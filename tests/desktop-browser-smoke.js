// SPDX-License-Identifier: GPL-3.0-only
// Runs inside the built EXE's actual WebView2 page via --browser-self-test.
(async()=>{
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  try{
    check(!document.getElementById('native-disk-core'),'Legacy disk adapter is still embedded');
    check(document.body.classList.contains('desktop-shell'),'Desktop controls did not initialize');
    check(document.querySelectorAll('.desktop-window-controls button').length===3,'Missing window controls');
    const header=new Uint8Array(89);header.set([0xa3,0x95,128,42,19]);
    const ascii=(at,text)=>header.set(new TextEncoder().encode(text),at);
    ascii(5,'CTUN');ascii(9,'Qff');ascii(25,'TimeUS,Alt,ThO');
    const packets=Array.from({length:30},(_,i)=>{
      const bytes=new Uint8Array(19),view=new DataView(bytes.buffer);bytes.set([0xa3,0x95,42]);
      view.setBigUint64(3,BigInt(i)*1000000n,true);view.setFloat32(11,i>=5&&i<25?20:0,true);view.setFloat32(15,i>=5&&i<25?50:0,true);return bytes;
    });
    const files=new DataTransfer();
    for(const name of ['browser-1.bin','browser-2.bin'])files.items.add(new File([header,...packets],name));
    const input=document.getElementById('fileInput');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    await uploadQueue;
    check(appState.lastUploadReport.loaded===2&&appState.lastUploadReport.failures.length===0,'File input BIN upload failed');
    check(appState.logs.every(log=>!log.parsedLog.nativeId&&log.parsedLog.storage==='lossless-packed'),'EXE is not using the HTML parser');
    check(appState.parsedLog.tables.CTUN.length===30,'BIN packets lost');
    check(appState.logs.filter(log=>log.parsedLog.retainedBytes>0).length===1,'Inactive raw cache not released');
    await selectLogByIndex(1);
    check(appState.activeLogIndex===1&&appState.logs[0].parsedLog.retainedBytes===0,'Log switching failed');
    for(const log of appState.logs)check(buildFieldCatalog(log.parsedLog).some(entry=>entry.name==='CTUN'),'Inactive field catalog unavailable');
    appState.customFields=['CTUN.Alt'];renderTelemetryCharts();
    check(mainChart&&mainChart.data.datasets.length>0,'Raw field chart failed');
    const dropped=new DataTransfer();dropped.items.add(new File(['FMT,42,19,CTUN,Qff,TimeUS,Alt,ThO\nCTUN,0,0,0\nCTUN,1000000,10,50\nCTUN,2000000,0,0\n'],'browser-text.log'));
    window.dispatchEvent(new DragEvent('drop',{dataTransfer:dropped,bubbles:true,cancelable:true}));await uploadQueue;
    check(appState.logs.length===3&&appState.lastUploadReport.loaded===1,'Drag/drop LOG upload failed');
    check(appState.logs.every(log=>!log.parsedLog.nativeId),'Drag/drop used a native backend');
    const csv=buildSelectedCsv(appState.logs,'telemetry',['file','sec','autoRelAlt'],null);
    check(csv.includes('browser-1.bin')&&csv.includes('browser-2.bin')&&csv.includes('browser-text.log'),'CSV omitted logs');
    await queueLogTask(()=>reanalyzeAllLogs());
    check(appState.logs.every(log=>log.analysis.timeline.length>0),'Reanalysis failed');
    window.desktopSmokeResult={ok:true,backend:'html-browser',logs:appState.logs.length,fileInput:true,dragDrop:true,logSwitch:true,rawCacheRelease:true,fieldCatalog:true,charts:true,csv:true,reanalysis:true,windowControls:true};
  }catch(error){window.desktopSmokeResult={ok:false,error:error.stack||String(error)};}
})();
