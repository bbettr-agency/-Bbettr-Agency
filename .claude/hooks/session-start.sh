#!/bin/bash
# Bbettr Agency Client Portal — SessionStart hook
# Installs Node dependencies so builds, linting and type-checks work in
# Claude Code on the web sessions.
set -euo pipefail

# Only run in the remote (web) environment; local machines manage their own deps.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent install. `npm install` (not `ci`) so the cached container layer
# can be reused across sessions.
npm install --no-audit --no-fund
