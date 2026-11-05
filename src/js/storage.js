// SPDX-License-Identifier: GPL-3.0-only
// Virtual arrays retain every record in packed storage, rather than millions of objects.
const PACKED_ROW_KEY = Symbol('packed-row');
function packedRows(backend, selection=null) {
  let selected=selection;
  const count=()=>selected?selected.length:backend.length;
  const physical=i=>selected?selected[i]:i;
  const row=i=>{
    const n=physical(i);
    return new Proxy({}, {
      get:(_,key)=>key===PACKED_ROW_KEY?{backend,index:n}:backend.get(n,key),
      set:(_,key,value)=>{backend.set(n,key,value);return true;},
      ownKeys:()=>backend.keys(n),
      getOwnPropertyDescriptor:(_,key)=>backend.keys(n).includes(key)?{enumerable:true,configurable:true}:undefined,
      has:(_,key)=>backend.keys(n).includes(key)
    });
  };
  const api={
    get _packed(){return {backend,selection:selected};},
    pointAt(i){return backend.point?backend.point(physical(i)):row(i);},
    at(i){i=i<0?count()+i:i;return i>=0&&i<count()?row(i):undefined;},
    push(value){if(selected)throw Error('Cannot append to filtered records');backend.append(value);return count();},
    filter(fn,thisArg){const indexes=new Uint32Array(count());let size=0;for(let i=0;i<count();i++)if(fn.call(thisArg,row(i),i,proxy))indexes[size++]=physical(i);return packedRows(backend,indexes.subarray(0,size));},
    slice(start=0,end=count()){const n=count();start=start<0?Math.max(0,n+start):Math.min(start,n);end=end<0?Math.max(0,n+end):Math.min(end,n);const ids=new Uint32Array(Math.max(0,end-start));for(let i=0;i<ids.length;i++)ids[i]=physical(start+i);return packedRows(backend,ids);},
    sort(fn){const ids=Uint32Array.from({length:count()},(_,i)=>physical(i));ids.sort((a,b)=>fn(packedRows(backend,new Uint32Array([a]))[0],packedRows(backend,new Uint32Array([b]))[0]));selected=ids;return proxy;},
    includes(value,from=0){const key=value&&value[PACKED_ROW_KEY];if(key&&key.backend===backend){for(let i=from;i<count();i++)if(physical(i)===key.index)return true;return false;}return false;},
    *[Symbol.iterator](){for(let i=0;i<count();i++)yield row(i);}
  };
  const proxy=new Proxy([],{
    get:(target,key)=>key==='length'?count():key in api?api[key]:typeof key==='string'&&/^\d+$/.test(key)?Number(key)<count()?row(Number(key)):undefined:Reflect.get(target,key),
    has:(target,key)=>typeof key==='string'&&/^\d+$/.test(key)?Number(key)<count():Reflect.has(target,key)
  });
  return proxy;
}

function createColumnRows(computed={}) {
  const BLOCK=8192,columns=new Map();
  const backend={length:0,
    keys(){return [...columns.keys(),...Object.keys(computed)];},
    get(i,key){if(computed[key])return computed[key](backend.get(i,'sec'));
      const col=columns.get(key),block=Math.floor(i/BLOCK),j=i%BLOCK;if(!col||!col.flags[block])return undefined;
      const kind=col.flags[block][j],value=col.values[block][j];return kind===1?value:kind===2?null:kind===3?col.strings[value]:kind===4?false:kind===5?true:undefined;
    },
    set(i,key,value){if(computed[key])return;
      if(!columns.has(key))columns.set(key,{values:[],flags:[],strings:[],intern:new Map()});
      const col=columns.get(key),b=Math.floor(i/BLOCK),j=i%BLOCK;
      if(!col.values[b]){col.values[b]=new Float64Array(BLOCK);col.flags[b]=new Uint8Array(BLOCK);}
      let kind=0,n=0;
      if(typeof value==='number'){kind=1;n=value;}else if(value===null)kind=2;else if(typeof value==='string'){kind=3;if(!col.intern.has(value)){col.intern.set(value,col.strings.length);col.strings.push(value);}n=col.intern.get(value);}else if(typeof value==='boolean')kind=value?5:4;
      else if(value!==undefined)throw Error('Unsupported packed value');
      col.values[b][j]=n;col.flags[b][j]=kind;
    },
    append(value){const i=this.length++;for(const key of Object.keys(value))this.set(i,key,value[key]);}
  };
  return packedRows(backend);
}

function mapPlotRows(rows,fn) {
  if(!rows._packed)return rows.map(fn);
  let previous=-1,value;
  const point=i=>{if(i!==previous){value=fn(rows[i],i);previous=i;}return value;};
  return packedRows({length:rows.length,keys:()=>['x','y'],point,get(i,key){return point(i)[key];},set(){throw Error('Plot view is read-only');}});
}
