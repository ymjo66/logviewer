// SPDX-License-Identifier: GPL-3.0-only
window.addEventListener('DOMContentLoaded',()=>queueMicrotask(()=>{
  if(!window.chrome?.webview)return;
  document.body.classList.add('desktop-shell');
  const host=window.chrome.webview,header=document.querySelector('header'),bar=header.firstElementChild;
  const controls=document.createElement('div');controls.className='desktop-window-controls';
  for(const [command,label,text] of [['minimize','최소화','─'],['maximize','최대화 / 복원','□'],['close','닫기','×']]){
    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',label);button.title=label;button.textContent=text;
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
    .desktop-window-controls{display:flex;align-self:stretch;align-items:stretch;flex-shrink:0;margin-left:12px}
    .desktop-window-controls button{width:42px;border:0;border-radius:0;background:transparent;color:#364152;font:20px Arial;cursor:default}
    .desktop-window-controls button:hover{background:#dce2e9}
    .desktop-window-controls button:last-child:hover{background:#c42b1c;color:white}
  `;document.head.append(style);
}));
