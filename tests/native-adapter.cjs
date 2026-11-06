// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const collections=new Map(),summaries=new Map();let raw,encode,csvText='';
const bridge={
 Endpoint(){return 'https://engine.logviewer.local/test';},
 ReadPage(id,name,start,count){return JSON.stringify(raw.tables[name].slice(start,start+count),encode);},
 BeginCollection(id,name){collections.set(id+':'+name,[]);},
 WriteCollectionPage(id,name,page,json){collections.get(id+':'+name)[page]=json;},
 AppendCollection(id,name,json){collections.get(id+':'+name).push(json);},
 ReadCollection(id,name,page){return collections.get(id+':'+name)[page];},
 StoreAnalysis(id,json){summaries.set(id,json);},GetAnalysis(id){return summaries.get(id);},
 BeginCsvExport(){csvText='\uFEFF';return 'export';},AppendCsvExport(token,text){csvText+=text;},FinishCsvExport(token,success){assert.ok(success);}
};
const context=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,TextDecoder,Uint8Array,DataView,ArrayBuffer,Blob,atob,window:{addEventListener(){},chrome:{webview:{hostObjects:{sync:{diskLogs:bridge}}}}},document:{},Chart:{register(){}}});
vm.runInContext(scripts.find(s=>s.includes('function detectBatteryCells')),context);vm.runInContext(scripts.find(s=>s.includes('function analyzeParsedLog')),context);vm.runInContext(fs.readFileSync('src/js/csv.js','utf8'),context);vm.runInContext(fs.readFileSync('src/js/native-disk.js','utf8'),context);encode=vm.runInContext('nativeEncode',context);
const plain=v=>JSON.parse(JSON.stringify(v));
(async()=>{
 for(const file of (process.argv.length>2?process.argv.slice(2):['synthetic-flight.log','synthetic-ground.log','synthetic-battery12.log','synthetic-instances.log','synthetic-modes.log'])){
  const input=fs.readFileSync(process.argv.length>2?file:'tests/fixtures/'+file);context.text=input.toString('utf8');context.binary=new Uint8Array(input);raw=vm.runInContext(/\.bin$/i.test(file)?'parseDataFlashBinary(binary)':'parseDataFlashTextLog(text)',context);context.raw=raw;
  const standard=vm.runInContext('analyzeParsedLog(raw,appState.config)',context);
  context.meta={nativeId:file,fileName:file,byteLength:100,fmtList:raw.fmtList,tables:Object.fromEntries(Object.entries(raw.tables).map(([name,rows])=>[name,rows.length])),rawCounts:raw.rawCounts,totalPackets:raw.totalPackets};
  const native=vm.runInContext('analyzeParsedLog(makeNativeParsed(meta),appState.config)',context);context.native=native;
  assert.equal(native.timeline._packed.backend.nativeMutable,true);
  const metadata=await vm.runInContext('storeNativeAnalysis(meta.nativeId,native)',context);context.stored=metadata;
  const restored=vm.runInContext('restoreNativeAnalysis(meta.nativeId,stored)',context);
  assert.deepEqual(plain(restored),plain(standard),'every analysis output with disk paging: '+file);
  for(const sec of [-1,0,12.3,120]){assert.equal(restored.secToKstStr(sec),standard.secToKstStr(sec));assert.equal(restored.secToBootStr(sec),standard.secToBootStr(sec));}
  context.csvLogs=[{fileName:'=test-'+file,analysis:restored}];context.csvStatus={textContent:''};
  for(const mode of ['summary','telemetry']){context.csvMode=mode;await vm.runInContext('streamNativeCsv(csvLogs,csvMode,["file","duration","sec","kst","autoRelAlt","volt"],{minSec:0,maxSec:120},csvStatus)',context);assert.equal(csvText,vm.runInContext('buildSelectedCsv(csvLogs,csvMode,["file","duration","sec","kst","autoRelAlt","volt"],{minSec:0,maxSec:120})',context),'streaming CSV matches existing output');}
 }
 if(process.argv.length>2){console.log('PASS: real log every derived analysis output and CSV match unchanged analysis rules');return;}
 context.cacheID='cache-check';vm.runInContext("nativeCachedPage(cacheID+':raw:TEST:0',()=> '[{\"Value\":123}]');nativeCachedPage(cacheID+':analysis:timeline:0',()=> '[{\"Value\":1}]');clearNativeCollectionPages(cacheID,'timeline');",context);assert.equal(vm.runInContext("nativePages.has(cacheID+':raw:TEST:0')",context),true,'timeline writes preserve immutable raw cache');assert.equal(vm.runInContext("nativePages.has(cacheID+':analysis:timeline:0')",context),false,'updated timeline cache invalidated');
 const rows=vm.runInContext('createNativeWritableRows("large","timeline")',context);
 for(let i=0;i<5000;i++)rows.push({sec:i,value:i===1999?NaN:i});
 for(let i=4999;i>=0;i--)rows[i].twice=i*2;rows._packed.backend.flush();
 for(let i=0;i<5000;i++){assert.equal(rows[i].twice,i*2);if(i===1999)assert.ok(Number.isNaN(rows[i].value));else assert.equal(rows[i].value,i);}
 assert.ok(vm.runInContext('nativePageBytes<=NATIVE_CACHE_LIMIT',context));
 // Execute the exact generated chart Worker source against the disk adapter.
 let workerSource='',preparedPlot;const chartWorkers=[];
 context.URL={createObjectURL(blob){workerSource=blob.parts.join('\n');return 'blob:test';},revokeObjectURL(){}};
 context.Blob=class {constructor(parts){this.parts=parts;}};
 context.document={querySelectorAll(){return scripts.map(textContent=>({textContent}));},getElementById(id){if(id==='battery-core')return {textContent:scripts.find(s=>s.includes('function detectBatteryCells'))};if(id==='native-disk-core')return {textContent:fs.readFileSync('src/js/native-disk.js','utf8')};if(id==='mainTelemetryChart')return {setAttribute(){}};return null;}};
 context.Worker=class {
  constructor(){chartWorkers.push(this);const owner=this,self={addEventListener(){},postMessage(data){owner.onmessage({data:structuredClone(data)});}};const workerContext=vm.createContext({self,console,TextDecoder,Uint8Array,DataView,ArrayBuffer,Blob,atob,btoa,setTimeout,clearTimeout,setInterval,clearInterval,XMLHttpRequest:class {open(){}setRequestHeader(){}send(text){const {method,args}=JSON.parse(text);this.status=200;this.responseText=JSON.stringify({result:bridge[method](...args)});}}});vm.runInContext(workerSource,workerContext);this.self=self;}
  postMessage(data){this.self.onmessage({data});}terminate(){}
 };
 context.capturePlot=plot=>{preparedPlot=plot;};vm.runInContext('appState.parsedLog=makeNativeParsed({...meta,isText:true});appState.analysis=restoreNativeAnalysis(meta.nativeId,stored);appState.customFields=["CTUN.Alt"];appState.zoomWindow={minSec:10,maxSec:25};renderTelemetryCharts=(plot)=>capturePlot(plot);startNativePlotRefresh(plotRevision);',context);
 assert.ok(preparedPlot&&!preparedPlot.error,'generated worker returns chart configuration');assert.ok(preparedPlot.config.datasets[0].statistics);assert.ok(preparedPlot.config.datasets[0].data.every(point=>point.x>=10&&point.x<=25));assert.ok(preparedPlot.overview.length);assert.equal(preparedPlot.config.datasets[0].borderColor,preparedPlot.config.customAxes.y.ticks.color);
 const outdated=preparedPlot;preparedPlot=null;context.window.chrome.webview.postMessage=()=>{};vm.runInContext('cancelPlotRefresh()',context);chartWorkers.at(-1).onmessage({data:outdated});assert.equal(preparedPlot,null,'outdated completion must never overwrite a newer view');
 vm.runInContext('appState.overviewCache={analysis:appState.analysis,key:JSON.stringify([appState.customFields,appState.activePreset,appState.altSourceMode]),datasets:[]};startNativePlotRefresh(plotRevision);',context);assert.equal(preparedPlot.overview,null,'range changes reuse full-range overview instead of re-querying it');
 console.log('PASS: actual generated chart Worker, paged range/statistics, overview and colored axes');
 console.log('PASS: disk-backed timeline every analysis output matches five fixtures; random updates, cache eviction, metadata and time formatters preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
