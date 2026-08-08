/**
 * server.js — HTTP 服务器，局域网内任何设备可访问完整仪表盘
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3456;
const ROOT = path.join(__dirname, '..');
let server = null;
let currentState = {};

// ─── LAN IP ────────────────────────────────────────────
function getLanIP() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address);
    }
  }
  const isReal = (a) => a.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(a) || a.startsWith('10.');
  const pref = candidates.find(isReal);
  return pref || candidates[0] || '127.0.0.1';
}

// ─── MIME ──────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// ─── Serve static file ─────────────────────────────────
function serveStatic(res, filePath) {
  try {
    const ext = path.extname(filePath);
    const data = fs.readFileSync(filePath);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end('Not Found');
  }
}

// ─── Web dashboard (index.html adapted for remote access) ──
function serveWebDashboard(res, isLocal) {
  try {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf-8');
    // Replace Electron renderer with web renderer
    html = html.replace('renderer.js', 'renderer-web.js');
    // Remove CSP that blocks inline scripts (needed for web)
    html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    if (!isLocal) {
      // Strip entire settings tab from HTML for remote users
      html = html.replace(/<!-- ═══ TAB: 设置 ═══ -->[\s\S]*?<!-- \/TAB: 设置 -->/, '');
      // Remove settings tab button from nav
      html = html.replace('<button class="tab" data-tab="settings">设置</button>', '');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
  } catch {
    res.statusCode = 500;
    res.end('Error loading dashboard');
  }
}

// ─── API ────────────────────────────────────────────────
function apiJSON(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

async function handleAPI(req, res, url) {
  if (url.pathname === '/api/state') {
    return apiJSON(res, currentState);
  }

  if (url.pathname === '/api/toggle-running' && req.method === 'POST') {
    // Trigger toggle-running via the Electron app's state
    currentState.running = !currentState.running;
    // Signal to main process via a temp file
    fs.writeFileSync(path.join(ROOT, '.web_toggle'), currentState.running ? 'start' : 'stop');
    return apiJSON(res, { running: currentState.running });
  }

  if (url.pathname === '/api/summaries') {
    try {
      const { loadAllSummaries } = require('./summarizer');
      return apiJSON(res, loadAllSummaries());
    } catch { return apiJSON(res, []); }
  }

  if (url.pathname === '/api/heatmap') {
    try {
      const { loadAllSummaries } = require('./summarizer');
      const all = loadAllSummaries();
      const map = {};
      for (const s of all) {
        const d = new Date(s.blockStart);
        d.setMinutes(Math.floor(d.getMinutes() / 10) * 10, 0, 0);
        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        map[key] = { category: s.category, project: s.project, entryCount: s.entryCount };
      }
      return apiJSON(res, map);
    } catch { return apiJSON(res, {}); }
  }

  if (url.pathname === '/api/qa' && req.method === 'POST') {
    try {
      const body = await new Promise(r => { let d='';req.on('data',c=>d+=c);req.on('end',()=>r(d)); });
      const { question } = JSON.parse(body);
      const { ask } = require('./qa');
      const result = await ask(question);
      return apiJSON(res, result);
    } catch (e) { return apiJSON(res, { error: e.message }); }
  }

  res.statusCode = 404;
  apiJSON(res, { error: 'Not found' });
}

// ─── Main handler ──────────────────────────────────────
async function requestHandler(req, res) {
  try {
  const url = new URL(req.url, 'http://localhost');

  // API
  if (url.pathname.startsWith('/api/')) {
    await handleAPI(req, res, url);
    return;
  }

  // Static files
  if (url.pathname === '/' || url.pathname === '/index.html') {
    const clientIP = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    const isLocal = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === 'localhost';
    return serveWebDashboard(res, isLocal);
  }

  // Serve other static files from project root
  const safePath = path.normalize(url.pathname).replace(/^\/+/, '');
  const filePath = path.join(ROOT, safePath);

  // Security: only serve files within project root
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end('Forbidden');
  }

  serveStatic(res, filePath);
  } catch (e) {
    if (!res.headersSent) { res.statusCode = 500; res.end('Server Error'); }
    console.error('[Server]', e.message);
  }
}

// ─── Watcher for toggle signal ─────────────────────────
function watchToggleSignal(callback) {
  const toggleFile = path.join(ROOT, '.web_toggle');
  setInterval(() => {
    if (fs.existsSync(toggleFile)) {
      try {
        const action = fs.readFileSync(toggleFile, 'utf-8').trim();
        fs.unlinkSync(toggleFile);
        callback(action);
      } catch { /* ignore */ }
    }
  }, 1000);
}

// ─── Start / Stop ──────────────────────────────────────
function start(stateObj, onToggle) {
  currentState = stateObj;
  const ip = getLanIP();

  server = http.createServer(requestHandler);
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error('[Server] Port '+PORT+' in use — old instance still running?');
    else console.error('[Server]', e.message);
  });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Web dashboard: http://${ip}:${PORT}`);
  });

  if (onToggle) watchToggleSignal(onToggle);

  return { ip, port: PORT };
}

function updateState(s) { currentState = s; }

function stop() {
  if (server) { server.close(); server = null; }
}

module.exports = { start, updateState, stop, getLanIP };
