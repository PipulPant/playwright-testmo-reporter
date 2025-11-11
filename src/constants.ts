/**
 * Constants used throughout the Testmo reporter
 */

export const DEFAULT_TIMEOUT = 30000; // 30 seconds
export const MAX_RETRIES = 3;
export const CACHE_TTL = 60000; // 1 minute
export const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB

// API Endpoints
export const API_ENDPOINTS = {
  CASES: '/api/v1/projects/{id}/cases',
  CASES_REPO: '/api/v1/repositories/{id}/cases',
  CASES_TESTCASES: '/api/v1/projects/{id}/testcases',
  AUTOMATION_RUNS: '/api/v1/projects/{id}/automation/runs',
  AUTOMATION_RUNS_SUBMIT: '/api/v1/projects/{id}/automation/runs/submit',
  AUTOMATION_RUNS_GLOBAL: '/api/v1/automation/runs',
  AUTOMATION_RUNS_GLOBAL_SUBMIT: '/api/v1/automation/runs/submit',
  RUN_COMPLETE: '/api/v1/projects/{id}/automation/runs/{runId}/complete',
  RUN_COMPLETE_GLOBAL: '/api/v1/automation/runs/{runId}/complete',
  RUN_COMPLETE_REPO: '/api/v1/repositories/{id}/automation/runs/{runId}/complete',
} as const;

// Test status mappings
export const STATUS_MAPPING = {
  passed: 'passed' as const,
  failed: 'failed' as const,
  skipped: 'skipped' as const,
  interrupted: 'skipped' as const,
  timedOut: 'failed' as const,
} as const;

// Valid source values for Testmo
export const VALID_SOURCES = ['playwright', 'automation', 'ci', 'local'] as const;

// Default values
export const DEFAULT_SOURCE = 'playwright';
export const DEFAULT_PROJECT_ID = 1;
export const DEFAULT_RUN_NAME_PREFIX = 'Playwright Test Run';

// Logging
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

