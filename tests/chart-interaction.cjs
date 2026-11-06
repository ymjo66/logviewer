// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const scripts=[...fs.readFileSync('index.html','utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match=>match[1]);
const timers=new Map(),frames=new Map(),handlers={};let serial=0,commits=0;
const context=vm.createContext({console,document:{getElementById(){return null;}},Chart:{register(){}},window:{addEventListener(){}},setTimeout(fn){const id=++serial;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},requestAnimationFrame(fn){const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},setInterval(){},clearInterval(){},commit(){commits++;}});
vm.runInContext(scripts.find(script=>script.includes('function detectBatteryCells')),context);vm.runInContext(scripts.find(script=>script.includes('function analyzeParsedLog')),context);
vm.runInContext('appState.analysis={minSec:0,maxSec:120};appState.parsedLog={};appState.zoomWindow={minSec:20,maxSec:60};mainChart={width:1000,chartArea:{left:0,right:1000},options:{scales:{x:{}}},scales:{x:{min:20,max:60,getValueForPixel(x){return 20+x*.04;}}},update(){}};renderTelemetryCharts=()=>commit();',context);
const canvas={style:{},addEventListener(name,fn){handlers[name]=fn;},getBoundingClientRect(){return {left:0,width:1000};},setPointerCapture(){}};
context.bindInteractiveChartZoom(canvas,()=>vm.runInContext('mainChart',context));
handlers.pointerdown({button:2,clientX:500,pointerId:1,preventDefault(){}});
for(let i=0;i<20;i++){handlers.pointermove({buttons:2,clientX:500+i,pointerId:1,preventDefault(){}});for(const [id,fn]of [...frames]){frames.delete(id);fn();}}
assert.equal(commits,0,'drag must never query or rebuild data');assert.equal(timers.size,0,'no final query scheduled before release');
handlers.pointerup();assert.equal(timers.size,1);for(const [id,fn]of [...timers]){timers.delete(id);fn();}assert.equal(commits,1,'release requests exactly one final refresh');
commits=0;
for(let i=0;i<15;i++)handlers.wheel({deltaY:-1,clientX:500,preventDefault(){}});
assert.equal(commits,0);assert.equal(timers.size,1,'wheel events coalesce into only the final range');for(const [id,fn]of [...timers]){timers.delete(id);fn();}assert.equal(commits,1);
let reads=0;const rows=new Proxy({length:1000000},{get(target,key){if(/^\d+$/.test(String(key))){reads++;return {sec:Number(key)*.1};}return target[key];}});
assert.equal(context.nearestTimelineIndex(rows,54321.23),543212);assert.ok(reads<30,'hover lookup must not scan a million rows');
assert.equal(context.nearestTimelineIndex([{sec:0},{sec:1},{sec:1},{sec:2}],1.2),1,'equal-time records keep original first-match behavior');
const bounds=[];rows._packed=true;rows.slice=(start,end)=>{bounds.push(start,end);return [];};context.largeRows=rows;
vm.runInContext('appState.analysis.timeline=largeRows;appState.zoomWindow={minSec:500,maxSec:501};getFilteredTimeline();',context);assert.deepEqual(bounds,[5000,5011]);
console.log('PASS: no drag-time data queries, one release refresh, wheel debounce, logarithmic hover/range lookup');
