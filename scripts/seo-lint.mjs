#!/usr/bin/env node
// SEO lint — validates Hugo build output for SEO regressions.
// Skips alias/redirect pages and special layouts.
// Exit codes: 0 = pass (warnings OK), 1 = errors found

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import matter from 'gray-matter';

const PUBLIC = process.argv[2] || 'public';
let errors = 0;
let warnings = 0;

function error(msg) { console.log(`ERROR: ${msg}`); errors++; }
function warn(msg) { console.log(`WARN: ${msg}`); warnings++; }

function findFiles(dir, name) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, name));
    else if (entry.name === name) results.push(full);
  }
  return results;
}

function isRedirect(html) {
  return /http-equiv=["']?refresh/i.test(html);
}

function isExcluded(filePath, html) {
  if (filePath.includes('/cv-pdf/')) return true;
  if (isRedirect(html)) return true;
  return false;
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/);
  return m ? m[1] : null;
}

function extractDescription(html) {
  const m = html.match(/<meta name=(?:")?description(?:")? content="([^"]*?)"/);
  return m ? m[1] : null;
}

function isTagPage(filePath) {
  return filePath.includes('/tags/');
}

// Load all HTML pages
const pages = findFiles(PUBLIC, 'index.html').map(filePath => ({
  filePath,
  rel: relative(PUBLIC, filePath),
  html: readFileSync(filePath, 'utf8'),
}));

// 1. Meta descriptions
console.log('\n--- Checking meta descriptions ---');
for (const { rel, html, filePath } of pages) {
  if (isExcluded(filePath, html)) continue;
  if (!extractDescription(html)) {
    error(`Missing meta description: ${rel}`);
  }
}

// 2. Post frontmatter descriptions
console.log('\n--- Checking post frontmatter descriptions ---');
const postFiles = findFiles('content/posts', '.md')
  .filter(f => !f.endsWith('_index.md'));
for (const filePath of postFiles) {
  const { data } = matter(readFileSync(filePath, 'utf8'));
  if (!data.description) {
    error(`Post missing frontmatter description: ${relative('.', filePath)}`);
  }
}

// 3. Duplicate titles
console.log('\n--- Checking for duplicate titles ---');
const titleMap = new Map();
for (const { rel, html, filePath } of pages) {
  if (isExcluded(filePath, html)) continue;
  const title = extractTitle(html);
  if (!title) continue;
  if (titleMap.has(title)) {
    error(`Duplicate title "${title}"\n  - ${titleMap.get(title)}\n  - ${rel}`);
  } else {
    titleMap.set(title, rel);
  }
}

// 4. Title length (skip tags)
console.log('\n--- Checking title lengths ---');
for (const { rel, html, filePath } of pages) {
  if (isExcluded(filePath, html) || isTagPage(filePath)) continue;
  const title = extractTitle(html);
  if (title && title.length > 60) {
    warn(`Title too long (${title.length} chars): ${title}\n  ${rel}`);
  }
}

// 5. Description length (skip tags)
console.log('\n--- Checking description lengths ---');
for (const { rel, html, filePath } of pages) {
  if (isExcluded(filePath, html) || isTagPage(filePath)) continue;
  const desc = extractDescription(html);
  if (desc && desc.length > 160) {
    warn(`Description too long (${desc.length} chars): ${desc.slice(0, 80)}...\n  ${rel}`);
  }
}

console.log(`\n=== Results: ${errors} error(s), ${warnings} warning(s) ===`);

if (errors > 0) {
  console.log('FAIL: SEO lint found errors');
  process.exit(1);
}

console.log('PASS: SEO lint passed');
