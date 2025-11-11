/**
 * Logger utility for structured logging with different log levels
 */

import { LOG_LEVELS } from './constants';

export type LogLevel = keyof typeof LOG_LEVELS;

export class Logger {
  private verbose: boolean;
  private logLevel: number;

  constructor(verbose = false, logLevel: LogLevel = 'INFO') {
    this.verbose = verbose || process.env.TESTMO_VERBOSE === 'true';
    this.logLevel = LOG_LEVELS[logLevel];
  }

  /**
   * Log debug messages (only shown in verbose mode)
   */
  debug(message: string, data?: any): void {
    if (this.verbose && this.logLevel <= LOG_LEVELS.DEBUG) {
      const dataStr = data ? ` ${JSON.stringify(data, null, 2)}` : '';
      console.log(`[DEBUG] ${message}${dataStr}`);
    }
  }

  /**
   * Log informational messages
   */
  info(message: string): void {
    if (this.logLevel <= LOG_LEVELS.INFO) {
      console.log(`ℹ️  ${message}`);
    }
  }

  /**
   * Log warning messages
   */
  warn(message: string): void {
    if (this.logLevel <= LOG_LEVELS.WARN) {
      console.warn(`⚠️  ${message}`);
    }
  }

  /**
   * Log error messages
   */
  error(message: string, error?: Error | any): void {
    if (this.logLevel <= LOG_LEVELS.ERROR) {
      console.error(`❌ ${message}`);
      if (error) {
        if (error instanceof Error) {
          console.error(`   ${error.message}`);
          if (this.verbose && error.stack) {
            console.error(`   ${error.stack}`);
          }
        } else {
          console.error(`   ${JSON.stringify(error, null, 2)}`);
        }
      }
    }
  }

  /**
   * Log success messages
   */
  success(message: string): void {
    if (this.logLevel <= LOG_LEVELS.INFO) {
      console.log(`✅ ${message}`);
    }
  }

  /**
   * Log progress messages
   */
  progress(message: string): void {
    if (this.logLevel <= LOG_LEVELS.INFO) {
      console.log(`🔄 ${message}`);
    }
  }

  /**
   * Set verbose mode
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  /**
   * Set log level
   */
  setLogLevel(level: LogLevel): void {
    this.logLevel = LOG_LEVELS[level];
  }
}

// Export singleton instance
export const logger = new Logger();

