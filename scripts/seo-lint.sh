#!/usr/bin/env bash
# SEO lint script — runs against Hugo build output in public/
# Skips alias/redirect pages and special layouts.
# Exit codes: 0 = pass (warnings OK), 1 = errors found
set -euo pipefail

PUBLIC="${1:-public}"
ERRORS=0
WARNINGS=0

echo "=== SEO Lint: $PUBLIC ==="

is_redirect() {
  grep -q 'http-equiv="refresh"\|http-equiv=refresh' "$1" 2>/dev/null
}

is_excluded() {
  local file="$1"
  # Skip redirect/alias pages and special layouts
  is_redirect "$file" && return 0
  [[ "$file" == *"/cv-pdf/"* ]] && return 0
  return 1
}

# 1. Every non-redirect HTML page must have a meta description
echo ""
echo "--- Checking meta descriptions ---"
while IFS= read -r file; do
  is_excluded "$file" && continue
  if ! grep -q 'meta name=description\|meta name="description"' "$file"; then
    echo "ERROR: Missing meta description: $file"
    ERRORS=$((ERRORS + 1))
  fi
done < <(find "$PUBLIC" -name "index.html" -type f)

# 2. Every post must have a frontmatter description (not falling back to .Summary)
echo ""
echo "--- Checking post frontmatter descriptions ---"
for file in content/posts/*.md; do
  [ -f "$file" ] || continue
  if ! grep -q '^description:' "$file"; then
    echo "ERROR: Post missing frontmatter description: $file"
    ERRORS=$((ERRORS + 1))
  fi
done

# 3. No duplicate titles (skip redirects)
echo ""
echo "--- Checking for duplicate titles ---"
declare -A TITLES
while IFS= read -r file; do
  is_excluded "$file" && continue
  title=$(grep -o '<title>[^<]*</title>' "$file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
  if [ -n "$title" ]; then
    if [ -n "${TITLES[$title]+x}" ]; then
      echo "ERROR: Duplicate title \"$title\""
      echo "  - ${TITLES[$title]}"
      echo "  - $file"
      ERRORS=$((ERRORS + 1))
    else
      TITLES["$title"]="$file"
    fi
  fi
done < <(find "$PUBLIC" -name "index.html" -type f)

# 4. Title length check (warn if >60 chars, skip redirects and tag pages)
echo ""
echo "--- Checking title lengths ---"
while IFS= read -r file; do
  is_excluded "$file" && continue
  [[ "$file" == *"/tags/"* ]] && continue
  title=$(grep -o '<title>[^<]*</title>' "$file" 2>/dev/null | head -1 | sed 's/<[^>]*>//g')
  if [ -n "$title" ]; then
    len=${#title}
    if [ "$len" -gt 60 ]; then
      echo "WARN: Title too long ($len chars): $title"
      echo "  $file"
      WARNINGS=$((WARNINGS + 1))
    fi
  fi
done < <(find "$PUBLIC" -name "index.html" -type f)

# 5. Description length check (warn if >160 chars, skip redirects and tag pages)
echo ""
echo "--- Checking description lengths ---"
while IFS= read -r file; do
  is_excluded "$file" && continue
  [[ "$file" == *"/tags/"* ]] && continue
  desc=$(python3 -c "
import re
html = open('$file').read()
m = re.search(r'<meta name=(?:\")?description(?:\")? content=\"([^\"]*?)\"', html)
if m: print(m.group(1))
" 2>/dev/null)
  if [ -n "$desc" ]; then
    len=${#desc}
    if [ "$len" -gt 160 ]; then
      echo "WARN: Description too long ($len chars): ${desc:0:80}..."
      echo "  $file"
      WARNINGS=$((WARNINGS + 1))
    fi
  fi
done < <(find "$PUBLIC" -name "index.html" -type f)

echo ""
echo "=== Results: $ERRORS error(s), $WARNINGS warning(s) ==="

if [ "$ERRORS" -gt 0 ]; then
  echo "FAIL: SEO lint found errors"
  exit 1
fi

echo "PASS: SEO lint passed"
exit 0
