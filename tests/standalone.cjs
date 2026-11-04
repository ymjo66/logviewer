const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html','utf8');
assert.ok(!/<script\b[^>]*\bsrc\s*=/.test(html),'all scripts must be embedded');
assert.ok(!/<link\b[^>]*\bhref\s*=\s*["'](?!data:)/.test(html),'all styles/fonts must be embedded');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
for (const script of scripts) new vm.Script(script);

const context = vm.createContext({console,window:{addEventListener(){}},Chart:{register(){}},document:{},setTimeout,clearTimeout,setInterval,clearInterval});
vm.runInContext(scripts.find(s=>s.includes('function detectBatteryCells')),context);
vm.runInContext(scripts.find(s=>s.includes('function analyzeParsedLog')),context);
function analyze(ctun, ev=[]) {
  context.input = {fileName:'synthetic.log',tables:{CTUN:ctun,EV:ev},fmtList:[],rawCounts:{}};
  return vm.runInContext('analyzeParsedLog(input, appState.config)', context);
}
function rows(fn,n=61) { return Array.from({length:n},(_,sec)=>({TimeUS:sec*1e6,Alt:0,ThO:0,...fn(sec)})); }
let result = analyze(rows(sec=>({Alt:sec*0.08,ThO:0.12})),[{TimeUS:1e6,Id:10},{TimeUS:60e6,Id:11}]);
assert.equal(result.sorties.length,0,'idle motor plus altitude drift must not create flight');
assert.equal(result.airborneDurationSec,0);
assert.equal(result.isLogCutoff,false);
result = analyze(rows(sec=>({Alt:sec>=10&&sec<45?5:0,ThO:sec>=10&&sec<45?0.5:0.1})));
assert.equal(result.sorties.length,1);
assert.equal(result.takeoffSec,10);
assert.equal(result.landingSec,45);
result = analyze(rows(sec=>({Alt:sec===10?5:0,ThO:0.5})));
assert.equal(result.sorties.length,0,'single spike must not create flight');
result = analyze(rows(sec=>({Alt:5,ThO:0.5})),[{TimeUS:0,Id:11}]);
assert.equal(result.sorties.length,0,'explicitly disarmed log must not create inferred flight');
result = analyze(rows(sec=>({Alt:sec>=10&&sec<45?5:0,ThO:0.1})),[{TimeUS:1e6,Id:10},{TimeUS:10e6,Id:28},{TimeUS:45e6,Id:18},{TimeUS:50e6,Id:11}]);
assert.equal(result.sorties.length,1,'explicit flight events override low throttle inference');
assert.equal(result.takeoffSec,10);
assert.equal(result.landingSec,45);
assert.equal(result.sorties[0].disarmSec,50,'use actual DISARM after landing');
result = analyze(rows(sec=>({Alt:sec>=10?1600:0,ThO:sec>=10?0.5:0.1})));
assert.equal(result.timeline[20].autoRelAlt,1600,'high altitude must not be guessed to be centimetres');
const mixed = rows(sec=>({Alt:sec,ThO:0.1,I:0})).flatMap(r=>[r,{...r,I:1,Alt:1000}]).reverse();
result = analyze(mixed);
assert.equal(result.timeline.length,61,'derived telemetry must use one sensor instance');
assert.equal(result.timeline[0].sec,0,'nearest lookup must use sorted time');
assert.equal(result.timeline.at(-1).sec,60);
assert.ok(result.timeline.every(p=>p.alt<100),'secondary sensor must not create a 1000m zigzag');
result = analyze(rows(sec=>({Alt:(sec>=10&&sec<30)||(sec>=50&&sec<75)?5:0,ThO:0.5}),91));
assert.equal(result.sorties.length,2,'two separate airborne segments must remain two sorties');
assert.equal(vm.runInContext("buildPresetConfig('battery', []).datasets.length",context),2,'battery chart shows measured voltage and current only');
console.log('PASS: JavaScript syntax and 8 flight/telemetry regression scenarios');
