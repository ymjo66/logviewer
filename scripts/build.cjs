const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function build(){
 const cli=path.join(root,'node_modules/tailwindcss/lib/cli.js');
 if(!fs.existsSync(cli))throw Error('Run npm ci before building.');
 fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
 require('node:child_process').execFileSync(process.execPath,[cli,'-i','src/styles/tailwind.input.css','-o','artifacts/tailwind.css','--minify'],{cwd:root,stdio:'inherit'});
 const names=fs.readdirSync(path.join(root,'licenses')).sort();
 const notices='Log Viewer '+require('../package.json').version+'\nCopyright (C) 2026 ymjo66 and contributors\nApplication source: GPL v3, with additional permission for Microsoft runtime integration (COPYING.md). Third-party components retain their own licenses.\nSource and build instructions: https://github.com/ymjo66/logviewer\nNo warranty. See GPL-3.0.txt below.\n\n'+fs.readFileSync(path.join(root,'COPYING.md'),'utf8')+'\n\n'+names.map(name=>'===== '+name+' =====\n'+fs.readFileSync(path.join(root,'licenses',name),'utf8')).join('\n\n');
 const normalizedNotices=notices.replace(/\r\n/g,'\n');
 fs.writeFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),normalizedNotices);
 const template=fs.readFileSync(path.join(root,'src/index.template.html'),'utf8');
 const html=template.replace(/\{\{include:([^}]+)\}\}/g,(_,file)=>{
  const target=path.resolve(root,file);if(!target.startsWith(root+path.sep))throw Error('Invalid include');
  return fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n');
 }).replace('{{LICENSE_NOTICES}}',normalizedNotices.replace(/[ \t]+$/gm,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'));
 if(html.includes('{{include:'))throw Error('Unresolved include');
 for(const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
 if(/<script\b[^>]*\bsrc=/.test(html))throw Error('External script in standalone output');
 fs.mkdirSync(path.join(root,'dist'),{recursive:true});
 fs.copyFileSync(path.join(root,'THIRD_PARTY_NOTICES.txt'),path.join(root,'dist/THIRD_PARTY_NOTICES.txt'));
 for(const name of ['index.html','dist/LogViewer.html'])fs.writeFileSync(path.join(root,name),html);
 console.log('Built offline HTML ('+Buffer.byteLength(html)+' bytes)');return html;
}
if(require.main===module)build();module.exports={build};
