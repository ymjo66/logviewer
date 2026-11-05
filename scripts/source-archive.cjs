// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function main(){
 const version=require('../package.json').version,archive=path.join(root,`dist/LogViewer-${version}-source.zip`);
 fs.mkdirSync('artifacts/upstream',{recursive:true});fs.mkdirSync('dist',{recursive:true});
 const sources=[['Chart.js-4.4.1-source.tar.gz','https://codeload.github.com/chartjs/Chart.js/tar.gz/refs/tags/v4.4.1','53eb9a1f0a0f0b3381c12457a4e4678454554308903d86ec82a31038b9f763d5'],['color-0.3.2-source.tar.gz','https://codeload.github.com/kurkle/color/tar.gz/refs/tags/v0.3.2','6da9eb120d2a435562438dd72e5f07248404c98fadfcfe35da2938ec44c4b241']];
 const info={version,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),upstream:[]};
 for(const [name,url,expected] of sources){const file='artifacts/upstream/'+name;if(!fs.existsSync(file)){const response=await fetch(url);if(!response.ok)throw Error('Source download HTTP '+response.status);fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));}const digest=hash(fs.readFileSync(file));if(digest!==expected)throw Error('Upstream source checksum mismatch: '+name);info.upstream.push({file:name,url,sha256:digest});}
 fs.writeFileSync('artifacts/upstream/SOURCE-MANIFEST.json',JSON.stringify(info,null,2));
 execFileSync('git',['archive','--format=zip','--output='+archive,'HEAD'],{stdio:'inherit',windowsHide:true});
 const q=s=>"'"+s.replace(/'/g,"''")+"'";
 const commands=["Add-Type -AssemblyName System.IO.Compression.FileSystem",`$z=[System.IO.Compression.ZipFile]::Open(${q(archive)},'Update')`];
 for(const name of [...sources.map(s=>s[0]),'SOURCE-MANIFEST.json'])commands.push(`[System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,${q(path.join(root,'artifacts/upstream',name))},${q('third_party/'+name)}) | Out-Null`);
 commands.push('$z.Dispose()');execFileSync('powershell.exe',['-NoProfile','-Command',commands.join(';')],{stdio:'inherit',windowsHide:true});
 const files=['LogViewer.html','LogViewer.exe','THIRD_PARTY_NOTICES.txt',path.basename(archive)];
 fs.writeFileSync('dist/SHA256SUMS.txt',files.map(name=>hash(fs.readFileSync('dist/'+name))+'  '+name).join('\n')+'\n');
 console.log('Created source archive for '+info.commit+' with upstream preferred sources.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
