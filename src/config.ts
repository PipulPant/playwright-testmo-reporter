/**
 * Configuration validation and management
 */

import { logger } from './logger';
import { DEFAULT_TIMEOUT, DEFAULT_PROJECT_ID, DEFAULT_SOURCE, VALID_SOURCES } from './constants';

export interface TestmoConfig {
  url: string;
  token: string;
  projectId: number;
  groupId?: number;
  timeout: number;
  retries: number;
  verbose: boolean;
  source: string;
}

/**
 * Validates and returns Testmo configuration from environment variables
 * 
 * @throws {Error} If required configuration is missing or invalid
 * @returns {TestmoConfig} Validated configuration object
 * 
 * @example
 * ```typescript
 * try {
 *   const config = validateConfig();
 *   console.log(`Using Testmo: ${config.url}`);
 * } catch (error) {
 *   console.error('Configuration error:', error.message);
 *   process.exit(1);
 * }
 * ```
 */
export function validateConfig(): TestmoConfig {
  const url = process.env.TESTMO_URL;
  const token = process.env.TESTMO_TOKEN;
  const projectId = process.env.TESTMO_PROJECT_ID || process.env.TESTMO_REPOSITORY_ID;
  const groupId = process.env.TESTMO_GROUP_ID;
  const timeout = process.env.TESTMO_TIMEOUT;
  const retries = process.env.TESTMO_RETRIES;
  const verbose = process.env.TESTMO_VERBOSE === 'true';
  const source = process.env.TESTMO_SOURCE || (process.env.CI ? 'ci' : DEFAULT_SOURCE);

  // Validate required fields
  const errors: string[] = [];

  if (!url) {
    errors.push('TESTMO_URL is required. Set it in your .env file or environment variables.');
  } else if (!url.match(/^https?:\/\/.+/)) {
    errors.push('TESTMO_URL must be a valid URL (e.g., https://your-instance.testmo.net)');
  }

  if (!token) {
    errors.push('TESTMO_TOKEN is required. Get your API token from Testmo Settings > API.');
  } else if (token.length < 10) {
    errors.push('TESTMO_TOKEN appears to be invalid (too short).');
  }

  if (!projectId) {
    errors.push('TESTMO_PROJECT_ID is required. Find it in your Testmo project URL.');
  } else if (isNaN(parseInt(projectId, 10))) {
    errors.push('TESTMO_PROJECT_ID must be a valid number.');
  }

  // Validate optional fields
  if (groupId && isNaN(parseInt(groupId, 10))) {
    errors.push('TESTMO_GROUP_ID must be a valid number (optional).');
  }

  if (timeout && isNaN(parseInt(timeout, 10))) {
    errors.push('TESTMO_TIMEOUT must be a valid number in milliseconds (optional).');
  }

  if (retries && isNaN(parseInt(retries, 10))) {
    errors.push('TESTMO_RETRIES must be a valid number (optional).');
  }

  if (source && !VALID_SOURCES.includes(source as any)) {
    errors.push(`TESTMO_SOURCE must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  if (errors.length > 0) {
    const errorMessage = [
      '❌ Testmo configuration errors:',
      ...errors.map(e => `   • ${e}`),
      '',
      '📖 For help, see: https://github.com/PipulPant/playwright-testmo-reporter#readme',
    ].join('\n');
    throw new Error(errorMessage);
  }

  const config: TestmoConfig = {
    url: url!.replace(/\/$/, ''), // Remove trailing slash
    token: token!,
    projectId: parseInt(projectId!, 10),
    groupId: groupId ? parseInt(groupId, 10) : undefined,
    timeout: timeout ? parseInt(timeout, 10) : DEFAULT_TIMEOUT,
    retries: retries ? parseInt(retries, 10) : 3,
    verbose,
    source: source as string,
  };

  if (config.verbose) {
    logger.debug('Testmo configuration loaded', {
      url: config.url,
      projectId: config.projectId,
      groupId: config.groupId,
      timeout: config.timeout,
      retries: config.retries,
      source: config.source,
    });
  }

  return config;
}

/**
 * Checks if Testmo is configured (non-throwing version)
 * 
 * @returns {boolean} True if configuration is valid
 */
export function isConfigured(): boolean {
  try {
    validateConfig();
    return true;
  } catch {
    return false;
  }
}

