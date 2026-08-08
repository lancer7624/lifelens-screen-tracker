/**
 * renderer-web.js — 网页版渲染器 (fetch API 替代 Electron IPC)
 */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ─── DOM ─────────────────────────────────────────────────
const el = {
  tabs: $$('.tab'), tabContents: $$('.tab-content'), tabStatus: $('#tabStatus'),
  btnStart: $('#btnStart'), btnStop: $('#btnStop'), btnFolder: $('#btnFolder'),
  modelBadge: $('#modelBadge'), statusText: $('#statusText'),
  queueCount: $('#queueCount'), lastCaptureLabel: $('#lastCaptureLabel'),
  nextCaptureLabel: $('#nextCaptureLabel'), summaryStatus: $('#summaryStatus'),
  totalCaptures: $('#totalCaptures'), analyzedCount: $('#analyzedCount'),
  errorCount: $('#errorCount'),
  resultsList: $('#resultsList'), logList: $('#logList'),
  hmYear: $('#hmYear'), hmMonth: $('#hmMonth'), hmDay: $('#hmDay'),
  hmPrev: $('#hmPrev'), hmNext: $('#hmNext'), hmLabel: $('#hmLabel'),
  heatmap: $('#heatmap'),
  timeline: $('#timeline'),
  filterProject: $('#filterProject'), filterSoftware: $('#filterSoftware'),
  filterYear: $('#filterYear'), filterMonth: $('#filterMonth'), filterDay: $('#filterDay'),
  filterCategory: $('#filterCategory'),
  filterApply: $('#filterApply'), filterClear: $('#filterClear'), filterCount: $('#filterCount'),
};

// Hide model select (web users can't change it)
const modelSelect = $('#modelSelect');
if (modelSelect) modelSelect.style.display = 'none';

// ─── API helpers ────────────────────────────────────────
async function api(url, opts) {
  const r = await fetch(url, opts);
  return r.json();
}

// ═══ Date helpers ═══════════════════════════════════════
const DAYS_IN_MONTH = [0,31,29,31,30,31,30,31,31,30,31,30,31];
function daysInMonth(y,m){ if(m!==2)return DAYS_IN_MONTH[m]; return(y%4===0&&y%100!==0)||y%400===0?29:28; }
function populateYearSelect(sel,f,t,s){ sel.innerHTML='';for(let y=f;y<=t;y++)sel.innerHTML+=`<option value="${y}"${y===s?' selected':''}>${y}年</option>`; }
function populateMonthSelect(sel,s){ sel.innerHTML='';for(let m=1;m<=12;m++)sel.innerHTML+=`<option value="${m}"${m===s?' selected':''}>${m}月</option>`; }
function populateDaySelect(sel,y,m,s){ sel.innerHTML='<option value="">日</option>';const max=daysInMonth(y,m);for(let d=1;d<=max;d++)sel.innerHTML+=`<option value="${d}"${d===s?' selected':''}>${d}日</option>`; }
function getDateFromSelects(yS,mS,dS){const y=yS.value,m=mS.value,d=dS.value;if(!y||!m||!d||y===''||m===''||d==='')return'';return`${y}-${String(parseInt(m)).padStart(2,'0')}-${String(parseInt(d)).padStart(2,'0')}`;}

// ═══ Tab switching ══════════════════════════════════════
function switchTab(name) {
  el.tabs.forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  el.tabContents.forEach(c=>c.classList.toggle('active',c.id===`tab-${name}`));
  if(name==='dynamic') loadDynamicTab();
  if(name==='settings') el.tabs.forEach(t=>{if(t.dataset.tab==='settings')t.style.display='none';});
}
el.tabs.forEach(t=>{if(t.dataset.tab==='settings')t.style.display='none';else t.addEventListener('click',()=>switchTab(t.dataset.tab))});

// ═══ Monitor ═══════════════════════════════════════════
function updateMonitor(s) {
  el.btnStart.disabled = s.running;
  el.btnStop.disabled = !s.running;
  el.statusText.textContent = s.statusText||(s.running?'运行中':'未运行');
  el.statusText.className = s.running?'running':'stopped';
  el.queueCount.textContent = s.queueCount||0;
  el.lastCaptureLabel.textContent = s.lastCapture?new Date(s.lastCapture).toLocaleTimeString('zh-CN',{hour12:false}):'-';
  el.nextCaptureLabel.textContent = s.running?(s.nextCaptureIn||0):'-';
  if(s.summarizing){el.summaryStatus.textContent='汇总中';el.tabStatus.style.display='flex';el.tabStatus.textContent='汇总中';}
  else{el.summaryStatus.textContent='';el.tabStatus.style.display='none';}
  el.totalCaptures.textContent=s.totalCaptures||0;
  el.analyzedCount.textContent=s.analyzedCount||0;
  el.errorCount.textContent=s.errors||0;

  const results=s.recentResults||[];
  el.resultsList.innerHTML=results.length===0?'<div class="empty-hint">点击「开始监控」进行记录</div>'
    :results.map(r=>`<div class="result-item"><div class="result-time">${fmtTime(r.timestamp)}</div><div class="result-summary">${esc(r.summary)}</div><div class="result-meta"><span>apps: ${esc((r.detail?.apps||[]).join(', ')||'-')}</span><span>${esc(r.detail?.activity||'')}</span><span>焦点: ${esc(r.detail?.focus||'')}</span></div></div>`).join('');

  el.logList.innerHTML=(s.logLines||[]).length===0?'<div class="log-line muted">等待启动…</div>'
    :s.logLines.slice(0,40).map(l=>`<div class="log-line"><span class="log-time">${esc(l.time)}</span>${esc(l.msg)}</div>`).join('');
}

// ═══ Dynamic tab ═══════════════════════════════════════
let heatmapMap={},allSummaries=[],dynamicLoaded=false;
const CAT_CLASS={'工作':'work','学习':'learn','娱乐':'play','社交':'social'};
function catClass(c){return CAT_CLASS[c]||'none';}

async function loadDynamicTab(){
  if(dynamicLoaded)return;dynamicLoaded=true;
  const now=new Date();
  populateYearSelect(el.hmYear,2026,2030,now.getFullYear());
  populateMonthSelect(el.hmMonth,now.getMonth()+1);
  populateDaySelect(el.hmDay,now.getFullYear(),now.getMonth()+1,now.getDate());
  el.filterYear.innerHTML='<option value="">年</option>';for(let y=2026;y<=2030;y++)el.filterYear.innerHTML+=`<option value="${y}">${y}年</option>`;
  el.filterMonth.innerHTML='<option value="">月</option>';for(let m=1;m<=12;m++)el.filterMonth.innerHTML+=`<option value="${m}">${m}月</option>`;
  el.filterDay.innerHTML='<option value="">日</option>';for(let d=1;d<=31;d++)el.filterDay.innerHTML+=`<option value="${d}">${d}日</option>`;
  try{heatmapMap=await api('/api/heatmap');allSummaries=await api('/api/summaries');renderHeatmap();applyTimelineFilters();}catch(e){console.error(e);}
}

function renderHeatmap(){
  const date=getDateFromSelects(el.hmYear,el.hmMonth,el.hmDay);
  const total=Object.keys(heatmapMap).length;
  el.hmLabel.textContent=`${date||'???'} · ${date?Object.keys(heatmapMap).filter(k=>k.startsWith(date)).length:0}块 · 总计${total}条`;
  if(!date){el.heatmap.innerHTML='<div class="empty-hint">未选择日期</div>';return;}
  const cells=[];
  for(let h=0;h<24;h++)for(let m=0;m<60;m+=10){
    const key=`${date}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
    const block=heatmapMap[key];const cat=block?.category||'none';
    cells.push({label:`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,cat,catClass:catClass(cat),project:block?.project,count:block?.entryCount||0});
  }
  const oldTT=document.querySelector('.heatmap-tooltip');if(oldTT)oldTT.remove();
  el.heatmap.innerHTML=cells.map(c=>`<div class="heatmap-cell ${c.catClass}" data-time="${date} ${c.label}" data-project="${escAttr(c.project||'')}" data-cat="${c.cat==='none'?'无记录':c.cat}" data-count="${c.count}"></div>`).join('');
  const tt=document.createElement('div');tt.className='heatmap-tooltip';tt.style.display='none';document.body.appendChild(tt);
  el.heatmap.querySelectorAll('.heatmap-cell').forEach(cell=>{
    cell.addEventListener('mouseenter',()=>{tt.innerHTML=`<div class="tt-time">${cell.dataset.time}</div>${cell.dataset.project?`<div class="tt-project">${esc(cell.dataset.project)}</div>`:''}<div class="tt-cat">${cell.dataset.cat} · ${cell.dataset.count}条</div>`;tt.style.display='block';});
    cell.addEventListener('mousemove',e=>{tt.style.left=(e.clientX+12)+'px';tt.style.top=(e.clientY-10)+'px';});
    cell.addEventListener('mouseleave',()=>{tt.style.display='none';});
  });
}

function applyTimelineFilters(){
  if(!allSummaries||!allSummaries.length){el.timeline.innerHTML='<div class="empty-hint">暂无数据</div>';el.filterCount.textContent='0 条';return;}
  const proj=el.filterProject.value.toLowerCase().trim();
  const sw=el.filterSoftware.value.toLowerCase().trim();
  const date=getDateFromSelects(el.filterYear,el.filterMonth,el.filterDay);
  const cat=el.filterCategory.value;
  let filtered=allSummaries;
  if(proj)filtered=filtered.filter(s=>s.project&&s.project.toLowerCase().includes(proj));
  if(sw)filtered=filtered.filter(s=>(s.software||[]).some(a=>a.toLowerCase().includes(sw)));
  if(date)filtered=filtered.filter(s=>new Date(s.blockStart).toISOString().split('T')[0]===date);
  if(cat)filtered=filtered.filter(s=>s.category===cat);
  el.filterCount.textContent=`${filtered.length} 条`;
  if(!filtered.length){el.timeline.innerHTML='<div class="empty-hint">没有匹配的记录</div>';return;}
  el.timeline.innerHTML=filtered.map(s=>{
    const start=new Date(s.blockStart),end=new Date(s.blockEnd);
    const timeStr=`${start.toLocaleDateString('zh-CN')} ${start.toLocaleTimeString('zh-CN',{hour12:false})} — ${end.toLocaleTimeString('zh-CN',{hour12:false})}`;
    const tags=(s.software||[]).map(a=>`<span class="tl-tag">${esc(a)}</span>`).join('');
    const descFull=s.description||'',descShort=descFull.slice(0,150),hasMore=descFull.length>150;
    const cc=catClass(s.category);
    return `<div class="tl-item ${cc}"><div class="tl-header"><span class="tl-time">${timeStr}</span><span class="tl-cat ${cc}">${s.category}</span><span style="font-size:10px;color:var(--text-muted)">${s.entryCount}条</span></div><div class="tl-project">${esc(s.project)}</div><div class="tl-desc" data-full="${escAttr(descFull)}">${esc(descShort)}</div>${hasMore?'<button class="tl-expand" data-action="expand">展开全文 ▼</button>':''}<div class="tl-tags">${tags}</div>${s.todos&&s.todos.length?`<div style="margin-top:6px;font-size:11px;color:var(--accent)">📋 ${esc(s.todos.join('、'))}</div>`:''}</div>`;
  }).join('');
  el.timeline.querySelectorAll('[data-action="expand"]').forEach(btn=>{btn.addEventListener('click',function(){const desc=this.previousElementSibling;const exp=desc.classList.toggle('expanded');if(exp){desc.textContent=desc.dataset.full;this.textContent='收起 ▲';}else{desc.textContent=desc.dataset.full.slice(0,150);this.textContent='展开全文 ▼';}});});
}

el.hmYear.addEventListener('change',()=>{syncHmDay();renderHeatmap();});
el.hmMonth.addEventListener('change',()=>{syncHmDay();renderHeatmap();});
el.hmDay.addEventListener('change',()=>renderHeatmap());
function syncHmDay(){const y=parseInt(el.hmYear.value),m=parseInt(el.hmMonth.value),cur=parseInt(el.hmDay.value),max=daysInMonth(y,m);populateDaySelect(el.hmDay,y,m,cur>max?max:cur);}
el.hmPrev.addEventListener('click',()=>shiftHmDate(-1));
el.hmNext.addEventListener('click',()=>shiftHmDate(1));
function shiftHmDate(days){const date=getDateFromSelects(el.hmYear,el.hmMonth,el.hmDay);if(!date)return;const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+days);const y=d.getFullYear(),m=d.getMonth()+1,day=d.getDate();el.hmYear.value=y;el.hmMonth.value=m;populateDaySelect(el.hmDay,y,m,day);el.hmDay.value=day;renderHeatmap();}
el.filterApply.addEventListener('click',applyTimelineFilters);
el.filterClear.addEventListener('click',()=>{el.filterProject.value='';el.filterSoftware.value='';el.filterYear.value='';el.filterMonth.value='';el.filterDay.value='';el.filterCategory.value='';applyTimelineFilters();});

// ═══ Helpers ═══════════════════════════════════════════
function esc(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escAttr(s){if(!s)return'';return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtTime(iso){return new Date(iso).toLocaleString('zh-CN',{hour12:false});}

// ═══ Init ═══════════════════════════════════════════
async function refresh(){
  try{const s=await api('/api/state');updateMonitor(s);}catch(e){console.error(e);}
}
async function init(){
  await refresh();
  setInterval(refresh,3000);
  el.btnStart.addEventListener('click',async()=>{await api('/api/toggle-running',{method:'POST'});});
  el.btnStop.addEventListener('click',async()=>{await api('/api/toggle-running',{method:'POST'});});
  el.btnFolder.style.display='none'; // Web can't open local folders
}
// ═══ DIARY (web) ═════════════════════════════════════
let diaryLoaded=false;
async function initWebDiary(){
  if(diaryLoaded)return;diaryLoaded=true;
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);
  const y=yesterday.getFullYear(),m=yesterday.getMonth()+1,d=yesterday.getDate();
  populateYearSelect($('#diaryYear'),2026,2030,y);populateMonthSelect($('#diaryMonth'),m);populateDaySelect($('#diaryDay'),y,m,d);
  $('#diaryYear').onchange=()=>{syncWebDiaryDay();loadWebDiary()};$('#diaryMonth').onchange=()=>{syncWebDiaryDay();loadWebDiary()};$('#diaryDay').onchange=loadWebDiary;
  $('#diaryPrev').onclick=()=>shiftWebDiary(-1);$('#diaryNext').onclick=()=>shiftWebDiary(1);
  loadWebDiary();
}
function getWebDiaryDate(){return getDateFromSelects($('#diaryYear'),$('#diaryMonth'),$('#diaryDay'))}
function syncWebDiaryDay(){const y=+$('#diaryYear').value,m=+$('#diaryMonth').value,cur=+$('#diaryDay').value,max=daysInMonth(y,m);populateDaySelect($('#diaryDay'),y,m,cur>max?max:cur)}
function shiftWebDiary(days){const dt=getWebDiaryDate();if(!dt)return;const d=new Date(dt+'T12:00:00');d.setDate(d.getDate()+days);$('#diaryYear').value=d.getFullYear();$('#diaryMonth').value=d.getMonth()+1;syncWebDiaryDay();$('#diaryDay').value=d.getDate();loadWebDiary()}
async function loadWebDiary(){
  const date=getWebDiaryDate();if(!date)return;
  try{
    const diary=await api('/api/diary?date='+date);
    if(!diary||diary.error){$('#diaryContent').innerHTML='<div class="diary-card"><div class="diary-date">'+date+'</div><div class="diary-body">暂无日记</div></div>';return}
    $('#diaryContent').innerHTML='<div class="diary-card"><div class="diary-date">'+esc(diary.date)+'</div><div class="diary-body">'+esc(diary.summary||'')+'</div>'+(diary.tips?'<div class="diary-tips">'+esc(diary.tips)+'</div>':'')+'</div>';
    const hls=document.getElementById('hlList'),tds=document.getElementById('todoList'),sgs=document.getElementById('sugList');
    if(hls)hls.innerHTML=(diary.highlights||[]).map((h,i)=>'<div class="hl-item"><span class="hl-num">'+(i+1)+'</span><span>'+esc(h)+'</span></div>').join('');
    if(tds)tds.innerHTML=(diary.todos||[]).map(t=>'<div class="todo-item">'+esc(t)+'</div>').join('');
    if(sgs)sgs.innerHTML=(diary.suggestions||[]).map(s=>'<div class="sug-item">'+esc(s)+'</div>').join('');
  }catch(e){$('#diaryContent').innerHTML='<div class="empty-hint">加载失败</div>'}
}

// ═══ QA (web) ════════════════════════════════════════
$('#qaAsk').onclick=async()=>{
  const q=$('#qaInput').value.trim();if(!q)return;
  $('#qaAsk').disabled=true;$('#qaAsk').textContent='搜索中…';
  $('#qaSteps').style.display='';$('#qaStepsList').innerHTML='<div style="color:var(--text-muted);font-size:12px">正在搜索…</div>';
  try{
    const r=await api('/api/qa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q})});
    $('#qaStepsList').innerHTML=(r.steps||[]).map(s=>'<div class="qa-step-item"><span class="qa-step-round">第'+s.round+'轮</span> '+esc(s.keywords.join(', '))+' → '+s.found+'条</div>').join('');
    $('#qaAnswer').style.display='';$('#qaAnswerText').textContent=r.answer;$('#qaMeta').textContent='共 '+r.resultCount+' 条';
  }catch(e){$('#qaStepsList').innerHTML='<div style="color:var(--red)">失败: '+esc(e.message)+'</div>'}
  $('#qaAsk').disabled=false;$('#qaAsk').textContent='提问';
};
$('#qaInput').onkeydown=e=>{if(e.key==='Enter')$('#qaAsk').click()};

// ═══ Tab extensions (web) ═════════════════════════════
const origSwitchWeb=switchTab;
switchTab=function(name){
  origSwitchWeb(name);
  if(name==='review'){$('#subTabsReview').style.display='flex';activateSubTab('dynamic')}
  else{$('#subTabsReview').style.display='none'}
  if(name==='diary')initWebDiary();
};
$$('.sub-tab').forEach(b=>b.addEventListener('click',function(){switchTab('review');activateSubTab(this.dataset.sub)}));
function activateSubTab(name){
  $$('.sub-tab').forEach(b=>b.classList.toggle('active',b.dataset.sub===name));
  $$('.tab-content').forEach(c=>c.classList.toggle('active',false));
  const map={dynamic:'tab-dynamic',dashboard:'tab-dashboard',diary:'tab-diary'};
  const t=document.getElementById(map[name]);if(t)t.classList.add('active');
  if(name==='diary')initWebDiary();if(name==='dynamic')loadDynamicTab();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
