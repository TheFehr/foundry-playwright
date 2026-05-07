#!/bin/bash

# Gently nudge about type-breaking or test-breaking changes.
# This script is intended to be run as a post-commit hook.
# It should not block the user workflow.

# ANSI colors for better visibility
YELLOW='\033[1;33m'
RED='\033[1;31m'
GREEN='\033[1;32m'
NC='\033[0m' # No Color

echo -e "\n${YELLOW}🔍 Running health checks (Types & Tests)...${NC}"
echo -e "${YELLOW}   (This may take a moment)${NC}"

# Track failures
HAS_FAILURE=0

# Run tsc
if ! command -v npx > /dev/null 2>&1; then
  echo -e "⚠️  ${YELLOW}[SKIP] npx not found - skipping type check${NC}"
elif ! npx tsc --noEmit > /dev/null 2>&1; then
  echo -e "⚠️  ${RED}[NUDGE] TypeScript check failed!${NC} You might have introduced type-breaking changes."
  HAS_FAILURE=1
fi

# Run tests
if ! command -v npm > /dev/null 2>&1; then
  echo -e "⚠️  ${YELLOW}[SKIP] npm not found - skipping test check${NC}"
elif ! npm run test --if-present > /dev/null 2>&1; then
  echo -e "⚠️  ${RED}[NUDGE] Tests failed!${NC} You might have introduced breaking changes."
  HAS_FAILURE=1
fi

if [ $HAS_FAILURE -eq 0 ]; then
  echo -e "✅ ${GREEN}Health check finished.${NC} (This check was non-blocking)"
else
  echo -e "\n${YELLOW}Tip: You can fix these issues in your next commit.${NC}"
fi
echo ""
