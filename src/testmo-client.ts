/**
 * Testmo API Client
 * Handles communication with Testmo REST API for test case retrieval and result submission
 */

import { logger } from './logger';
import { validateConfig, type TestmoConfig } from './config';
import { DEFAULT_TIMEOUT, API_ENDPOINTS, VALID_SOURCES, DEFAULT_SOURCE } from './constants';

interface TestmoTestCase {
  id: number;
  name: string;
  full_name: string;
  path: string;
  automation_key?: string;
  automation_id?: string;
}

interface TestmoTestCasesResponse {
  cases: TestmoTestCase[];
}

interface TestmoTestResult {
  case_id: number;
  status: 'passed' | 'failed' | 'skipped' | 'blocked';
  comment?: string;
  duration?: number;
  error?: string;
  // Alternative field names that Testmo might expect
  caseId?: number;
  test_case_id?: number;
  result?: string;
}

interface TestmoRunSubmitRequest {
  name: string;
  source?: string;
  results: TestmoTestResult[];
}

export class TestmoClient {
  private baseUrl: string;
  private token: string;
  private projectId: number;
  private groupId: number | null;
  private testCasesCache: Map<string, TestmoTestCase> | null = null;
  private config: TestmoConfig | null = null;
  private timeout: number;

  /**
   * Creates a new TestmoClient instance
   * 
   * @param config - Optional Testmo configuration. If not provided, will attempt to load from environment variables.
   * @throws {Error} If configuration is invalid
   */
  constructor(config?: TestmoConfig) {
    try {
      this.config = config || validateConfig();
      this.baseUrl = this.config.url;
      this.token = this.config.token;
      this.projectId = this.config.projectId;
      this.groupId = this.config.groupId || null;
      this.timeout = this.config.timeout;
    } catch (error) {
      // Fallback to old behavior for backward compatibility
      let url = process.env.TESTMO_URL || '';
      this.baseUrl = url.replace(/\/$/, '');
      this.token = process.env.TESTMO_TOKEN || '';
      this.projectId = parseInt(process.env.TESTMO_PROJECT_ID || process.env.TESTMO_REPOSITORY_ID || '1', 10);
      this.groupId = process.env.TESTMO_GROUP_ID ? parseInt(process.env.TESTMO_GROUP_ID, 10) : null;
      this.timeout = parseInt(process.env.TESTMO_TIMEOUT || String(DEFAULT_TIMEOUT), 10);

      if (!this.baseUrl || !this.token) {
        logger.warn('Testmo credentials not configured. Set TESTMO_URL and TESTMO_TOKEN environment variables.');
      }
    }
  }

  /**
   * Check if Testmo is properly configured
   * 
   * @returns {boolean} True if Testmo is configured with valid credentials
   */
  isConfigured(): boolean {
    return !!this.baseUrl && !!this.token;
  }

  /**
   * Makes a fetch request with timeout and error handling
   * 
   * @param url - The URL to fetch
   * @param options - Fetch options
   * @returns {Promise<Response>} The fetch response
   * @throws {Error} If the request times out or fails
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${this.timeout}ms. Check your network connection or increase TESTMO_TIMEOUT.`);
      }
      throw error;
    }
  }

  /**
   * Fetch all test cases from Testmo repository
   * 
   * @returns {Promise<TestmoTestCase[]>} Array of test cases from Testmo
   * 
   * @example
   * ```typescript
   * const testCases = await client.fetchTestCases();
   * console.log(`Fetched ${testCases.length} test cases`);
   * ```
   */
  async fetchTestCases(): Promise<TestmoTestCase[]> {
    if (!this.isConfigured()) {
      logger.warn('Cannot fetch test cases: Testmo not configured');
      return [];
    }

    if (this.testCasesCache) {
      logger.debug('Returning cached test cases', { count: this.testCasesCache.size });
      return Array.from(this.testCasesCache.values());
    }

    try {
      // Check if fetch is available (Node.js 18+)
      if (typeof fetch === 'undefined') {
        throw new Error('fetch API is not available. Please use Node.js 18 or higher.');
      }

      // Build query parameters
      const queryParams = new URLSearchParams();
      if (this.groupId) {
        queryParams.append('group_id', this.groupId.toString());
        logger.info(`Filtering test cases by group_id: ${this.groupId}`);
      }
      const queryString = queryParams.toString();
      const querySuffix = queryString ? `?${queryString}` : '';

      // Try different possible API endpoint structures
      const endpoints = [
        `${this.baseUrl}${API_ENDPOINTS.CASES.replace('{id}', String(this.projectId))}${querySuffix}`,
        `${this.baseUrl}${API_ENDPOINTS.CASES_REPO.replace('{id}', String(this.projectId))}${querySuffix}`,
        `${this.baseUrl}${API_ENDPOINTS.CASES_TESTCASES.replace('{id}', String(this.projectId))}${querySuffix}`,
      ];

      let data: any = null;
      let lastError: Error | null = null;
      let successfulEndpoint = '';

      for (const url of endpoints) {
        try {
          logger.debug(`Trying endpoint: ${url}`);
          
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            logger.debug(`Endpoint failed: ${response.status} ${response.statusText}`, { error: errorText.substring(0, 200) });
            lastError = new Error(`API request failed with status ${response.status}: ${errorText.substring(0, 200)}`);
            continue; // Try next endpoint
          }

          data = await response.json();
          successfulEndpoint = url;
          logger.success(`Successfully connected to Testmo API: ${url}`);
          break; // Success, exit loop
        } catch (error: any) {
          logger.debug(`Endpoint error: ${error.message}`);
          lastError = error;
          continue; // Try next endpoint
        }
      }

      if (!data) {
        const errorMessage = lastError 
          ? `Failed to fetch test cases from Testmo. ${lastError.message}`
          : 'All API endpoints failed. Please check your TESTMO_URL and TESTMO_PROJECT_ID.';
        throw new Error(errorMessage);
      }
      
      // Handle pagination - Testmo API returns paginated results
      let allTestCases: any[] = [];
      
      // Handle different possible response structures
      let currentPage = data.page || 1;
      const lastPage = data.last_page || 1;
      const perPage = data.per_page || 100;
      const total = data.total || 0;
      
      // Extract test cases from current page
      const pageTestCases = data.result || data.cases || data.data?.cases || data.items || data.data?.items || data.testcases || [];
      allTestCases = [...pageTestCases];
      
      logger.info(`Page ${currentPage} of ${lastPage}: Found ${pageTestCases.length} test cases (Total: ${total})`);
      
      // Fetch remaining pages if there are more
      if (lastPage > 1 && currentPage < lastPage) {
        const remainingPages = lastPage - currentPage;
        logger.progress(`Fetching remaining pages (${remainingPages} more pages)...`);
        
        for (let page = currentPage + 1; page <= lastPage; page++) {
          try {
            // Build URL with pagination and group_id
            const baseUrl = successfulEndpoint.split('?')[0]; // Get base URL without query params
            const pageParams = new URLSearchParams();
            if (this.groupId) {
              pageParams.append('group_id', this.groupId.toString());
            }
            pageParams.append('page', page.toString());
            const pageUrl = `${baseUrl}?${pageParams.toString()}`;
            logger.debug(`Fetching page ${page}/${lastPage}...`);
            
            const pageResponse = await this.fetchWithTimeout(pageUrl, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json',
              },
            });

            if (pageResponse.ok) {
              const pageData: any = await pageResponse.json();
              const pageCases = pageData.result || pageData.cases || [];
              allTestCases = [...allTestCases, ...pageCases];
              logger.debug(`Page ${page}: Found ${pageCases.length} test cases`);
            } else {
              logger.warn(`Failed to fetch page ${page}: ${pageResponse.status}`);
            }
          } catch (error: any) {
            logger.warn(`Error fetching page ${page}: ${error.message}`);
          }
        }
      }
      
      const testCases = allTestCases;

      // Build cache for quick lookup
      this.testCasesCache = new Map();
      testCases.forEach(testCase => {
        // Store by multiple keys for flexible matching
        const normalizedName = this.normalizeTestName(testCase.name);
        this.testCasesCache!.set(normalizedName, testCase);
        
        // Also store by full name if different
        if (testCase.full_name && testCase.full_name !== testCase.name) {
          const normalizedFullName = this.normalizeTestName(testCase.full_name);
          this.testCasesCache!.set(normalizedFullName, testCase);
        }
      });

      logger.success(`Fetched ${testCases.length} test cases from Testmo project ${this.projectId}`);
      return testCases;
    } catch (error: any) {
      logger.error('Error fetching test cases from Testmo', error);
      return [];
    }
  }

  /**
   * Find a test case by matching test name
   * 
   * @param testName - The name of the test to find
   * @param filePath - Optional file path to help with matching
   * @returns {Promise<TestmoTestCase | null>} The matching test case or null if not found
   * 
   * @example
   * ```typescript
   * const testCase = await client.findTestCaseByTestName('Login test', './tests/login.spec.ts');
   * if (testCase) console.log(`Found: ${testCase.name}`);
   * ```
   */
  async findTestCaseByTestName(testName: string, filePath?: string): Promise<TestmoTestCase | null> {
    if (!this.isConfigured()) {
      return null;
    }

    // Ensure cache is populated
    if (!this.testCasesCache) {
      await this.fetchTestCases();
    }

    if (!this.testCasesCache || this.testCasesCache.size === 0) {
      return null;
    }

    // Try exact match first
    const normalizedName = this.normalizeTestName(testName);
    let testCase = this.testCasesCache.get(normalizedName);

    // Try partial match if exact match fails
    if (!testCase) {
      for (const [key, value] of Array.from(this.testCasesCache.entries())) {
        if (key.includes(normalizedName) || normalizedName.includes(key)) {
          testCase = value;
          break;
        }
      }
    }

    // Try matching by file path if available
    if (!testCase && filePath) {
      const fileName = filePath.split('/').pop()?.replace('.spec.ts', '').replace('.test.ts', '') || '';
      const normalizedFileName = this.normalizeTestName(fileName);
      
      for (const [key, value] of Array.from(this.testCasesCache.entries())) {
        if (key.includes(normalizedFileName) || normalizedFileName.includes(key)) {
          testCase = value;
          break;
        }
      }
    }

    return testCase || null;
  }

  /**
   * Normalize test name for matching (remove special chars, lowercase, etc.)
   */
  private normalizeTestName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Submit test results to Testmo using JUnit XML file (like Testmo CLI)
   * This method uploads the JUnit XML file directly, which Testmo can parse and link automatically
   * 
   * @param runName - Name for the test run in Testmo
   * @param xmlFilePath - Path to the JUnit XML file
   * @param source - Source identifier (e.g., 'playwright', 'ci', 'local')
   * @returns {Promise<boolean>} True if submission was successful
   * 
   * @example
   * ```typescript
   * const success = await client.submitTestResultsFromXML(
   *   'Nightly Test Run',
   *   './test-results/results.xml',
   *   'ci'
   * );
   * ```
   */
  async submitTestResultsFromXML(
    runName: string,
    xmlFilePath: string,
    source?: string
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('Testmo not configured, skipping result submission');
      return false;
    }

    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(xmlFilePath)) {
      logger.error(`JUnit XML file not found: ${xmlFilePath}. Make sure you have the junit reporter configured in playwright.config.ts`);
      return false;
    }

    try {
      const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
      logger.progress('Submitting JUnit XML file to Testmo...');
      logger.debug(`File: ${xmlFilePath}, Size: ${(xmlContent.length / 1024).toFixed(2)} KB`);

      // Try submitting XML as multipart form data (like Testmo CLI does)
      // In Node.js 18+, FormData and Blob are available globally
      const formData = new FormData();
      formData.append('name', runName);
      formData.append('source', source || 'playwright');
      
      // Create a Blob from the XML content
      // Blob is available in Node.js 18+ globally
      const blob = new Blob([xmlContent], { type: 'application/xml' });
      formData.append('results', blob, path.basename(xmlFilePath));

      // Try multiple endpoints - Testmo might use different endpoints for XML submission
      const endpoints = [
        `${this.baseUrl}${API_ENDPOINTS.AUTOMATION_RUNS.replace('{id}', String(this.projectId))}`,
        `${this.baseUrl}${API_ENDPOINTS.AUTOMATION_RUNS_SUBMIT.replace('{id}', String(this.projectId))}`,
        `${this.baseUrl}${API_ENDPOINTS.AUTOMATION_RUNS_GLOBAL}`,
        `${this.baseUrl}${API_ENDPOINTS.AUTOMATION_RUNS_GLOBAL_SUBMIT}`,
      ];

      let lastError: Error | null = null;
      
      for (const endpoint of endpoints) {
        try {
          logger.debug(`Trying endpoint: ${endpoint}`);
          
          const response = await this.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.token}`,
              // Don't set Content-Type - let fetch set it with boundary for FormData
            },
            body: formData,
          });

          const responseText = await response.text();
          
          if (response.ok) {
            let responseData: any;
            try {
              responseData = JSON.parse(responseText);
            } catch {
              responseData = { message: responseText };
            }
            
            const runId = responseData.id || responseData.run_id;
            logger.success(`Successfully submitted JUnit XML to Testmo`);
            logger.info(`Run ID: ${runId || 'N/A'}`);
            if (runId) {
              logger.info(`View run: ${this.baseUrl}/projects/${this.projectId}/automation/runs/${runId}`);
            }
            
            // Try to complete the run
            if (runId) {
              await this.completeRun(runId);
            }
            
            return true;
          } else {
            logger.debug(`Endpoint ${endpoint} failed: ${response.status} ${response.statusText}`);
            logger.debug(`Error: ${responseText.substring(0, 200)}`);
            lastError = new Error(`API request failed with status ${response.status}: ${responseText.substring(0, 200)}`);
            continue;
          }
        } catch (error: any) {
          logger.debug(`Endpoint ${endpoint} error: ${error.message}`);
          lastError = error;
          continue;
        }
      }
      
      logger.error(`Failed to submit JUnit XML to all endpoints`);
      if (lastError) {
        logger.error(`Last error: ${lastError.message}`);
      }
      return false;
    } catch (error: any) {
      logger.error(`Error submitting JUnit XML: ${error.message}`, error);
      return false;
    }
  }

  /**
   * Submit test results to Testmo
   * 
   * @param runName - Name for the test run in Testmo
   * @param results - Array of test results to submit
   * @param source - Source identifier (e.g., 'playwright', 'ci', 'local')
   * @returns {Promise<boolean>} True if submission was successful
   * 
   * @example
   * ```typescript
   * const results = [
   *   { case_id: 123, status: 'passed', duration: 1500 },
   *   { case_id: 124, status: 'failed', error: 'Test failed' }
   * ];
   * const success = await client.submitTestResults('Test Run', results, 'ci');
   * ```
   */
  async submitTestResults(
    runName: string,
    results: TestmoTestResult[],
    source?: string
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn('Testmo not configured, skipping result submission');
      return false;
    }

    if (results.length === 0) {
      logger.info('No test results to submit');
      return true;
    }

    try {
      const correctEndpoint = `${this.baseUrl}${API_ENDPOINTS.AUTOMATION_RUNS.replace('{id}', String(this.projectId))}`;
      
      const validSources = [
        ...VALID_SOURCES,
        source || DEFAULT_SOURCE,
      ].filter(s => s && /^[a-zA-Z0-9-]+$/.test(s));

      const payload = {
        name: runName,
        source: validSources[0] || DEFAULT_SOURCE,
        results: results,
      };

      logger.debug(`Submitting ${results.length} test results to Testmo`, { endpoint: correctEndpoint, runName });

      const response = await this.fetchWithTimeout(correctEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        const responseData: any = await response.json();
        const runId = responseData.id || responseData.run_id;
        logger.success(`Successfully submitted ${results.length} test results to Testmo`);
        if (runId) {
          logger.info(`Run ID: ${runId}`);
          await this.completeRun(runId);
        }
        return true;
      } else {
        const errorText = await response.text();
        logger.error(`Failed to submit results: ${response.status} - ${errorText.substring(0, 200)}`);
        return false;
      }
    } catch (error: any) {
      logger.error('Error submitting test results to Testmo', error);
      return false;
    }
  }

  /**
   * Complete a test run in Testmo
   * 
   * @param runId - The ID of the run to complete
   * @private
   */
  private async completeRun(runId: number | string): Promise<void> {
    logger.debug(`Attempting to complete run ${runId}...`);
    try {
      const completeEndpoints = [
        `${this.baseUrl}${API_ENDPOINTS.RUN_COMPLETE.replace('{id}', String(this.projectId)).replace('{runId}', String(runId))}`,
        `${this.baseUrl}${API_ENDPOINTS.RUN_COMPLETE_GLOBAL.replace('{runId}', String(runId))}`,
        `${this.baseUrl}${API_ENDPOINTS.RUN_COMPLETE_REPO.replace('{id}', String(this.projectId)).replace('{runId}', String(runId))}`,
      ];
      
      for (const endpoint of completeEndpoints) {
        try {
          const completeResponse = await this.fetchWithTimeout(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (completeResponse.ok) {
            logger.debug(`Run ${runId} completed successfully`);
            return;
          }
        } catch (e: any) {
          logger.debug(`Failed to complete run via ${endpoint}: ${e.message}`);
          // Continue to next endpoint
        }
      }
    } catch (e: any) {
      logger.debug(`Error completing run: ${e.message}`);
      // Silently fail - completion is optional
    }
  }

  /**
   * Clear the test cases cache (useful for refreshing)
   * 
   * @example
   * ```typescript
   * client.clearCache();
   * const freshCases = await client.fetchTestCases();
   * ```
   */
  clearCache(): void {
    this.testCasesCache = null;
    logger.debug('Test cases cache cleared');
  }
}

export type { TestmoTestCase, TestmoTestResult };

