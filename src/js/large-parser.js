// SPDX-License-Identifier: GPL-3.0-only
// Lossless chunked file ingestion. No packet stride, sampling or field exclusion.
function binaryField(store,offset,type) {
  const size=FORMAT_SIZES[type],block=Math.floor(offset/store.chunkSize);
  let at=offset%store.chunkSize,dv=store.views[block];
  if(at+size>dv.byteLength){const bytes=store.bytes(offset,size);dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);at=0;}
  switch(type){
    case 'b':return dv.getInt8(at);case 'B':case 'M':return dv.getUint8(at);
    case 'h':return dv.getInt16(at,true);case 'H':return dv.getUint16(at,true);
    case 'c':return dv.getInt16(at,true)/100;case 'C':return dv.getUint16(at,true)/100;
    case 'i':return dv.getInt32(at,true);case 'I':return dv.getUint32(at,true);
    case 'e':return dv.getInt32(at,true)/100;case 'E':return dv.getUint32(at,true)/100;
    case 'L':return dv.getInt32(at,true)*1e-7;case 'f':return dv.getFloat32(at,true);case 'd':return dv.getFloat64(at,true);
    case 'q':case 'Q':{const high=type==='q'?dv.getInt32(at+4,true):dv.getUint32(at+4,true),n=high*4294967296+dv.getUint32(at,true);if(Number.isSafeInteger(n))return n;return String(type==='q'?dv.getBigInt64(at,true):dv.getBigUint64(at,true));}
    case 'a':return Array.from({length:32},(_,i)=>dv.getInt16(at+i*2,true));
    case 'n':case 'N':case 'Z':return readCleanAscii(store.bytes(offset,size),0,size);
    default:return 0;
  }
}
function createBinaryTable(store,fileSize) {
  const BLOCK=65536,offsets=[],definitions=[];let cachedIndex=-1,cachedPosition,cachedSchema;
  const backend={length:0,
    addSchema(schema){definitions.push(schema);},
    schema(i){const position=offsets[Math.floor(i/BLOCK)][i%BLOCK];let lo=0,hi=definitions.length-1;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(definitions[mid].start<=position)lo=mid;else hi=mid-1;}return {position,schema:definitions[lo]};},
    keys(i){return this.schema(i).schema.fields.map(f=>f.name);},
    get(i,key){if(typeof key!=='string')return undefined;if(i!==cachedIndex){cachedPosition=offsets[Math.floor(i/BLOCK)][i%BLOCK];cachedSchema=definitions.length===1?definitions[0]:this.schema(i).schema;cachedIndex=i;}const field=cachedSchema.byName.get(key);return field?binaryField(store,cachedPosition+field.offset,field.type):undefined;},
    set(){throw Error('Raw log records are read-only');},
    append(position){const i=this.length++,b=Math.floor(i/BLOCK);if(!offsets[b])offsets[b]=fileSize>0xffffffff?new Float64Array(BLOCK):new Uint32Array(BLOCK);offsets[b][i%BLOCK]=position;}
  };
  return packedRows(backend);
}

async function parseDataFlashFile(file,onProgress=()=>{},options={}) {
  const chunkSize=options.chunkSize||8*1024*1024;
  if(/\.log$/i.test(file.name))return parseTextFileChunks(file,onProgress,chunkSize);
  const chunks=[],views=[],tables={},rawCounts={},definitions=[],active={};
  const store={chunkSize,views,bytes(position,size){const block=Math.floor(position/chunkSize),at=position%chunkSize;
    if(at+size<=chunks[block].length)return chunks[block].subarray(at,at+size);
    const out=new Uint8Array(size);for(let j=0;j<size;j++)out[j]=chunks[Math.floor((position+j)/chunkSize)][(position+j)%chunkSize];return out;
  }};
  let carry=new Uint8Array(0),totalPackets=0;
  const fmt={typeId:128,length:89,name:'FMT',format:'BBnNZ',columns:['Type','Length','Name','Format','Columns'],count:0};
  for(let start=0;start<file.size;start+=chunkSize){
    const bytes=new Uint8Array(await file.slice(start,Math.min(file.size,start+chunkSize)).arrayBuffer());chunks.push(bytes);views.push(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength));
    let scan=bytes;if(carry.length){scan=new Uint8Array(carry.length+bytes.length);scan.set(carry);scan.set(bytes,carry.length);}
    const base=start-carry.length;let p=0;
    while(p+3<=scan.length){
      if(scan[p]!==0xa3||scan[p+1]!==0x95){p++;continue;}
      const type=scan[p+2];
      if(type===128){
        if(p+89>scan.length)break;
        const id=scan[p+3],name=readCleanAscii(scan,p+5,4),format=readCleanAscii(scan,p+9,16),columns=readCleanAscii(scan,p+25,64).split(',').map(s=>s.trim()),size=calcFormatPayloadSize(format);
        if(!/^[A-Za-z0-9_]{1,4}$/.test(name)||size<0||(scan[p+4]!==size+3&&name!=='FMT')){p+=2;continue;}
        const fields=[];let fieldOffset=3;for(let i=0;i<format.length;i++){fields.push({name:columns[i]||'F'+i,type:format[i],offset:fieldOffset});fieldOffset+=FORMAT_SIZES[format[i]];}
        const schema={typeId:id,length:size+3,name,format,columns,count:0,start:base+p,fields,byName:new Map(fields.map(f=>[f.name,f]))};
        active[id]=schema;definitions.push(schema);if(!tables[name])tables[name]=createBinaryTable(store,file.size);
        tables[name]._packed.backend.addSchema(schema);rawCounts[name]??=0;fmt.count++;totalPackets++;p+=89;continue;
      }
      const schema=active[type];if(!schema||schema.length<3){p+=2;continue;}
      if(p+schema.length>scan.length)break;
      tables[schema.name]._packed.backend.append(base+p);schema.count++;rawCounts[schema.name]++;totalPackets++;p+=schema.length;
    }
    carry=scan.slice(p);onProgress(Math.min(1,(start+bytes.length)/file.size),'원본 패킷 색인');
    if(options.yieldEvery!==0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  const fmtList=[fmt,...definitions].filter((f,i,all)=>all.findIndex(s=>s.name===f.name&&s.format===f.format&&s.columns.join(',')===f.columns.join(','))===i);
  return {fileName:file.name,byteLength:file.size,totalPackets,fmtList,tables,rawCounts,storage:'lossless-packed',retainedBytes:file.size};
}

async function parseTextFileChunks(file,onProgress,chunkSize) {
  const decoder=new TextDecoder(),tables={},fmtList=[],active={},rawCounts={};let carry='',totalPackets=0;
  function line(text){const parts=text.trim().split(',').map(s=>s.trim()),name=parts[0];if(!name)return;
    if(name==='FMT'&&parts.length>=6){const schema={typeId:parseInt(parts[1],10)||0,length:parseInt(parts[2],10)||0,name:parts[3],format:parts[4],columns:parts.slice(5),count:0};active[schema.name]=schema;fmtList.push(schema);tables[schema.name]??=createColumnRows();totalPackets++;return;}
    const schema=active[name];if(!schema)return;const row={};
    for(let i=0;i<schema.columns.length&&i+1<parts.length;i++){const type=schema.format[i]||'f',value=parts[i+1],n=Number(value);row[schema.columns[i]]=/^[nNZ]$/.test(type)?value:(type==='q'||type==='Q')&&!Number.isSafeInteger(n)?value:Number.isFinite(n)?n:value;}
    tables[name].push(row);schema.count++;rawCounts[name]=(rawCounts[name]||0)+1;totalPackets++;
  }
  for(let start=0;start<file.size;start+=chunkSize){
    const bytes=await file.slice(start,Math.min(file.size,start+chunkSize)).arrayBuffer();
    const text=carry+decoder.decode(bytes,{stream:true});let first=0,next;
    while((next=text.indexOf('\n',first))>=0){line(text.slice(first,next));first=next+1;}
    carry=text.slice(first);onProgress(Math.min(1,(start+bytes.byteLength)/file.size),'전체 텍스트 패킷 해석');await new Promise(resolve=>setTimeout(resolve,0));
  }
  carry+=decoder.decode();if(carry)line(carry);
  return {fileName:file.name,byteLength:file.size,totalPackets,fmtList,tables,rawCounts,storage:'lossless-packed'};
}
