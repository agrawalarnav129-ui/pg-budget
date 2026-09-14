#!/usr/bin/env bash
# Test, build, and publish dist/ to the gh-pages branch (served by GitHub Pages).
set -euo pipefail

cd "$(dirname "$0")/.."
REMOTE="$(git remote get-url origin)"

npm test
npm run build

cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy $(date '+%Y-%m-%d %H:%M')"
git push -q -f "$REMOTE" gh-pages
rm -rf .git

echo "Deployed. Live in ~1 minute at https://agrawalarnav129-ui.github.io/pg-budget/"
