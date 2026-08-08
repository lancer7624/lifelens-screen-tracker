/**
 * qa.js — Agentic 问答模块 · DeepSeek 驱动
 * DeepSeek 生成关键词 → 搜索本地记录 → 迭代 3 轮 → 回答
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const MAX_SNIPPETS = 300;
const SNIPPET_LEN = 400;
const MAX_ROUNDS = 3;

// ─── DeepSeek API ─────────────────────────────────────
function getConfig() {
  try {
    const p = path.join(ROOT, 'deepseek_config.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { /* ignore */ }
  return {};
}

async function deepseekChat(messages, jsonMode) {
  const cfg = getConfig();
  if (!cfg.api_key) throw new Error('DeepSeek API Key 未配置');

  const body = JSON.stringify({
    model: cfg.model || 'deepseek-v4-flash',
    messages,
    temperature: 0.3,
    max_tokens: jsonMode ? 512 : 1536,
    stream: false,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
  });

  return new Promise((resolve, reject) => {
    const url = new URL(cfg.base_url || 'https://api.deepseek.com/v1/chat/completions');
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.api_key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const r = JSON.parse(d);
          if (res.statusCode >= 400) reject(new Error(`API ${res.statusCode}`));
          else resolve(r.choices?.[0]?.message?.content || '');
        } catch (e) { reject(new Error('parse: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

// ─── Search ──────────────────────────────────────────
function searchDir(dir, keywords) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  function walk(d) {
    const entries = fs.readdirSync(d, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(d, e.name);
      if (e.isDirectory()) { walk(fp); continue; }
      if (!e.name.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        const text = JSON.stringify(data).toLowerCase();
        const hits = keywords.filter(k => text.includes(k.toLowerCase()));
        if (hits.length > 0) {
          results.push({ file: path.relative(ROOT, fp), hits, snippet: JSON.stringify(data).slice(0, SNIPPET_LEN), date: (fp.match(/(\d{4}-\d{2}-\d{2})/) || [''])[0] });
        }
      } catch { /* skip */ }
    }
  }
  walk(dir);
  return results;
}

function searchAll(keywords, timeRange) {
  let results = [];
  const dirs = [
    { dir: path.join(ROOT, 'screenshots'), label: '20s截图' },
    { dir: path.join(ROOT, 'summaries'), label: '10分钟汇总' },
    { dir: path.join(ROOT, 'diaries'), label: '日记' },
  ];
  for (const { dir, label } of dirs) {
    for (const r of searchDir(dir, keywords)) results.push({ ...r, source: label });
  }
  if (timeRange?.from) results = results.filter(r => !r.date || r.date >= timeRange.from);
  if (timeRange?.to) results = results.filter(r => !r.date || r.date <= timeRange.to);
  results.sort((a, b) => b.date.localeCompare(a.date));
  return results.slice(0, MAX_SNIPPETS);
}

// ─── Agentic Loop ────────────────────────────────────
async function ask(question, onStep) {
  let allResults = [], context = '';
  const steps = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const prompt = round === 1
      ? `根据用户问题生成搜索关键词。\n\n问题: "${question}"\n\n数据源: 20s截图描述、10分钟活动汇总(含project/category/description/software)、每日AI日记。\n\n输出JSON: {"keywords":["关键词1","关键词2","关键词3"],"timeRange":{"from":"2026-08-01","to":"2026-08-08"}}\n\nkeywords 用中文，3-5个。timeRange不填表示不限制。只输出JSON。`
      : `上一轮找到了一些结果，需要更精准的关键词。\n已有信息:\n${context.slice(0,1500)}\n\n问题: "${question}"\n输出JSON: {"keywords":["更精准的关键词"],"timeRange":{}}`;

    let plan = { keywords: [] };
    try {
      const raw = await deepseekChat([{ role: 'user', content: prompt }], true);
      plan = JSON.parse(raw);
    } catch {
      // Fallback: extract words from question
      plan.keywords = question.replace(/[？?，,。.！!]/g, ' ').split(/\s+/).filter(w => w.length >= 2).slice(0, 5);
    }

    const keywords = (plan.keywords || []).filter(Boolean).slice(0, 5);
    if (keywords.length === 0) break;

    const found = searchAll(keywords, plan.timeRange);
    allResults = [...allResults, ...found];
    const seen = new Set();
    allResults = allResults.filter(r => { const k = r.file + r.snippet.slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; });
    context = allResults.slice(0, 20).map(r => `[${r.source}|${r.date}] ${r.snippet.slice(0, 300)}`).join('\n---\n');

    steps.push({ round, keywords, found: found.length, total: allResults.length });
    if (onStep) onStep(steps[steps.length - 1]);
    if (allResults.length >= 10 || (round > 1 && found.length < 3)) break;
  }

  // Final answer via DeepSeek
  const answerPrompt = `根据以下搜索到的用户活动记录回答问题。\n\n记录:\n${context.slice(0, 4000) || '(无)'}\n\n问题: "${question}"\n\n用中文简要回答。如有相关信息请引用具体时间和内容。没有就说没找到。`;
  const answer = await deepseekChat([{ role: 'user', content: answerPrompt }], false);

  return { answer, steps, resultCount: allResults.length };
}

module.exports = { ask };
