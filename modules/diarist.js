/**
 * diarist.js — 每日日记模块
 * 根据当天的所有 10 分钟汇总，生成二阶摘要日记
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const DIARIES_DIR = path.join(__dirname, '..', 'diaries');

// ─── Config ───────────────────────────────────────────
function getConfig() {
  try {
    const p = path.join(__dirname, '..', 'deepseek_config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

// ─── HTTP ────────────────────────────────────────────
function httpReq(options) {
  return new Promise((resolve, reject) => {
    const t = options.protocol === 'https:' ? require('https') : http;
    const req = t.request(options, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error(`API ${res.statusCode}: ${r.error?.message || d}`));
          else resolve(r);
        } catch (e) { reject(new Error(`parse: ${e.message}`)); }
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

// ─── Build prompt ────────────────────────────────────
function buildDiaryPrompt(dateStr, summaries) {
  const items = summaries.map((s) => {
    const t = new Date(s.blockStart);
    const time = t.toLocaleTimeString('zh-CN', { hour12: false });
    return `[${time}] ${s.project || '未知'} | ${s.category || '未知'} | ${(s.description || '').slice(0, 150)}`;
  }).join('\n');

  return `你是一个温暖、有洞察力的日记助手。请根据以下某一天的所有活动记录，生成一篇当天的日记。

日期: ${dateStr}

当天活动记录 (每10分钟一条):
${items || '(无记录)'}

只输出一个JSON对象:
{
  "summary": "200字左右的日记式总结。以'今天'开头，自然叙述这一天做了什么，语气温暖平实。",
  "highlights": ["当天做的最重要的三件事，每条20字以内"],
  "todos": ["根据上下文推断的可能遗漏待办事项，最多3条"],
  "suggestions": ["针对时间管理或效率的优化建议，最多2条"],
  "tips": "一句温馨的话，可以是鼓励、提醒或小确幸"
}`;
}

// ─── Call DeepSeek ───────────────────────────────────
async function callDeepSeek(prompt) {
  const cfg = getConfig();
  if (!cfg.api_key) throw new Error('DeepSeek not configured');

  const body = JSON.stringify({
    model: cfg.model || 'deepseek-v4-flash',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5, max_tokens: 2048, stream: false,
    response_format: { type: 'json_object' },
  });

  const url = new URL(cfg.base_url || 'https://api.deepseek.com/v1/chat/completions');
  const result = await httpReq({
    protocol: url.protocol, hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.api_key}`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  return result.choices?.[0]?.message?.content || '';
}

// ─── Parse ────────────────────────────────────────────
function parseDiary(raw) {
  try {
    const p = JSON.parse(raw);
    return {
      summary: p.summary || '',
      highlights: Array.isArray(p.highlights) ? p.highlights.filter(Boolean).slice(0, 3) : [],
      todos: Array.isArray(p.todos) ? p.todos.filter(Boolean).slice(0, 3) : [],
      suggestions: Array.isArray(p.suggestions) ? p.suggestions.filter(Boolean).slice(0, 2) : [],
      tips: p.tips || '',
    };
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return parseDiary(m[0]); } catch { /* fall through */ }
    }
    return { summary: raw.slice(0, 200), highlights: [], todos: [], suggestions: [], tips: '' };
  }
}

// ─── Paths ────────────────────────────────────────────
function diaryPath(dateStr) {
  const [y, m] = dateStr.split('-');
  const dir = path.join(DIARIES_DIR, `${y}-${m}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${dateStr}.json`);
}

function diaryExists(dateStr) {
  return fs.existsSync(diaryPath(dateStr));
}

function loadDiary(dateStr) {
  const p = diaryPath(dateStr);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { /* ignore */ }
  }
  return null;
}

// ─── Generate diary ───────────────────────────────────
async function generateDiary(dateStr, summaries) {
  if (!summaries || summaries.length === 0) {
    const empty = {
      date: dateStr,
      generatedAt: new Date().toISOString(),
      summary: '今天没有记录到任何活动。',
      highlights: [],
      todos: [],
      suggestions: [],
      tips: '好好休息，也是重要的一天。',
      entryCount: 0,
    };
    fs.writeFileSync(diaryPath(dateStr), JSON.stringify(empty, null, 2), 'utf-8');
    return empty;
  }

  const prompt = buildDiaryPrompt(dateStr, summaries);
  const raw = await callDeepSeek(prompt);
  const diary = parseDiary(raw);

  const result = {
    date: dateStr,
    generatedAt: new Date().toISOString(),
    entryCount: summaries.length,
    ...diary,
  };

  fs.writeFileSync(diaryPath(dateStr), JSON.stringify(result, null, 2), 'utf-8');
  return result;
}

// ─── Find unprocessed dates ───────────────────────────
function findUnprocessedDates() {
  const dates = new Set();
  const summariesDir = path.join(__dirname, '..', 'summaries');

  if (!fs.existsSync(summariesDir)) return [];

  const months = fs.readdirSync(summariesDir).filter((f) => /^\d{4}-\d{2}$/.test(f));
  for (const month of months) {
    const mdir = path.join(summariesDir, month);
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(mdir, file), 'utf-8'));
        const d = new Date(data.blockStart);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dates.add(dateStr);
      } catch { /* skip */ }
    }
  }

  // Filter out dates that already have diaries
  const unprocessed = [];
  for (const d of dates) {
    if (!diaryExists(d)) unprocessed.push(d);
  }

  unprocessed.sort();
  return unprocessed;
}

// ─── Load summaries for a specific date ──────────────
function loadSummariesForDate(dateStr) {
  const results = [];
  const summariesDir = path.join(__dirname, '..', 'summaries');

  if (!fs.existsSync(summariesDir)) return results;

  const months = fs.readdirSync(summariesDir).filter((f) => /^\d{4}-\d{2}$/.test(f));
  for (const month of months) {
    const mdir = path.join(summariesDir, month);
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(mdir, file), 'utf-8'));
        const d = new Date(data.blockStart);
        const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (ds === dateStr) results.push(data);
      } catch { /* skip */ }
    }
  }

  results.sort((a, b) => new Date(a.blockStart) - new Date(b.blockStart));
  return results;
}

// ─── Load all diaries ────────────────────────────────
function loadAllDiaries() {
  const all = [];
  if (!fs.existsSync(DIARIES_DIR)) return all;

  const months = fs.readdirSync(DIARIES_DIR).filter((f) => /^\d{4}-\d{2}$/.test(f));
  for (const month of months) {
    const mdir = path.join(DIARIES_DIR, month);
    const files = fs.readdirSync(mdir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        all.push(JSON.parse(fs.readFileSync(path.join(mdir, file), 'utf-8')));
      } catch { /* skip */ }
    }
  }
  all.sort((a, b) => b.date.localeCompare(a.date));
  return all;
}

module.exports = { generateDiary, loadDiary, diaryExists, findUnprocessedDates, loadSummariesForDate, loadAllDiaries, DIARIES_DIR };
