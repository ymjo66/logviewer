// BCL/BCL2 store cell voltages in mV. Total voltage alone cannot uniquely
// determine series count, especially for partially discharged packs.
function detectBatteryCells(manualCells, batteryRows, cellRows=[], extraCellRows=[]) {
  if(Number.isInteger(manualCells)&&manualCells>=1&&manualCells<=24)
    return {cells:manualCells,source:'수동 설정',candidates:[manualCells]};
  const instance=row=>row.Instance??row.Inst??row.I??0;
  const primary=batteryRows.length?instance(batteryRows[0]):(cellRows.length?instance(cellRows[0]):0);
  const counts=new Map();
  for(const row of cellRows.filter(r=>instance(r)===primary)) {
    const extra=extraCellRows.find(r=>instance(r)===primary&&Math.abs(r.TimeUS-row.TimeUS)<=1e6)||{};
    let count=0,sum=0,gap=false,invalid=false;
    for(let i=1;i<=14;i++) {
      const value=(i<=12?row:extra)['V'+i];
      if(value===undefined||value===0||value===65535) {gap=true;continue;}
      if(!Number.isFinite(value)||value<1500||value>5000||gap) {invalid=true;break;}
      count++;sum+=value/1000;
    }
    if(!invalid&&count>0&&(!row.Volt||Math.abs(sum-row.Volt)<=Math.max(0.5,row.Volt*0.08)))
      counts.set(count,(counts.get(count)||0)+1);
  }
  const ranked=Array.from(counts).sort((a,b)=>b[1]-a[1]);
  const votes=ranked.reduce((sum,pair)=>sum+pair[1],0);
  if(ranked.length&&ranked[0][1]>=3&&ranked[0][1]/votes>=0.8)
    return {cells:ranked[0][0],source:'셀별 전압 기록 (BCL)',candidates:[ranked[0][0]]};
  const voltages=batteryRows.map(r=>r.Volt).filter(v=>Number.isFinite(v)&&v>1.5);
  if(!voltages.length) return {cells:0,source:'전압 기록 없음',candidates:[]};
  const early=voltages.slice(0,30).sort((a,b)=>a-b);
  const reference=early[Math.floor((early.length-1)*0.8)];
  const candidates=[];
  for(let cells=1;cells<=24;cells++) if(reference/cells>=3.0&&reference/cells<=4.4) candidates.push(cells);
  if(candidates.length===1) return {cells:candidates[0],source:'전압 기반 추정 · 화학계/수동 설정 확인 필요',candidates};
  return {cells:0,source:candidates.length?'셀 수 미확정 · 후보 '+candidates.map(n=>n+'S').join('/')+' · 기준 설정에서 지정':'셀 수 미확정 · 기준 설정에서 지정',candidates};
}
