const http=require('node:http'),fs=require('node:fs'),path=require('node:path');const {build}=require('./build.cjs');
const root=path.resolve(__dirname,'..');let timer;build();
fs.watch(path.join(root,'src'),{recursive:true},()=>{clearTimeout(timer);timer=setTimeout(()=>{try{build();}catch(e){console.error(e.message);}},150);});
http.createServer((req,res)=>{if(req.url!=='/'&&req.url!=='/index.html'){res.writeHead(404);return res.end();}res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(path.join(root,'index.html')));}).listen(8767,'127.0.0.1',()=>console.log('http://127.0.0.1:8767 — save src files to rebuild, refresh browser to apply'));
