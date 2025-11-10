/**
 * Testmo API Client
 * Handles communication with Testmo REST API for test case retrieval and result submission
 */

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

  constructor() {
    let url = process.env.TESTMO_URL || '';
    // Remove trailing slash if present
    this.baseUrl = url.replace(/\/$/, '');
    this.token = process.env.TESTMO_TOKEN || '';
    // Support both TESTMO_PROJECT_ID and TESTMO_REPOSITORY_ID for backward compatibility
    this.projectId = parseInt(process.env.TESTMO_PROJECT_ID || process.env.TESTMO_REPOSITORY_ID || '1', 10);
    // Get group_id from environment variable if provided
    this.groupId = process.env.TESTMO_GROUP_ID ? parseInt(process.env.TESTMO_GROUP_ID, 10) : null;

    if (!this.baseUrl || !this.token) {
      console.warn('⚠️  Testmo credentials not configured. Set TESTMO_URL and TESTMO_TOKEN environment variables.');
    }
  }

  /**
   * Check if Testmo is properly configured
   */
  isConfigured(): boolean {
    return !!this.baseUrl && !!this.token;
  }

  /**
   * Fetch all test cases from Testmo repository
   */
  async fetchTestCases(): Promise<TestmoTestCase[]> {
    if (!this.isConfigured()) {
      return [];
    }

    if (this.testCasesCache) {
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
        console.log(`🎯 Filtering test cases by group_id: ${this.groupId}`);
      }
      const queryString = queryParams.toString();
      const querySuffix = queryString ? `?${queryString}` : '';

      // Try different possible API endpoint structures
      const endpoints = [
        `${this.baseUrl}/api/v1/projects/${this.projectId}/cases${querySuffix}`,
        `${this.baseUrl}/api/v1/repositories/${this.projectId}/cases${querySuffix}`,
        `${this.baseUrl}/api/v1/projects/${this.projectId}/testcases${querySuffix}`,
      ];

      let data: any = null;
      let lastError: Error | null = null;

      for (const url of endpoints) {
        try {
          console.log(`🔍 Trying endpoint: ${url}`);
          
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.log(`⚠️  Endpoint failed: ${response.status} ${response.statusText}`);
            lastError = new Error(`Failed: ${response.status} - ${errorText}`);
            continue; // Try next endpoint
          }

          data = await response.json();
          console.log(`✅ Success with endpoint: ${url}`);
          break; // Success, exit loop
        } catch (error: any) {
          console.log(`⚠️  Endpoint error: ${error.message}`);
          lastError = error;
          continue; // Try next endpoint
        }
      }

      if (!data) {
        throw lastError || new Error('All API endpoints failed');
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
      
      console.log(`📄 Page ${currentPage} of ${lastPage}: Found ${pageTestCases.length} test cases (Total: ${total})`);
      
      // Fetch remaining pages if there are more
      if (lastPage > 1 && currentPage < lastPage) {
        console.log(`📥 Fetching remaining pages (${lastPage - currentPage} more pages)...`);
        
        for (let page = currentPage + 1; page <= lastPage; page++) {
          try {
            // Build URL with pagination and group_id
            const baseUrl = endpoints[0].split('?')[0]; // Get base URL without query params
            const pageParams = new URLSearchParams();
            if (this.groupId) {
              pageParams.append('group_id', this.groupId.toString());
            }
            pageParams.append('page', page.toString());
            const pageUrl = `${baseUrl}?${pageParams.toString()}`;
            console.log(`🔍 Fetching page ${page}/${lastPage}...`);
            
            const pageResponse = await fetch(pageUrl, {
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
              console.log(`✅ Page ${page}: Found ${pageCases.length} test cases`);
            } else {
              console.log(`⚠️  Failed to fetch page ${page}: ${pageResponse.status}`);
            }
          } catch (error: any) {
            console.log(`⚠️  Error fetching page ${page}: ${error.message}`);
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

      console.log(`✅ Fetched ${testCases.length} test cases from Testmo project ${this.projectId}`);
      return testCases;
    } catch (error) {
      console.error('❌ Error fetching test cases from Testmo:', error);
      return [];
    }
  }

  /**
   * Find a test case by matching test name
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
   */
  async submitTestResultsFromXML(
    runName: string,
    xmlFilePath: string,
    source?: string
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('⚠️  Testmo not configured, skipping result submission');
      return false;
    }

    const fs = await import('fs');
    const path = await import('path');

    if (!fs.existsSync(xmlFilePath)) {
      console.error(`❌ JUnit XML file not found: ${xmlFilePath}`);
      return false;
    }

    try {
      const xmlContent = fs.readFileSync(xmlFilePath, 'utf-8');
      console.log(`\n📤 Submitting JUnit XML file to Testmo...`);
      console.log(`   File: ${xmlFilePath}`);
      console.log(`   Size: ${(xmlContent.length / 1024).toFixed(2)} KB`);

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
        `${this.baseUrl}/api/v1/projects/${this.projectId}/automation/runs`,
        `${this.baseUrl}/api/v1/projects/${this.projectId}/automation/runs/submit`,
        `${this.baseUrl}/api/v1/automation/runs`,
        `${this.baseUrl}/api/v1/automation/runs/submit`,
      ];

      let lastError: Error | null = null;
      
      for (const endpoint of endpoints) {
        try {
          console.log(`   Trying endpoint: ${endpoint}`);
          
          const response = await fetch(endpoint, {
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
            
            console.log(`✅ Successfully submitted JUnit XML to Testmo`);
            console.log(`   Endpoint: ${endpoint}`);
            console.log(`   Run ID: ${responseData.id || responseData.run_id || 'N/A'}`);
            console.log(`   View run: ${this.baseUrl}/projects/${this.projectId}/automation/runs/${responseData.id || responseData.run_id || ''}`);
            
            // Try to complete the run
            const runId = responseData.id || responseData.run_id;
            if (runId) {
              await this.completeRun(runId);
            }
            
            return true;
          } else {
            console.log(`   ⚠️  Endpoint ${endpoint} failed: ${response.status} ${response.statusText}`);
            console.log(`   Error: ${responseText.substring(0, 200)}`);
            lastError = new Error(`Failed: ${response.status} - ${responseText.substring(0, 200)}`);
            continue;
          }
        } catch (error: any) {
          console.log(`   ⚠️  Endpoint ${endpoint} error: ${error.message}`);
          lastError = error;
          continue;
        }
      }
      
      console.error(`❌ Failed to submit JUnit XML to all endpoints`);
      if (lastError) {
        console.error(`   Last error: ${lastError.message}`);
      }
      return false;
    } catch (error: any) {
      console.error(`❌ Error submitting JUnit XML: ${error.message}`);
      return false;
    }
  }

  /**
   * Submit test results to Testmo
   */
  async submitTestResults(
    runName: string,
    results: TestmoTestResult[],
    source?: string
  ): Promise<boolean> {
    if (!this.isConfigured()) {
      console.warn('⚠️  Testmo not configured, skipping result submission');
      return false;
    }

    if (results.length === 0) {
      console.log('ℹ️  No test results to submit');
      return true;
    }

    try {
      const correctEndpoint = `${this.baseUrl}/api/v1/projects/${this.projectId}/automation/runs`;
      
      const validSources = [
        'playwright',
        'automation',
        'ci',
        'local',
        source || 'playwright',
      ].filter(s => s && /^[a-zA-Z0-9-]+$/.test(s));

      const payload = {
        name: runName,
        source: validSources[0] || 'playwright',
        results: results,
      };

      const response = await fetch(correctEndpoint, {
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
        if (runId) {
          await this.completeRun(runId);
        }
        return true;
      } else {
        const errorText = await response.text();
        console.error(`❌ Failed to submit results: ${response.status} - ${errorText.substring(0, 200)}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Error submitting test results to Testmo:', error);
      return false;
    }
  }

  /**
   * Complete a test run in Testmo
   */
  private async completeRun(runId: number | string): Promise<void> {
    console.log(`   🔄 Attempting to complete run ${runId}...`);
    try {
      const completeEndpoints = [
        `${this.baseUrl}/api/v1/projects/${this.projectId}/automation/runs/${runId}/complete`,
        `${this.baseUrl}/api/v1/automation/runs/${runId}/complete`,
        `${this.baseUrl}/api/v1/repositories/${this.projectId}/automation/runs/${runId}/complete`,
      ];
      
      for (const endpoint of completeEndpoints) {
        try {
          const completeResponse = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (completeResponse.ok) {
            console.log(`   ✅ Run completed successfully`);
            return;
          }
        } catch (e: any) {
          // Continue to next endpoint
        }
      }
    } catch (e: any) {
      // Silently fail
    }
  }

  /**
   * Clear the test cases cache (useful for refreshing)
   */
  clearCache(): void {
    this.testCasesCache = null;
  }
}

export type { TestmoTestCase, TestmoTestResult };

