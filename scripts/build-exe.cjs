// SPDX-License-Identifier: GPL-3.0-only
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');process.chdir(root);
async function main(){
 if(process.platform!=='win32')throw Error('EXE build requires Windows. HTML builds work on Windows/Linux.');
 require('./build.cjs').build();
 require('./build-icon.cjs');
 const version=require('../package.json').version,sdkVersion='1.0.4314.35',sdk=path.join(root,'artifacts/webview2/sdk');
 if(!fs.existsSync(path.join(sdk,'lib/net462/Microsoft.Web.WebView2.Core.dll'))){
  fs.mkdirSync(path.dirname(sdk),{recursive:true});
  const response=await fetch(`https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${sdkVersion}/microsoft.web.webview2.${sdkVersion}.nupkg`);
  if(!response.ok)throw Error('WebView2 SDK download: HTTP '+response.status);
  const zip=path.join(root,'artifacts/webview2/package.zip');fs.writeFileSync(zip,Buffer.from(await response.arrayBuffer()));
  // Built-in Windows archive extraction; no execution policy changes or script files.
  const quote=s=>"'"+s.replace(/'/g,"''")+"'";
  execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath ${quote(zip)} -DestinationPath ${quote(sdk)} -Force`],{stdio:'inherit',windowsHide:true});
 }
 fs.writeFileSync('artifacts/Version.cs',`[assembly: System.Reflection.AssemblyVersion("${version}.0")]\n[assembly: System.Reflection.AssemblyFileVersion("${version}.0")]\nnamespace LogViewer { internal static class BuildInfo { internal const string Utc = "${new Date().toISOString()}"; } }\n`);
 const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 const exeName=process.env.LOGVIEWER_EXE_NAME||'LogViewer.exe';
 if(!/^LogViewer(?:-[a-z0-9]+)?\.exe$/i.test(exeName))throw Error('Invalid EXE output name');
 const args=['/nologo','/target:winexe','/platform:x64','/optimize+','/win32icon:assets\\LogViewer.ico','/out:dist\\'+exeName,
  ...['System.Windows.Forms.dll','System.Drawing.dll','System.Net.Http.dll','System.Web.Extensions.dll'].map(s=>'/reference:'+s),
  ...['Core','WinForms'].map(s=>'/reference:'+path.join(sdk,`lib/net462/Microsoft.Web.WebView2.${s}.dll`)),
  '/resource:dist\\LogViewer.html,ViewerHtml',
  '/resource:tests\\desktop-browser-smoke.js,BrowserSmokeTest',
  '/resource:assets\\LogViewer.ico,ViewerIcon',
  ...['Core','WinForms'].map(s=>'/resource:'+path.join(sdk,`lib/net462/Microsoft.Web.WebView2.${s}.dll`)+`,Microsoft.Web.WebView2.${s}.dll`),
  '/resource:'+path.join(sdk,'runtimes/win-x64/native/WebView2Loader.dll')+',WebView2Loader.dll',
  'desktop\\Program.cs','artifacts\\Version.cs'];
 execFileSync(csc,args,{stdio:'inherit',windowsHide:true});
 fs.copyFileSync('assets/LogViewer.ico','dist/LogViewer.ico');
 const names=['LogViewer.html',exeName,'LogViewer.ico','THIRD_PARTY_NOTICES.txt'];
 fs.writeFileSync('dist/SHA256SUMS.txt',names.map(n=>crypto.createHash('sha256').update(fs.readFileSync('dist/'+n)).digest('hex')+'  '+n).join('\n')+'\n');
 console.log('Built Windows x64 EXE, offline HTML and checksums.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

