#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { launch } from 'puppeteer';
import matter from 'gray-matter';

const POSTS_DIR = './content/posts';
const OUTPUT_DIR = './static/images/og';
const WIDTH = 1200;
const HEIGHT = 630;

function getPostData(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const { data } = matter(raw);
  const slug = basename(filePath, '.md');
  return { slug, ...data };
}

function isStale(slug, mdPath) {
  const pngPath = join(OUTPUT_DIR, `${slug}.png`);
  if (!existsSync(pngPath)) return true;
  const mdMtime = statSync(mdPath).mtimeMs;
  const pngMtime = statSync(pngPath).mtimeMs;
  return mdMtime > pngMtime;
}

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function buildHTML(post) {
  const tags = (post.tags || []).slice(0, 4);
  const date = formatDate(post.date);
  const tagsHTML = tags
    .map(t => `<span class="tag">${t}</span>`)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<style>

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: linear-gradient(135deg, #000060, #000080, #0a0a6e);
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .accent-bar {
    height: 6px;
    background: linear-gradient(90deg, #C5B358, #e0cc6e, #C5B358);
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 56px 64px 40px;
    gap: 24px;
  }

  .title {
    color: #FFFFFF;
    font-size: 48px;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.5px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tags {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .tag {
    color: #C5B358;
    border: 1.5px solid rgba(197, 179, 88, 0.5);
    border-radius: 4px;
    padding: 4px 12px;
    font-size: 14px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 64px 40px;
  }

  .date {
    color: #708090;
    font-size: 16px;
    font-weight: 400;
  }

  .site {
    color: #708090;
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 1px;
  }
</style>
</head>
<body>
  <div class="accent-bar"></div>
  <div class="content">
    <div class="title">${post.title}</div>
    <div class="tags">${tagsHTML}</div>
  </div>
  <div class="footer">
    <span class="date">${date}</span>
    <span class="site">dortort.com</span>
  </div>
</body>
</html>`;
}

async function main() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const files = readdirSync(POSTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => join(POSTS_DIR, f));

  const posts = files.map(f => ({ path: f, ...getPostData(f) }));
  const stale = posts.filter(p => isStale(p.slug, p.path));

  if (stale.length === 0) {
    console.log('OG images: all up to date.');
    return;
  }

  console.log(`OG images: generating ${stale.length} of ${posts.length}...`);

  const browser = await launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT });

    for (const post of stale) {
      const html = buildHTML(post);
      await page.setContent(html, { waitUntil: 'domcontentloaded' });

      const outPath = join(OUTPUT_DIR, `${post.slug}.png`);
      await page.screenshot({ path: outPath, type: 'png' });
      console.log(`  ${post.slug}.png`);
    }
  } finally {
    await browser.close();
  }

  console.log('OG images: done.');
}

main().catch(err => {
  console.error('OG image generation failed:', err.message);
  process.exit(1);
});
