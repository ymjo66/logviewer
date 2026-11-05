/* Workbench controls are separate from log parsing and diagnosis. */
function bindMapNavigation(canvas) {
  if (!canvas || canvas._navigationBound) return;
  canvas._navigationBound = true;
  canvas.style.touchAction = 'none';
  let drag = null;
  const view = () => appState.mapView ||= createMapView();
  canvas.addEventListener('mousedown',event=>{if(event.button===1)event.preventDefault();});
  canvas.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const v = view();
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX-rect.left)*canvas.width/rect.width-canvas.width/2;
    const y = (event.clientY-rect.top)*canvas.height/rect.height-canvas.height/2;
    const next = Math.max(0.25, Math.min(64,v.scale*Math.exp(-event.deltaY*0.0015)));
    const ratio = next/v.scale;
    v.x = x-(x-v.x)*ratio;
    v.y = y-(y-v.y)*ratio;
    v.scale = next;
    renderGpsMap();
  }, {passive:false});
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return;
    if(event.button===1 && view().mode!=='3d')return;
    event.preventDefault();
    drag = {x:event.clientX,y:event.clientY,button:event.button};
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor=event.button===1?'move':'grabbing';
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const rect = canvas.getBoundingClientRect();
    event.preventDefault();
    if(drag.button===1)orbitMapView(view(),event.clientX-drag.x,event.clientY-drag.y);
    else {
      view().x += (event.clientX-drag.x)*canvas.width/rect.width;
      view().y += (event.clientY-drag.y)*canvas.height/rect.height;
    }
    drag = {...drag,x:event.clientX,y:event.clientY};
    renderGpsMap();
  });
  const stop=()=>{drag=null;canvas.style.cursor='';};
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,stop);
  window.addEventListener('blur',stop);
  canvas.addEventListener('dblclick', () => {
    appState.mapView = createMapView(view().mode);
    renderGpsMap();
  });
}

function setupWorkbench() {
  const workspace = document.getElementById('tabViewWorkspace');
  const grid = workspace.firstElementChild;
  grid.id = 'workbenchGrid';
  grid.children[0].id = 'chartPane';
  grid.children[1].id = 'routePane';
  const nav = document.createElement('nav');
  nav.className = 'workbench-nav';
  nav.setAttribute('aria-label','분석 작업 영역');
  nav.innerHTML = `<div><span class="section-eyebrow">TELEMETRY WORKSPACE</span><strong id="workbenchTitle">차트 분석</strong><span id="workbenchDescription">필드를 비교하고 아래 전체 구간 그래프에서 분석 범위를 조절합니다.</span></div>`;
  workspace.prepend(nav);
  workspace.dataset.focus = 'charts';
  setupAnalysisShell(workspace, nav);
  const controls = document.createElement('details');
  controls.className = 'axis-controls';
  controls.innerHTML = `<summary>축 범위 설정 <span>시간축 공통 · 세로축 개별 · 로그 전환 시 유지</span></summary>
    <form id="axisForm"><fieldset><legend>시간축 — 부팅 후 초</legend><label>시작<input name="xMin" type="number" step="any"></label><label>종료<input name="xMax" type="number" step="any"></label></fieldset>
    ${['main'].map((group,i) => `<fieldset><legend>메인 차트</legend>${['y','y1'].map((axis,j) => `<div><span>${j ? '오른쪽' : '왼쪽'} 축</span><label>최솟값<input name="${group}_${axis}_min" type="number" step="any"></label><label>최댓값<input name="${group}_${axis}_max" type="number" step="any"></label></div>`).join('')}</fieldset>`).join('')}
    <p>빈칸은 자동 범위입니다. 서로 다른 단위의 곡선은 왼쪽·오른쪽 축을 구분해 확인하세요.</p>
    <div><button type="submit">범위 적용</button><button type="button" id="axisReset">전체 자동</button><output id="axisError" role="status"></output></div></form>`;
  document.getElementById('chartPane').prepend(controls);
  const form = controls.querySelector('form');
  try { appState.axisLimits = JSON.parse(localStorage.getItem('xdlv-axis-limits')) || {}; } catch { appState.axisLimits = {}; }
  try { appState.customAxisLimits = JSON.parse(localStorage.getItem('xdlv-custom-axis-limits')) || {}; } catch { appState.customAxisLimits = {}; }
  for (const group of ['main']) for (const axis of ['y','y1']) for (const side of ['min','max']) {
    form.elements[`${group}_${axis}_${side}`].value = appState.axisLimits[group]?.[axis]?.[side] ?? '';
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const read = name => form.elements[name].value === '' ? undefined : Number(form.elements[name].value);
    const valid = (min,max) => (min === undefined || Number.isFinite(min)) && (max === undefined || Number.isFinite(max)) && (min === undefined || max === undefined || min < max);
    const limits = {};
    for (const group of ['main']) {
      limits[group] = {};
      for (const axis of ['y','y1']) {
        const min = read(`${group}_${axis}_min`), max = read(`${group}_${axis}_max`);
        if (!valid(min,max)) { document.getElementById('axisError').textContent = '최솟값은 최댓값보다 작아야 합니다.'; return; }
        limits[group][axis] = {min,max};
      }
    }
    const a = appState.analysis;
    const min = read('xMin') ?? a?.minSec, max = read('xMax') ?? a?.maxSec;
    if (!a || !valid(min,max) || max <= a.minSec || min >= a.maxSec) {
      document.getElementById('axisError').textContent = '로그를 열고 기록 범위 안의 시작·종료 시간을 입력하세요.'; return;
    }
    const customLimits = {...appState.customAxisLimits};
    for (const row of form.querySelectorAll('[data-custom-axis-field]')) {
      const inputs = row.querySelectorAll('input');
      const lo = inputs[0].value === '' ? undefined : Number(inputs[0].value);
      const hi = inputs[1].value === '' ? undefined : Number(inputs[1].value);
      if (!valid(lo,hi)) {document.getElementById('axisError').textContent=row.dataset.customAxisField+'의 최솟값은 최댓값보다 작아야 합니다.';return;}
      customLimits[row.dataset.customAxisField] = {min:lo,max:hi};
    }
    appState.axisLimits = limits;
    appState.customAxisLimits = customLimits;
    try { localStorage.setItem('xdlv-custom-axis-limits', JSON.stringify(customLimits)); } catch {}
    try { localStorage.setItem('xdlv-axis-limits', JSON.stringify(limits)); } catch {}
    document.getElementById('axisError').textContent = '적용됨';
    applyZoomRange(Math.max(a.minSec,min), Math.min(a.maxSec,max));
  });
  document.getElementById('axisReset').addEventListener('click', () => {
    form.reset(); appState.axisLimits = {}; appState.customAxisLimits = {}; appState.zoomWindow = null;
    document.getElementById('customAxisControls')?.remove();
    try { localStorage.removeItem('xdlv-custom-axis-limits'); } catch {}
    try { localStorage.removeItem('xdlv-axis-limits'); } catch {}
    document.getElementById('axisError').textContent = '자동 범위';
    if (appState.analysis) renderTelemetryCharts();
  });
  document.getElementById('plotDisplayControls').append(document.getElementById('chartShortcuts'));
  document.getElementById('plotDisplayControls').append(document.querySelector('.quick-zoom'));
}

function renderCustomAxisControls(fields) {
  const form=document.getElementById('axisForm');
  if(!form) return;
  form.querySelector('fieldset:nth-of-type(2)').hidden=fields.length>0;
  let panel=document.getElementById('customAxisControls');
  if(!fields.length) {panel?.remove();return;}
  const signature=JSON.stringify(fields);
  if(panel?.dataset.fields===signature) return;
  panel?.remove();panel=document.createElement('fieldset');
  panel.id='customAxisControls';panel.dataset.fields=signature;panel.style.gridColumn='1 / -1';
  const legend=document.createElement('legend');legend.textContent='사용자 지정 필드별 세로축';panel.append(legend);
  for(const field of fields) {
    const row=document.createElement('div');row.dataset.customAxisField=field;
    const name=document.createElement('strong');name.textContent=field;row.append(name);
    for(const [side,text] of [['min','최솟값'],['max','최댓값']]) {
      const label=document.createElement('label');label.append(document.createTextNode(field+' '+text));
      const input=document.createElement('input');input.type='number';input.step='any';
      input.value=appState.customAxisLimits?.[field]?.[side]??'';label.append(input);row.append(label);
    }
    panel.append(row);
  }
  form.querySelector('p').before(panel);
}

function setupAnalysisShell(workspace, heading) {
  const loaded = document.getElementById('loadedWorkspaceContainer');
  const manager = loaded.children[0];
  const status = loaded.children[1];
  const summary = loaded.children[2];
  const oldNavigation = loaded.children[3];
  const logCard = manager.children[0];
  const logbook = manager.children[1];
  const overview = document.createElement('section');
  overview.id = 'tabViewOverview';
  overview.className = 'hidden overview-page';
  overview.innerHTML = '<div class="page-heading"><span class="section-eyebrow">FLIGHT OVERVIEW</span><h2>비행 요약</h2><p>이착륙 기록, 기체 상태와 비행일지를 확인합니다.</p></div>';
  overview.append(summary, logbook);
  const sidebar = document.createElement('aside');
  sidebar.id = 'analysisSidebar';
  sidebar.innerHTML = '<div class="sidebar-brand"><span class="brand-mark">X</span><div><small>FLIGHT LOG STUDIO</small></div></div><div class="sidebar-label">분석 도구</div><nav id="analysisNavigation" aria-label="주 분석 메뉴"></nav><div class="sidebar-label log-list-label">불러온 로그</div>';
  const menu = sidebar.querySelector('nav');
  const names = {workspace:['01','차트 분석'],diagnostics:['03','센서 진단'],events:['04','이벤트 기록'],params:['05','파라미터']};
  const buttons = Array.from(oldNavigation.querySelectorAll('.main-tab-btn'));
  for (const key of ['overview']) {
    const b = document.createElement('button');
    b.type = 'button'; b.dataset.mainTab = key; b.className = 'main-tab-btn';
    names[key] = key === 'overview' ? ['02','비행 요약'] : ['03','경로 · 재생'];
    buttons.push(b);
  }
  buttons.sort((a,b) => Number(names[a.dataset.mainTab][0])-Number(names[b.dataset.mainTab][0]));
  for (const button of buttons) {
    const [number,name] = names[button.dataset.mainTab];
    const badge = button.querySelector('#diagAlertCountBadge');
    button.replaceChildren();
    const count = document.createElement('span'); count.className='menu-number'; count.textContent=number;
    const label = document.createElement('span'); label.textContent=name;
    button.append(count,label);
    if (badge) button.append(badge);
    button.setAttribute('aria-current',button.dataset.mainTab === 'workspace' ? 'page' : 'false');
    menu.append(button);
  }
  const quickZoom = oldNavigation.lastElementChild;
  quickZoom.classList.add('quick-zoom');
  heading.append(quickZoom);
  oldNavigation.remove();
  logCard.id = 'sidebarLogCard';
  sidebar.append(logCard);
  const logLabel=sidebar.querySelector('.log-list-label');
  const toolLabel=sidebar.querySelector('.sidebar-label:not(.log-list-label)');
  sidebar.insertBefore(logLabel,toolLabel);
  sidebar.insertBefore(logCard,toolLabel);
  const sidebarLogo=document.querySelector('header img').cloneNode(true);
  sidebarLogo.className='sidebar-logo';
  sidebar.querySelector('.brand-mark').replaceWith(sidebarLogo);
  logCard.append(document.getElementById('btnClearAllLogs'));
  document.querySelector('#btnOpenSettings span').textContent='기준 설정';
  manager.remove();
  const main = document.createElement('div');
  main.id='analysisMain';
  status.id='activeLogBar';
  main.append(status,overview);
  for (const element of Array.from(loaded.children)) main.append(element);
  const routePanel=workspace.querySelector('#routePane');
  routePanel.setAttribute('aria-label','항상 표시되는 비행경로와 재생');
  const topTools=document.createElement('div'); topTools.id='topAnalysisTools';topTools.className='hidden';
  topTools.setAttribute('aria-label','분석 도구'); topTools.append(menu);
  toolLabel.remove();
  const headerRow=document.querySelector('header>div');
  headerRow.classList.add('app-header-row');
  headerRow.firstElementChild.classList.add('app-brand');
  headerRow.lastElementChild.classList.add('header-actions');
  headerRow.insertBefore(topTools,headerRow.lastElementChild);
  // Sticky panels must follow the actual header height, including font/DPI changes.
  const syncHeaderHeight=()=>document.documentElement.style.setProperty('--app-header-height',`${Math.ceil(headerRow.parentElement.getBoundingClientRect().height)}px`);
  new ResizeObserver(syncHeaderHeight).observe(headerRow.parentElement);
  syncHeaderHeight();
  loaded.append(sidebar,main,routePanel);
  loaded.classList.add('analysis-shell');
  // Task shortcuts belong with the charts, leaving the app header for files/settings.
  const shortcuts = document.getElementById('scenarioBarLabel').parentElement;
  shortcuts.id='chartShortcuts';
  document.getElementById('chartPane').prepend(shortcuts);
  document.getElementById('btnClearAllLogs').classList.add('quiet-action');
  const chartCanvas=document.getElementById('mainTelemetryChart');
  chartCanvas.parentElement.classList.add('primary-chart-frame');
  const plotCard=chartCanvas.parentElement.parentElement;
  const mainHeading=chartCanvas.parentElement.previousElementSibling;
  mainHeading.classList.add('main-chart-heading');
  const mainFrame=chartCanvas.parentElement;
  const displayControls=document.createElement('details');
  displayControls.id='plotDisplayControls';
  displayControls.className='plot-display-controls';
  displayControls.innerHTML='<summary>이벤트 · 구간 설정</summary>';
  for(const element of Array.from(plotCard.children)) {
    if (![mainHeading,mainFrame].includes(element)) displayControls.append(element);
  }
  const overviewFrame=document.createElement('div');overviewFrame.className='timeline-overview-frame';
  overviewFrame.innerHTML='<canvas id="timelineOverviewChart" aria-label="전체 시간 구간 탐색 그래프"></canvas>';
  const overviewCaption=document.createElement('div');overviewCaption.className='overview-caption';overviewCaption.innerHTML='Time since boot <span id="overviewRangeLabel"></span>';
  const plotLegend=document.createElement('div');plotLegend.id='plotLegend';
  plotCard.id='uavPlotCard';
  plotCard.replaceChildren(mainHeading,plotLegend,mainFrame,overviewFrame,overviewCaption,displayControls);
  const presets=document.getElementById('presetButtonsContainer');
  const oldPresetHeader=presets.parentElement.parentElement;
  const presetBar=document.createElement('div');presetBar.className='preset-toolbar';
  presetBar.setAttribute('aria-label','차트 분석 항목');presetBar.append(presets);
  plotCard.before(presetBar);
  const zoomToolbar=document.getElementById('btnChartZoomIn').parentElement.parentElement;
  // Existing listeners are registered in the same DOMContentLoaded handler.
  // Remove the obsolete controls after that registration has finished.
  queueMicrotask(()=>{oldPresetHeader.remove();zoomToolbar.remove();});
  const horizon=document.getElementById('hudHorizonCanvas').parentElement;
  horizon.classList.add('hud-stage');horizon.parentElement.classList.add('hud-stack');
  horizon.nextElementSibling.classList.add('hud-readouts');
  const replay=document.getElementById('timelineScrubber').parentElement;
  replay.classList.add('replay-panel');replay.firstElementChild.classList.add('replay-toolbar');
  replay.lastElementChild.classList.add('replay-labels');
  const fields=document.getElementById('customFieldExplorer').parentElement;
  const explorer=document.createElement('section');
  explorer.id='sidebarFieldExplorer';
  explorer.className='field-explorer-panel';
  explorer.innerHTML='<h3>필드 탐색기</h3>';
  sidebar.append(explorer); explorer.append(fields);
  const search=fields.querySelector('#fieldSearchInput');
  const clearSearch=document.createElement('button');clearSearch.type='button';clearSearch.id='btnClearFieldSearch';clearSearch.textContent='전체 필드 보기';
  clearSearch.className='text-xs px-2 py-1 rounded border border-slate-700';
  search.parentElement.append(clearSearch);
  clearSearch.addEventListener('click',()=>{search.value='';renderCustomFieldExplorer();});
  const count=document.createElement('p');count.id='fieldCatalogCount';count.className='text-xs text-slate-400 my-2';
  fields.querySelector('#customFieldExplorer').before(count);
  setupCsvExport(logCard);
  setupLogComparison();
}
