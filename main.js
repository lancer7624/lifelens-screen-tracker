/**
 * main.js — LifeLens 活动追踪器 主进程
 */
const { app, BrowserWindow, ipcMain, Menu, shell, dialog, powerMonitor } = require('electron');
const path = require('path');
const { capture } = require('./modules/screenshot');
const { analyze, USE_PIPELINE, getModel: getAnalysisModel, setModel: setAnalysisModel, getProvider, reloadConfig: reloadAnalyzerConfig } = require('./modules/analyzer');
const { saveRecord, todayCount } = require('./modules/storage');
const { summarizeBlock, findUnprocessedBlocks, loadAllSummaries, getModel: getSummaryModel, setModel: setSummaryModel } = require('./modules/summarizer');
const { start: startServer, updateState: updateServerState } = require('./modules/server');
const { generateDiary, loadDiary, findUnprocessedDates, loadSummariesForDate, loadAllDiaries } = require('./modules/diarist');
const { ask: qaAsk } = require('./modules/qa');
const { run: cleanupRun } = require('./modules/cleanup');

// ─── 配置 ───────────────────────────────────────────
const INTERVAL_MS = 20_000;
const SUMMARY_INTERVAL_MS = 10 * 60_000; // 10 min
const WIN_W = 900;
const WIN_H = 700;
let mainWindow = null;
let timer = null;
let summaryTimer = null;
let running = false;

// State
const state = {
  running: false,
  lastCapture: null, lastImage: null, lastSummary: '', lastDetail: null,
  todayCount: 0, nextCaptureIn: 0, errors: 0, totalCaptures: 0,
  analyzedCount: 0, queueCount: 0,
  analysisMode: USE_PIPELINE ? 'pipeline' : 'local',
  currentModel: getAnalysisModel(),
  visionProvider: getProvider(),
  statusText: '未运行',
  recentResults: [],
  logLines: [],
  // Summary state
  summarizing: false,
  mobileURL: '',
  summaryQueue: [],
  summaryQueueTotal: 0,
  summaryQueueDone: 0,
  lastSummaryBlock: null,
};

// ─── 日志 ──────────────────────────────────────────
function addLog(msg) {
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  state.logLines.unshift({ time, msg });
  if (state.logLines.length > 150) state.logLines.length = 150;
  pushState();
}

// ─── 菜单栏 ────────────────────────────────────────
function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: '开始监控', accelerator: 'CmdOrCtrl+S', click: () => { if (!running) startLoop(); } },
        { label: '停止监控', accelerator: 'CmdOrCtrl+X', click: () => { if (running) stopLoop(); } },
        { type: 'separator' },
        { label: '打开数据文件夹', accelerator: 'CmdOrCtrl+O', click: () => shell.openPath(path.join(__dirname, 'screenshots')) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'close' }] },
    { label: 'Help', submenu: [{ label: '关于 LifeLens', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'LifeLens', message: 'LifeLens - 活动追踪器', detail: '每 20 秒截屏 + 每 10 分钟 AI 汇总' }) }] },
  ]));
}

// ─── 窗口 ──────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_W, height: WIN_H, minWidth: 720, minHeight: 560,
    title: 'LifeLens - 活动追踪器',
    backgroundColor: '#0e0f13',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.center();
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC ────────────────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-state', () => state);
  ipcMain.handle('toggle-running', async () => { running ? stopLoop() : startLoop(); return { running }; });
  ipcMain.handle('open-data-folder', async () => shell.openPath(path.join(__dirname, 'screenshots')));
  ipcMain.handle('quit-app', async () => { stopLoop(); app.quit(); return { ok: true }; });
  ipcMain.handle('open-external', async (_e, url) => { return shell.openExternal(url); });

  // Diary IPC
  ipcMain.handle('get-diary', async (_e, dateStr) => {
    let diary = loadDiary(dateStr);
    if (!diary) {
      const summaries = loadSummariesForDate(dateStr);
      try {
        diary = await generateDiary(dateStr, summaries);
      } catch (e) {
        diary = { date: dateStr, summary: '生成失败: ' + e.message, highlights: [], todos: [], suggestions: [], tips: '', entryCount: summaries.length };
      }
    }
    return diary;
  });

  ipcMain.handle('get-all-diaries', async () => loadAllDiaries());

  ipcMain.handle('get-unprocessed-diaries', async () => findUnprocessedDates());

  // QA
  ipcMain.handle('qa-ask', async (_e, question) => {
    const result = await qaAsk(question, (step) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('qa-step', step);
      }
    });
    return result;
  });

  ipcMain.handle('set-model', async (_e, model) => {
    setAnalysisModel(model);
    setSummaryModel(model);
    state.currentModel = model;
    addLog(`模型切换: ${model}`);
    pushState();
    return { model };
  });

  // Settings IPC
  const fs = require('fs');
  ipcMain.handle('get-config', async () => {
    const p = path.join(__dirname, 'deepseek_config.json');
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return {}; }
  });
  ipcMain.handle('save-config', async (_e, cfg) => {
    const p = path.join(__dirname, 'deepseek_config.json');
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
    // Reload configs
    if (cfg.api_key) {
      setAnalysisModel(cfg.model || 'deepseek-v4-flash');
      setSummaryModel(cfg.model || 'deepseek-v4-flash');
      state.currentModel = cfg.model || 'deepseek-v4-flash';
      state.analysisMode = 'pipeline';
    } else {
      state.analysisMode = 'local';
    }
    reloadAnalyzerConfig();
    state.visionProvider = cfg.vision_provider || 'ollama';
    addLog(`配置已保存 (${state.visionProvider})`);
    pushState();
    return { ok: true };
  });

  // Dynamic tab: load all summaries
  ipcMain.handle('get-summaries', async () => {
    return loadAllSummaries();
  });

  // Dynamic tab: get summaries as map keyed by ISO block start
  ipcMain.handle('get-heatmap', async () => {
    const all = loadAllSummaries();
    const map = {};
    for (const s of all) {
      const d = new Date(s.blockStart);
      // Use LOCAL time key (not UTC ISO) to match renderer's local time lookup
      d.setMinutes(Math.floor(d.getMinutes() / 10) * 10, 0, 0);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      map[key] = {
        category: s.category || null,
        project: s.project || null,
        entryCount: s.entryCount || 0,
      };
    }
    return map;
  });
}

// ─── 截屏循环 ──────────────────────────────────────
async function runOneCycle() {
  state.statusText = '截屏中...'; state.queueCount = 1; pushState();

  let imageResult;
  try {
    imageResult = await capture();
    state.lastCapture = imageResult.timestamp.toISOString();
    state.lastImage = imageResult.relPath;
    state.totalCaptures++;
    state.todayCount = todayCount();
    state.statusText = '分析中...'; pushState();
    addLog(`截屏: ${imageResult.relPath}`);
  } catch (err) {
    state.errors++; state.queueCount = 0;
    state.statusText = `截屏失败: ${err.message}`;
    addLog(`截屏失败: ${err.message}`);
    pushState(); return { ok: false, error: err.message };
  }

  let summary = '', detail = { apps: [], activity: '未知', focus: '未知' };
  try {
    const analysis = await analyze(imageResult.absPath);
    summary = analysis.summary; detail = analysis.detail;
    state.lastSummary = summary; state.lastDetail = detail;
    state.analysisMode = analysis.mode || 'local';
    state.analyzedCount++;
    state.errors = Math.max(0, state.errors - 1);
    state.queueCount = 0;
    addLog(`分析: ${detail.activity} | ${(detail.apps || []).join(', ')}`);
  } catch (err) {
    state.errors++; state.queueCount = 0;
    summary = `[分析失败] ${err.message}`;
    detail = { apps: [], activity: '分析不可用', focus: '未知' };
    state.lastSummary = summary; state.lastDetail = detail;
    addLog(`分析失败: ${err.message}`);
  }

  try {
    const saved = saveRecord(imageResult.relPath, summary, detail, imageResult.timestamp);
    state.statusText = `已保存 → ${saved.parts.dateStr}_${saved.parts.h}.json`;
  } catch (err) { console.error('[存储]', err); }

  state.recentResults.unshift({ timestamp: imageResult.timestamp.toISOString(), image: imageResult.relPath, summary, detail });
  if (state.recentResults.length > 20) state.recentResults.length = 20;
  pushState();
  return { ok: true, image: imageResult.relPath };
}

// ─── 10分钟汇总 ────────────────────────────────────
async function runSummary() {
  if (state.summarizing) return;
  state.summarizing = true;
  addLog('开始 10 分钟汇总...');

  const blockStart = new Date();
  blockStart.setMinutes(Math.floor(blockStart.getMinutes() / 10) * 10, 0, 0);

  // Collect entries from this block
  const entries = state.recentResults.filter((r) => {
    const t = new Date(r.timestamp);
    return t >= blockStart && t < new Date(blockStart.getTime() + 10 * 60_000);
  });

  try {
    const result = await summarizeBlock(entries, blockStart.toISOString());
    state.lastSummaryBlock = result;
    addLog(`汇总完成: ${result.project} (${result.category}, ${result.entryCount}条)`);
    console.log('[Summary]', result.project, result.category);
  } catch (err) {
    addLog(`汇总失败: ${err.message}`);
    console.error('[Summary error]', err);
  }

  state.summarizing = false;
  pushState();
}

// ─── 启动时排队处理遗漏的汇总 ──────────────────────
async function processQueue() {
  const blocks = findUnprocessedBlocks();
  if (blocks.length === 0) return;

  state.summaryQueueTotal = blocks.length;
  state.summaryQueueDone = 0;
  state.summaryQueue = blocks.map((b) => b.key);
  addLog(`发现 ${blocks.length} 个未汇总时段，开始排队处理...`);
  pushState();

  for (const block of blocks) {
    state.summarizing = true;
    state.summaryQueueDone++;
    pushState();
    addLog(`汇总补处理: ${new Date(block.key).toLocaleTimeString('zh-CN', { hour12: false })} (${block.entries.length}条)`);

    try {
      await summarizeBlock(block.entries, block.key);
    } catch (err) {
      addLog(`汇总补处理失败: ${err.message}`);
    }
  }

  state.summarizing = false;
  state.summaryQueue = [];
  state.summaryQueueTotal = 0;
  state.summaryQueueDone = 0;
  addLog('排队汇总处理完成');
  pushState();
}

// ─── 定时器 ─────────────────────────────────────────
let captureInProgress = false, nextCaptureAt = 0;
let idlePaused = false, idleTimer = null;
const IDLE_MINUTES = 5;

function checkIdle() {
  const idleSec = powerMonitor.getSystemIdleTime();
  if (idleSec > IDLE_MINUTES * 60 && running && !idlePaused) {
    idlePaused = true;
    stopLoop();
    state.statusText = '空闲暂停（人已离开）';
    addLog('检测到空闲，自动暂停');
    pushState();
  } else if (idleSec < 30 && idlePaused && !running) {
    idlePaused = false;
    startLoop();
    addLog('检测到活动，自动恢复');
  }
}

async function runOneCycleSafe() {
  if (captureInProgress) return;
  captureInProgress = true;
  for (let i = 1; i <= 3; i++) {
    const r = await runOneCycle();
    if (r.ok) break;
    if (i < 3) { state.statusText = `重试 ${i}/3...`; pushState(); await new Promise((r) => setTimeout(r, 2000)); }
  }
  captureInProgress = false;
  nextCaptureAt = Date.now() + INTERVAL_MS;
  state.nextCaptureIn = INTERVAL_MS / 1000;
  pushState();
}

function startLoop() {
  running = true; state.running = true; state.statusText = '运行中';
  addLog('监控已启动'); pushState();
  runOneCycleSafe();
  nextCaptureAt = Date.now() + INTERVAL_MS;

  timer = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((nextCaptureAt - Date.now()) / 1000));
    state.nextCaptureIn = remaining;
    if (remaining <= 0 && !captureInProgress) runOneCycleSafe();
    pushState();
  }, 1000);

  // 10-min summary timer
  summaryTimer = setInterval(() => {
    if (!state.summarizing) runSummary();
  }, SUMMARY_INTERVAL_MS);
}

function stopLoop() {
  running = false; state.running = false; state.statusText = '已停止';
  state.nextCaptureIn = 0; captureInProgress = false; state.queueCount = 0;
  if (timer) { clearInterval(timer); timer = null; }
  if (summaryTimer) { clearInterval(summaryTimer); summaryTimer = null; }
  addLog('监控已停止'); pushState();
}

function pushState() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state-update', { ...state });
  updateServerState(state);
}

// ─── 启动 ───────────────────────────────────────────
app.whenReady().then(async () => {
  buildMenu();
  setupIPC();
  createWindow();
  pushState();

  console.log('[LifeLens] 就绪');
  console.log('[LifeLens] 模式:', USE_PIPELINE ? '流水线' : '纯本地');

  // Start mobile HTTP server
  const srv = startServer(state, (action) => {
    if (action === 'start' && !running) startLoop();
    if (action === 'stop' && running) stopLoop();
  });
  state.mobileURL = `http://${srv.ip}:${srv.port}`;
  addLog(`局域网访问: ${state.mobileURL}`);
  pushState();

  // Idle detection — check every 30s
  idleTimer = setInterval(checkIdle, 30000);

  // Cleanup — run at startup + every 6 hours
  const doCleanup = () => {
    try {
      const r = cleanupRun();
      if (r.screenshotsDeleted > 0 || r.sizeEnforced > 0) {
        addLog(`清理: ${r.screenshotsDeleted}张过期截图, 当前${r.currentSizeMB}MB`);
      }
    } catch (e) { /* silent */ }
  };
  setTimeout(doCleanup, 10000);
  setInterval(doCleanup, 6 * 3600_000);

  // 启动后排隊处理遗漏汇总 + 日记
  setTimeout(() => processQueue(), 3000);
  setTimeout(async () => {
    const dates = findUnprocessedDates();
    if (dates.length > 0) {
      addLog(`发现 ${dates.length} 天未生成日记，开始处理...`);
      for (const d of dates) {
        try {
          const s = loadSummariesForDate(d);
          await generateDiary(d, s);
          addLog(`日记: ${d}`);
        } catch (e) { addLog(`日记失败 ${d}: ${e.message}`); }
      }
      addLog('日记补处理完成');
    }
  }, 5000);
});

app.on('window-all-closed', () => { stopLoop(); app.quit(); });
app.on('before-quit', () => { stopLoop(); });
