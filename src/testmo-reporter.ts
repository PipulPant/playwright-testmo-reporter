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
import { logger } from './logger';
import { DEFAULT_RUN_NAME_PREFIX, MAX_BUFFER_SIZE } from './constants';

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

  /**
   * Creates a new TestmoReporter instance
   */
  constructor() {
    this.testmoClient = new TestmoClient();
    this.runName = `${DEFAULT_RUN_NAME_PREFIX} - ${new Date().toISOString()}`;
  }

  /**
   * Called when test execution begins
   * 
   * @param config - Playwright configuration
   * @param suite - Root test suite
   */
  onBegin(config: FullConfig, suite: Suite) {
    this.startTime = Date.now();
    
    if (!this.testmoClient.isConfigured()) {
      logger.warn('Testmo reporter: Testmo not configured. Skipping Testmo integration.');
      return;
    }

    logger.progress('Testmo reporter: Extracting Testmo case IDs from test files...');
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
          logger.debug(`Detected: "${test.title.substring(0, 50)}..." → Case #${testCaseId}`);
        }
      } else {
        notMappedCount++;
      }
    }

    const totalTests = suite.allTests().length;
    logger.success(`Testmo reporter: Found Testmo IDs for ${mappedCount} of ${totalTests} tests`);
    
    if (notMappedCount > 0) {
      logger.warn(`${notMappedCount} tests don't have Testmo case IDs. Run 'npx sync-testmo' to add them.`);
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

  /**
   * Converts Playwright test status to Testmo status
   * 
   * @param status - Playwright test status
   * @returns {string} Testmo status
   * @private
   */
  private convertStatus(status: string): 'passed' | 'failed' | 'skipped' | 'blocked' {
    switch (status) {
      case 'passed':
        return 'passed';
      case 'failed':
      case 'timedOut':
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

  /**
   * Called when test execution ends
   * 
   * @param result - Full test execution result
   */
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
      logger.progress('Testmo reporter: Submitting JUnit XML via Testmo CLI (recommended method)...');
      
      const cliSuccess = await this.submitViaCLI(runName, xmlFilePath, process.env.CI ? 'ci' : 'playwright');
      
      if (cliSuccess) {
        logger.success('Testmo reporter: Results submitted successfully via Testmo CLI');
        return;
      }
      
      logger.progress('Testmo reporter: CLI submission failed, trying JUnit XML API...');
      const xmlSuccess = await this.testmoClient.submitTestResultsFromXML(
        runName,
        xmlFilePath,
        process.env.CI ? 'ci' : 'playwright'
      );
      
      if (xmlSuccess) {
        logger.success('Testmo reporter: Results submitted successfully via JUnit XML API');
        return;
      }
    }

    if (this.testResults.length === 0) {
      logger.info('Testmo reporter: No test results to submit');
      return;
    }
    
    logger.progress(`Testmo reporter: Submitting ${this.testResults.length} test results via JSON API...`);
    const success = await this.testmoClient.submitTestResults(
      runName,
      this.testResults,
      process.env.CI ? 'ci' : 'playwright'
    );

    if (success) {
      logger.success('Testmo reporter: Results submitted successfully');
    } else {
      logger.error('Testmo reporter: Failed to submit results');
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
        maxBuffer: MAX_BUFFER_SIZE,
      });

      if (stdout) {
        logger.debug(`CLI output: ${stdout}`);
      }
      if (stderr) {
        logger.debug(`CLI stderr: ${stderr}`);
      }
      
      return true;
    } catch (error: any) {
      logger.debug(`CLI submission failed: ${error.message}`);
      return false;
    }
  }

  printsToStdout() {
    return true;
  }
}

