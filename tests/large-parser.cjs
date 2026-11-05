// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function analyzeParsedLog'));
const context=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,TextDecoder,Uint8Array,DataView,ArrayBuffer,Blob,window:{addEventListener(){}},document:{},Chart:{register(){}}});
const battery=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function detectBatteryCells'));
vm.runInContext(battery,context);vm.runInContext(script,context);
const file=(blob,name)=>({name,size:blob.size,slice:(a,b)=>blob.slice(a,b)});
function fmt(id,name,format,columns){const b=Buffer.alloc(89);b.set([0xa3,0x95,128,id,3+[...format].reduce((n,c)=>n+({Q:8,q:8,a:64,f:4,I:4,B:1,n:4}[c]),0)]);b.write(name,5);b.write(format,9);b.write(columns,25);return b;}
async function parse(blob,name,chunkSize){context.file=file(blob,name);context.options={chunkSize,yieldEvery:0};return vm.runInContext('parseDataFlashFile(file,()=>{},options)',context);}
const plain=value=>JSON.parse(JSON.stringify(value));
(async()=>{
 const first=fmt(42,'TEST','Qaf','TimeUS,Samples,Value'),changed=fmt(42,'TEST','Qq','TimeUS,Counter');
 const records=Array.from({length:211},(_,i)=>{const b=Buffer.alloc(79);b.set([0xa3,0x95,42]);b.writeBigUInt64LE(BigInt(i)*1000000n,3);for(let j=0;j<32;j++)b.writeInt16LE((i+j)%7===0?-300:i+j,11+j*2);b.writeFloatLE(i===97?12345.25:-i/3,75);return b;});
 const tail=Buffer.alloc(19);tail.set([0xa3,0x95,42]);tail.writeBigUInt64LE(9007199254740993n,11);
 const bytes=Buffer.concat([first,...records,changed,tail]);context.bytes=new Uint8Array(bytes);
 const expected=plain(vm.runInContext('parseDataFlashBinary(bytes)',context));
 for(const chunkSize of [1,17,88,89,127,1024,8*1024*1024]){
  const actual=await parse(new Blob([bytes]),'boundary.bin',chunkSize);
  assert.deepEqual(plain(actual.tables),expected.tables,'every field / array / schema / unsafe integer matches at chunk size '+chunkSize);
  assert.equal(actual.totalPackets,expected.totalPackets);
  for(const rows of Object.values(actual.tables))assert.equal(rows._packed.backend.storageBytes,rows.length*4,'packet indexes retain no unused capacity');
  actual.releaseRawBytes();assert.equal(actual.retainedBytes,0);
  assert.throws(()=>actual.tables.TEST[0].TimeUS,/원본 파일/);
  await Promise.all([actual.ensureLoaded(),actual.ensureLoaded()]);assert.equal(actual.retainedBytes,bytes.length);
  assert.deepEqual(plain(actual.tables),expected.tables,'reloading preserves every field across chunk boundaries');
 }
 const text=fs.readFileSync('tests/fixtures/synthetic-instances.log','utf8');context.text=text;
 const legacy=plain(vm.runInContext('parseDataFlashTextLog(text)',context));
 const textParsed=await parse(new Blob([text]),'instances.log',31);
 assert.deepEqual(plain(textParsed.tables),legacy.tables,'streaming text preserves all records');
 context.packed=textParsed;
 const analysis=vm.runInContext('analyzeParsedLog(packed,appState.config)',context);
 assert.ok(analysis.timeline.length);
 const packed=vm.runInContext('createColumnRows()',context);packed.push({sec:1,x:NaN,z:null,s:'한글',large:9007199254740991});packed.push({sec:2,x:-0,z:2,s:'한글'});
 assert.ok(Number.isNaN(packed[0].x));assert.ok(Object.is(packed[1].x,-0));assert.equal(packed[0].z,null);assert.equal(packed[0].large,9007199254740991);packed[1].s='updated';assert.equal(packed.at(-1).s,'updated');
 assert.equal(packed.filter(r=>r.sec>1).length,1);assert.equal(packed.slice(1)[0].sec,2);assert.ok(packed.filter(()=>true).includes(packed[0]));
 packed._packed.backend.compact();packed.push({sec:3,x:42,s:'after compact'});assert.equal(packed[2].x,42);assert.equal(packed[1].s,'updated');assert.equal(packed[2].s,'after compact');
 console.log('PASS: lossless BIN chunk boundaries, arrays, schema changes, 64-bit values, UTF-8 text, packed analysis and row views');
 const realAt=process.argv.indexOf('--real');
 if(realAt>=0){
  const path=process.argv[realAt+1],bytes=fs.readFileSync(path);context.realBytes=new Uint8Array(bytes);
  const old=vm.runInContext('parseDataFlashBinary(realBytes)',context),blob=await fs.openAsBlob(path),current=await parse(blob,'real.bin',8*1024*1024);
  let packets=0,fields=0;
  for(const [name,rows] of Object.entries(old.tables)){
   assert.equal(current.tables[name].length,rows.length,name+' packet count');
   for(let i=0;i<rows.length;i++){const actual=current.tables[name][i];for(const key of Object.keys(rows[i])){const value=actual[key],expected=rows[i][key];if(Array.isArray(expected))assert.deepEqual(plain(value),plain(expected),name+'.'+key);else assert.ok(Object.is(value,expected),name+'.'+key+' row '+i);fields++;}packets++;}
  }
  context.oldReal=old;context.newReal=current;
  const oldA=vm.runInContext('analyzeParsedLog(oldReal,appState.config)',context),newA=vm.runInContext('analyzeParsedLog(newReal,appState.config)',context);
  assert.equal(oldA.timeline.length,newA.timeline.length);
  for(let i=0;i<oldA.timeline.length;i++)assert.deepEqual(plain(newA.timeline[i]),plain(oldA.timeline[i]),'derived timeline '+i);
  assert.deepEqual(plain(newA.sorties),plain(oldA.sorties));assert.deepEqual(plain(newA.diagnostics),plain(oldA.diagnostics));
  const indexes=Object.values(current.tables),previousBytes=indexes.reduce((n,rows)=>n+Math.ceil(rows.length/65536)*65536*4,0),currentBytes=indexes.reduce((n,rows)=>n+rows._packed.backend.storageBytes,0);
  console.log('Packet index allocation:',JSON.stringify({previousBytes,currentBytes,savedBytes:previousBytes-currentBytes}));
  current.releaseRawBytes();assert.equal(current.retainedBytes,0);await current.ensureLoaded();
  assert.deepEqual(plain(current.tables),plain(old.tables),'real BIN complete original restored after cache eviction');
  console.log('PASS: real BIN every packet and field, complete derived timeline, sorties and diagnostics identical',JSON.stringify({packets,fields,timeline:newA.timeline.length}));
 }
 if(process.argv.includes('--stress')){
  fs.mkdirSync('artifacts',{recursive:true});const path='artifacts/large-parser-805MiB.bin',header=fmt(42,'TEST','Qaf','TimeUS,Samples,Value');
  const batchCount=8192,batch=Buffer.alloc(79*batchCount);
  for(let i=0;i<batchCount;i++){const offset=i*79;batch.set([0xa3,0x95,42],offset);batch.writeBigUInt64LE(BigInt(i)*1000n,offset+3);batch.writeInt16LE(-32768,offset+11);batch.writeInt16LE(32767,offset+73);batch.writeFloatLE(i===4321?98765.25:i/2,offset+75);}
  const batches=Math.ceil(805*1024*1024/batch.length),fd=fs.openSync(path,'w');fs.writeSync(fd,header);for(let i=0;i<batches;i++){for(let j=0;j<batchCount;j++)batch.writeBigUInt64LE(BigInt(i*batchCount+j)*1000n,j*79+3);fs.writeSync(fd,batch);}fs.closeSync(fd);
  const blob=await fs.openAsBlob(path),start=Date.now(),large=await parse(blob,'large.bin',8*1024*1024),rows=large.tables.TEST;
  assert.equal(rows.length,batches*batchCount);assert.equal(large.totalPackets,rows.length+1);
  for(const i of [0,4321,batchCount-1,batchCount,batchCount*127+4321,rows.length-1]){const r=rows[i],j=i%batchCount;assert.equal(r.TimeUS,i*1000);assert.equal(r.Samples[0],-32768);assert.equal(r.Samples[31],32767);assert.equal(r.Value,j===4321?98765.25:j/2);}
  if(process.argv.includes('--plot')){
   context.large=large;
   vm.runInContext('appState.parsedLog=large;appState.analysis={minSec:0,maxSec:large.tables.TEST.length/1000};appState.zoomWindow=null;var stressPlot=buildCustomFieldConfig(["TEST.Value"],true);normalizePlotDatasets(stressPlot.datasets);',context);
   const plot=vm.runInContext('stressPlot',context);assert.equal(plot.datasets[0].statistics.max,98765.25);assert.ok(plot.datasets[0].data.length<2500);assert.equal(rows.length,batches*batchCount,'rendering never removes raw packets');
   console.log('PASS: 10 million record custom field chart retains exact statistics and raw records');
  }
  const report={bytes:blob.size,packets:large.totalPackets,elapsedSeconds:(Date.now()-start)/1000,memory:process.memoryUsage(),heapLimitMb:require('node:v8').getHeapStatistics().heap_size_limit/1024/1024};
  fs.writeFileSync('artifacts/large-parser-stress.json',JSON.stringify(report,null,2));console.log('PASS: >800MB all packets preserved',JSON.stringify(report));
 }
 if(process.argv.includes('--reload-stress')){
  const blob=await fs.openAsBlob('artifacts/large-parser-805MiB.bin'),large=await parse(blob,'large.bin',8*1024*1024);
  assert.equal(large.totalPackets,10690561);assert.equal(large.retainedBytes,blob.size);
  for(let cycle=0;cycle<3;cycle++){
   large.releaseRawBytes();assert.equal(large.retainedBytes,0);await large.ensureLoaded();
   assert.equal(large.retainedBytes,blob.size);assert.equal(large.tables.TEST[4321].Value,98765.25);assert.equal(large.tables.TEST.at(-1).TimeUS,(large.tables.TEST.length-1)*1000);
  }
  large.releaseRawBytes();assert.equal(large.retainedBytes,0);
  console.log('PASS: 844,554,329-byte BIN / 10,690,561 packets, three full cache eviction/reload cycles');
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
