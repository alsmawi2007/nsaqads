#!/usr/bin/env bash
# Naming guard: the product is "Nasaq Ads" (نسق ادز). The legacy name
# "Adari" must not appear in source-level product strings. A small set of
# infrastructure identifiers (localStorage keys, package workspace names,
# example DB credentials) are deliberately exempted because renaming them
# would invalidate sessions, break workspace resolution, or drift the
# example env from docker-compose.
#
# Run from the repo root: bash scripts/check-naming.sh
# Exit 0 = clean. Exit 1 = unapproved occurrence found.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Files / paths excluded from the scan.
#   - node_modules, dist, .git: noise
#   - apps/api/.env.example: contains DB credentials (adari user/db)
#   - apps/{api,web}/package.json: workspace names @adari/{api,web}
#   - apps/web/src/lib/api/{auth,client}.ts, apps/web/src/lib/stores/{auth,ui}.store.ts,
#     apps/web/src/features/campaign-architect/store/wizard.store.ts:
#       contain localStorage keys (adari_access_token, etc.) — renaming logs
#       out every active user; defer to a coordinated migration.
#   - apps/api/docs/RELEASE.md: documents real infra identifiers (ssh host,
#     install path, pm2 name, ops email) and explicitly calls them out in a
#     naming note.
#   - scripts/check-naming.sh (this file): mentions the banned name in
#     comments and patterns by design.
EXCLUDE_PATHS=(
  ':!node_modules'
  ':!**/node_modules'
  ':!dist'
  ':!**/dist'
  ':!.git'
  ':!apps/api/.env.example'
  ':!apps/api/package.json'
  ':!apps/web/package.json'
  ':!apps/web/src/lib/api/auth.ts'
  ':!apps/web/src/lib/api/client.ts'
  ':!apps/web/src/lib/stores/auth.store.ts'
  ':!apps/web/src/lib/stores/ui.store.ts'
  ':!apps/web/src/features/campaign-architect/store/wizard.store.ts'
  ':!apps/api/docs/RELEASE.md'
  ':!scripts/check-naming.sh'
)

cd "$ROOT"

# Use git ls-files so the exclude pathspec is honored. If the working tree
# is not a git repo (CI artifact runs), fall back to find.
if git rev-parse --git-dir >/dev/null 2>&1; then
  files=$(git ls-files -- 'apps/' 'packages/' 'docs/' 'README.md' "${EXCLUDE_PATHS[@]}" 2>/dev/null || true)
else
  files=$(find apps packages docs README.md -type f \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.json' -o -name '*.md' \) 2>/dev/null || true)
fi

if [ -z "$files" ]; then
  echo "naming guard: no files to scan"
  exit 0
fi

# Case-insensitive match for the legacy name.
matches=$(printf '%s\n' $files | xargs grep -InE '[Aa]dari' 2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "naming guard FAILED — legacy 'Adari' found. Use 'Nasaq Ads' (نسق ادز) instead."
  echo
  echo "$matches"
  echo
  echo "If the match is an infrastructure identifier (localStorage key,"
  echo "workspace name, DB credential), add it to the EXCLUDE_PATHS list"
  echo "in scripts/check-naming.sh with a justifying comment."
  exit 1
fi

echo "naming guard: clean"
