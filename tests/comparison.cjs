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
