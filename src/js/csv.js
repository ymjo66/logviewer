const CSV_COLUMNS = {
  summary: [
    ['file','파일명', (log)=>log.fileName],
    ['detection','비행 감지', (log)=>log.analysis.groundOnly?'비행 미감지':'비행 감지'],
    ['sortie','소티 번호',(_,s)=>s?.index??''],
    ['takeoff','이륙 시각 (KST)',(_,s)=>s?.takeoffKst??''],
    ['landing','착륙 시각 (KST)',(_,s)=>s?.landingKst??''],
    ['duration','비행 시간 (초)',(_,s)=>s?.durationSec??0],
    ['alt','최대 상대고도 (m)',(log,s)=>s?.maxRelAlt??log.analysis.maxRelAlt],
  ],
  telemetry: [
    ['file','파일명',log=>log.fileName], ['sec','부팅 후 시간 (초)',(_,p)=>p.sec],
    ['kst','시각 (KST)',(_,p)=>p.kstStr], ['mode','비행 모드',(_,p)=>p.modeName],
    ...[['autoRelAlt','상대고도 (m)'],['gpsAmsl','해발고도 (m)'],['bAlt','기압 상대고도 (m)'],
      ['thO','스로틀 (%)'],['roll','Roll (deg)'],['pitch','Pitch (deg)'],['yaw','Yaw (deg)'],
      ['vibeX','진동 X'],['vibeY','진동 Y'],['vibeZ','진동 Z'],['volt','배터리 전압 (V)'],
      ['curr','전류 (A)'],['cellVolt','평균 셀 전압 (V)'],['c1','모터 C1 (PWM)'],['c2','모터 C2 (PWM)'],
      ['c3','모터 C3 (PWM)'],['c4','모터 C4 (PWM)'],['nSats','GPS 위성 수'],['hdop','HDOP'],
      ['lat','위도'],['lng','경도'],['spd','속도 (m/s)']].map(([key,label])=>[key,label,(log,p)=>key==='cellVolt'&&!log.analysis.detectedCells?null:p[key]])
  ]
};

function csvCell(value) {
  if (value===undefined || value===null || (typeof value==='number'&&!Number.isFinite(value))) return '';
  let text=String(value);
  if (typeof value==='string' && /^[=+\-@\t\r]/.test(text)) text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
}

function buildSelectedCsv(logs,mode,keys,range=null) {
  const columns=CSV_COLUMNS[mode].filter(c=>keys.includes(c[0]));
  if (!columns.length) throw Error('저장할 데이터 항목을 하나 이상 선택하세요.');
  const lines=[columns.map(c=>csvCell(c[1])).join(',')];
  for(const log of logs) {
    const rows=mode==='summary'?(log.analysis.sorties.length?log.analysis.sorties:[null]):log.analysis.timeline;
    for(const row of rows) {
      if(mode==='telemetry'&&range&&(row.sec<range.minSec||row.sec>range.maxSec)) continue;
      lines.push(columns.map(c=>csvCell(c[2](log,row))).join(','));
    }
  }
  return '\uFEFF'+lines.join('\r\n');
}

function setupCsvExport(logCard) {
  const button=document.createElement('button');
  button.type='button';button.id='btnExportSelectedCsv';button.className='csv-open-button';
  button.textContent='CSV 저장 · 항목 선택';button.addEventListener('click',openCsvExport);
  logCard.insertBefore(button,document.getElementById('btnClearAllLogs'));
  const dialog=document.createElement('dialog');dialog.id='csvExportDialog';
  dialog.innerHTML=`<form method="dialog" class="csv-export-form"><div class="csv-dialog-heading"><div><span class="section-eyebrow">EXPORT DATA</span><h2>CSV 저장</h2></div><button value="cancel" aria-label="CSV 창 닫기">×</button></div>
    <p>저장할 로그와 데이터 항목을 선택하세요. 요약은 소티별, 텔레메트리는 뷰어 분석용 타임라인의 시간별 데이터로 저장합니다.</p>
    <fieldset><legend>저장할 로그</legend><div class="csv-bulk"><button type="button" data-logs="all">전체 로그</button><button type="button" data-logs="active">현재 로그만</button></div><div id="csvLogChoices"></div></fieldset>
    <fieldset><legend>데이터 종류</legend><label><input type="radio" name="csvMode" value="summary" checked> 비행 요약</label><label><input type="radio" name="csvMode" value="telemetry"> 텔레메트리</label><label id="csvRangeLabel" hidden><input id="csvCurrentRange" type="checkbox"> 현재 차트 시간 범위만 (선택한 모든 로그에 부팅 후 초 기준 적용)</label></fieldset>
    <fieldset><legend>저장할 데이터 항목</legend><div class="csv-bulk"><button type="button" data-columns="all">전체 선택</button><button type="button" data-columns="none">선택 해제</button></div><div id="csvColumnChoices"></div></fieldset>
    <output id="csvExportStatus" role="status"></output><div class="csv-dialog-actions"><button value="cancel">취소</button><button type="button" id="csvSave">선택한 항목으로 저장</button></div></form>`;
  document.body.append(dialog);
  const selected={summary:new Set(CSV_COLUMNS.summary.map(c=>c[0])),telemetry:new Set(['file','sec','kst','autoRelAlt','volt','curr'])};
  const mode=()=>dialog.querySelector('[name=csvMode]:checked').value;
  function columns() {
    const target=document.getElementById('csvColumnChoices');target.replaceChildren();
    for(const [key,label] of CSV_COLUMNS[mode()]) {
      const item=document.createElement('label'),input=document.createElement('input');
      input.type='checkbox';input.value=key;input.checked=selected[mode()].has(key);
      input.addEventListener('change',()=>input.checked?selected[mode()].add(key):selected[mode()].delete(key));
      item.append(input,document.createTextNode(label));target.append(item);
    }
    document.getElementById('csvRangeLabel').hidden=mode()!=='telemetry';
  }
  dialog.querySelectorAll('[name=csvMode]').forEach(r=>r.addEventListener('change',columns));
  dialog.querySelectorAll('[data-columns]').forEach(b=>b.addEventListener('click',()=>{
    selected[mode()]=new Set(b.dataset.columns==='all'?CSV_COLUMNS[mode()].map(c=>c[0]):[]);columns();
  }));
  dialog.querySelectorAll('[data-logs]').forEach(b=>b.addEventListener('click',()=>{
    dialog.querySelectorAll('#csvLogChoices input').forEach(input=>input.checked=b.dataset.logs==='all'||Number(input.value)===appState.activeLogIndex);
  }));
  document.getElementById('csvSave').addEventListener('click',async()=>{
    const logs=Array.from(dialog.querySelectorAll('#csvLogChoices input:checked')).map(input=>appState.logs[Number(input.value)]);
    const status=document.getElementById('csvExportStatus');
    if(!logs.length) {status.textContent='저장할 로그를 선택하세요.';return;}
    try {
      const range=mode()==='telemetry'&&document.getElementById('csvCurrentRange').checked?appState.zoomWindow:null;
      if(logs.some(log=>log.parsedLog?.nativeId)){
        const save=document.getElementById('csvSave');save.disabled=true;
        try{await queueLogTask(()=>streamNativeCsv(logs,mode(),Array.from(selected[mode()]),range,status));}finally{save.disabled=false;}
        return;
      }
      const text=buildSelectedCsv(logs,mode(),Array.from(selected[mode()]),range);
      const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8;'}));
      const link=document.createElement('a');link.href=url;
      link.download=logs.length===1?logs[0].fileName.replace(/\.[^.]+$/,'')+'_'+mode()+'.csv':'logviewer_'+mode()+'.csv';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      status.textContent=`${logs.length}개 로그의 CSV 저장을 시작했습니다.`;
    } catch(error) {status.textContent=error.message;}
  });
  dialog._refreshColumns=columns;
}

function openCsvExport(requestedMode) {
  if(!appState.logs.length) {showToast('먼저 로그를 열어주세요.');return;}
  const dialog=document.getElementById('csvExportDialog'),choices=document.getElementById('csvLogChoices');
  if(requestedMode==='summary'||requestedMode==='telemetry') dialog.querySelector(`[name=csvMode][value=${requestedMode}]`).checked=true;
  choices.replaceChildren();
  appState.logs.forEach((log,index)=>{
    const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=index;input.checked=index===appState.activeLogIndex;
    label.append(input,document.createTextNode(log.fileName));choices.append(label);
  });
  document.getElementById('csvExportStatus').textContent='';dialog._refreshColumns();dialog.showModal();
}
