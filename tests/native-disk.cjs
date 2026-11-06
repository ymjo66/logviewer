// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),readline=require('node:readline'),path=require('node:path'),{spawnSync}=require('node:child_process');
const html=fs.readFileSync('index.html','utf8'),scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
const context=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,TextDecoder,Uint8Array,DataView,ArrayBuffer,Blob,window:{addEventListener(){}},document:{},Chart:{register(){}}});
vm.runInContext(scripts.find(s=>s.includes('function detectBatteryCells')),context);vm.runInContext(scripts.find(s=>s.includes('function analyzeParsedLog')),context);
const decode=(key,v)=>{if(v&&typeof v==='object'){if(v.$float64)return Buffer.from(v.$float64,'base64').readDoubleLE();if('$literal'in v){const n=Number(v.$literal);return Number.isFinite(n)&&(!['q','Q'].includes(v.$format)||Number.isSafeInteger(n))?n:v.$literal;}if(v.$number)return {'NaN':NaN,'Infinity':Infinity,'-Infinity':-Infinity,'-0':-0}[v.$number];}return v;};
fs.mkdirSync('artifacts',{recursive:true});
const protection=spawnSync(path.resolve(process.env.LOGVIEWER_TEST_EXE||'dist/LogViewer.exe'),['--disk-source-test','artifacts/native-source-protection.json'],{windowsHide:true,encoding:'utf8',timeout:30000});assert.equal(protection.status,0,protection.stderr);
for(const value of Object.values(JSON.parse(fs.readFileSync('artifacts/native-source-protection.json','utf8').replace(/^\uFEFF/,''))))assert.equal(value,true);
console.log('PASS: direct source reading without copy, write/delete lock, release unlock, source bytes and cache cleanup');
async function verify(input){
 const name=path.basename(input),report='artifacts/native-verify-'+name+'.json';
 const result=spawnSync(path.resolve(process.env.LOGVIEWER_TEST_EXE||'dist/LogViewer.exe'),['--disk-dump',input,report],{windowsHide:true,encoding:'utf8',timeout:240000});assert.equal(result.status,0,result.stderr);
 const info=JSON.parse(fs.readFileSync(report,'utf8').replace(/^\uFEFF/,''),decode);
 const raw=fs.readFileSync(input);context.raw=new Uint8Array(raw);context.text=raw.toString('utf8');
 const legacy=vm.runInContext(/\.log$/i.test(input)?'parseDataFlashTextLog(text)':'parseDataFlashBinary(raw)',context),counts={};
 assert.equal(info.metadata.totalPackets,legacy.totalPackets,'total packet count');
 let fields=0;
 const reader=readline.createInterface({input:fs.createReadStream(report+'.rows'),crlfDelay:Infinity});
 for await(const line of reader){const page=JSON.parse(line,decode);for(let i=0;i<page.rows.length;i++){
   const expected=legacy.tables[page.table][page.start+i],actual=page.rows[i];assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());
   for(const key of Object.keys(expected)){const value=expected[key];if(Array.isArray(value))assert.deepEqual(actual[key],Array.from(value),page.table+'.'+key);else assert.ok(Object.is(actual[key],value),`${name} ${page.table}[${page.start+i}].${key}: ${actual[key]} != ${value}`);fields++;}
 }counts[page.table]=(counts[page.table]||0)+page.rows.length;}
 for(const [name,rows] of Object.entries(legacy.tables))assert.equal(counts[name]||0,rows.length,'every row in '+name);
 context.catalogParsed=legacy;assert.deepEqual(info.catalog,JSON.parse(JSON.stringify(vm.runInContext('buildFieldCatalog(catalogParsed)',context))),'field catalog and all sensor instances');
 for(const [field,curves] of Object.entries(info.plots)){
  const [message,column]=field.split('.');let min=Infinity,max=-Infinity,sum=0,count=0;
  for(const row of legacy.tables[message])if(Number.isFinite(row.TimeUS)&&Number.isFinite(row[column])){min=Math.min(min,row[column]);max=Math.max(max,row[column]);sum+=row[column];count++;}
  assert.equal(curves.length,1);assert.equal(curves[0].count,count);assert.equal(curves[0].statistics.min,min);assert.equal(curves[0].statistics.max,max);assert.equal(curves[0].statistics.mean,sum/count);assert.ok(curves[0].data.length<=3000);
 }
 assert.equal(info.atomicAnalysis,true);
 for(const [field,curves] of Object.entries(info.ranges)){
  const [message,column]=field.split('.'), values=Array.from(legacy.tables[message]).filter(row=>Number.isFinite(row.TimeUS)&&row.TimeUS>=0&&row.TimeUS<=2e6&&Number.isFinite(row[column])).map(row=>row[column]);
  if(!values.length){assert.ok(curves.every(curve=>curve.count===0));continue;}
  assert.equal(curves.length,1);assert.equal(curves[0].count,values.length);assert.equal(curves[0].statistics.min,Math.min(...values));assert.equal(curves[0].statistics.max,Math.max(...values));assert.equal(curves[0].statistics.mean,values.reduce((sum,n)=>sum+n,0)/values.length);
 }
 console.log('PASS: native disk parser every packet/field',JSON.stringify({name,rows:info.rows,fields,managedBytes:info.managedBytes}));
}
function edgeFixture(){
 const format=(id,name,types,columns)=>{const sizes={Q:8,q:8,a:64,f:4};const b=Buffer.alloc(89);b.set([0xa3,0x95,128,id,3+[...types].reduce((n,type)=>n+sizes[type],0)]);b.write(name,5);b.write(types,9);b.write(columns,25);return b;};
 const chunks=[Buffer.alloc(4*1024*1024-45,0xff),format(42,'TEST','QafqQ','TimeUS,Samples,Value,Big,UBig')];
 for(const [i,value] of [-0,1.25,-2.5,NaN,Infinity,98765.25].entries()){
  const b=Buffer.alloc(95);b.set([0xa3,0x95,42]);b.writeBigUInt64LE(BigInt(i)*1000000n,3);for(let j=0;j<32;j++)b.writeInt16LE(j===0?-32768:j===31?32767:j,11+j*2);b.writeFloatLE(value,75);b.writeBigInt64LE(-9007199254740993n,79);b.writeBigUInt64LE(18446744073709551615n,87);chunks.push(b);
 }
 chunks.push(format(42,'TEST','Qq','TimeUS,Counter'));const last=Buffer.alloc(19);last.set([0xa3,0x95,42]);last.writeBigUInt64LE(10000000n,3);last.writeBigInt64LE(9007199254740993n,11);chunks.push(last);
 const file='artifacts/native-edge.bin';fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync(file,Buffer.concat(chunks));return file;
}
(async()=>{for(const input of process.argv.slice(2).length?process.argv.slice(2):['tests/fixtures/synthetic-flight.log','tests/fixtures/synthetic-instances.log',edgeFixture()])await verify(input);})().catch(e=>{console.error(e);process.exitCode=1;});
