// SPDX-License-Identifier: GPL-3.0-only
const COMPARISON_METRICS=[
  ['autoRelAlt','상대고도 (m)',['CTUN','POS','BARO','AHR2','GPS']],
  ['spd','속도 (m/s)',['GPS']],['volt','배터리 전압 (V)',['BAT']],['curr','전류 (A)',['BAT']],
  ['vibeX','진동 X (m/s²)',['VIBE']],['vibeY','진동 Y (m/s²)',['VIBE']],['vibeZ','진동 Z (m/s²)',['VIBE']],
  ['roll','Roll (°)',['ATT','XKF1']],['pitch','Pitch (°)',['ATT','XKF1']],['yaw','Yaw (°)',['ATT','XKF1']],
  ['thO','스로틀 (%)',['CTUN','RCOU']],['c1','모터 C1 (µs)',['RCOU']],['c2','모터 C2 (µs)',['RCOU']],
  ['c3','모터 C3 (µs)',['RCOU']],['c4','모터 C4 (µs)',['RCOU']],['magPct','자기장 변동률 (%)',['MAG']],
  ['nSats','GPS 위성 수',['GPS']],['hdop','HDOP',['GPS']]
];
let comparisonChart=null,comparisonChosen=new Set(),comparisonKnown=new Set(),comparisonVersions=new Map();
const comparisonFields=new Map();let comparisonFieldSignature='';const comparisonFieldChosen=new Set();
function rawComparisonKey(message,field){return 'raw:'+JSON.stringify([message,field]);}
function rawComparisonCurves(log,key,offset){
  const [message,field]=JSON.parse(key.slice(4)),match=/^(.*)\[([^\]]+)\]$/.exec(message),name=match?match[1]:message;
  const parsed=log.parsedLog,rows=parsed.tables[name];if(!rows?.length)return [];
  const instanceKey=messageInstanceField(parsed,name);
  if(parsed.nativeId&&!parsed.nativeMetadata.isText){
    return JSON.parse(nativeCall('QueryField',parsed.nativeId,JSON.stringify({message:name,field,instanceKey,instance:match?.[2]??null,min:nativeDouble(log.analysis.minSec),max:nativeDouble(log.analysis.maxSec)})),nativeDecode).filter(curve=>curve.count>0).map(curve=>({data:curve.data.map(point=>({x:point.x-offset,y:point.y})),statistics:curve.statistics}));
  }
  const selected=match?rows.filter(row=>instanceKey&&String(row[instanceKey])===match[2]):rows;
  const points=mapPlotRows(selected,row=>({sec:row.TimeUS/1e6,value:readPlotField(row,field)}));
  return [{data:comparisonPoints(points,'value',offset).sort((a,b)=>a.x-b.x)}];
}
function refreshComparisonFields(force=false){
  const container=document.getElementById('comparisonRawFields');if(!container)return;
  const signature=appState.logs.map(log=>log.parsedLog.nativeId||log.fileName+':'+log.parsedLog.totalPackets).join('|');
  if(force||signature!==comparisonFieldSignature){comparisonFields.clear();for(const log of appState.logs)for(const entry of buildFieldCatalog(log.parsedLog))for(const field of entry.fields){const key=rawComparisonKey(entry.name,field.name),old=comparisonFields.get(key);comparisonFields.set(key,{message:entry.name,field:field.name,unit:field.unit||old?.unit||'',numeric:field.numeric||old?.numeric});}comparisonFieldSignature=signature;for(const key of comparisonFieldChosen)if(!comparisonFields.has(key))comparisonFieldChosen.delete(key);}
  const query=(document.getElementById('comparisonFieldSearch').value||'').trim().toLowerCase();container.replaceChildren();
  const groups=new Map();for(const [key,field] of comparisonFields){if(query&&!`${field.message}.${field.field}`.toLowerCase().includes(query))continue;if(!groups.has(field.message))groups.set(field.message,[]);groups.get(field.message).push([key,field]);}
  for(const [message,fields] of groups){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent=`${message} · ${fields.length}개`;details.append(summary);
    const populate=()=>{if(details.childElementCount>1)return;for(const [key,field] of fields){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=comparisonFieldChosen.has(key);input.disabled=!field.numeric;input.addEventListener('change',()=>{if(input.checked)comparisonFieldChosen.add(key);else comparisonFieldChosen.delete(key);document.getElementById('comparisonFieldCount').textContent=`전체 ${comparisonFields.size}개 필드 · 선택 ${comparisonFieldChosen.size}개`;clearLogComparison();});label.append(input,document.createTextNode(field.field+(field.unit?' ('+field.unit+')':'')+(!field.numeric?' · 수치 차트 불가':'')));details.append(label);}};
    details.addEventListener('toggle',()=>{if(details.open)populate();});if(query){populate();details.open=true;}container.append(details);
  }
  document.getElementById('comparisonFieldCount').textContent=`전체 ${comparisonFields.size}개 필드 · 선택 ${comparisonFieldChosen.size}개`;
}
const COMPARISON_SOURCE_FIELDS={autoRelAlt:['Alt','RelHomeAlt','RelOriginAlt'],spd:['Spd'],volt:['Volt'],curr:['Curr'],vibeX:['VibeX'],vibeY:['VibeY'],vibeZ:['VibeZ'],roll:['Roll'],pitch:['Pitch'],yaw:['Yaw'],thO:['ThO','C1'],c1:['C1'],c2:['C2'],c3:['C3'],c4:['C4'],magPct:['MagX','MagY','MagZ'],nSats:['NSats'],hdop:['HDop']};
function comparisonColor(index){return `hsl(${(index*137.508)%360} 65% 40%)`;}
function comparisonPoints(rows,key,offset,limit=1800){
  const result=[],stride=Math.max(1,Math.ceil(rows.length/Math.max(1,Math.floor(limit/4))));
  for(let start=0;start<rows.length;start+=stride){
    let first,last,low,high,gap;
    for(let i=start;i<Math.min(rows.length,start+stride);i++){
      const row=rows[i],x=row.sec-offset,y=row[key];
      if(!Number.isFinite(x))continue;
      if(!Number.isFinite(y)){gap={x,y:null,index:i};continue;}
      const point={x,y,index:i};first??=point;last=point;
      if(!low||y<low.y)low=point;if(!high||y>high.y)high=point;
    }
    const points=[first,low,high,last,gap].filter(Boolean).sort((a,b)=>a.index-b.index);
    let previous=-1;for(const point of points)if(point.index!==previous){result.push({x:point.x,y:point.y});previous=point.index;}
  }
  return result;
}
function buildLogComparison(logs,keys,alignment){
  keys=[...new Set(Array.isArray(keys)?keys:[keys])];
  if(!keys.length)throw Error('비교 항목을 하나 이상 선택하세요.');
  const datasets=[],skipped=[],axes={};
  for(const [metricIndex,key] of keys.entries()){
  const raw=key.startsWith('raw:'),descriptor=raw?JSON.parse(key.slice(4)):null;
  const metric=raw?[key,descriptor.join('.')]:COMPARISON_METRICS.find(m=>m[0]===key);if(!metric)throw Error('지원하지 않는 비교 항목입니다.');
  const axisID=raw?'compare_raw_'+metricIndex:'compare_'+key;
  for(const log of logs){
    if(!raw&&!metric[2].some(name=>log.parsedLog.tables[name]?.length&&log.parsedLog.fmtList.some(schema=>schema.name===name&&schema.columns.some(column=>COMPARISON_SOURCE_FIELDS[key].includes(column))))){skipped.push(`${log.fileName} · ${metric[1]}: 해당 필드 기록 없음`);continue;}
    const offset=alignment==='takeoff'?log.analysis.sorties?.[0]?.takeoffSec:log.analysis.minSec;
    if(!Number.isFinite(offset)){skipped.push(`${log.fileName}: 첫 이륙 미감지`);continue;}
    if(raw){const [message,field]=descriptor,entry=buildFieldCatalog(log.parsedLog).find(item=>item.name===message);if(!entry?.fields.some(item=>item.name===field&&item.numeric)){skipped.push(`${log.fileName} · ${metric[1]}: 수치 필드 기록 없음`);continue;}}
    const data=raw?rawComparisonCurves(log,key,offset).flatMap(curve=>curve.data):comparisonPoints(log.analysis.timeline,key,offset);
    if(!data.some(point=>point.y!==null)){skipped.push(`${log.fileName}: 유효한 값 없음`);continue;}
    axes[axisID]??={type:'linear',position:metricIndex%2?'right':'left',title:{display:true,text:metric[1]},ticks:{color:'#444'},grid:{color:'#e5e5e5',drawOnChartArea:Object.keys(axes).length===0}};
    datasets.push({label:`${metric[1]} · ${log.fileName}`,logIndex:appState.logs.indexOf(log),metricKey:key,yAxisID:axisID,data,borderColor:comparisonColor(appState.logs.indexOf(log)),borderDash:[[],[7,3],[2,3],[9,3,2,3],[4,2]][metricIndex%5],borderWidth:1.2,pointRadius:0,pointHitRadius:5,fill:false,tension:0,spanGaps:false});
  }
  }
  return {datasets,skipped,axes,title:keys.length===1?(keys[0].startsWith('raw:')?JSON.parse(keys[0].slice(4)).join('.'):COMPARISON_METRICS.find(m=>m[0]===keys[0])[1]):'다중 항목 비교'};
}
function setupLogComparison(){
  const notice=document.createElement('aside');notice.id='capacityNotice';notice.className='capacity-notice';
  notice.innerHTML='<strong>대용량 로그 사용 안내</strong><p>현재 버전은 브라우저/WebView2 메모리 한계로 대용량·다중 로그 불러오기가 실패할 수 있습니다. 안정적인 최대 용량·파일 개수는 보장하지 않습니다. 실패하면 기존 Log Viewer 창을 모두 닫고 필요한 로그만 선택해 주세요.</p><output id="capacityTotals"></output>';
  document.querySelector('header').after(notice);
  const panel=document.createElement('section');panel.id='logComparisonPanel';panel.className='glass-card rounded-xl log-comparison';
  panel.innerHTML='<h3>다중 로그 비교</h3><p>선택한 로그의 같은 항목을 공통 세로축으로 비교합니다. 분석 타임라인 기준이며 메인 차트의 범위와 독립적으로 동작합니다.</p><div class="comparison-controls"><label>비교 항목 <select id="comparisonMetric"></select></label><label>시간 기준 <select id="comparisonAlignment"><option value="start">각 로그 시작 = 0초</option><option value="takeoff">첫 이륙 = 0초</option></select></label><button type="button" id="comparisonSelectAll">전체 선택</button><button type="button" id="comparisonSelectNone">선택 해제</button><button type="button" id="comparisonDraw">비교하기</button><button type="button" id="comparisonReset">전체 범위</button></div><div id="comparisonLogChoices" class="comparison-log-choices"></div><output id="comparisonStatus" role="status">비교할 로그를 선택하세요.</output><div class="comparison-frame"><canvas id="logComparisonChart" aria-label="다중 로그 비교 그래프"></canvas></div><p>휠: 확대·축소 · 오른쪽 드래그: 시간축 이동 · 더블클릭: 전체 범위</p>';
  document.getElementById('chartPane').append(panel);
  const oldMetric=panel.querySelector('#comparisonMetric'),metricChoices=document.createElement('fieldset');metricChoices.id='comparisonMetricChoices';
  const legend=document.createElement('legend');legend.textContent='비교 항목 (여러 개 선택 가능)';metricChoices.append(legend);oldMetric.parentElement.remove();panel.querySelector('.comparison-controls').before(metricChoices);
  for(const [key,label] of COMPARISON_METRICS){const item=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=key;input.checked=key==='autoRelAlt';input.addEventListener('change',clearLogComparison);item.append(input,document.createTextNode(label));metricChoices.append(item);}
  const fieldPicker=document.createElement('details');fieldPicker.className='comparison-field-picker';fieldPicker.innerHTML='<summary>전체 원본 필드 선택</summary><input id="comparisonFieldSearch" type="search" placeholder="전체 필드 검색 (예: GPS[0].Alt, RCOU.C6)" aria-label="비교할 전체 필드 검색"><button type="button" id="comparisonClearFields">원본 필드 선택 초기화</button><output id="comparisonFieldCount"></output><div id="comparisonRawFields"></div>';metricChoices.after(fieldPicker);
  fieldPicker.querySelector('input').addEventListener('input',()=>refreshComparisonFields());fieldPicker.querySelector('button').addEventListener('click',()=>{comparisonFieldChosen.clear();refreshComparisonFields();clearLogComparison();});
  panel.querySelector('p').textContent='기본 분석 항목 또는 전체 원본 필드를 여러 개 선택해 비교합니다. 같은 계열 필드는 공통 범위를 사용하며 곡선과 세로축 색상이 일치합니다. 센서 인스턴스·배열 원소도 선택할 수 있습니다.';
  const surface=document.createElement('div');surface.className='comparison-chart-surface';panel.querySelector('.comparison-frame').append(surface);surface.append(panel.querySelector('canvas'));
  panel.querySelector('#comparisonSelectAll').addEventListener('click',()=>{comparisonChosen=new Set(appState.logs);refreshLogComparison(false);clearLogComparison();});
  panel.querySelector('#comparisonSelectNone').addEventListener('click',()=>{comparisonChosen.clear();refreshLogComparison(false);clearLogComparison();});
  panel.querySelector('#comparisonDraw').addEventListener('click',drawLogComparison);
  panel.querySelector('#comparisonReset').addEventListener('click',resetComparisonRange);
  panel.querySelector('#comparisonAlignment').addEventListener('change',clearLogComparison);
  const canvas=panel.querySelector('canvas');let drag=null;
  canvas.addEventListener('contextmenu',e=>e.preventDefault());
  canvas.addEventListener('wheel',e=>{
    if(!comparisonChart)return;e.preventDefault();const scale=comparisonChart.scales.x,rect=canvas.getBoundingClientRect();
    const center=scale.getValueForPixel(e.clientX-rect.left),factor=e.deltaY<0?.8:1.25;
    comparisonChart.options.scales.x.min=center-(center-scale.min)*factor;comparisonChart.options.scales.x.max=center+(scale.max-center)*factor;comparisonChart.update('none');
  },{passive:false});
  canvas.addEventListener('pointerdown',e=>{if(e.button!==2||!comparisonChart)return;e.preventDefault();drag={id:e.pointerId,x:e.clientX,min:comparisonChart.scales.x.min,max:comparisonChart.scales.x.max};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId||!comparisonChart)return;const shift=(e.clientX-drag.x)*(drag.max-drag.min)/comparisonChart.chartArea.width;comparisonChart.options.scales.x.min=drag.min-shift;comparisonChart.options.scales.x.max=drag.max-shift;comparisonChart.update('none');});
  const end=e=>{if(drag?.id===e.pointerId){drag=null;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);}};
  canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',()=>drag=null);canvas.addEventListener('dblclick',resetComparisonRange);
}
function clearLogComparison(){comparisonChart?.destroy();comparisonChart=null;const status=document.getElementById('comparisonStatus');if(status)status.textContent='비교할 항목과 로그를 선택하고 비교하기를 눌러 주세요.';}
function synchronizeComparisonAxes(result){
  const axes={},groups=new Map();
  for(const [index,dataset] of result.datasets.entries()){
    const previous=result.axes[dataset.yAxisID],key=dataset.metricKey;
    const family=key.startsWith('raw:')?fieldRangeGroup(JSON.parse(key.slice(4)).join('.')):/^c\d+$/.test(key)?fieldRangeGroup('RCOU.C1'):key;
    const axisId='comparison_curve_'+index,color=dataset.borderColor;
    axes[axisId]={...previous,title:{...previous.title,color},ticks:{...previous.ticks,color},border:{color},grid:{...previous.grid,drawOnChartArea:index===0}};
    dataset.yAxisID=axisId;
    if(!groups.has(family))groups.set(family,{min:Infinity,max:-Infinity,axes:[]});const group=groups.get(family);group.axes.push(axisId);
    for(const point of dataset.data)if(Number.isFinite(point.y)){group.min=Math.min(group.min,point.y);group.max=Math.max(group.max,point.y);}
  }
  for(const group of groups.values()){const bounds=commonPlotBounds(group.min,group.max);if(bounds)for(const axis of group.axes)Object.assign(axes[axis],bounds);}
  result.axes=axes;
}
function refreshLogComparison(invalidate=true){
  const choices=document.getElementById('comparisonLogChoices');if(!choices)return;
  const changed=appState.logs.length!==comparisonKnown.size||appState.logs.some(log=>!comparisonKnown.has(log)||comparisonVersions.get(log)!==log.analysis);
  const current=new Set(appState.logs);comparisonChosen=new Set([...comparisonChosen].filter(log=>current.has(log)));
  for(const log of appState.logs)if(!comparisonKnown.has(log)&&comparisonChosen.size<2)comparisonChosen.add(log);
  comparisonKnown=current;
  comparisonVersions=new Map(appState.logs.map(log=>[log,log.analysis]));
  refreshComparisonFields(changed);
  choices.replaceChildren();appState.logs.forEach((log,index)=>{
    const label=document.createElement('label'),input=document.createElement('input'),dot=document.createElement('span');input.type='checkbox';input.checked=comparisonChosen.has(log);dot.style.color=comparisonColor(index);dot.textContent='●';
    input.addEventListener('change',()=>{if(input.checked)comparisonChosen.add(log);else comparisonChosen.delete(log);clearLogComparison();});label.append(input,dot,document.createTextNode(log.fileName));label.title=log.fileName;choices.append(label);
  });
  const bytes=appState.logs.reduce((n,log)=>n+(log.parsedLog.byteLength||0),0);
  document.getElementById('capacityTotals').textContent=`현재 첨부 ${appState.logs.length}개 · 원본 합계 ${(bytes/1024**3).toFixed(2)} GB (실제 메모리 사용량과 다름)`;
  if(invalidate&&changed)clearLogComparison();
}
function drawLogComparison(){return queueLogTask(async()=>{
  const status=document.getElementById('comparisonStatus');
  try{
    const keys=Array.from(document.querySelectorAll('#comparisonMetricChoices input:checked'),input=>input.value);
    keys.push(...comparisonFieldChosen);const selected=appState.logs.filter(log=>comparisonChosen.has(log));
    const result={datasets:[],skipped:[],axes:{}};
    for(const log of selected){status.textContent=`비교 데이터 조회 중 · ${log.fileName}`;await new Promise(resolve=>setTimeout(resolve,0));if(comparisonFieldChosen.size)await log.parsedLog.ensureLoaded?.();try{const part=buildLogComparison([log],keys,document.getElementById('comparisonAlignment').value);result.datasets.push(...part.datasets);result.skipped.push(...part.skipped);Object.assign(result.axes,part.axes);}finally{if(log!==appState.logs[appState.activeLogIndex])log.parsedLog.releaseRawBytes?.();}}
    const metricCount=new Set(result.datasets.map(dataset=>dataset.metricKey)).size;
    synchronizeComparisonAxes(result);
    clearLogComparison();status.textContent=`${new Set(result.datasets.map(dataset=>dataset.logIndex)).size}개 로그 · ${metricCount}개 항목 · ${result.datasets.length}개 곡선${result.skipped.length?' · 제외: '+result.skipped.join(' / '):''}`;
    if(!result.datasets.length)return;
    document.querySelector('.comparison-chart-surface').style.minWidth=`${Math.max(620,500+Object.keys(result.axes).length*55)}px`;
    comparisonChart=new Chart(document.getElementById('logComparisonChart').getContext('2d'),{
      type:'line',data:{datasets:result.datasets},
      options:{
        responsive:true,maintainAspectRatio:false,animation:false,parsing:false,
        interaction:{mode:'nearest',intersect:false},
        plugins:{
          flightMilestones:false,manualAxisLimits:false,flightModeSections:false,
          legend:{position:'bottom',labels:{color:'#333',boxWidth:18,font:{size:10},generateLabels(chart){
            return Chart.defaults.plugins.legend.labels.generateLabels(chart).map(label=>({...label,text:label.text.length>45?label.text.slice(0,42)+'…':label.text}));
          }}}
        },
        scales:{
          x:{type:'linear',title:{display:true,text:document.getElementById('comparisonAlignment').value==='takeoff'?'첫 이륙 기준 경과 시간 (초)':'로그 시작 기준 경과 시간 (초)'},ticks:{color:'#444'},grid:{color:'#e5e5e5'}},
          ...result.axes
        }
      }
    });
  }catch(error){status.textContent=`비교 실패: ${error.message}`;}
});}
function resetComparisonRange(){if(!comparisonChart)return;delete comparisonChart.options.scales.x.min;delete comparisonChart.options.scales.x.max;comparisonChart.update('none');}
