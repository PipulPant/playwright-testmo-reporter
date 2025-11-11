#!/usr/bin/env node
/**
 * CLI tool to sync Testmo test case IDs with Playwright tests
 * 
 * Usage:
 *   sync-testmo [directory] [options]
 * 
 * Options:
 *   --help, -h     Show help message
 *   --verbose, -v  Enable verbose logging
 * 
 * Examples:
 *   sync-testmo                    # Sync tests in ./tests directory
 *   sync-testmo tests/e2e         # Sync tests in specific directory
 *   sync-testmo --verbose          # Enable verbose output
 */

import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import * as path from 'path';
import { TestmoClient } from '../testmo-client';
import { logger } from '../logger';
import { validateConfig } from '../config';

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
  // Parse command line arguments
  const args = process.argv.slice(2);
  const helpIndex = args.findIndex(arg => arg === '--help' || arg === '-h');
  const verboseIndex = args.findIndex(arg => arg === '--verbose' || arg === '-v');
  
  if (helpIndex !== -1) {
    console.log(`
Usage: sync-testmo [directory] [options]

Sync Testmo test case IDs with Playwright tests by adding C{ID} prefixes to test titles.

Arguments:
  directory              Test directory to scan (default: tests)

Options:
  --help, -h             Show this help message
  --verbose, -v          Enable verbose logging for debugging

Environment Variables:
  TESTMO_URL             Your Testmo instance URL (required)
  TESTMO_TOKEN           Your Testmo API token (required)
  TESTMO_PROJECT_ID      Your Testmo project ID (required)
  TESTMO_GROUP_ID        Optional: Filter by group ID
  TESTMO_VERBOSE         Enable verbose logging (set to 'true')

Examples:
  sync-testmo                           # Sync tests in ./tests directory
  sync-testmo tests/e2e/frontend       # Sync tests in specific directory
  sync-testmo --verbose                # Enable verbose output
  TESTMO_VERBOSE=true sync-testmo       # Enable verbose via env var

For more information, visit:
  https://github.com/PipulPant/playwright-testmo-reporter
`);
    process.exit(0);
  }

  const verbose = verboseIndex !== -1 || process.env.TESTMO_VERBOSE === 'true';
  logger.setVerbose(verbose);
  
  const testDirArg = args.filter(arg => !arg.startsWith('--') && !arg.startsWith('-'))[0];
  const testDir = testDirArg || 'tests';

  logger.progress('Starting Testmo ID sync...\n');

  // Validate configuration
  try {
    validateConfig();
  } catch (error: any) {
    logger.error('Configuration error', error);
    process.exit(1);
  }

  const testmoClient = new TestmoClient();

  if (!testmoClient.isConfigured()) {
    logger.error('Testmo not configured. Please set TESTMO_URL, TESTMO_TOKEN, and TESTMO_PROJECT_ID in your .env file.');
    process.exit(1);
  }

  logger.progress('Fetching test cases from Testmo...');
  const testCases = await testmoClient.fetchTestCases();

  if (testCases.length === 0) {
    logger.error('No test cases found in Testmo project. Please check your TESTMO_PROJECT_ID and TESTMO_GROUP_ID.');
    process.exit(1);
  }

  logger.success(`Found ${testCases.length} test cases in Testmo project\n`);

  const testFiles = findTestFiles(path.resolve(testDir));

  logger.info(`Scanning tests in: ${testDir}`);
  logger.info(`Found ${testFiles.length} test files\n`);

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
          logger.info(`[${match.confidence}] ${relativePath}:${test.line} → Testmo Case #${testCaseId}`);
          logger.debug(`  "${test.title}" → "${newTitle}"`);
        }
      }
    }
  }

  logger.success('\nSync complete!');
  logger.info(`   - Matched: ${totalMatched} tests`);
  logger.info(`   - Updated: ${updatedFiles.size} test files`);
  
  if (totalMatched === 0) {
    logger.warn('No tests were matched. Make sure your test names match Testmo case names.');
  }
}

syncTestmoIds().catch((error) => {
  logger.error('Error syncing Testmo IDs', error);
  process.exit(1);
});

