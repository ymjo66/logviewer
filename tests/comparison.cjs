// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({appState:{logs:[]}});vm.runInContext(fs.readFileSync('src/js/comparison.js','utf8'),context);
const make=(name,start,takeoff,peak)=>({fileName:name,parsedLog:{tables:{CTUN:{length:5000}},fmtList:[{name:'CTUN',columns:['Alt']}]},analysis:{minSec:start,sorties:takeoff==null?[]:[{takeoffSec:takeoff}],timeline:Array.from({length:5000},(_,i)=>({sec:start+i*.1,autoRelAlt:i===1234?peak:Math.sin(i/9)}))}});
const logs=[make('first.bin',100,110,9123),make('second.bin',500,520,8765),make('ground.bin',1000,null,111)];
context.appState.logs=logs;context.logs=logs;
let result=vm.runInContext('buildLogComparison(logs,"autoRelAlt","start")',context);
assert.equal(result.datasets.length,3);assert.equal(result.datasets[0].data[0].x,0);assert.equal(result.datasets[1].data[0].x,0);
assert.equal(Math.max(...result.datasets[0].data.map(p=>p.y)),9123);assert.equal(Math.max(...result.datasets[1].data.map(p=>p.y)),8765);
assert.ok(result.datasets[0].data.length<2500);assert.notEqual(result.datasets[0].borderColor,result.datasets[1].borderColor);
result=vm.runInContext('buildLogComparison(logs,"autoRelAlt","takeoff")',context);assert.equal(result.datasets.length,2);assert.equal(result.datasets[0].data[0].x,-10);assert.equal(result.datasets[1].data[0].x,-20);assert.match(result.skipped[0],/첫 이륙 미감지/);
result=vm.runInContext('buildLogComparison(logs,"volt","start")',context);assert.equal(result.datasets.length,0);assert.equal(result.skipped.length,3);
assert.equal(logs[0].analysis.timeline.length,5000,'rendering retains complete analysis');
context.rows=[{sec:0,autoRelAlt:1},{sec:1,autoRelAlt:NaN},{sec:2,autoRelAlt:2}];
result=vm.runInContext('comparisonPoints(rows,"autoRelAlt",0)',context);assert.equal(result[1].y,null);
assert.throws(()=>vm.runInContext('buildLogComparison(logs,"invalid","start")',context),/지원하지 않는/);
for(const log of logs){log.parsedLog.tables.BAT={length:5000};log.parsedLog.fmtList.push({name:'BAT',columns:['Volt']});for(const row of log.analysis.timeline)row.volt=50-row.sec*.001;}
result=vm.runInContext('buildLogComparison(logs,["autoRelAlt","volt","volt"],"start")',context);
assert.equal(result.datasets.length,6);assert.equal(Object.keys(result.axes).length,2);
assert.equal(result.datasets[0].yAxisID,result.datasets[1].yAxisID,'same field shares axis across logs');
assert.notEqual(result.datasets[0].yAxisID,result.datasets[3].yAxisID,'different fields have independent axes');
assert.equal(result.datasets[0].borderColor,result.datasets[3].borderColor,'same log keeps color across metrics');
assert.notDeepEqual(Array.from(result.datasets[0].borderDash),Array.from(result.datasets[3].borderDash));
assert.throws(()=>vm.runInContext('buildLogComparison(logs,[],"start")',context),/하나 이상/);
console.log('PASS: comparison alignment, common metric, distinct colors, narrow peak retention, missing fields/takeoff and gaps; no raw buffers loaded');
context.messageInstanceField=()=> 'I';context.readPlotField=(row,key)=>key==='Samples[1]'?row.Samples?.[1]:row[key];context.mapPlotRows=(rows,fn)=>rows.map(fn);context.buildFieldCatalog=parsed=>parsed.catalog;
for(const log of logs){log.parsedLog.tables.TEST=[{TimeUS:100e6,I:0,Samples:[1,99]},{TimeUS:101e6,I:1,Samples:[2,8000]},{TimeUS:102e6,I:1,Samples:[3,7]}];log.parsedLog.catalog=[{name:'TEST[1]',fields:[{name:'Samples[1]',numeric:true}]}];}
result=vm.runInContext('buildLogComparison(logs,[rawComparisonKey("TEST[1]","Samples[1]"),"autoRelAlt"],"start")',context);
assert.equal(result.datasets.length,6);assert.equal(result.datasets[0].data.length,2);assert.equal(result.datasets[0].data[0].y,8000);assert.equal(Object.keys(result.axes).length,2);
logs[1].parsedLog.catalog=[];result=vm.runInContext('buildLogComparison(logs,rawComparisonKey("TEST[1]","Samples[1]"),"start")',context);assert.equal(result.datasets.length,2);assert.match(result.skipped[0],/수치 필드 기록 없음/);
console.log('PASS: arbitrary raw fields, sensor instance and array element comparison; missing fields reported');
logs[0].parsedLog.nativeId='native-raw';logs[0].parsedLog.nativeMetadata={isText:false};context.nativeDouble=value=>value;context.nativeDecode=(key,value)=>value;
context.nativeCall=(method,id,json)=>{assert.equal(method,'QueryField');assert.equal(id,'native-raw');const query=JSON.parse(json);assert.equal(query.message,'TEST');assert.equal(query.field,'Samples[1]');assert.equal(query.instance,'1');return JSON.stringify([{count:2,data:[{x:101,y:8000},{x:102,y:7}],statistics:{min:7,max:8000,mean:4003.5}}]);};
result=vm.runInContext('buildLogComparison([logs[0]],rawComparisonKey("TEST[1]","Samples[1]"),"start")',context);assert.equal(result.datasets[0].data[0].x,1);assert.equal(result.datasets[0].data[0].y,8000);
console.log('PASS: native raw-field comparison queries disk engine with selected sensor and original timestamps');
