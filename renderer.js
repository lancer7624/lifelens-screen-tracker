/**
 * renderer.js — LifeLens 渲染进程
 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ─── Elements ──────────────────────────────────────────
const el = {
  tabs: $$('.tab'), tabContents: $$('.tab-content'), tabStatus: $('#tabStatus'),
  btnStart: $('#btnStart'), btnStop: $('#btnStop'), btnFolder: $('#btnFolder'),
  modelSelect: $('#modelSelect'), providerBadge: $('#providerBadge'),
  statusText: $('#statusText'), queueCount: $('#queueCount'),
  lastCaptureLabel: $('#lastCaptureLabel'), nextCaptureLabel: $('#nextCaptureLabel'),
  summaryStatus: $('#summaryStatus'), mobileURL: $('#mobileURL'),
  totalCaptures: $('#totalCaptures'), analyzedCount: $('#analyzedCount'),
  errorCount: $('#errorCount'),
  resultsList: $('#resultsList'), logList: $('#logList'),
  // Heatmap date selects
  heatmap: $('#heatmap'), hmYear: $('#hmYear'), hmMonth: $('#hmMonth'), hmDay: $('#hmDay'),
  hmPrev: $('#hmPrev'), hmNext: $('#hmNext'), hmLabel: $('#hmLabel'),
  // Timeline filters
  timeline: $('#timeline'),
  filterProject: $('#filterProject'), filterSoftware: $('#filterSoftware'),
  filterYear: $('#filterYear'), filterMonth: $('#filterMonth'), filterDay: $('#filterDay'),
  filterCategory: $('#filterCategory'),
  filterApply: $('#filterApply'), filterClear: $('#filterClear'), filterCount: $('#filterCount'),
  // Settings
  setProvider: $('#setProvider'),
  setApiKey: $('#setApiKey'), setModel: $('#setModel'),
  setOllamaHost: $('#setOllamaHost'), setOllamaPort: $('#setOllamaPort'),
  setVisionModel: $('#setVisionModel'),
  setLmHost: $('#setLmHost'), setLmPort: $('#setLmPort'), setLmModel: $('#setLmModel'),
  panelOllama: $('#panelOllama'), panelLmStudio: $('#panelLmStudio'),
  btnSaveSettings: $('#btnSaveSettings'), btnBackFromSettings: $('#btnBackFromSettings'),
  settingsMsg: $('#settingsMsg'),
};

let heatmapMap = {};
let allSummaries = [];
let dynamicLoaded = false;

// Model returns Chinese category names → map to CSS class names
const CAT_CLASS = { '工作': 'work', '学习': 'learn', '娱乐': 'play', '社交': 'social' };
function catClass(cat) { return CAT_CLASS[cat] || 'none'; }

// ═══ DATE HELPERS ══════════════════════════════════════
const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // 29 for Feb (max)

function daysInMonth(y, m) {
  if (m !== 2) return DAYS_IN_MONTH[m];
  // Leap year check
  return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0) ? 29 : 28;
}

function populateYearSelect(sel, from, to, selected) {
  sel.innerHTML = '';
  for (let y = from; y <= to; y++) {
    sel.innerHTML += `<option value="${y}" ${y === selected ? 'selected' : ''}>${y}年</option>`;
  }
}

function populateMonthSelect(sel, selected) {
  sel.innerHTML = '';
  for (let m = 1; m <= 12; m++) {
    sel.innerHTML += `<option value="${m}" ${m === selected ? 'selected' : ''}>${m}月</option>`;
  }
}

function populateDaySelect(sel, y, m, selected) {
  sel.innerHTML = '<option value="">日</option>';
  const max = daysInMonth(y, m);
  for (let d = 1; d <= max; d++) {
    sel.innerHTML += `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}日</option>`;
  }
}

function getDateFromSelects(ySel, mSel, dSel) {
  const yv = ySel.value, mv = mSel.value, dv = dSel.value;
  if (!yv || !mv || !dv || yv === '' || mv === '' || dv === '') return '';
  const y = parseInt(yv), m = parseInt(mv), d = parseInt(dv);
  if (!y || !m || !d) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ═══ TAB SWITCHING ═════════════════════════════════════
function switchTab(name) {
  el.tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  el.tabContents.forEach((c) => c.classList.toggle('active', c.id === `tab-${name}`));
  if (name === 'dynamic') loadDynamicTab();
}
el.tabs.forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));

// ═══ MONITOR TAB ══════════════════════════════════════
function updateMonitor(s) {
  el.btnStart.disabled = s.running;
  el.btnStop.disabled = !s.running;

  // Provider badge
  const pv = s.visionProvider || 'ollama';
  el.providerBadge.textContent = pv === 'none' ? '纯截图' : pv;
  el.providerBadge.className = 'provider-badge ' + (pv === 'none' ? 'screenshot' : pv);

  // Model selector
  if (s.currentModel && el.modelSelect.value !== s.currentModel) {
    el.modelSelect.value = s.currentModel;
  }

  el.statusText.textContent = s.statusText || (s.running ? '运行中' : '未运行');
  el.statusText.className = s.running ? 'running' : 'stopped';
  el.queueCount.textContent = s.queueCount || 0;
  el.lastCaptureLabel.textContent = s.lastCapture
    ? new Date(s.lastCapture).toLocaleTimeString('zh-CN', { hour12: false }) : '-';
  el.nextCaptureLabel.textContent = s.running ? (s.nextCaptureIn || 0) : '-';

  if (s.summarizing) {
    const q = s.summaryQueueTotal > 0 ? ` ${s.summaryQueueDone}/${s.summaryQueueTotal}` : '';
    el.summaryStatus.textContent = `汇总中${q}`;
    el.tabStatus.style.display = 'flex'; el.tabStatus.textContent = '汇总中';
  } else { el.summaryStatus.textContent = ''; el.tabStatus.style.display = 'none'; }

  el.totalCaptures.textContent = s.totalCaptures || 0;
  el.analyzedCount.textContent = s.analyzedCount || 0;
  el.errorCount.textContent = s.errors || 0;

  const results = s.recentResults || [];
  el.resultsList.innerHTML = results.length === 0
    ? '<div class="empty-hint">点击「开始监控」进行记录</div>'
    : results.map((r) => `<div class="result-item">
        <div class="result-time">${fmtTime(r.timestamp)}</div>
        <div class="result-summary">${esc(r.summary)}</div>
        <div class="result-meta">
          <span>apps: ${esc((r.detail?.apps||[]).join(', ')||'-')}</span>
          <span>${esc(r.detail?.activity||'')}</span>
          <span>焦点: ${esc(r.detail?.focus||'')}</span>
        </div></div>`).join('');

  el.logList.innerHTML = (s.logLines || []).length === 0
    ? '<div class="log-line muted">等待启动…</div>'
    : s.logLines.slice(0, 40).map((l) => `<div class="log-line"><span class="log-time">${esc(l.time)}</span>${esc(l.msg)}</div>`).join('');
}

// ═══ DYNAMIC TAB ═══════════════════════════════════════
async function loadDynamicTab() {
  if (dynamicLoaded) return;
  dynamicLoaded = true;
  console.log('[DEBUG] loadDynamicTab START');

  const now = new Date();
  populateYearSelect(el.hmYear, 2026, 2030, now.getFullYear());
  populateMonthSelect(el.hmMonth, now.getMonth() + 1);
  populateDaySelect(el.hmDay, now.getFullYear(), now.getMonth() + 1, now.getDate());

  // Filter selects: insert blank placeholder option
  el.filterYear.innerHTML = '<option value="">年</option>';
  for (let y = 2026; y <= 2030; y++) el.filterYear.innerHTML += `<option value="${y}">${y}年</option>`;
  el.filterMonth.innerHTML = '<option value="">月</option>';
  for (let m = 1; m <= 12; m++) el.filterMonth.innerHTML += `<option value="${m}">${m}月</option>`;
  el.filterDay.innerHTML = '<option value="">日</option>';
  for (let d = 1; d <= 31; d++) el.filterDay.innerHTML += `<option value="${d}">${d}日</option>`;
  el.filterYear.addEventListener('change', () => {
    const y = parseInt(el.filterYear.value) || new Date().getFullYear();
    const m = parseInt(el.filterMonth.value) || 1;
    populateDaySelect(el.filterDay, y, m, parseInt(el.filterDay.value) || 0);
    el.filterDay.querySelector('option').textContent = '日';
  });
  el.filterMonth.addEventListener('change', () => {
    const y = parseInt(el.filterYear.value) || new Date().getFullYear();
    const m = parseInt(el.filterMonth.value) || 1;
    populateDaySelect(el.filterDay, y, m, parseInt(el.filterDay.value) || 0);
    el.filterDay.querySelector('option').textContent = '日';
  });

  try {
    // Check if API is available
    if (!window.api.getHeatmap) {
      el.heatmap.innerHTML = '<div class="empty-hint" style="color:red">API 不可用: getHeatmap 未定义</div>';
      return;
    }

    heatmapMap = await window.api.getHeatmap();
    allSummaries = await window.api.getSummaries();

    // Diagnostic - show directly if data received
    const hmKeys = Object.keys(heatmapMap).length;
    if (hmKeys === 0) {
      el.heatmap.innerHTML = '<div class="empty-hint" style="color:#d48787">后端返回空数据 (0条汇总)。请先运行监控至少10分钟生成汇总。</div>';
      el.timeline.innerHTML = '<div class="empty-hint">暂无数据</div>';
      return;
    }

    renderHeatmap();
    applyTimelineFilters();
  } catch (e) {
    el.heatmap.innerHTML = `<div class="empty-hint" style="color:red">加载失败: ${esc(e.message)}</div>`;
  }
}

// ─── Heatmap ───────────────────────────────────────────
el.hmYear.addEventListener('change', () => { syncHmDay(); renderHeatmap(); });
el.hmMonth.addEventListener('change', () => { syncHmDay(); renderHeatmap(); });
el.hmDay.addEventListener('change', () => renderHeatmap());

function syncHmDay() {
  const y = parseInt(el.hmYear.value);
  const m = parseInt(el.hmMonth.value);
  const cur = parseInt(el.hmDay.value);
  const max = daysInMonth(y, m);
  populateDaySelect(el.hmDay, y, m, cur > max ? max : cur);
}

function renderHeatmap() {
  const date = getDateFromSelects(el.hmYear, el.hmMonth, el.hmDay);
  const totalBlocks = Object.keys(heatmapMap).length;
  const dateBlocks = date ? Object.keys(heatmapMap).filter(k => k.startsWith(date)).length : 0;

  // Show diag on label
  el.hmLabel.textContent = `${date || '???'} · ${dateBlocks}块 · 总计${totalBlocks}条`;

  if (!date) {
    el.heatmap.innerHTML = '<div class="empty-hint">未选择日期</div>';
    return;
  }

  const cells = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 10) {
      // Use LOCAL time key (matching main process) to avoid timezone mismatch
      const key = `${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      const block = heatmapMap[key];
      const catRaw = block?.category || 'none';
      cells.push({
        label: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
        cat: catRaw, catClass: catClass(catRaw), project: block?.project, count: block?.entryCount || 0,
      });
    }
  }

  const oldTT = document.querySelector('.heatmap-tooltip');
  if (oldTT) oldTT.remove();

  el.heatmap.innerHTML = cells.map((c) =>
    `<div class="heatmap-cell ${c.catClass}"
          data-time="${date} ${c.label}"
          data-project="${escAttr(c.project||'')}"
          data-cat="${c.cat === 'none' ? '无记录' : c.cat}"
          data-count="${c.count}"></div>`
  ).join('');

  const tt = document.createElement('div');
  tt.className = 'heatmap-tooltip'; tt.style.display = 'none';
  document.body.appendChild(tt);

  el.heatmap.querySelectorAll('.heatmap-cell').forEach((cell) => {
    cell.addEventListener('mouseenter', () => {
      tt.innerHTML = `<div class="tt-time">${cell.dataset.time}</div>
        ${cell.dataset.project ? `<div class="tt-project">${esc(cell.dataset.project)}</div>` : ''}
        <div class="tt-cat">${cell.dataset.cat} · ${cell.dataset.count}条</div>`;
      tt.style.display = 'block';
    });
    cell.addEventListener('mousemove', (e) => { tt.style.left = (e.clientX + 12) + 'px'; tt.style.top = (e.clientY - 10) + 'px'; });
    cell.addEventListener('mouseleave', () => { tt.style.display = 'none'; });
  });
}

function countBlocksForDate(dateStr) {
  let n = 0;
  for (const key of Object.keys(heatmapMap)) { if (key.startsWith(dateStr)) n++; }
  return n;
}

el.hmPrev.addEventListener('click', () => shiftHmDate(-1));
el.hmNext.addEventListener('click', () => shiftHmDate(1));

function shiftHmDate(days) {
  const date = getDateFromSelects(el.hmYear, el.hmMonth, el.hmDay);
  if (!date) return;
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  const y = d.getFullYear(); const m = d.getMonth() + 1; const day = d.getDate();
  el.hmYear.value = y; el.hmMonth.value = m;
  populateDaySelect(el.hmDay, y, m, day);
  el.hmDay.value = day;
  renderHeatmap();
}

// ─── Timeline ───────────────────────────────────────────
function applyTimelineFilters() {
  if (!allSummaries || allSummaries.length === 0) {
    el.timeline.innerHTML = '<div class="empty-hint" style="color:#d48787">摘要数据为空 (allSummaries=' + (allSummaries ? allSummaries.length : 'null') + ')。请确认汇总已生成。</div>';
    el.filterCount.textContent = '0 条';
    return;
  }

  const proj = el.filterProject.value.toLowerCase().trim();
  const sw = el.filterSoftware.value.toLowerCase().trim();
  const date = getDateFromSelects(el.filterYear, el.filterMonth, el.filterDay);
  const cat = el.filterCategory.value;

  let filtered = allSummaries;
  if (proj) filtered = filtered.filter((s) => s.project && s.project.toLowerCase().includes(proj));
  if (sw) filtered = filtered.filter((s) => (s.software || []).some((a) => a.toLowerCase().includes(sw)));
  if (date) filtered = filtered.filter((s) => new Date(s.blockStart).toISOString().split('T')[0] === date);
  if (cat) filtered = filtered.filter((s) => s.category === cat);

  el.filterCount.textContent = `${filtered.length} 条`;

  if (!filtered.length) { el.timeline.innerHTML = '<div class="empty-hint">没有匹配的记录</div>'; return; }

  el.timeline.innerHTML = filtered.map((s) => {
    const start = new Date(s.blockStart); const end = new Date(s.blockEnd);
    const timeStr = `${start.toLocaleDateString('zh-CN')} ${start.toLocaleTimeString('zh-CN',{hour12:false})} — ${end.toLocaleTimeString('zh-CN',{hour12:false})}`;
    const tags = (s.software || []).map((a) => `<span class="tl-tag">${esc(a)}</span>`).join('');
    const descFull = s.description || ''; const descShort = descFull.slice(0, 150);
    const hasMore = descFull.length > 150;

    const cc = catClass(s.category);
    return `<div class="tl-item ${cc}">
      <div class="tl-header">
        <span class="tl-time">${timeStr}</span>
        <span class="tl-cat ${cc}">${s.category}</span>
        <span style="font-size:10px;color:var(--text-muted)">${s.entryCount}条</span>
      </div>
      <div class="tl-project">${esc(s.project)}</div>
      <div class="tl-desc" data-full="${escAttr(descFull)}">${esc(descShort)}</div>
      ${hasMore ? '<button class="tl-expand" data-action="expand">展开全文 ▼</button>' : ''}
      <div class="tl-tags">${tags}</div>
      ${s.todos && s.todos.length ? `<div style="margin-top:6px;font-size:11px;color:var(--accent)">📋 ${esc(s.todos.join('、'))}</div>` : ''}
    </div>`;
  }).join('');

  el.timeline.querySelectorAll('[data-action="expand"]').forEach((btn) => {
    btn.addEventListener('click', function () {
      const desc = this.previousElementSibling;
      const exp = desc.classList.toggle('expanded');
      if (exp) { desc.textContent = desc.dataset.full; this.textContent = '收起 ▲'; }
      else { desc.textContent = desc.dataset.full.slice(0, 150); this.textContent = '展开全文 ▼'; }
    });
  });
}

el.filterApply.addEventListener('click', applyTimelineFilters);
el.filterClear.addEventListener('click', () => {
  el.filterProject.value = '';
  el.filterSoftware.value = '';
  el.filterYear.value = ''; el.filterMonth.value = ''; el.filterDay.value = '';
  el.filterCategory.value = '';
  applyTimelineFilters();
});
el.filterProject.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyTimelineFilters(); });
el.filterSoftware.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyTimelineFilters(); });

// ═══ HELPERS ═══════════════════════════════════════════
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escAttr(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtTime(iso) { return new Date(iso).toLocaleString('zh-CN', { hour12: false }); }

// ═══ DIARY TAB ══════════════════════════════════════════
const elDiary = {
  dYear: $('#diaryYear'), dMonth: $('#diaryMonth'), dDay: $('#diaryDay'),
  dPrev: $('#diaryPrev'), dNext: $('#diaryNext'), dStatus: $('#diaryStatus'),
  dContent: $('#diaryContent'), dHighlights: $('#diaryHighlights'),
  hlList: $('#hlList'), dTodos: $('#diaryTodos'), todoList: $('#todoList'),
  dSuggestions: $('#diarySuggestions'), sugList: $('#sugList'),
};

function populateDiarySelects(date) {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  populateYearSelect(elDiary.dYear, 2026, 2030, y);
  populateMonthSelect(elDiary.dMonth, m);
  populateDaySelect(elDiary.dDay, y, m, d);
}
elDiary.dYear.addEventListener('change', () => { syncDiaryDay(); loadDiaryForDate(); });
elDiary.dMonth.addEventListener('change', () => { syncDiaryDay(); loadDiaryForDate(); });
elDiary.dDay.addEventListener('change', loadDiaryForDate);
elDiary.dPrev.addEventListener('click', () => shiftDiary(-1));
elDiary.dNext.addEventListener('click', () => shiftDiary(1));

function getDiaryDate() { return getDateFromSelects(elDiary.dYear, elDiary.dMonth, elDiary.dDay); }
function syncDiaryDay() { const y = parseInt(elDiary.dYear.value), m = parseInt(elDiary.dMonth.value), cur = parseInt(elDiary.dDay.value), max = daysInMonth(y, m); populateDaySelect(elDiary.dDay, y, m, cur > max ? max : cur); }
function shiftDiary(days) {
  const d = getDiaryDate(); if (!d) return;
  const dt = new Date(d + 'T12:00:00'); dt.setDate(dt.getDate() + days);
  populateDiarySelects(dt); loadDiaryForDate();
}

async function loadDiaryForDate() {
  const date = getDiaryDate(); if (!date) return;
  elDiary.dStatus.textContent = '加载中…';
  try {
    const diary = await window.api.getDiary(date);
    elDiary.dStatus.textContent = diary.entryCount ? `${diary.entryCount}个时段` : '';
    renderDiary(diary);
  } catch (e) {
    elDiary.dStatus.textContent = '加载失败';
    elDiary.dContent.innerHTML = '<div class="empty-hint">加载失败: ' + esc(e.message) + '</div>';
  }
}

function renderDiary(diary) {
  elDiary.dContent.innerHTML = `<div class="diary-card"><div class="diary-date">${esc(diary.date)}</div><div class="diary-body">${esc(diary.summary||'今天没有记录到任何活动。')}</div>${diary.tips ? `<div class="diary-tips">${esc(diary.tips)}</div>` : ''}</div>`;

  if (diary.highlights && diary.highlights.length) {
    elDiary.dHighlights.style.display = '';
    elDiary.hlList.innerHTML = diary.highlights.map((h, i) => `<div class="hl-item"><span class="hl-num">${i+1}</span><span>${esc(h)}</span></div>`).join('');
  } else { elDiary.dHighlights.style.display = 'none'; }

  if (diary.todos && diary.todos.length) {
    elDiary.dTodos.style.display = '';
    elDiary.todoList.innerHTML = diary.todos.map(t => `<div class="todo-item">${esc(t)}</div>`).join('');
  } else { elDiary.dTodos.style.display = 'none'; }

  if (diary.suggestions && diary.suggestions.length) {
    elDiary.dSuggestions.style.display = '';
    elDiary.sugList.innerHTML = diary.suggestions.map(s => `<div class="sug-item">${esc(s)}</div>`).join('');
  } else { elDiary.dSuggestions.style.display = 'none'; }
}

// ═══ DASHBOARD TAB ═════════════════════════════════════
const elDb = {
  periods: $$('.db-period'), dbYear: $('#dbYear'), dbMonth: $('#dbMonth'), dbDay: $('#dbDay'), dbLabel: $('#dbLabel'),
};
let dbPeriod = 'day';

elDb.periods.forEach(b => b.addEventListener('click', function () {
  elDb.periods.forEach(x => x.classList.remove('active'));
  this.classList.add('active');
  dbPeriod = this.dataset.period;
  elDb.dbMonth.style.display = (dbPeriod === 'day' || dbPeriod === 'month') ? '' : 'none';
  elDb.dbDay.style.display = dbPeriod === 'day' ? '' : 'none';
  refreshDashboard();
}));

elDb.dbYear.addEventListener('change', refreshDashboard);
elDb.dbMonth.addEventListener('change', refreshDashboard);
elDb.dbDay.addEventListener('change', refreshDashboard);

function initDashboardSelects() {
  const now = new Date();
  populateYearSelect(elDb.dbYear, 2026, 2030, now.getFullYear());
  populateMonthSelect(elDb.dbMonth, now.getMonth() + 1);
  populateDaySelect(elDb.dbDay, now.getFullYear(), now.getMonth() + 1, now.getDate());
  elDb.dbMonth.style.display = '';
  elDb.dbDay.style.display = '';
}

function getDashboardRange() {
  const y = parseInt(elDb.dbYear.value) || new Date().getFullYear();
  const m = parseInt(elDb.dbMonth.value) || 1;
  const d = parseInt(elDb.dbDay.value) || 1;
  const start = new Date(y, m - 1, d);
  let end;
  switch (dbPeriod) {
    case 'day': end = new Date(start); end.setDate(end.getDate() + 1); break;
    case 'week': end = new Date(start); end.setDate(end.getDate() + 7); break;
    case 'month': end = new Date(start); end.setMonth(end.getMonth() + 1); break;
    case 'year': end = new Date(start); end.setFullYear(end.getFullYear() + 1); break;
    default: end = new Date(start); end.setDate(end.getDate() + 1);
  }
  elDb.dbLabel.textContent = `${start.toLocaleDateString('zh-CN')} — ${new Date(end.getTime()-86400000).toLocaleDateString('zh-CN')}`;
  return { start: start.toISOString(), end: end.toISOString() };
}

async function refreshDashboard() {
  const range = getDashboardRange();
  try {
    const allS = await window.api.getSummaries();
    const filtered = allS.filter(s => {
      const t = new Date(s.blockStart);
      return t >= new Date(range.start) && t < new Date(range.end);
    });

    if (!filtered.length) {
      $('#dbStats').innerHTML = '<div class="empty-hint">暂无数据</div>';
      ['chartPie', 'chartSoftware', 'chartProjects', 'chartTimeline'].forEach(id => {
        const c = document.getElementById(id); if (c) { const cx = c.getContext('2d'); cx.clearRect(0, 0, c.width, c.height); cx.fillStyle = '#6e707d'; cx.font = '13px sans-serif'; cx.textAlign = 'center'; cx.fillText('暂无数据', c.width/2, c.height/2); }
      });
      return;
    }

    // Stat cards
    const cats = {}; const sw = new Set();
    for (const s of filtered) { cats[s.category] = (cats[s.category] || 0) + 1; (s.software || []).forEach(a => sw.add(a)); }
    const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    const hours = new Set(); for (const s of filtered) hours.add(new Date(s.blockStart).getHours());
    $('#dbStats').innerHTML = `
      <div class="db-stat"><div class="db-stat-num">${filtered.length}</div><div class="db-stat-label">总时段</div></div>
      <div class="db-stat"><div class="db-stat-num">${hours.size}h</div><div class="db-stat-label">活跃小时</div></div>
      <div class="db-stat"><div class="db-stat-num">${topCat?.[0]||'—'}</div><div class="db-stat-label">主要活动</div></div>
      <div class="db-stat"><div class="db-stat-num">${sw.size}</div><div class="db-stat-label">软件数</div></div>`;

    drawCatPie(filtered);
    drawSoftwareBar(filtered);
    drawProjectBar(filtered);
    drawTimeline(filtered, range);
  } catch (e) { console.error('Dashboard:', e); }
}

// ─── Pie Chart: Category ────────────────────────────────
// ═══ CHART ENGINE (finesse) ═══════════════════════════
const CHART_COLORS={'工作':'#7db87d','学习':'#7daed8','娱乐':'#d4a87d','社交':'#c894c8'};
const CHART_FB=['#7db87d','#7daed8','#d4a87d','#c894c8','#c8946c','#8a9a90'];

function rrect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath()}

// Chart tooltip system
let _ctCanvas=null,_ctData=[],_ctTT=null;
function initChartTT(canvas,data){_ctCanvas=canvas;_ctData=data;_ctTT=_ctTT||(()=>{const d=document.createElement('div');d.className='hm-tt';d.id='chartTT';document.body.appendChild(d);return d})();canvas.onmousemove=e=>{const r=canvas.getBoundingClientRect();const items=_ctData.filter(d=>d.test(e.clientX-r.left,e.clientY-r.top));if(items.length){const t=_ctTT();t.innerHTML=items[0].html;t.style.display='block';t.style.left=(e.clientX+14)+'px';t.style.top=(e.clientY-8)+'px'}else{_ctTT().style.display='none'}};canvas.onmouseleave=()=>{_ctTT().style.display='none'}}

function drawCatPie(summaries){
  const cats={};for(const s of summaries){const c=s.category||'未知';cats[c]=(cats[c]||0)+1}
  const canvas=document.getElementById('chartPie');const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height,cx=w/2,cy=h/2,R=Math.min(cx,cy)-28;ctx.clearRect(0,0,w,h);
  const items=Object.entries(cats).sort((a,b)=>b[1]-a[1]);
  const total=items.reduce((s,[,v])=>s+v,0);if(!total)return;

  ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=10;ctx.shadowOffsetY=2;
  let angle=-Math.PI/2;
  items.forEach(([name,val],i)=>{
    const slice=(val/total)*Math.PI*2;
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.arc(cx,cy,R,angle,angle+slice);
    ctx.fillStyle=CHART_COLORS[name]||CHART_FB[i%CHART_FB.length];ctx.fill();
    if(val/total>.06){
      const mid=angle+slice/2;
      ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;
      ctx.fillStyle='#0d0b0a';ctx.font='bold 11px "PingFang SC","Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillText(Math.round(val/total*100)+'%',cx+Math.cos(mid)*R*.6,cy+Math.sin(mid)*R*.6);
      ctx.shadowColor='rgba(0,0,0,.25)';ctx.shadowBlur=10;ctx.shadowOffsetY=2;
    }
    angle+=slice;
  });
  ctx.shadowColor='transparent';ctx.shadowBlur=0;ctx.shadowOffsetY=0;

  ctx.textBaseline='middle';let ly=18;
  items.forEach(([name,val],i)=>{
    const col=CHART_COLORS[name]||CHART_FB[i%CHART_FB.length];
    ctx.fillStyle=col;rrect(ctx,10,ly-6,12,12,3);ctx.fill();
    ctx.fillStyle='#b0aab8';ctx.font='11px "PingFang SC","Microsoft YaHei",sans-serif';ctx.textAlign='left';
    ctx.fillText(name+'  '+val+'时段',28,ly);ly+=22;
  });
}

function drawSoftwareBar(summaries){
  const sw={};for(const s of summaries)for(const a of(s.software||[])){sw[a]=(sw[a]||0)+1}
  const items=Object.entries(sw).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const canvas=document.getElementById('chartSoftware');const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  if(!items.length)return;
  const max=items[0][1],barH=Math.min(24,(h-40)/items.length);
  const ttData=[];
  items.forEach(([name,val],i)=>{
    const bw=Math.max(4,(val/max)*(w-130)),y=16+i*(barH+8);
    ttData.push({test:(mx,my)=>mx>=108&&mx<=108+bw&&my>=y&&my<=y+barH,html:`<b>${esc(name)}</b><br>${val} 次`});
    ctx.fillStyle='rgba(255,255,255,.025)';rrect(ctx,108,y,w-125,barH,4);ctx.fill();
    const g=ctx.createLinearGradient(108,0,300,0);g.addColorStop(0,'#c8946c');g.addColorStop(1,'rgba(200,148,108,.35)');
    ctx.fillStyle=g;rrect(ctx,108,y,bw,barH,4);ctx.fill();
    ctx.fillStyle='#b0aab8';ctx.font='11px "PingFang SC","Microsoft YaHei",sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(name.length>11?name.slice(0,10)+'…':name,104,y+barH/2);
    ctx.fillStyle='#e4e5ea';ctx.textAlign='left';ctx.font='bold 11px "SF Mono","Cascadia Code",monospace';
    ctx.fillText(val,112+bw,y+barH/2);
  });
  initChartTT(canvas,ttData);
}

function drawProjectBar(summaries){
  const proj={};for(const s of summaries){const p=s.project||'未知';proj[p]=(proj[p]||0)+1}
  const items=Object.entries(proj).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const canvas=document.getElementById('chartProjects');const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  if(!items.length)return;
  const max=items[0][1],barH=Math.min(30,(h-40)/items.length);
  items.forEach(([name,val],i)=>{
    const bw=Math.max(4,(val/max)*(w-170)),y=16+i*(barH+10);
    ctx.fillStyle='rgba(255,255,255,.025)';rrect(ctx,138,y,w-165,barH,4);ctx.fill();
    const g=ctx.createLinearGradient(138,0,380,0);g.addColorStop(0,'#7daed8');g.addColorStop(1,'rgba(125,174,216,.35)');
    ctx.fillStyle=g;rrect(ctx,138,y,bw,barH,4);ctx.fill();
    ctx.fillStyle='#b0aab8';ctx.font='11px "PingFang SC","Microsoft YaHei",sans-serif';ctx.textAlign='right';ctx.textBaseline='middle';
    ctx.fillText(name.length>14?name.slice(0,13)+'…':name,134,y+barH/2);
    ctx.fillStyle='#e4e5ea';ctx.textAlign='left';ctx.font='bold 11px "SF Mono","Cascadia Code",monospace';
    ctx.fillText(val+'时段',142+bw,y+barH/2);
  });
}

function drawTimeline(summaries,range){
  const canvas=document.getElementById('chartTimeline');const ctx=canvas.getContext('2d');
  const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  const hourCats={};
  for(const s of summaries){const hr=new Date(s.blockStart).getHours();if(!hourCats[hr])hourCats[hr]={};const c=s.category||'未知';hourCats[hr][c]=(hourCats[hr][c]||0)+1}
  let max=1;for(const h of Object.values(hourCats)){const t=Object.values(h).reduce((a,b)=>a+b,0);if(t>max)max=t}
  const colW=(w-45)/24,chartH=h-30;
  ctx.strokeStyle='rgba(255,255,255,.025)';ctx.lineWidth=1;
  for(let i=2;i<5;i++){const gy=8+(chartH/5)*i;ctx.beginPath();ctx.moveTo(30,gy);ctx.lineTo(w-12,gy);ctx.stroke()}
  for(let hr=0;hr<24;hr++){
    const x=30+hr*colW,entries=Object.entries(hourCats[hr]||{}).sort((a,b)=>b[1]-a[1]);
    const total=entries.reduce((s,[,v])=>s+v,0);if(!total)continue;
    let sy=8+chartH;
    entries.forEach(([cat,val])=>{const segH=(val/max)*chartH;sy-=segH;ctx.fillStyle=CHART_COLORS[cat]||CHART_FB[0];ctx.fillRect(x+1.5,sy,colW-3,Math.max(3,segH))});
  }
  ctx.fillStyle='#6e707d';ctx.font='9px "PingFang SC","Microsoft YaHei",sans-serif';ctx.textAlign='center';
  for(let h=0;h<24;h+=3)ctx.fillText(h+'时',30+h*colW+colW/2,h-2);
  ctx.textAlign='right';ctx.fillText(max,24,14);
}

// Extend tab switching for diary + dashboard
const origSwitchTab2 = switchTab;
switchTab = function (name) {
  origSwitchTab2(name);
  if (name === 'diary') initDiaryTab();
  if (name === 'dashboard') initDashboardTab();
  if (name === 'settings') loadSettingsTab();
};

async function initDiaryTab() {
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  populateDiarySelects(yesterday);
  loadDiaryForDate();
}

function initDashboardTab() {
  initDashboardSelects();
  refreshDashboard();
}

// ═══ SETTINGS TAB ═══════════════════════════════════════
async function loadSettingsTab() {
  try {
    const cfg = await window.api.getConfig();
    el.setProvider.value = cfg.vision_provider || 'ollama';
    el.setApiKey.value = cfg.api_key || '';
    el.setModel.value = cfg.model || 'deepseek-v4-flash';
    el.setOllamaHost.value = cfg.ollama_host || '127.0.0.1';
    el.setOllamaPort.value = cfg.ollama_port || '11434';
    el.setVisionModel.value = cfg.vision_model || 'qwen3-vl:4b';
    el.setLmHost.value = cfg.lmstudio_host || '127.0.0.1';
    el.setLmPort.value = cfg.lmstudio_port || '1234';
    el.setLmModel.value = cfg.lmstudio_model || 'auto';
    updateProviderPanels();
  } catch (e) { /* ignore */ }
}

function updateProviderPanels() {
  const v = el.setProvider.value;
  el.panelOllama.style.display = v === 'ollama' ? '' : 'none';
  el.panelLmStudio.style.display = v === 'lmstudio' ? '' : 'none';
}
el.setProvider.addEventListener('change', updateProviderPanels);

el.btnBackFromSettings.addEventListener('click', () => switchTab('monitor'));

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-url]');
  if (link) { e.preventDefault(); window.api.openExternal(link.dataset.url); }
});

el.btnSaveSettings.addEventListener('click', async () => {
  const cfg = {
    vision_provider: el.setProvider.value,
    api_key: el.setApiKey.value.trim(),
    model: el.setModel.value,
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    ollama_host: el.setOllamaHost.value.trim() || '127.0.0.1',
    ollama_port: el.setOllamaPort.value.trim() || '11434',
    vision_model: el.setVisionModel.value.trim() || 'qwen3-vl:4b',
    lmstudio_host: el.setLmHost.value.trim() || '127.0.0.1',
    lmstudio_port: el.setLmPort.value.trim() || '1234',
    lmstudio_model: el.setLmModel.value.trim() || 'auto',
  };
  try {
    await window.api.saveConfig(cfg);
    el.settingsMsg.textContent = '✅ 已保存 (' + (cfg.vision_provider === 'none' ? '纯截图' : cfg.vision_provider) + ')';
    el.settingsMsg.style.color = 'var(--green)';
    setTimeout(() => { el.settingsMsg.textContent = ''; }, 2000);
  } catch (e) {
    el.settingsMsg.textContent = '❌ 保存失败: ' + e.message;
    el.settingsMsg.style.color = 'var(--red)';
  }
});

// Extend tab switching for settings
const origSwitchTab = switchTab;
switchTab = function(name) {
  origSwitchTab(name);
  if (name === 'settings') loadSettingsTab();
};

// ═══ FIRST-RUN DETECTION ═══════════════════════════════
let firstRunChecked = false;
async function checkFirstRun() {
  if (firstRunChecked) return;
  firstRunChecked = true;
  try {
    const cfg = await window.api.getConfig();
    if (!cfg.api_key) {
      switchTab('settings');
      el.settingsMsg.textContent = '⚠️ 请先配置 DeepSeek API Key，或点「← 返回监控」跳过';
      el.settingsMsg.style.color = 'var(--accent)';
    }
  } catch (e) { /* ignore */ }
}

// ═══ INIT ═══════════════════════════════════════════
async function init() {
  try { updateMonitor(await window.api.getState()); } catch (e) { console.error(e); }
  window.api.onStateUpdate((s) => { updateMonitor(s); if (s.lastSummaryBlock) { dynamicLoaded = false; } });

  el.btnStart.addEventListener('click', () => window.api.toggleRunning());
  el.btnStop.addEventListener('click', () => window.api.toggleRunning());
  el.btnFolder.addEventListener('click', () => window.api.openDataFolder());

  el.modelSelect.addEventListener('change', async () => {
    await window.api.setModel(el.modelSelect.value);
  });

  // Check if API key is configured
  setTimeout(checkFirstRun, 500);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
