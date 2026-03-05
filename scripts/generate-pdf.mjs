#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { launch } from 'puppeteer';

const SERVE_DIR = process.argv.find(a => a.startsWith('--serve-dir='))?.split('=')[1] ?? './public';
const OUTPUT = process.argv.find(a => a.startsWith('--output='))?.split('=')[1] ?? './static/Francis_Eytan_Dortort_CV.pdf';

// A4 dimensions in mm minus margins (12mm top/bottom, 15mm left/right)
const A4_CONTENT_HEIGHT_MM = 297 - 12 - 12;

// Baseline CSS custom property values
const BASELINES = {
  '--pdf-section-gap': 12,
  '--pdf-item-gap': 6,
  '--pdf-line-height': 1.3,
  '--pdf-resp-gap': 3,
  '--pdf-tag-gap': 4,
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
};

function serveStatic(dir) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let filePath = join(dir, req.url === '/' ? 'index.html' : req.url);
      if (filePath.endsWith('/')) filePath += 'index.html';
      if (!extname(filePath)) filePath = join(filePath, 'index.html');

      if (!existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function applyDensity(density) {
  const vars = {};
  for (const [prop, baseline] of Object.entries(BASELINES)) {
    if (prop === '--pdf-line-height') {
      // Only scale the "extra" leading above 1.0
      vars[prop] = 1.0 + (baseline - 1.0) * density;
    } else {
      vars[prop] = baseline * density;
    }
  }
  return vars;
}

function cssVarString(vars) {
  return Object.entries(vars)
    .map(([prop, val]) => {
      const unit = prop === '--pdf-line-height' ? '' : 'px';
      return `${prop}: ${val}${unit}`;
    })
    .join('; ');
}

async function autoFit(page, targetHeightPx) {
  let lo = 0.80;
  let hi = 1.20;
  let bestDensity = 1.0;
  const MAX_ITER = 15;
  const TOLERANCE = 0.01; // 1% of target height

  for (let i = 0; i < MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    const vars = applyDensity(mid);

    await page.evaluate((css) => {
      document.documentElement.style.cssText = css;
    }, cssVarString(vars));

    // Wait for reflow
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const contentHeight = await page.evaluate(() => {
      return document.querySelector('.cv-pdf-content').scrollHeight;
    });

    const diff = contentHeight - targetHeightPx;
    const ratio = Math.abs(diff) / targetHeightPx;

    console.log(`  iter ${i + 1}: density=${mid.toFixed(4)}, content=${contentHeight}px, target=${targetHeightPx}px, diff=${diff.toFixed(0)}px (${(ratio * 100).toFixed(1)}%)`);

    if (ratio < TOLERANCE && contentHeight <= targetHeightPx) {
      bestDensity = mid;
      break;
    }

    if (contentHeight > targetHeightPx) {
      hi = mid; // content too tall, tighten spacing
    } else {
      lo = mid; // content too short, loosen spacing
    }
    bestDensity = mid;
  }

  // Guardrail: check density is within acceptable range
  if (bestDensity < 0.80 || bestDensity > 1.20) {
    throw new Error(
      `Auto-fit density ${bestDensity.toFixed(4)} exceeds ±20% range. ` +
      `Content has changed significantly — redesign the template or adjust content.`
    );
  }

  console.log(`  final density: ${bestDensity.toFixed(4)}`);
  return bestDensity;
}

function countPdfPages(pdfBuffer) {
  // Count /Type /Page (but not /Type /Pages) occurrences in the PDF
  const str = pdfBuffer.toString('latin1');
  const matches = str.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

async function main() {
  console.log('Starting PDF generation...');
  console.log(`  serve dir: ${SERVE_DIR}`);
  console.log(`  output: ${OUTPUT}`);

  // Ensure output directory exists
  const outputDir = OUTPUT.substring(0, OUTPUT.lastIndexOf('/'));
  if (outputDir && !existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const { server, port } = await serveStatic(SERVE_DIR);
  console.log(`  static server on port ${port}`);

  let browser;
  try {
    browser = await launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      timeout: 120000,
      protocolTimeout: 120000,
    });

    const page = await browser.newPage();

    // Set viewport to A4 dimensions at 96dpi
    const a4WidthPx = Math.round((210 - 15 - 15) * 96 / 25.4); // ~680px
    const a4HeightPx = Math.round(A4_CONTENT_HEIGHT_MM * 96 / 25.4); // ~1031px
    await page.setViewport({ width: a4WidthPx, height: a4HeightPx });

    console.log(`  target content area: ${a4WidthPx}x${a4HeightPx}px`);

    await page.goto(`http://127.0.0.1:${port}/cv-pdf/`, {
      waitUntil: 'networkidle0',
      timeout: 30000,
    });

    // Wait for fonts
    await page.evaluate(() => document.fonts.ready);
    console.log('  fonts loaded');

    // Auto-fit
    console.log('  running auto-fit...');
    await autoFit(page, a4HeightPx);

    // Generate PDF
    const margin = '12mm';
    await page.pdf({
      path: OUTPUT,
      format: 'A4',
      margin: { top: margin, bottom: margin, left: '15mm', right: '15mm' },
      printBackground: true,
      preferCSSPageSize: false,
    });

    console.log(`  PDF written to ${OUTPUT}`);

    // Validate page count
    const pdfBuffer = readFileSync(OUTPUT);
    const pageCount = countPdfPages(pdfBuffer);
    console.log(`  page count: ${pageCount}`);

    if (pageCount !== 1) {
      throw new Error(
        `PDF has ${pageCount} pages — expected exactly 1. ` +
        `Adjust content or template to fit within a single A4 page.`
      );
    }

    console.log('PDF generation complete.');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('PDF generation failed:', err.message);
  process.exit(1);
});
