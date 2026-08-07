/**
 * summarizer.js — 10 分钟汇总模块
 *
 * 聚合一个 10 分钟窗口内的所有截屏记录，调用 DeepSeek V4 Flash
 * 生成结构化摘要。支持队列处理未完成的时段。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── DeepSeek 配置 ──────────────────────────────────
let deepseekConfig = null;
function loadConfig() {
  try {
    const configPath = path.join(__dirname, '..', 'deepseek_config.json');
    if (fs.existsSync(configPath)) {
      deepseekConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch { /* ignore */ }
}
loadConfig();

function getModel() { return deepseekConfig?.model || 'deepseek-v4-flash'; }
function setModel(name) { if (deepseekConfig) deepseekConfig.model = name; }

const SUMMARIES_DIR = path.join(__dirname, '..', 'summaries');

// ─── HTTP ────────────────────────────────────────────
function httpRequest(options) {
  return new Promise((resolve, reject) => {
    const t = options.protocol === 'https:' ? https : http;
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
function buildPrompt(entries, previousSummary) {
  const records = entries.map((e) => {
    const t = new Date(e.timestamp);
    const time = t.toLocaleTimeString('zh-CN', { hour12: false });
    return `[${time}] ${e.summary || '(截图)'} | apps: ${(e.detail?.apps || []).join(', ') || '-'} | activity: ${e.detail?.activity || '未知'}`;
  }).join('\n');

  const prevBlock = previousSummary
    ? `\n上一个 10 分钟的摘要（用于保持连续性——如果项目相同请用相同名称）：\n${JSON.stringify(previousSummary, null, 2)}`
    : '\n（这是第一个时段，没有上一个摘要）';

  return `你是一个活动分析助手。以下是用户在过去 10 分钟内的屏幕活动记录，请生成结构化摘要。

${prevBlock}

10 分钟内的活动记录：
${records || '(无记录)'}

只输出一个 JSON 对象，不要任何其他文字：
{
  "project": "用户正在做的具体项目名称。带上具体内容名——如'开发LifeLens追踪器'、'玩《荒野大镖客》'、'写《2026年中报告》'、'看《甄嬛传》'。如果和上一个10分钟是同一个项目，必须使用完全相同的名称。",
  "category": "工作|学习|娱乐|社交 四选一。判定标准：写代码/开发/调试/写文档/做PPT/开会/画图/处理业务→工作。看教程/上课/读书/查资料学东西/刷题→学习。看视频/看电影/追剧/看直播/看解说/听音乐/打游戏/刷抖音/刷B站→娱乐。微信聊天/群聊/朋友圈/刷微博/水群/视频通话唠嗑→社交。如果同时有工作和娱乐，看哪个占比大。",
  "description": "1000字左右的详细描述。内容包括：用户具体在做什么、进展如何、用了什么工具、关注点在哪儿、有什么值得记录的细节。语言流畅、信息密集、不要空洞话。",
  "software": ["用到的软件1", "软件2"],
  "todos": ["可能遗漏的重要待办事项。根据上下文推断用户可能忘了但应该做的事。如果没有则为空数组[]。"]
}`;
}

// ─── Call DeepSeek ───────────────────────────────────
async function callDeepSeek(prompt) {
  if (!deepseekConfig?.api_key) throw new Error('DeepSeek not configured');

  const body = JSON.stringify({
    model: getModel(),
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2048,
    stream: false,
    response_format: { type: 'json_object' },
  });

  const url = new URL(deepseekConfig.base_url || 'https://api.deepseek.com/v1/chat/completions');
  const result = await httpRequest({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${deepseekConfig.api_key}`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });

  return result.choices?.[0]?.message?.content || '';
}

// ─── Parse & normalize ──────────────────────────────
function parseSummary(raw) {
  try {
    const parsed = JSON.parse(raw);
    return {
      project: parsed.project || '未知项目',
      category: ['工作', '学习', '娱乐', '社交'].includes(parsed.category) ? parsed.category : '工作',
      description: parsed.description || '',
      software: Array.isArray(parsed.software) ? parsed.software.filter(Boolean) : [],
      todos: Array.isArray(parsed.todos) ? parsed.todos.filter(Boolean) : [],
    };
  } catch {
    // Try to extract JSON from text
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try { return parseSummary(m[0]); } catch { /* fall through */ }
    }
    return {
      project: '未知项目',
      category: '工作',
      description: raw.slice(0, 1000),
      software: [],
      todos: [],
    };
  }
}

// ─── Storage paths ──────────────────────────────────
function summaryPathForBlock(blockStart) {
  const d = new Date(blockStart);
  const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const file = `${month}-${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;
  const dir = path.join(SUMMARIES_DIR, month);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, file);
}

// ─── Get block key from timestamp ───────────────────
function getBlockKey(ts) {
  const d = new Date(ts);
  d.setMinutes(Math.floor(d.getMinutes() / 10) * 10, 0, 0);
  return d.toISOString();
}

// ─── Load existing summary ──────────────────────────
function loadSummary(blockStart) {
  const p = summaryPathForBlock(blockStart);
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { /* ignore */ }
  }
  return null;
}

// ─── Main: summarize a 10-min block ─────────────────
async function summarizeBlock(entries, blockStart) {
  // Find previous block
  const prevStart = new Date(new Date(blockStart).getTime() - 10 * 60 * 1000).toISOString();
  const prev = loadSummary(prevStart);

  const prompt = buildPrompt(entries, prev);
  const raw = await callDeepSeek(prompt);
  const summary = parseSummary(raw);

  // Save
  const result = {
    blockStart,
    blockEnd: new Date(new Date(blockStart).getTime() + 10 * 60 * 1000).toISOString(),
    entryCount: entries.length,
    generatedAt: new Date().toISOString(),
    previousProject: prev?.project || null,
    ...summary,
  };

  fs.writeFileSync(summaryPathForBlock(blockStart), JSON.stringify(result, null, 2), 'utf-8');
  return result;
}

// ─── Scan for unprocessed blocks ────────────────────
function findUnprocessedBlocks() {
  const blocks = [];
  const screenshotsDir = path.join(__dirname, '..', 'screenshots');

  if (!fs.existsSync(screenshotsDir)) return blocks;

  const months = fs.readdirSync(screenshotsDir).filter((f) => /^\d{4}-\d{2}$/.test(f));
  for (const month of months) {
    const monthDir = path.join(screenshotsDir, month);
    const files = fs.readdirSync(monthDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(monthDir, file), 'utf-8');
        const data = JSON.parse(raw);
        for (const entry of (data.entries || [])) {
          const blockKey = getBlockKey(entry.timestamp);
          // Check if summary already exists
          const sp = summaryPathForBlock(blockKey);
          if (!fs.existsSync(sp)) {
            // Add to blocks map
            const existing = blocks.find((b) => b.key === blockKey);
            if (existing) {
              existing.entries.push(entry);
            } else {
              blocks.push({ key: blockKey, entries: [entry] });
            }
          }
        }
      } catch { /* skip corrupt files */ }
    }
  }

  // Sort oldest first
  blocks.sort((a, b) => a.key.localeCompare(b.key));
  // Limit queue to 50 blocks
  return blocks.slice(0, 50);
}

// ─── Load all summaries (for heatmap/timeline) ──────
function loadAllSummaries() {
  const all = [];
  if (!fs.existsSync(SUMMARIES_DIR)) return all;

  const months = fs.readdirSync(SUMMARIES_DIR).filter((f) => /^\d{4}-\d{2}$/.test(f));
  for (const month of months) {
    const dir = path.join(SUMMARIES_DIR, month);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
        all.push(s);
      } catch { /* skip */ }
    }
  }

  all.sort((a, b) => new Date(b.blockStart) - new Date(a.blockStart));
  return all;
}

module.exports = { summarizeBlock, findUnprocessedBlocks, loadAllSummaries, getBlockKey, SUMMARIES_DIR, getModel, setModel };
