/**
 * cleanup.js — 数据自动清理
 * 截图 >24h 删除，总存储上限 5GB
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h for screenshots
const MAX_SIZE = 5 * 1024 * 1024 * 1024; // 5GB total

function dirSize(d) {
  let size = 0;
  if (!fs.existsSync(d)) return 0;
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const fp = path.join(d, f.name);
    if (f.isDirectory()) size += dirSize(fp);
    else try { size += fs.statSync(fp).size; } catch { /* skip */ }
  }
  return size;
}

function cleanupScreenshots() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) return { deleted: 0, freed: 0 };
  const now = Date.now();
  let deleted = 0, freed = 0;

  function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) { walk(fp); continue; }
      if (!f.name.endsWith('.png')) continue;
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > MAX_AGE_MS) {
          const s = stat.size;
          fs.unlinkSync(fp);
          deleted++; freed += s;
        }
      } catch { /* skip locked files */ }
    }
    // Remove empty month dirs
    try {
      const remaining = fs.readdirSync(d).filter(x => !x.startsWith('.'));
      if (remaining.length === 0 && d !== SCREENSHOTS_DIR) fs.rmdirSync(d);
    } catch { /* skip */ }
  }
  walk(SCREENSHOTS_DIR);
  return { deleted, freed };
}

function enforceSizeLimit() {
  const size = dirSize(SCREENSHOTS_DIR) + dirSize(path.join(ROOT, 'summaries')) + dirSize(path.join(ROOT, 'diaries'));
  if (size < MAX_SIZE) return { ok: true, currentSize: size };
  // Delete oldest screenshots until under limit
  const files = [];
  function collect(d) {
    if (!fs.existsSync(d)) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const fp = path.join(d, f.name);
      if (f.isDirectory()) { collect(fp); continue; }
      if (!f.name.endsWith('.png')) continue;
      try { files.push({ path: fp, mtime: fs.statSync(fp).mtimeMs }); } catch { /* skip */ }
    }
  }
  collect(SCREENSHOTS_DIR);
  files.sort((a, b) => a.mtime - b.mtime);
  let total = size, deleted = 0;
  for (const f of files) {
    if (total < MAX_SIZE * 0.8) break;
    try { const s = fs.statSync(f.path).size; fs.unlinkSync(f.path); total -= s; deleted++; } catch { /* skip */ }
  }
  return { ok: true, deleted, currentSize: total };
}

function run() {
  const r1 = cleanupScreenshots();
  const r2 = enforceSizeLimit();
  return { screenshotsDeleted: r1.deleted, sizeEnforced: r2.deleted || 0, currentSizeMB: Math.round((r2.currentSize || 0) / 1048576) };
}

module.exports = { run };
