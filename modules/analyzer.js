/**
 * analyzer.js — 截屏分析模块
 *
 * 三模式:
 *   ollama    — Ollama 本地视觉模型 (qwen3-vl 等)
 *   lmstudio  — LM Studio OpenAI 兼容 API
 *   none      — 纯截图，不做 AI 分析
 *
 * 检测到 deepseek_config.json 中有 api_key 时启用 DeepSeek 流水线提炼。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Config ───────────────────────────────────────────
let config = {};
function loadConfig() {
  try {
    const p = path.join(__dirname, '..', 'deepseek_config.json');
    if (fs.existsSync(p)) config = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { config = {}; }
}
loadConfig();

function getProvider()     { return config.vision_provider || 'ollama'; }
function setProvider(v)    { config.vision_provider = v; }
function getModel()        { return config.model || 'deepseek-v4-flash'; }
function setModel(name)    { config.model = name; }
function getOllamaHost()   { return config.ollama_host || '127.0.0.1'; }
function getOllamaPort()   { return config.ollama_port || '11434'; }
function getVisionModel()  { return config.vision_model || 'qwen3-vl:4b'; }
function getLmStudioHost() { return config.lmstudio_host || '127.0.0.1'; }
function getLmStudioPort() { return config.lmstudio_port || '1234'; }
function getLmStudioModel(){ return config.lmstudio_model || 'auto'; }

let USE_PIPELINE = !!(config.api_key);
function reloadPipeline() { USE_PIPELINE = !!(config.api_key); }
function reloadConfig() { loadConfig(); reloadPipeline(); }

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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function imageToBase64(absPath) {
  return fs.readFileSync(absPath).toString('base64');
}

// ─── Prompt ───────────────────────────────────────────
const VISION_PROMPT = `请详细描述这张屏幕截图的内容。包括：
1. 屏幕上打开了哪些应用或窗口
2. 每个应用/窗口里显示的主要内容是什么
3. 用户可能正在做什么任务
4. 任务栏/菜单栏/系统托盘有什么值得注意的信息

用中文回答，尽量具体，不超过300字。`;

function refinePrompt(description) {
  return `根据以下屏幕截图文字描述，总结用户正在做什么。

截图描述：${description}

你必须只输出一个完整的 JSON 对象，不要输出任何其他文字、解释或 markdown 标记。JSON 格式如下：
{"summary":"恰好5句简短的中文总结，每句话不超过20个字，用句号结束，不要编号。","apps":["应用名1","应用名2"],"activity":"活动类别","focus":"当前焦点应用"}

注意：
- 整个响应必须是一个可以被 JSON.parse 直接解析的对象，以 { 开头，以 } 结束
- summary 必须恰好5句话
- apps 列出屏幕上识别到的应用名，最多5个
- activity 从以下选一个：编程开发、设计创作、文档办公、视频会议、浏览器上网、文件管理、影音娱乐、游戏、社交聊天、在线学习、系统操作、其他
- focus 是当前焦点应用名，从 apps 里选`;
}

// ═══ PROVIDER: Ollama ══════════════════════════════════
async function ollamaDescribe(imageAbsPath) {
  const base64 = imageToBase64(imageAbsPath);
  const body = JSON.stringify({
    model: getVisionModel(),
    prompt: VISION_PROMPT,
    images: [base64],
    stream: false,
    options: { temperature: 0.1, max_tokens: 512 },
  });
  const result = await httpRequest({
    hostname: getOllamaHost(), port: getOllamaPort(),
    path: '/api/generate', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  return result.response || '';
}

// ═══ PROVIDER: LM Studio ═══════════════════════════════
async function lmStudioDescribe(imageAbsPath) {
  const base64 = imageToBase64(imageAbsPath);
  const body = JSON.stringify({
    model: getLmStudioModel(),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: VISION_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
      ],
    }],
    temperature: 0.1, max_tokens: 512, stream: false,
  });
  const result = await httpRequest({
    hostname: getLmStudioHost(), port: getLmStudioPort(),
    path: '/v1/chat/completions', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  return result.choices?.[0]?.message?.content || '';
}

// ═══ STEP 2: DeepSeek Refine ═══════════════════════════
async function refineWithDeepSeek(description) {
  const body = JSON.stringify({
    model: getModel(),
    messages: [{ role: 'user', content: refinePrompt(description) }],
    temperature: 0.1, max_tokens: 1024, stream: false,
    response_format: { type: 'json_object' },
  });
  const url = new URL(config.base_url || 'https://api.deepseek.com/v1/chat/completions');
  const result = await httpRequest({
    protocol: url.protocol, hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.api_key}`,
      'Content-Length': Buffer.byteLength(body),
    },
    body,
  });
  return result.choices?.[0]?.message?.content || '';
}

// ═══ LOCAL FALLBACK ════════════════════════════════════
async function analyzeLocal(imageAbsPath) {
  let description;
  const provider = getProvider();

  if (provider === 'lmstudio') {
    description = await lmStudioDescribe(imageAbsPath);
  } else {
    // ollama (default)
    description = await ollamaDescribe(imageAbsPath);
  }

  if (!description || description.length < 5) throw new Error('视觉描述为空');

  const body = JSON.stringify({
    model: getVisionModel(),
    prompt: `请分析这张屏幕截图，用恰好5句简短的中文描述用户正在做什么。\n要求：每句话不超过20个字，关注打开了哪些应用、在进行什么任务。直接输出5句话，不要编号，每句话用句号结束。\n\n另外在5句话之后附加一行JSON：\n{"apps":["应用名"],"activity":"活动类别","focus":"焦点应用"}`,
    images: [imageToBase64(imageAbsPath)],
    stream: false,
    options: { temperature: 0.1, max_tokens: 256 },
  });
  const result = await httpRequest({
    hostname: getOllamaHost(), port: getOllamaPort(),
    path: '/api/generate', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    body,
  });
  return parseResponse(result.response || '');
}

// ═══ RESPONSE PARSE ════════════════════════════════════
function parseResponse(text) {
  const clean = text.trim();
  let detail = { apps: [], activity: '未知', focus: '未知' };

  try {
    const parsed = JSON.parse(clean);
    if (parsed && typeof parsed === 'object') {
      return { summary: parsed.summary || '', detail: normalizeDetail(parsed) };
    }
  } catch { /* not pure JSON */ }

  const lastBrace = clean.lastIndexOf('{');
  if (lastBrace >= 0) {
    const candidate = clean.substring(lastBrace);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        return { summary: clean.substring(0, lastBrace).trim() || parsed.summary || '', detail: normalizeDetail(parsed) };
      }
    } catch {
      const repaired = repairTruncatedJson(candidate);
      if (repaired) {
        try {
          const parsed = JSON.parse(repaired);
          return { summary: clean.substring(0, lastBrace).trim() || parsed.summary || '', detail: normalizeDetail(parsed) };
        } catch { /* fail */ }
      }
    }
  }

  const am = clean.match(/(?:activity|活动)[:：]\s*"([^"]+)"/);
  const fm = clean.match(/(?:focus|焦点)[:：]\s*"([^"]+)"/);
  const appsM = clean.match(/(?:apps|应用)[:：]\s*\[([^\]]*)\]/);
  if (am) detail.activity = am[1].trim();
  if (fm) detail.focus = fm[1].trim();
  if (appsM) detail.apps = appsM[1].split(/[,，]/).map(s => s.replace(/['"]/g,'').trim()).filter(Boolean);

  return { summary: clean.replace(/^\d+[\.\、\)]\s*/gm,'').replace(/\n+$/g,'').trim(), detail };
}

function normalizeDetail(d) {
  return {
    apps: Array.isArray(d.apps) ? d.apps.filter(a => typeof a === 'string' && a.trim()) : [],
    activity: typeof d.activity === 'string' && d.activity.trim() ? d.activity.trim() : '未知',
    focus: typeof d.focus === 'string' && d.focus.trim() ? d.focus.trim() : '未知',
  };
}

function repairTruncatedJson(str) {
  let s = str.trim();
  if (!s.startsWith('{')) return null;
  let brace = 0, bracket = 0, inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') brace++; if (ch === '}') brace--;
    if (ch === '[') bracket++; if (ch === ']') bracket--;
  }
  if (inStr) s += '"';
  while (bracket > 0) { s += ']'; bracket--; }
  while (brace > 0) { s += '}'; brace--; }
  return s !== str.trim() ? s : null;
}

// ═══ MAIN ENTRY ════════════════════════════════════════
async function analyze(imageAbsPath) {
  const provider = getProvider();

  // Pure screenshot mode — no AI at all
  if (provider === 'none') {
    return {
      summary: '[纯截图模式] 已保存截图',
      detail: { apps: [], activity: '纯截图', focus: '未知' },
      mode: 'screenshot-only',
    };
  }

  if (USE_PIPELINE && config.api_key) {
    // Pipeline: vision model → DeepSeek refine
    try {
      let description;
      if (provider === 'lmstudio') {
        description = await lmStudioDescribe(imageAbsPath);
      } else {
        description = await ollamaDescribe(imageAbsPath);
      }
      if (!description || description.length < 5) throw new Error('视觉描述为空');
      const refined = await refineWithDeepSeek(description);
      const parsed = parseResponse(refined);
      parsed.mode = 'pipeline';
      return parsed;
    } catch (err) {
      console.error('[Analyzer] Pipeline failed, fallback local:', err.message);
      try {
        const fb = await analyzeLocal(imageAbsPath);
        fb.mode = 'local-fallback';
        return fb;
      } catch (e2) {
        throw new Error(`分析失败: ${e2.message}`);
      }
    }
  }

  // Local only
  const result = await analyzeLocal(imageAbsPath);
  result.mode = 'local';
  return result;
}

module.exports = {
  analyze, USE_PIPELINE,
  getModel, setModel, getProvider, setProvider,
  reloadPipeline, reloadConfig,
};
