// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),{spawnSync,execFileSync}=require('node:child_process');
const version=require('../package.json').version,tag='v'+version,repo='ymjo66/logviewer';
async function main(){
 let token=process.env.GH_TOKEN||process.env.GITHUB_TOKEN;
 if(!token){const c=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',windowsHide:true});const fields=Object.fromEntries(c.stdout.trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));token=fields.password;}
 if(!token)throw Error('GitHub credentials unavailable');
 const headers={Authorization:'Bearer '+token,Accept:'application/vnd.github+json','User-Agent':'logviewer-release','X-GitHub-Api-Version':'2022-11-28'};
 async function api(route,method='GET',body){const r=await fetch('https://api.github.com/repos/'+repo+route,{method,headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(method+' '+route+' HTTP '+r.status);return r.status===204?null:r.json();}
 const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const probe=await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`,{headers});let release;
 if(probe.ok){release=await probe.json();if(!release.draft){console.log('Published release already exists: '+release.html_url);return;}}
 else if(probe.status===404)release=await api('/releases','POST',{tag_name:tag,target_commitish:commit,name:'Log Viewer '+version,draft:true,prerelease:false,body:fs.readFileSync('CHANGELOG.md','utf8')+'\n\nHTML: LogViewer.html\nWindows x64: LogViewer.exe\n아이콘: LogViewer.ico\n대응 소스: LogViewer-'+version+'-source.zip\n전체 패킷 보존 파서입니다. 원본은 축약하지 않습니다. 초고밀도 필드 계산 시간은 PC/로그에 따라 달라집니다.\nEXE는 새 정식 버전을 백그라운드에서 확인·다운로드하고 정상 종료할 때 적용합니다. 다음 실행부터 새 버전이 열립니다.'});
 else throw Error('Release lookup HTTP '+probe.status);
 const files=['LogViewer.html','LogViewer.exe','LogViewer.ico','THIRD_PARTY_NOTICES.txt',`LogViewer-${version}-source.zip`,'SHA256SUMS.txt'];
 for(const name of files){const local=fs.readFileSync('dist/'+name),old=release.assets.find(a=>a.name===name);if(old)await api('/releases/assets/'+old.id,'DELETE');const r=await fetch(release.upload_url.replace(/\{.*$/,'')+'?name='+encodeURIComponent(name),{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream'},body:local});if(!r.ok)throw Error('Upload '+name+' HTTP '+r.status);console.log('Uploaded '+name+' ('+local.length+' bytes)');}
 release=await api('/releases/'+release.id,'PATCH',{draft:false,make_latest:'true'});
 console.log('Published '+release.html_url+' at '+commit);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
