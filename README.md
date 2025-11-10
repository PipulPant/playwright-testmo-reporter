# @playwright/testmo-reporter

Playwright reporter for Testmo integration. Automatically submits test results to Testmo with automatic test case linking via `C{ID}` prefixes.

## Features

- ✅ **Automatic Test Case Linking**: Uses `C{ID}` prefix in test titles (e.g., `C123 should display login page`)
- ✅ **Testmo CLI Integration**: Uses official Testmo CLI for reliable result submission
- ✅ **JUnit XML Support**: Automatically submits JUnit XML reports
- ✅ **Fallback Methods**: Multiple submission methods for maximum compatibility
- ✅ **Sync Tool**: CLI tool to sync test case IDs from Testmo to your test files

## Installation

```bash
npm install @playwright/testmo-reporter
```

## Setup

### 1. Configure Environment Variables

Create a `.env` file in your project root:

```env
TESTMO_URL=https://your-instance.testmo.net
TESTMO_TOKEN=your-api-token
TESTMO_PROJECT_ID=1
TESTMO_GROUP_ID=1  # Optional: filter by group
```

### 2. Configure Playwright

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  reporter: [
    ['line'],
    ['junit', { outputFile: './test-results/results.xml' }],
    ['@playwright/testmo-reporter'], // Add this
  ],
  // ... rest of your config
});
```

### 3. Sync Test Cases (One-Time Setup)

Run the sync tool to add `C{ID}` prefixes to your test titles:

```bash
npx sync-testmo tests
```

This will:
- Fetch test cases from Testmo
- Match them to your Playwright tests
- Add `C{ID}` prefixes to test titles for automatic linking

### 4. Run Your Tests

Run your Playwright tests as usual. Results will automatically be submitted to Testmo:

```bash
npx playwright test
```

## How It Works

1. **Test Case Linking**: The reporter extracts `C{ID}` from test titles (e.g., `C123 should display login page`)
2. **Result Collection**: During test execution, results are collected with their case IDs
3. **Submission**: After tests complete, results are submitted via:
   - **Primary**: Testmo CLI (if installed) - most reliable
   - **Fallback 1**: JUnit XML API submission
   - **Fallback 2**: JSON API submission

## Manual Test Case ID Assignment

You can manually add test case IDs to your tests:

```typescript
test('C123 should display login page', async ({ page }) => {
  // test code
});
```

The `C{ID}` prefix enables automatic linking in Testmo.

## CLI Tool

The package includes a CLI tool for syncing test case IDs:

```bash
# Sync all tests in a directory
npx sync-testmo tests

# Sync specific directory
npx sync-testmo tests/e2e/frontend
```

## Requirements

- Node.js 18+ (for native `fetch` API)
- Playwright 1.20+
- Testmo account with API access
- Testmo CLI (optional but recommended): `npm install -g @testmo/testmo-cli`

## License

MIT

## Support

For issues or questions:
- Check Testmo API documentation: https://docs.testmo.com/api
- Review console output for detailed error messages
- Verify your Testmo plan includes Automation API access

