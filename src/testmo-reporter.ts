/**
 * Testmo Reporter for Playwright
 * Automatically maps tests to Testmo test cases and submits results
 */

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TestmoClient } from './testmo-client';

const execAsync = promisify(exec);

interface MappedTestResult {
  case_id: number;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  comment?: string;
  duration?: number;
  error?: string;
}

export default class TestmoReporter implements Reporter {
  private testmoClient: TestmoClient;
  private testCaseMap: Map<string, number> = new Map();
  private testResults: MappedTestResult[] = [];
  private runName: string;
  private startTime: number = 0;

  constructor() {
    this.testmoClient = new TestmoClient();
    this.runName = `Playwright Test Run - ${new Date().toISOString()}`;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    
    if (!this.testmoClient.isConfigured()) {
      console.log('⚠️  Testmo reporter: Testmo not configured. Skipping Testmo integration.');
      return;
    }

    console.log('🔄 Testmo reporter: Extracting Testmo case IDs from test files...');
    this.extractTestmoIdsFromFiles(suite);
  }

  private extractTestmoIdsFromFiles(suite: Suite) {
    let mappedCount = 0;
    let notMappedCount = 0;

    for (const test of suite.allTests()) {
      const testKey = this.getTestKey(test);
      const testCaseId = this.extractTestmoIdFromTest(test);

      if (testCaseId) {
        this.testCaseMap.set(testKey, testCaseId);
        mappedCount++;
        if (mappedCount <= 5) {
          console.log(`   ✓ Detected: "${test.title.substring(0, 50)}..." → Case #${testCaseId}`);
        }
      } else {
        notMappedCount++;
      }
    }

    const totalTests = suite.allTests().length;
    console.log(`✅ Testmo reporter: Found Testmo IDs for ${mappedCount} of ${totalTests} tests`);
    
    if (notMappedCount > 0) {
      console.log(`⚠️  ${notMappedCount} tests don't have Testmo case IDs. Run 'sync-testmo' to add them.`);
    }
  }

  private extractTestmoIdFromTest(test: TestCase): number | null {
    // Primary method: Extract from test title using C{ID} prefix
    const cIdMatch = test.title.match(/\bC(\d+)(?:\s|[-:]|$)/);
    if (cIdMatch) {
      return parseInt(cIdMatch[1], 10);
    }

    // Fallback: Check test title for TC-123 pattern
    const titleMatch = test.title.match(/\[?TC[_-]?(\d+)\]?/i);
    if (titleMatch) {
      return parseInt(titleMatch[1], 10);
    }

    // Legacy support: Check file for comment-based IDs
    try {
      const filePath = test.location.file;
      const lineNumber = test.location.line;
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(0, lineNumber - 4);
      const endLine = Math.min(lines.length, lineNumber + 1);

      for (let i = startLine; i < endLine; i++) {
        const idMatch = lines[i].match(/@testmo-id:\s*(\d+)/i);
        if (idMatch) {
          return parseInt(idMatch[1], 10);
        }
      }
    } catch (error) {
      // Silently skip
    }

    return null;
  }

  private getTestKey(test: TestCase): string {
    return `${test.location.file}:${test.title}`;
  }

  private convertStatus(status: string): 'passed' | 'failed' | 'skipped' | 'blocked' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
        return 'failed';
      case 'skipped':
      case 'interrupted':
        return 'skipped';
      default:
        return 'blocked';
    }
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (!this.testmoClient.isConfigured()) {
      return;
    }

    const testKey = this.getTestKey(test);
    let testCaseId: number | undefined = this.testCaseMap.get(testKey);

    if (!testCaseId) {
      const extractedId = this.extractTestmoIdFromTest(test);
      if (extractedId !== null) {
        testCaseId = extractedId;
        this.testCaseMap.set(testKey, testCaseId);
      }
    }

    if (!testCaseId) {
      return;
    }

    const status = this.convertStatus(result.status);
    const duration = result.duration;
    
    let error: string | undefined;
    let comment: string | undefined;
    
    if (result.status === 'failed' && result.error) {
      error = result.error.message;
      comment = `Test failed: ${result.error.message}\n${result.error.stack || ''}`;
    } else if (result.status === 'skipped') {
      comment = 'Test was skipped';
    }

    this.testResults.push({
      case_id: testCaseId,
      status,
      comment,
      duration: Math.round(duration),
      error,
    });
  }

  async onEnd(result: FullResult) {
    if (!this.testmoClient.isConfigured()) {
      return;
    }

    const duration = Date.now() - this.startTime;
    const runName = `${this.runName} (${Math.round(duration / 1000)}s)`;
    
    const xmlFilePath = './test-results/results.xml';
    const fs = await import('fs');
    const path = await import('path');
    
    if (fs.existsSync(xmlFilePath)) {
      console.log(`\n🔄 Testmo reporter: Submitting JUnit XML via Testmo CLI (recommended method)...`);
      
      const cliSuccess = await this.submitViaCLI(runName, xmlFilePath, process.env.CI ? 'ci' : 'playwright');
      
      if (cliSuccess) {
        console.log('✅ Testmo reporter: Results submitted successfully via Testmo CLI');
        return;
      }
      
      const xmlSuccess = await this.testmoClient.submitTestResultsFromXML(
        runName,
        xmlFilePath,
        process.env.CI ? 'ci' : 'playwright'
      );
      
      if (xmlSuccess) {
        console.log('✅ Testmo reporter: Results submitted successfully via JUnit XML API');
        return;
      }
    }

    if (this.testResults.length === 0) {
      console.log('ℹ️  Testmo reporter: No test results to submit');
      return;
    }
    
    const success = await this.testmoClient.submitTestResults(
      runName,
      this.testResults,
      process.env.CI ? 'ci' : 'playwright'
    );

    if (success) {
      console.log('✅ Testmo reporter: Results submitted successfully');
    } else {
      console.error('❌ Testmo reporter: Failed to submit results');
    }
  }

  private async submitViaCLI(
    runName: string,
    xmlFilePath: string,
    source: string
  ): Promise<boolean> {
    try {
      const dotenv = await import('dotenv');
      dotenv.config();
      
      const testmoUrl = process.env.TESTMO_URL?.replace(/\/$/, '') || '';
      const testmoToken = process.env.TESTMO_TOKEN || '';
      const projectId = process.env.TESTMO_PROJECT_ID || process.env.TESTMO_REPOSITORY_ID || '1';

      if (!testmoUrl || !testmoToken) {
        return false;
      }

      try {
        await execAsync('testmo --version');
      } catch {
        return false;
      }

      const escapedRunName = runName.replace(/"/g, '\\"');
      const absoluteXmlPath = path.resolve(xmlFilePath);
      const command = `testmo automation:run:submit --instance "${testmoUrl}" --project-id ${projectId} --name "${escapedRunName}" --source "${source}" --results "${absoluteXmlPath}"`;

      const { stdout, stderr } = await execAsync(command, {
        env: {
          ...process.env,
          TESTMO_TOKEN: testmoToken,
        },
        maxBuffer: 10 * 1024 * 1024,
      });

      if (stdout) {
        console.log(`   ${stdout}`);
      }
      
      return true;
    } catch (error: any) {
      return false;
    }
  }

  printsToStdout() {
    return true;
  }
}

