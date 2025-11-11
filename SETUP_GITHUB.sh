#!/bin/bash
# Script to set up GitHub repository for playwright-testmo-reporter

echo "🚀 Setting up GitHub repository..."
echo ""

# Get GitHub username (you'll need to replace this)
GITHUB_USERNAME="pipulpant"  # Change this to your GitHub username
REPO_NAME="playwright-testmo-reporter"

echo "📝 Step 1: Initialize git (if not already)"
if [ ! -d ".git" ]; then
    git init
    echo "✅ Git initialized"
else
    echo "✅ Git already initialized"
fi

echo ""
echo "📝 Step 2: Add all files"
git add .

echo ""
echo "📝 Step 3: Create initial commit"
git commit -m "Initial commit: Playwright Testmo Reporter package v1.0.3"

echo ""
echo "📝 Step 4: Add remote repository"
echo "⚠️  First, create the repository on GitHub at: https://github.com/new"
echo "    Repository name: $REPO_NAME"
echo "    Then run these commands:"
echo ""
echo "git remote add origin https://github.com/$GITHUB_USERNAME/$REPO_NAME.git"
echo "git branch -M main"
echo "git push -u origin main"
echo ""
echo "📝 Step 5: After pushing, update package.json with correct URLs"
echo "    Then run: npm publish --access public"



