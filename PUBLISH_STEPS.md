# Step-by-Step Publishing Guide

## Step 1: Login to NPM

Run this command in your terminal:

```bash
npm login
```

You'll be prompted for:
- Username
- Password
- Email address
- One-time password (if you have 2FA enabled)

## Step 2: (Optional) Update Repository URL

If you want to link to a GitHub repository, update `package.json`:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/YOUR_USERNAME/playwright-testmo-reporter.git"
}
```

You can skip this if you don't have a repo yet.

## Step 3: Verify Package is Ready

The package is already built. You can verify:

```bash
cd packages/playwright-testmo-reporter
ls dist/  # Should show compiled .js files
```

## Step 4: Test Locally (Optional but Recommended)

Test the package before publishing:

```bash
npm pack
```

This creates a `.tgz` file. You can test it in another project:

```bash
# In another test project
npm install ../path/to/playwright-testmo-reporter-1.0.0.tgz
```

## Step 5: Publish to NPM

Since this is a scoped package (`@playwright/testmo-reporter`), you need `--access public`:

```bash
npm publish --access public
```

## Step 6: Verify Publication

Check your package on npm:
https://www.npmjs.com/package/@playwright/testmo-reporter

## Troubleshooting

### "Package name already exists"
- The name `@playwright/testmo-reporter` might be taken
- Change the name in `package.json` to something unique like:
  - `@yourusername/playwright-testmo-reporter`
  - `playwright-testmo-reporter` (unscoped)

### "You do not have permission"
- Make sure you're logged in: `npm whoami`
- For scoped packages, you might need to create an organization or use unscoped name

### "Invalid package name"
- Scoped packages must start with `@`
- Unscoped packages must be lowercase, no spaces

## Quick Publish Command

Once logged in, you can publish directly:

```bash
cd packages/playwright-testmo-reporter
npm publish --access public
```

The `prepublishOnly` script will automatically build before publishing.

