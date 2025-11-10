#!/usr/bin/env node
/**
 * CLI tool to sync Testmo test case IDs with Playwright tests
 * Usage: sync-testmo
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { TestmoClient } from '../testmo-client';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTestsFromFile(filePath: string): Array<{ line: number; title: string }> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const tests: Array<{ line: number; title: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const testMatch = lines[i].match(/test\s*\(['"`]([^'"`]+)['"`]/);
    if (testMatch) {
      tests.push({
        line: i + 1,
        title: testMatch[1],
      });
    }
  }

  return tests;
}

function hasTestmoIdPrefix(testTitle: string): boolean {
  return /^C\d+\s/.test(testTitle);
}

function extractTestmoIdFromTitle(testTitle: string): number | null {
  const match = testTitle.match(/^C(\d+)\s/);
  return match ? parseInt(match[1], 10) : null;
}

function updateTestTitleWithTestmoId(
  filePath: string,
  lineNumber: number,
  testCaseId: number,
  testTitle: string
): boolean {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const testLineIndex = lineNumber - 1;
  const testLine = lines[testLineIndex];

  const quoteMatch = testLine.match(/test\s*\((['"`])/);
  const quote = quoteMatch ? quoteMatch[1] : "'";
  
  if (hasTestmoIdPrefix(testTitle)) {
    const existingId = extractTestmoIdFromTitle(testTitle);
    if (existingId === testCaseId) {
      return false;
    }
    const titleWithoutPrefix = testTitle.replace(/^C\d+\s/, '');
    const newTitle = `C${testCaseId} ${titleWithoutPrefix}`;
    lines[testLineIndex] = testLine.replace(/test\s*\((['"`])([^'"`]+)(['"`])/, `test(${quote}${newTitle}${quote}`);
  } else {
    const newTitle = `C${testCaseId} ${testTitle}`;
    lines[testLineIndex] = testLine.replace(/test\s*\((['"`])([^'"`]+)(['"`])/, `test(${quote}${newTitle}${quote}`);
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
  return true;
}

function findMatchingTestCase(
  testTitle: string,
  testCases: any[],
  filePath?: string
): { testCase: any; confidence: 'exact' | 'partial' | 'low' } | null {
  const normalizedTitle = normalizeText(testTitle);

  for (const testCase of testCases) {
    const normalizedCaseName = normalizeText(testCase.name);
    if (normalizedTitle === normalizedCaseName) {
      return { testCase, confidence: 'exact' };
    }
  }

  for (const testCase of testCases) {
    const normalizedCaseName = normalizeText(testCase.name);
    if (normalizedTitle.includes(normalizedCaseName) || normalizedCaseName.includes(normalizedTitle)) {
      return { testCase, confidence: 'partial' };
    }
  }

  return null;
}

function findTestFiles(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!file.includes('node_modules') && !file.includes('__snapshots__')) {
        findTestFiles(filePath, fileList);
      }
    } else if (file.match(/\.(spec|test)\.(ts|js)$/)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

async function syncTestmoIds() {
  console.log('🔄 Starting Testmo ID sync...\n');

  const testmoClient = new TestmoClient();

  if (!testmoClient.isConfigured()) {
    console.error('❌ Testmo not configured. Please set TESTMO_URL, TESTMO_TOKEN, and TESTMO_PROJECT_ID in your .env file.');
    process.exit(1);
  }

  console.log('📥 Fetching test cases from Testmo...');
  const testCases = await testmoClient.fetchTestCases();

  if (testCases.length === 0) {
    console.error('❌ No test cases found in Testmo project.');
    process.exit(1);
  }

  console.log(`✅ Found ${testCases.length} test cases in Testmo project\n`);

  const testDir = process.argv[2] || 'tests';
  const testFiles = findTestFiles(path.resolve(testDir));

  console.log(`📁 Scanning tests in: ${testDir}`);
  console.log(`📁 Found ${testFiles.length} test files\n`);

  let totalMatched = 0;
  let totalUpdated = 0;
  const updatedFiles = new Set<string>();
  
  for (const testFile of testFiles) {
    const fullPath = path.resolve(testFile);
    const relativePath = path.relative(process.cwd(), fullPath);
    const tests = extractTestsFromFile(fullPath);

    for (const test of tests) {
      const existingId = extractTestmoIdFromTitle(test.title);
      let match = null;
      let testCaseId = existingId;

      if (existingId) {
        const existingCase = testCases.find(tc => tc.id === existingId);
        if (existingCase) {
          match = { testCase: existingCase, confidence: 'exact' as const };
          testCaseId = existingId;
        }
      }

      if (!match) {
        const titleWithoutPrefix = test.title.replace(/^C\d+\s/, '');
        const nameMatch = findMatchingTestCase(titleWithoutPrefix, testCases, fullPath);
        if (nameMatch) {
          match = nameMatch;
          testCaseId = nameMatch.testCase.id;
        }
      }

      if (match && testCaseId) {
        totalMatched++;
        const updated = updateTestTitleWithTestmoId(fullPath, test.line, testCaseId, test.title);
        if (updated) {
          updatedFiles.add(relativePath);
          totalUpdated++;
          const newTitle = hasTestmoIdPrefix(test.title) 
            ? test.title.replace(/^C\d+\s/, `C${testCaseId} `)
            : `C${testCaseId} ${test.title}`;
          console.log(`  ✓ [${match.confidence}] ${relativePath}:${test.line} → Testmo Case #${testCaseId}`);
          console.log(`    "${test.title}" → "${newTitle}"`);
        }
      }
    }
  }

  console.log(`\n✅ Sync complete!`);
  console.log(`   - Matched: ${totalMatched} tests`);
  console.log(`   - Updated: ${updatedFiles.size} test files`);
}

syncTestmoIds().catch((error) => {
  console.error('❌ Error syncing Testmo IDs:', error);
  process.exit(1);
});

