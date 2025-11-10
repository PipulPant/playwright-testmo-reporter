# Publishing Guide

## Prerequisites

1. **NPM Account**: Make sure you have an npm account
2. **Login**: `npm login`
3. **Build**: The package will auto-build before publishing

## Publishing Steps

### 1. Update Version

Update the version in `package.json`:
- Patch: `1.0.1` (bug fixes)
- Minor: `1.1.0` (new features)
- Major: `2.0.0` (breaking changes)

### 2. Build the Package

```bash
cd packages/playwright-testmo-reporter
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` folder.

### 3. Test Locally (Optional)

Test the package locally before publishing:

```bash
# In the package directory
npm pack

# In your test project
npm install ../playwright-testmo-reporter/playwright-testmo-reporter-1.0.0.tgz
```

### 4. Publish to NPM

```bash
npm publish --access public
```

For scoped packages (`@playwright/testmo-reporter`), you need `--access public` the first time.

### 5. Verify

Check npm: https://www.npmjs.com/package/@playwright/testmo-reporter

## Updating the Package

1. Make your changes
2. Update version in `package.json`
3. Update `CHANGELOG.md` (if you have one)
4. Run `npm run build`
5. Run `npm publish --access public`

## Notes

- The `prepublishOnly` script automatically builds before publishing
- Only files listed in `package.json` `files` array will be published
- Make sure `.npmignore` excludes source files (only `dist/` should be published)

