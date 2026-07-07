#!/usr/bin/env node
// Walks all docs section pages, extracts text, pre-computes embeddings,
// and writes docs/search-index.json for use by the browser search UI.

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

function cleanTag(html) {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractPage(html, relUrl) {
  const stripped = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  const titleM = stripped.match(/<title>(.*?)<\/title>/is);
  const h1M = stripped.match(/<h1[^>]*>(.*?)<\/h1>/is);
  const h2Matches = [...stripped.matchAll(/<h2[^>]*>(.*?)<\/h2>/gis)];

  const title = titleM ? cleanTag(titleM[1]) : '';
  const h1 = h1M ? cleanTag(h1M[1]) : '';
  const h2s = h2Matches.slice(0, 6).map(m => cleanTag(m[1])).filter(Boolean);

  const parts = relUrl.split('/').filter(Boolean);
  const product = parts[0] || '';
  const label = PRODUCT_LABELS[product] || product;

  // Compose embedding text: h1 is most important, h2s give topical context
  const embText = [h1 || title, ...h2s].join(' ').slice(0, 512);

  return { url: relUrl.replace(/index\.html$/, ''), title: h1 || title, product: label, embText };
}

function collectPages(dir, pages = []) {
  if (!fs.existsSync(dir)) return pages;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const idx = path.join(full, 'index.html');
      if (fs.existsSync(idx)) {
        const rel = '/' + path.relative(DOCS_ROOT, idx);
        try {
          const html = fs.readFileSync(idx, 'utf-8');
          const page = extractPage(html, rel);
          if (page.title) pages.push(page);
        } catch { /* skip unreadable files */ }
      }
      collectPages(full, pages);
    }
  }
  return pages;
}

// Keep the self-hosted WASM assets in sync with the installed package version
const PKG_BUNDLER = path.resolve(__dirname, 'node_modules/@ternlight/mini/pkg-bundler');
for (const asset of ['tern_engine_bg.wasm', 'tern_engine_bg.js']) {
  fs.copyFileSync(path.join(PKG_BUNDLER, asset), path.join(DOCS_ROOT, asset));
}
console.log('Copied WASM assets → docs/');

console.log('Scanning docs…');
const pages = collectPages(DOCS_ROOT);
console.log(`Found ${pages.length} section pages. Computing embeddings…`);

const index = [];
for (let i = 0; i < pages.length; i++) {
  const p = pages[i];
  if (i % 20 === 0) process.stdout.write(`  ${i}/${pages.length}\r`);
  const vec = Array.from(embed(p.embText));
  index.push({ url: p.url, title: p.title, product: p.product, vec });
}

console.log(`\nDone. Writing search-index.json…`);
const out = path.join(DOCS_ROOT, 'search-index.json');
fs.writeFileSync(out, JSON.stringify(index));

const kb = Math.round(fs.statSync(out).size / 1024);
console.log(`Saved ${index.length} entries (${kb} KB) → ${out}`);
