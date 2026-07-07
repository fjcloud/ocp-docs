#!/usr/bin/env node
// Walks all docs pages, extracts text + snippets, pre-computes embeddings,
// and writes docs/search-index.json for use by the browser search UI.
//
// Vector storage: int8-quantized (scale ×127), base64-encoded — ~9× smaller
// than float32 JSON arrays, keeping ranking quality effectively identical.

import { embed } from '@ternlight/mini';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_ROOT = path.resolve(__dirname, '../../docs');

const PRODUCT_LABELS = {
  'openshift-enterprise': 'OpenShift Container Platform',
  'openshift-origin': 'OKD / OpenShift Origin',
  'openshift-dedicated': 'OpenShift Dedicated',
  'openshift-rosa': 'ROSA Classic',
  'openshift-rosa-hcp': 'ROSA (HCP)',
  'microshift': 'MicroShift',
  'openshift-aro': 'Azure Red Hat OpenShift',
  'openshift-webscale': 'OpenShift Web-Scale',
  'openshift-dpu': 'OpenShift DPU',
  'openshift-telco': 'OpenShift Telco',
  'openshift-service-mesh': 'Service Mesh',
  'openshift-serverless': 'Serverless',
  'openshift-pipelines': 'Pipelines',
  'openshift-logging': 'Logging',
  'openshift-lightspeed': 'Lightspeed',
  'openshift-gitops': 'GitOps',
  'openshift-coo': 'Cluster Observability',
  'openshift-builds': 'Builds',
  'openshift-acs': 'Advanced Cluster Security',
  'openshift-rosa-portal': 'ROSA Portal',
};

// Minimum file size — skips stub/redirect pages that have no real content.
const MIN_FILE_BYTES = 4096;

function cleanTag(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Extract the first meaningful paragraph for use as a search result snippet. */
function extractSnippet(stripped) {
  // Prefer the preamble intro paragraph (Asciibinder/Asciidoctor convention)
  const preambleM = stripped.match(/<div[^>]+id="preamble"[^>]*>([\s\S]*?)<\/div>/i);
  const searchArea = preambleM ? preambleM[1] : stripped;

  // Find first <p> with a reasonable amount of content
  const pMatches = [...searchArea.matchAll(/<p>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = cleanTag(m[1]).replace(/\s+/g, ' ').trim();
    if (text.length > 40) return text.slice(0, 200);
  }
  return '';
}

function extractPage(html, relUrl) {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const titleM = stripped.match(/<title>(.*?)<\/title>/is);
  const h1M    = stripped.match(/<h1[^>]*>(.*?)<\/h1>/is);
  const h2Matches = [...stripped.matchAll(/<h2[^>]*>(.*?)<\/h2>/gis)];
  const h3Matches = [...stripped.matchAll(/<h3[^>]*>(.*?)<\/h3>/gis)];

  const title = titleM ? cleanTag(titleM[1]).replace(/\s*[|–—-].*$/, '').trim() : '';
  const h1    = h1M ? cleanTag(h1M[1]) : '';
  const h2s   = h2Matches.slice(0, 6).map(m => cleanTag(m[1])).filter(Boolean);
  const h3s   = h3Matches.slice(0, 4).map(m => cleanTag(m[1])).filter(Boolean);
  const snippet = extractSnippet(stripped);

  const parts   = relUrl.split('/').filter(Boolean);
  const product = parts[0] || '';
  const label   = PRODUCT_LABELS[product] || product;

  // Richer embedding text: h1 + h2s + h3s + first paragraph
  const embParts = [h1 || title, ...h2s, ...h3s];
  if (snippet) embParts.push(snippet);
  const embText = embParts.join(' ').slice(0, 512);

  const cleanTitle = h1 || title;
  return { url: relUrl.replace(/index\.html$/, ''), title: cleanTitle, product: label, embText, snippet };
}

/** Encode a Float32Array as a base64 int8 string (scale ×127, clamp [-127,127]). */
function quantizeVec(float32arr) {
  const buf = Buffer.allocUnsafe(float32arr.length);
  for (let i = 0; i < float32arr.length; i++) {
    const v = Math.round(float32arr[i] * 127);
    buf.writeInt8(Math.max(-127, Math.min(127, v)), i);
  }
  return buf.toString('base64');
}

/** Collect all indexable HTML pages under a directory. */
function collectPages(dir, pages = []) {
  if (!fs.existsSync(dir)) return pages;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Index the directory's own index.html (section overview)
      const idx = path.join(full, 'index.html');
      if (fs.existsSync(idx)) {
        tryAddPage(idx, pages);
      }
      collectPages(full, pages);
    } else if (entry.isFile() && entry.name.endsWith('.html') && entry.name !== 'index.html') {
      // Also index individual topic pages
      tryAddPage(full, pages);
    }
  }
  return pages;
}

function tryAddPage(fullPath, pages) {
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size < MIN_FILE_BYTES) return; // skip stubs/redirects
    const html = fs.readFileSync(fullPath, 'utf-8');
    const rel = '/' + path.relative(DOCS_ROOT, fullPath);
    const page = extractPage(html, rel);
    if (page.title && page.embText) pages.push(page);
  } catch { /* skip unreadable files */ }
}

// ── Keep WASM assets in sync with the installed package version ──────────────
const PKG_BUNDLER = path.resolve(__dirname, 'node_modules/@ternlight/mini/pkg-bundler');
for (const asset of ['tern_engine_bg.wasm', 'tern_engine_bg.js']) {
  fs.copyFileSync(path.join(PKG_BUNDLER, asset), path.join(DOCS_ROOT, asset));
}
console.log('Copied WASM assets → docs/');

console.log('Scanning docs…');
const pages = collectPages(DOCS_ROOT);
console.log(`Found ${pages.length} pages. Computing embeddings…`);

const index = [];
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  if (i % 50 === 0) process.stdout.write(`  ${i}/${pages.length}\r`);
  const vec = quantizeVec(embed(p.embText));
  index.push({ url: p.url, title: p.title, product: p.product, snippet: p.snippet, vec });
}

console.log(`\nDone. Writing search-index.json…`);
const out = path.join(DOCS_ROOT, 'search-index.json');
fs.writeFileSync(out, JSON.stringify(index));

const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`Saved ${index.length} entries (${kb} KB) → ${out}`);
