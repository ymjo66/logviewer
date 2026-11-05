// SPDX-License-Identifier: GPL-3.0-only
window.addEventListener('DOMContentLoaded',()=>queueMicrotask(()=>{
  if(!window.chrome?.webview)return;
  document.body.classList.add('desktop-shell');
  const host=window.chrome.webview,header=document.querySelector('header'),bar=header.firstElementChild;
  const updateInfo=document.createElement('p');updateInfo.id='desktopUpdateStatus';
  updateInfo.style.cssText='margin:12px 0;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#334155';
  updateInfo.textContent='자동 업데이트 상태 확인 중';
  const licenseDialog=document.getElementById('licenseDialog');licenseDialog.querySelector('h2').after(updateInfo);
  host.addEventListener('message',e=>{if(e.data?.type!=='updateStatus')return;updateInfo.textContent=`버전 ${e.data.version} · ${e.data.message}`;document.getElementById('btnLicenses').title=updateInfo.textContent;});
  host.postMessage('ready');
  const controls=document.createElement('div');controls.className='desktop-window-controls';
  for(const [command,label,path] of [['minimize','최소화','M3 8h10'],['maximize','최대화 / 복원','M3 3h10v10H3z'],['close','닫기','M3 3l10 10M13 3L3 13']]){
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;
    button.innerHTML=`<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="square" aria-hidden="true"><path d="${path}"/></svg>`;
    button.addEventListener('click',()=>host.postMessage(command));controls.append(button);
  }
  const actions=document.createElement('div');actions.className='desktop-actions';
  actions.append(document.getElementById('btnOpenSettings'),controls);bar.append(actions);
  header.addEventListener('pointerdown',e=>{
    if(e.button!==0||e.target.closest('button,input,select,label,a,summary'))return;
    e.preventDefault();host.postMessage(e.detail===2?'maximize':'drag');
  });
  const style=document.createElement('style');style.textContent=`
    .desktop-shell header{user-select:none}
    .desktop-shell header>div{padding-right:0!important}
    .desktop-shell header>div>div:has(#btnOpenSettings){margin-left:auto}
    .desktop-actions{display:flex;align-items:center;align-self:stretch;gap:12px;margin-left:auto}
    .desktop-window-controls{display:flex;align-self:stretch;align-items:center;flex-shrink:0;margin-left:12px}
    .desktop-window-controls button{display:grid;place-items:center;width:44px;height:40px;padding:0;border:0;border-radius:0;background:transparent;color:#364152;line-height:1;cursor:default}
    .desktop-window-controls svg{display:block;width:16px;height:16px;flex-shrink:0}
    .desktop-window-controls button:hover{background:#dce2e9}
    .desktop-window-controls button:last-child:hover{background:#c42b1c;color:white}
  `;document.head.append(style);
}));
