// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8'),scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const collections=new Map(),summaries=new Map();let raw,encode,csvText='';
const bridge={
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
 for(const file of ['synthetic-flight.log','synthetic-ground.log','synthetic-battery12.log','synthetic-instances.log','synthetic-modes.log']){
  context.text=fs.readFileSync('tests/fixtures/'+file,'utf8');raw=vm.runInContext('parseDataFlashTextLog(text)',context);context.raw=raw;
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
 const rows=vm.runInContext('createNativeWritableRows("large","timeline")',context);
 for(let i=0;i<5000;i++)rows.push({sec:i,value:i===1999?NaN:i});
 for(let i=4999;i>=0;i--)rows[i].twice=i*2;rows._packed.backend.flush();
 for(let i=0;i<5000;i++){assert.equal(rows[i].twice,i*2);if(i===1999)assert.ok(Number.isNaN(rows[i].value));else assert.equal(rows[i].value,i);}
 assert.ok(vm.runInContext('nativePageBytes<=NATIVE_CACHE_LIMIT',context));
 console.log('PASS: disk-backed timeline every analysis output matches five fixtures; random updates, cache eviction, metadata and time formatters preserved');
})().catch(error=>{console.error(error);process.exitCode=1;});
