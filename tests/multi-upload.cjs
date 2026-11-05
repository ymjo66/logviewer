// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const elements=new Map();
const element=()=>({value:'',style:{},classList:{add(){},remove(){}},after(){},append(){},replaceChildren(){},scrollTo(){}});
const context=vm.createContext({console:{error(){}},setTimeout:fn=>setTimeout(fn,0),clearTimeout,setInterval,clearInterval,TextDecoder,Uint8Array,DataView,ArrayBuffer,Blob,window:{addEventListener(){}},document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element},Chart:{register(){}}});
vm.runInContext(scripts.find(s=>s.includes('function detectBatteryCells')),context);
vm.runInContext(scripts.find(s=>s.includes('function analyzeParsedLog')),context);
vm.runInContext('var realActivate=activateLogByIndex;stopPlayback=()=>{};activateLogByIndex=()=>{};showToast=()=>{};renderUploadReport=r=>{appState.report=r;}',context);
const bytes=fs.readFileSync('tests/fixtures/synthetic-flight.log');
const file=name=>{const blob=new Blob([bytes]);return {name,size:blob.size,slice:(a,b)=>blob.slice(a,b)};};
async function upload(files){context.files=files;await vm.runInContext('handleMultipleFilesUpload(files)',context);return vm.runInContext('appState.report',context);}
(async()=>{
 for(const count of [58,101,150]){vm.runInContext('appState.logs=[];appState.activeLogIndex=0',context);const result=await upload(Array.from({length:count},(_,i)=>file(`flight-${i}.log`)));assert.equal(result.selected,count);assert.equal(result.loaded,count);assert.equal(result.failures.length,0);assert.equal(vm.runInContext('appState.logs.length',context),count);}
 const bad={name:'unreadable.bin',size:10,slice(){throw Error('Test read failure');}};
 const result=await upload([file('same.log'),bad,file('same.log')]);assert.equal(result.loaded,2);assert.equal(result.failures.length,1);assert.equal(result.failures[0].fileName,'unreadable.bin');assert.match(result.failures[0].message,/Test read failure/);
 context.first=[file('queued-1.log')];context.second=[file('queued-2.log')];const before=vm.runInContext('appState.logs.length',context);
 await vm.runInContext('Promise.all([handleMultipleFilesUpload(first),handleMultipleFilesUpload(second)])',context);assert.equal(vm.runInContext('appState.logs.length',context),before+2);
 const fmt=Buffer.alloc(89);fmt.set([0xa3,0x95,128,42,19]);fmt.write('CTUN',5);fmt.write('Qff',9);fmt.write('TimeUS,Alt,ThO',25);
 const packets=Array.from({length:20},(_,i)=>{const b=Buffer.alloc(19);b.set([0xa3,0x95,42]);b.writeBigUInt64LE(BigInt(i)*1000000n,3);b.writeFloatLE(i>3&&i<16?20:0,11);b.writeFloatLE(i>3&&i<16?50:0,15);return b;});
 const bin=new Blob([fmt,...packets]);vm.runInContext('appState.logs=[];appState.activeLogIndex=-1',context);
 const resultBin=await upload(Array.from({length:150},(_,i)=>({name:`raw-${i}.bin`,size:bin.size,slice:(a,b)=>bin.slice(a,b)})));
 assert.equal(resultBin.loaded,150);assert.equal(vm.runInContext('appState.logs.reduce((n,log)=>n+log.parsedLog.retainedBytes,0)',context),0,'inactive BIN caches retain zero raw bytes');
 vm.runInContext('activateLogByIndex=realActivate;renderAllViews=()=>{};renderMultiLogManager=()=>{};switchMainTab=()=>{};window.scrollTo=()=>{};',context);
 await vm.runInContext('selectLogByIndex(0)',context);assert.equal(vm.runInContext('appState.parsedLog.tables.CTUN.length',context),20);
 await vm.runInContext('selectLogByIndex(149)',context);assert.equal(vm.runInContext('appState.logs[0].parsedLog.retainedBytes',context),0);assert.equal(vm.runInContext('appState.logs[149].parsedLog.retainedBytes',context),bin.size);
 await vm.runInContext('reanalyzeAllLogs()',context);assert.equal(vm.runInContext('appState.logs.reduce((n,log)=>n+log.parsedLog.retainedBytes,0)',context),bin.size);
 console.log('PASS: real parser + upload pipeline: 58, 101, 150 files; duplicate names retained; failed file reported; overlapping uploads queued');
})().catch(error=>{console.error(error);process.exitCode=1;});
