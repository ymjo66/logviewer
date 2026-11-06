// SPDX-License-Identifier: GPL-3.0-only
// Native files/indexes live on disk. JS retains only a bounded page cache.
const nativeDiskBridge=window.chrome?.webview?.hostObjects?.sync?.diskLogs||null;
const NATIVE_PAGE_ROWS=128,NATIVE_CACHE_LIMIT=16*1024*1024;
let nativeRawPageRows=128;
const nativePages=new Map();let nativePageBytes=0,nativeRequestSerial=0;
const nativeRequests=new Map();
let nativeProfileEnabled=false;const nativeRpcStats={};
function nativeProfileNow(){return typeof performance!=='undefined'?performance.now():Date.now();}
function nativeDecode(key,value){
  if(value&&typeof value==='object'){
    if(value.$float64){const bytes=Uint8Array.from(atob(value.$float64),c=>c.charCodeAt(0));return new DataView(bytes.buffer).getFloat64(0,true);}
    if('$literal' in value){const number=Number(value.$literal);return Number.isFinite(number)&&(!['q','Q'].includes(value.$format)||Number.isSafeInteger(number))?number:value.$literal;}
    if(value.$number){switch(value.$number){case 'NaN':return NaN;case 'Infinity':return Infinity;case '-Infinity':return -Infinity;case '-0':return -0;}}
  }return value;
}
function nativeEncode(key,value){if(typeof value==='number'&&(!Number.isFinite(value)||Object.is(value,-0)))return {$number:Object.is(value,-0)?'-0':String(value)};return value;}
function nativeCall(method,...args){
  if(typeof __nativeDiskEndpoint==='string'){
    const started=nativeProfileEnabled?nativeProfileNow():0;
    const request=new XMLHttpRequest();request.open('POST',__nativeDiskEndpoint,false);request.setRequestHeader('Content-Type','application/json');request.send(JSON.stringify({method,args}));
    const response=JSON.parse(request.responseText);if(request.status!==200||response.error)throw Error(response.error||`디스크 엔진 HTTP ${request.status}`);
    if(nativeProfileEnabled){const stats=nativeRpcStats[method]??={calls:0,milliseconds:0,nativeMilliseconds:0,responseCharacters:0};stats.calls++;stats.milliseconds+=nativeProfileNow()-started;stats.nativeMilliseconds+=response.nativeMilliseconds||0;stats.responseCharacters+=request.responseText.length;}
    return response.result;
  }
  if(!nativeDiskBridge)throw Error('EXE 디스크 엔진에 연결되지 않았습니다.');
  return nativeDiskBridge[method](...args);
}
function nativeCachedPage(key,load){
  const previous=nativePages.get(key);if(previous){nativePages.delete(key);nativePages.set(key,previous);return previous.rows;}
  const text=load(),rows=JSON.parse(text,nativeDecode),bytes=text.length*4+2048;
  while(nativePageBytes+bytes>NATIVE_CACHE_LIMIT&&nativePages.size){const first=nativePages.keys().next().value;nativePageBytes-=nativePages.get(first).bytes;nativePages.delete(first);}
  if(bytes<=NATIVE_CACHE_LIMIT){nativePages.set(key,{rows,bytes});nativePageBytes+=bytes;}
  return rows;
}
function clearNativePages(id){for(const [key,page] of nativePages)if(key.startsWith(id+':')){nativePageBytes-=page.bytes;nativePages.delete(key);}}
function clearNativeCollectionPages(id,name){const prefix=`${id}:analysis:${name}:`;for(const [key,page] of nativePages)if(key.startsWith(prefix)){nativePageBytes-=page.bytes;nativePages.delete(key);}}
function nativeDouble(value){if(value==null||!Number.isFinite(value))return null;const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,true);return {$float64:btoa(String.fromCharCode(...bytes))};}
function nativeFieldPlot(parsed,message,field,instanceKey,instance,fullRange){
  const zoom=!fullRange?appState.zoomWindow:null;
  const query=JSON.stringify({message,field,instanceKey,instance:instance??null,min:nativeDouble(zoom?.minSec??appState.analysis.minSec),max:nativeDouble(zoom?.maxSec??appState.analysis.maxSec),filterMin:nativeDouble(zoom?.minSec),filterMax:nativeDouble(zoom?.maxSec)});
  return nativeCachedPage(`${parsed.nativeId}:query:${query}`,()=>nativeCall('QueryField',parsed.nativeId,query));
}
function startNativePlotRefresh(revision){
  const parsed=appState.parsedLog,analysis=appState.analysis;
  setPlotQueryStatus('원본 구간 조회 중…');
  if(mainChart&&mainChart._plotAnalysis!==analysis){mainChart.data.datasets=[];mainChart.update('none');renderPlotLegend([]);}
  const key=JSON.stringify([appState.customFields,appState.activePreset,appState.altSourceMode]);
  const needOverview=appState.overviewCache?.analysis!==analysis||appState.overviewCache?.key!==key;
  const core=Array.from(document.querySelectorAll('script')).find(script=>script.textContent.includes('function analyzeParsedLog(')).textContent;
  const source=[
    'const window=self;const document={};const Chart={register(){}};',
    `const __nativeDiskEndpoint=${JSON.stringify(nativeCall('Endpoint'))};`,
    document.getElementById('battery-core').textContent,core,document.getElementById('native-disk-core').textContent,
    `self.onmessage=event=>{try{
      const input=event.data;Object.assign(appState,input.state);
      appState.parsedLog=makeNativeParsed(input.metadata);appState.parsedLog._fieldCatalog=input.catalog;
      appState.analysis=restoreNativeAnalysis(input.metadata.nativeId,JSON.parse(nativeCall('GetAnalysis',input.metadata.nativeId),nativeDecode));
      const build=full=>{const config=appState.customFields.length?buildCustomFieldConfig(appState.customFields,full):buildPresetConfig(appState.activePreset,full?appState.analysis.timeline:getFilteredTimeline());normalizePlotDatasets(config.datasets,full?null:appState.zoomWindow);styleUavDatasets(config.datasets,!!config.customAxes);synchronizePlotAxes(config,appState.customFields);return config;};
      const config=build(false);let overview=null;
      if(input.needOverview)overview=build(true).datasets.map(ds=>{const lo=ds.statistics?.min??0,span=(ds.statistics?.max??1)-lo||1;return {...ds,data:ds.data.map(point=>({x:point.x,y:point.y===null?null:(point.y-lo)/span})),yAxisID:'y',fill:false,borderWidth:1};});
      const a=appState.analysis,overlay={timeline:[{}],sorties:Array.from(a.sorties,row=>({...row})),chartErrorMarkers:Array.from(a.chartErrorMarkers,row=>({...row})),modeSegments:Array.from(a.modeSegments,row=>({...row})),cursorSec:a.timeline[input.scrubberIndex]?.sec};
      for(const key of ['armSec','disarmSec','takeoffSec','landingSec','takeoffKst','takeoffBoot','landingKst','landingBoot','disarmKst','disarmBoot','groundOnly','isLogCutoff'])overlay[key]=a[key];
      self.postMessage({config,overview,overlay});
    }catch(error){self.postMessage({error:error.message});}};`
  ].join('\n');
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url);URL.revokeObjectURL(url);plotWorker=worker;
  const canvas=document.getElementById('mainTelemetryChart');canvas?.setAttribute('aria-busy','true');
  worker.onmessage=event=>{
    worker.terminate();if(plotWorker===worker)plotWorker=null;
    if(revision!==plotRevision||appState.analysis!==analysis||appState.parsedLog!==parsed)return;
    canvas?.setAttribute('aria-busy','false');
    if(event.data.error){setPlotQueryStatus('조회 실패 · 이전 그래프를 유지합니다.');showToast('차트 조회 실패: '+event.data.error);return;}
    renderTelemetryCharts(event.data,revision);
  };
  worker.onerror=event=>{worker.terminate();if(plotWorker===worker)plotWorker=null;if(revision===plotRevision){canvas?.setAttribute('aria-busy','false');showToast('차트 조회 실패: '+event.message);}};
  worker.postMessage({metadata:parsed.nativeMetadata,catalog:parsed._fieldCatalog,needOverview,scrubberIndex:appState.scrubberIndex,state:{customFields:[...appState.customFields],activePreset:appState.activePreset,zoomWindow:appState.zoomWindow,altSourceMode:appState.altSourceMode,customAxisLimits:appState.customAxisLimits,axisLimits:appState.axisLimits,config:appState.config,timeMode:appState.timeMode}});
}
function nativeRawRows(id,name,length){
  const read=i=>{const start=Math.floor(i/nativeRawPageRows)*nativeRawPageRows;return nativeCachedPage(`${id}:raw:${name}:${nativeRawPageRows}:${start}`,()=>nativeCall('ReadPage',id,name,start,nativeRawPageRows))[i-start];};
  return packedRows({length,keys(i){return Object.keys(read(i)||{});},get(i,key){return typeof key==='string'?read(i)?.[key]:undefined;},set(){throw Error('원본 로그는 읽기 전용입니다.');}});
}
function nativeCollectionRows(id,name,length,computed={}){
  const read=i=>nativeCachedPage(`${id}:analysis:${name}:${Math.floor(i/NATIVE_PAGE_ROWS)}`,()=>nativeCall('ReadCollection',id,name,Math.floor(i/NATIVE_PAGE_ROWS)))[i%NATIVE_PAGE_ROWS];
  return packedRows({length,keys(i){return [...new Set([...Object.keys(read(i)||{}),...Object.keys(computed)])];},get(i,key){return computed[key]?computed[key](read(i)?.sec):typeof key==='string'?read(i)?.[key]:undefined;},set(){throw Error('디스크 분석 결과는 읽기 전용입니다.');}});
}
function createNativeWritableRows(id,name,computed={}){
  nativeCall('BeginCollection',id,name);let writtenPages=0;const pages=new Map();
  const save=(page,entry)=>{if(!entry.dirty)return;nativeCall('WriteCollectionPage',id,name,page,JSON.stringify(entry.rows,nativeEncode));writtenPages=Math.max(writtenPages,page+1);entry.dirty=false;clearNativeCollectionPages(id,name);};
  const load=page=>{
    let entry=pages.get(page);if(entry){pages.delete(page);pages.set(page,entry);return entry;}
    while(pages.size>=4){const oldest=pages.keys().next().value;save(oldest,pages.get(oldest));pages.delete(oldest);}
    entry={rows:page<writtenPages?JSON.parse(nativeCall('ReadCollection',id,name,page),nativeDecode):[],dirty:false};pages.set(page,entry);return entry;
  };
  const backend={length:0,nativeMutable:true,
    keys(i){return [...new Set([...Object.keys(load(Math.floor(i/NATIVE_PAGE_ROWS)).rows[i%NATIVE_PAGE_ROWS]||{}),...Object.keys(computed)])];},
    get(i,key){const row=load(Math.floor(i/NATIVE_PAGE_ROWS)).rows[i%NATIVE_PAGE_ROWS];return computed[key]?computed[key](row?.sec):typeof key==='string'?row?.[key]:undefined;},
    set(i,key,value){if(computed[key])return;const entry=load(Math.floor(i/NATIVE_PAGE_ROWS));entry.rows[i%NATIVE_PAGE_ROWS]??={};entry.rows[i%NATIVE_PAGE_ROWS][key]=value;entry.dirty=true;},
    append(value){const i=this.length++;for(const key of Object.keys(value))this.set(i,key,value[key]);},
    flush(){for(const [page,entry] of pages)save(page,entry);},compact(){this.flush();}
  };
  return packedRows(backend);
}
function makeNativeParsed(metadata){
  return {...metadata,storage:'lossless-packed',nativeMetadata:metadata,retainedBytes:0,
    tables:Object.fromEntries(Object.entries(metadata.tables).map(([name,length])=>[name,nativeRawRows(metadata.nativeId,name,length)])),
    beginSensorScan(){nativeRawPageRows=512;},endSensorScan(){nativeRawPageRows=128;clearNativePages(metadata.nativeId);},
    releaseRawBytes(){clearNativePages(metadata.nativeId);},async ensureLoaded(){},
    dispose(){clearNativePages(metadata.nativeId);nativeCall('Release',metadata.nativeId);}
  };
}
function restoreNativeAnalysis(id,metadata){
  const analysis={...metadata.summary};
  analysis.secToBootStr=sec=>{const tenths=Math.round(Math.abs(sec)*10),mins=Math.floor(tenths/600),rem=((tenths%600)/10).toFixed(1).padStart(4,'0');return `T${sec<0?'-':'+'}${String(mins).padStart(2,'0')}:${rem}`;};
  analysis.secToKstStr=sec=>{
    if(analysis.gpsEpochOffsetMs==null)return analysis.secToBootStr(sec);
    const date=new Date(Math.floor((analysis.gpsEpochOffsetMs+sec*1000+9*3600000)/1000)*1000);
    return [date.getUTCHours(),date.getUTCMinutes(),date.getUTCSeconds()].map(n=>String(n).padStart(2,'0')).join(':');
  };
  for(const [name,length] of Object.entries(metadata.collections))analysis[name]=nativeCollectionRows(metadata.storeId||id,name,length,name==='timeline'?{kstStr:analysis.secToKstStr,bootStr:analysis.secToBootStr}:{});
  return analysis;
}
async function storeNativeAnalysis(id,analysis,onProgress=()=>{}){
  const metadata={summary:{},collections:{},storeId:id};
  for(const [key,value] of Object.entries(analysis)){
    if(['timeline','unifiedEvents','parmRows','chartErrorMarkers','modeSegments','sorties','diagnostics'].includes(key)){
      if(value._packed?.backend.nativeMutable){value._packed.backend.flush();metadata.collections[key]=value.length;continue;}
      nativeCall('BeginCollection',id,key);metadata.collections[key]=value.length;
      for(let start=0;start<value.length;start+=NATIVE_PAGE_ROWS){
        const rows=Array.from({length:Math.min(NATIVE_PAGE_ROWS,value.length-start)},(_,i)=>value[start+i]);
        nativeCall('AppendCollection',id,key,JSON.stringify(rows,nativeEncode));
        onProgress(start/Math.max(1,value.length),`분석 결과 디스크 저장 · ${key}`);
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }else if(typeof value!=='function')metadata.summary[key]=value;
  }
  // Materialize the small metadata while raw row views are still available.
  const text=JSON.stringify(metadata,nativeEncode);nativeCall('StoreAnalysis',id,text);clearNativePages(id);
  return JSON.parse(text,nativeDecode);
}
function importNativeFile(file,onProgress){
  const requestId=String(++nativeRequestSerial);
  return new Promise((resolve,reject)=>{
    nativeRequests.set(requestId,{resolve,reject,onProgress});window.chrome.webview.postMessage(JSON.stringify({action:'disk.index',requestId,id:file.nativeId}));
  });
}
async function streamNativeCsv(logs,mode,keys,range,status){
  const columns=CSV_COLUMNS[mode].filter(column=>keys.includes(column[0]));if(!columns.length)throw Error('저장할 항목을 하나 이상 선택하세요.');
  const token=nativeCall('BeginCsvExport',logs.length===1?logs[0].fileName.replace(/\.[^.]+$/,'')+'_'+mode+'.csv':'logviewer_'+mode+'.csv');
  if(!token){status.textContent='CSV 저장을 취소했습니다.';return;}
  try{
    nativeCall('AppendCsvExport',token,columns.map(column=>csvCell(column[1])).join(','));let buffer='',count=0;
    for(const log of logs){
      const rows=mode==='summary'?(log.analysis.sorties.length?log.analysis.sorties:[null]):log.analysis.timeline;
      for(const row of rows){
        if(mode==='telemetry'&&range&&(row.sec<range.minSec||row.sec>range.maxSec))continue;
        buffer+='\r\n'+columns.map(column=>csvCell(column[2](log,row))).join(',');count++;
        if(buffer.length>=128*1024){nativeCall('AppendCsvExport',token,buffer);buffer='';status.textContent=`CSV 저장 중 · ${count.toLocaleString()}행`;await new Promise(resolve=>setTimeout(resolve,0));}
      }
    }
    if(buffer)nativeCall('AppendCsvExport',token,buffer);nativeCall('FinishCsvExport',token,true);status.textContent=`CSV 저장 완료 · ${count.toLocaleString()}행`;
  }catch(error){nativeCall('FinishCsvExport',token,false);throw error;}
}
async function analyzeNativeLog(parsed,cfg,onProgress=()=>{}){
  const analysisStarted=nativeProfileNow();
  const source=[
    'const window=self;const document={};const Chart={register(){}};',
    `const __nativeDiskEndpoint=${JSON.stringify(nativeCall('Endpoint'))};`,
    document.getElementById('battery-core').textContent,
    Array.from(document.querySelectorAll('script')).find(script=>script.textContent.includes('function analyzeParsedLog(')).textContent,
    document.getElementById('native-disk-core').textContent,
    `self.onmessage=async(event)=>{let store;try{
      const {metadata,cfg,altSourceMode,timeMode,catalog}=event.data;nativeProfileEnabled=!!metadata.profileEnabled;
      appState.config=cfg;appState.altSourceMode=altSourceMode;appState.timeMode=timeMode;
      const parsed=makeNativeParsed(metadata),profile={stages:{},analysisPhases:[],rpc:nativeRpcStats};
      store=nativeCall('BeginAnalysis',parsed.nativeId);parsed.nativeAnalysisStore=store;
      let phaseStart=nativeProfileNow(),lastRpc=0;
      if(nativeProfileEnabled)parsed.onAnalysisPhase=name=>{const now=nativeProfileNow(),rpc=Object.values(nativeRpcStats).reduce((sum,item)=>sum+item.milliseconds,0);profile.analysisPhases.push({name,milliseconds:now-phaseStart,rpcMilliseconds:rpc-lastRpc});phaseStart=now;lastRpc=rpc;};
      self.postMessage({type:'progress',fraction:0,phase:'전체 패킷 분석 중'});
      let started=nativeProfileNow();const analysis=analyzeParsedLog(parsed,cfg);profile.stages.analysis=nativeProfileNow()-started;
      started=nativeProfileNow();analysis.timeline._packed?.backend.compact();profile.stages.timelineFlush=nativeProfileNow()-started;
      self.postMessage({type:'progress',fraction:0,phase:'전체 필드·인스턴스 목록 확인'});
      started=nativeProfileNow();const fieldCatalog=catalog||JSON.parse(nativeCall('GetFieldCatalog',parsed.nativeId),nativeDecode);profile.stages.fieldCatalog=nativeProfileNow()-started;
      started=nativeProfileNow();const result=await storeNativeAnalysis(store,analysis,(fraction,phase)=>self.postMessage({type:'progress',fraction,phase}));profile.stages.resultStorage=nativeProfileNow()-started;
      result.catalog=fieldCatalog;started=nativeProfileNow();nativeCall('CommitAnalysis',parsed.nativeId,store);profile.stages.commit=nativeProfileNow()-started;
      profile.timelineRows=analysis.timeline.length;profile.fieldCount=fieldCatalog.reduce((sum,item)=>sum+item.fields.length,0);result.profile=profile;
      self.postMessage({type:'done',result});
    }catch(error){if(store)try{nativeCall('AbortAnalysis',store);}catch{}self.postMessage({type:'error',message:error.message,stack:error.stack});}};`
  ].join('\n');
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url);URL.revokeObjectURL(url);
  const result=await new Promise((resolve,reject)=>{
    const finish=()=>worker.terminate();
    worker.onmessage=e=>{if(e.data.type==='progress'){onProgress(e.data.fraction,e.data.phase);return;}finish();if(e.data.type==='error')reject(Error(e.data.message));else resolve(e.data.result);};
    worker.onerror=e=>{finish();reject(Error(e.message||'백그라운드 분석 오류'));};
    worker.postMessage({metadata:parsed.nativeMetadata,cfg:{...cfg},altSourceMode:appState.altSourceMode,timeMode:appState.timeMode,catalog:parsed._fieldCatalog});
  });
  parsed._fieldCatalog=result.catalog;
  if(parsed.nativeMetadata.profileEnabled){parsed.loadProfile={fileName:parsed.fileName,bytes:parsed.byteLength,packets:parsed.totalPackets,indexMilliseconds:parsed.nativeMetadata.indexMilliseconds,analysisWallMilliseconds:nativeProfileNow()-analysisStarted,...result.profile};window.chrome.webview.postMessage(JSON.stringify({action:'disk.profile',profile:parsed.loadProfile}));}
  clearNativePages(parsed.nativeId);return restoreNativeAnalysis(parsed.nativeId,result);
}
window.addEventListener('DOMContentLoaded',()=>{
  if(!nativeDiskBridge)return;
  const host=window.chrome.webview;
  const nativePick=()=>host.postMessage(JSON.stringify({action:'disk.pick'}));
  document.addEventListener('click',e=>{if(e.target.closest('label[for="fileInput"]')||e.target.id==='fileInput'){e.preventDefault();e.stopImmediatePropagation();nativePick();}},true);
  document.addEventListener('drop',e=>{const files=Array.from(e.dataTransfer?.files||[]);if(!files.length)return;e.preventDefault();e.stopImmediatePropagation();host.postMessageWithAdditionalObjects(JSON.stringify({action:'disk.drop'}),files);},true);
  host.addEventListener('message',e=>{
    const data=e.data;if(data?.type==='disk-files'){handleMultipleFilesUpload(data.files);return;}
    if(data?.type==='disk-error'){showToast(data.message);return;}
    const request=nativeRequests.get(data?.requestId);if(!request)return;
    if(data.type==='disk-progress'){request.onProgress?.(data.fraction,data.phase);return;}
    if(data.type==='disk-result'){nativeRequests.delete(data.requestId);if(data.error)request.reject(Error(data.error));else request.resolve(makeNativeParsed(JSON.parse(data.metadata,nativeDecode)));}
  });
  const notice=document.getElementById('capacityNotice');
  if(notice){notice.querySelector('p').textContent='EXE 디스크 엔진: 원본은 복사하지 않고 읽기 전용으로 직접 조회합니다. 인덱스와 분석 결과만 %LOCALAPPDATA%\\LogViewer\\disk-cache 에 임시 저장하며 정상 종료 시 삭제합니다. 로그가 목록에 있는 동안 원본을 이동·수정하거나 저장 장치를 분리하지 마세요. 화면 페이지 캐시에 상한이 있으며, 매우 큰 작업의 성공을 무제한 보장하지는 않습니다.';}
});
