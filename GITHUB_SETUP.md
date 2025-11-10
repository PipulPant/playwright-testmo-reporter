# GitHub Repository Setup Guide

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `playwright-testmo-reporter`
3. Description: "Playwright reporter for Testmo - automatically submit test results with C{ID} linking"
4. Choose: **Public** (recommended for npm packages)
5. **DO NOT** initialize with README, .gitignore, or license (we already have these)
6. Click **Create repository**

## Step 2: Initialize Git and Push Code

After creating the repository, GitHub will show you commands. Use these:

```bash
cd packages/playwright-testmo-reporter

# Initialize git (if not already initialized)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit: Playwright Testmo Reporter package"

# Add remote (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/playwright-testmo-reporter.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Update package.json

After pushing to GitHub, update the repository URLs in `package.json`:

```json
{
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_USERNAME/playwright-testmo-reporter.git"
  },
  "bugs": {
    "url": "https://github.com/YOUR_USERNAME/playwright-testmo-reporter/issues"
  },
  "homepage": "https://github.com/YOUR_USERNAME/playwright-testmo-reporter#readme"
}
```

Replace `YOUR_USERNAME` with your actual GitHub username.

## Step 4: Republish to npm

After updating package.json:

```bash
# Bump version
# Edit package.json: "version": "1.0.4"

# Build and publish
npm run build
npm publish --access public
```

## Quick Commands

```bash
# 1. Create repo on GitHub (via web interface)
# 2. Then run these commands:

cd packages/playwright-testmo-reporter
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/playwright-testmo-reporter.git
git branch -M main
git push -u origin main
```

