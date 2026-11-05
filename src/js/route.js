    function createMapView(mode='2d') {return {mode,scale:1,x:0,y:0,azimuth:-0.6,elevation:0.65};}

    function orbitMapView(view,dx,dy) {
      view.azimuth=((view.azimuth??-.6)+dx*.008)%(Math.PI*2);
      view.elevation=Math.max(.12,Math.min(Math.PI/2-.025,(view.elevation??.65)+dy*.006));
    }

    function projectRoute3D(point,view,width,height,extent,targetZ=0) {
      const azimuth=view.azimuth??-.6,elevation=view.elevation??.65;
      const horizontal=point.x*Math.cos(azimuth)-point.y*Math.sin(azimuth);
      const depth=point.x*Math.sin(azimuth)+point.y*Math.cos(azimuth);
      const vertical=depth*Math.sin(elevation)-(point.z-targetZ)*Math.cos(elevation);
      const scale=Math.min(width,height)*.65/Math.max(20,extent)*(view.scale??1);
      return [width/2+horizontal*scale+(view.x||0),height*.55+vertical*scale+(view.y||0)];
    }

    function renderRoute3D(ctx,canvas,points,analysis) {
      const view=appState.mapView||createMapView('3d'),w=canvas.width,h=canvas.height;
      let minLat=Infinity,maxLat=-Infinity,minLng=Infinity,maxLng=-Infinity,minZ=0,maxZ=0;
      for(const p of points){minLat=Math.min(minLat,p.lat);maxLat=Math.max(maxLat,p.lat);minLng=Math.min(minLng,p.lng);maxLng=Math.max(maxLng,p.lng);minZ=Math.min(minZ,p.autoRelAlt||0);maxZ=Math.max(maxZ,p.autoRelAlt||0);}
      const lat=(minLat+maxLat)/2,lng=(minLng+maxLng)/2,cos=Math.cos(lat*Math.PI/180);
      const world=p=>({x:(p.lng-lng)*111320*cos,y:(p.lat-lat)*111320,z:Number.isFinite(p.autoRelAlt)?p.autoRelAlt:0});
      const extent=Math.max(20,(maxLng-minLng)*111320*cos,(maxLat-minLat)*111320,maxZ-minZ),targetZ=(minZ+maxZ)/2;
      const project=p=>projectRoute3D(p,view,w,h,extent,targetZ);
      const line=(a,b,color,width=1)=>{const p=project(a),q=project(b);ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.moveTo(...p);ctx.lineTo(...q);ctx.stroke();};
      const half=extent*.65,step=half/5;
      for(let i=-5;i<=5;i++){line({x:i*step,y:-half,z:0},{x:i*step,y:half,z:0},'#39424e');line({x:-half,y:i*step,z:0},{x:half,y:i*step,z:0},'#39424e');}
      const origin={x:-half,y:-half,z:0};
      for(const [p,label,color] of [[{x:-half+extent*.25,y:-half,z:0},'E','#7bbcff'],[{x:-half,y:-half+extent*.25,z:0},'N','#84d4ad'],[{x:-half,y:-half,z:extent*.25},'H','#e2e7ee']]){line(origin,p,color,1.5);const [x,y]=project(p);ctx.fillStyle=color;ctx.font='10px Arial';ctx.fillText(label,x+3,y-3);}
      const stride=Math.max(1,Math.ceil(points.length/2500));let previous=world(points[0]);
      for(let i=stride;i<points.length;i+=stride){const next=world(points[i]);line(previous,next,points[i].modeColor||'#38bdf8',2.3);previous=next;}
      line(previous,world(points.at(-1)),points.at(-1).modeColor||'#38bdf8',2.3);
      if(!analysis.groundOnly)for(const [sec,label,color] of [[analysis.takeoffSec,'이륙','#38bdf8'],[analysis.landingSec,'착륙','#a78bfa']]){
        const p=points.find(p=>p.sec>=sec)||points.at(-1);const [x,y]=project(world(p));ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();ctx.font='10px Arial';ctx.fillText(label,x+6,y-5);
      }
      const current=analysis.timeline[appState.scrubberIndex];
      if(current&&Number.isFinite(current.lat)&&Number.isFinite(current.lng)&&Math.abs(current.lat)<=90&&Math.abs(current.lng)<=180&&(current.lat!==0||current.lng!==0)){
        const p=world(current),xy=project(p);ctx.setLineDash([3,3]);line({...p,z:0},p,'#f6a7b7');ctx.setLineDash([]);
        const yaw=(current.yaw||0)*Math.PI/180,forward=project({x:p.x+Math.sin(yaw)*extent*.1,y:p.y+Math.cos(yaw)*extent*.1,z:p.z});
        ctx.save();ctx.translate(...xy);ctx.rotate(Math.atan2(forward[1]-xy[1],forward[0]-xy[0])+Math.PI/2);ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(6,7);ctx.lineTo(0,3);ctx.lineTo(-6,7);ctx.closePath();ctx.fillStyle='#f66c89';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.stroke();ctx.restore();
        ctx.fillStyle='#e2e7ee';ctx.font='10px Arial';ctx.fillText(p.z.toFixed(1)+' m',xy[0]+10,xy[1]+15);
      }
      ctx.fillStyle='#aeb9c9';ctx.font='10px Arial';ctx.fillText('3D 경로 · 고도(m)',10,h-10);
    }

    function renderGpsMap() {
      const canvas = document.getElementById('gpsMapCanvas');
      bindMapNavigation(canvas);
      if (!canvas) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(300, rect.width);
      canvas.height = Math.max(240, rect.height);
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const is3D=appState.mapView?.mode==='3d';
      for(const [id,selected] of [['btnMap2D',!is3D],['btnMap3D',is3D]])document.getElementById(id)?.setAttribute('aria-pressed',String(selected));
      canvas.title=is3D?'휠 클릭 드래그: 회전·각도 · 왼쪽 드래그: 이동 · 휠: 확대/축소 · 더블클릭: 원점':'왼쪽 드래그: 이동 · 휠: 확대/축소 · 더블클릭: 원점';

      ctx.fillStyle = '#1e2229';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = 'rgba(149, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      const step = 40;
      for (let x = 0; x < w; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let y = 0; y < h; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }

      const a = appState.analysis;
      if (!a || !a.timeline.length) return;
      const pts = a.timeline.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && (p.lat !== 0 || p.lng !== 0));
      if (!pts.length) {
        ctx.fillStyle = '#64748b';
        ctx.font = '13px sans-serif';
        ctx.fillText('유효한 GPS 위치 기록이 없습니다.', 20, 35);
        return;
      }
      if(is3D){ctx.fillStyle='#1e2229';ctx.fillRect(0,0,w,h);renderRoute3D(ctx,canvas,pts,a);return;}

      let minLat = 999, maxLat = -999, minLng = 999, maxLng = -999;
      for (const p of pts) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      }
      const latSpan = Math.max(0.0005, maxLat - minLat);
      const lngSpan = Math.max(0.0005, maxLng - minLng);
      const pad = 34;

      function toXY(lat, lng) {
        const cosLat = Math.max(0.01, Math.cos((minLat + maxLat) / 2 * Math.PI / 180));
        const fitScale = Math.min((w-pad*2)/(lngSpan*cosLat), (h-pad*2)/latSpan);
        const x = w/2 + (lng-(minLng+maxLng)/2)*cosLat*fitScale;
        const y = h/2 - (lat-(minLat+maxLat)/2)*fitScale;
        const view = appState.mapView || {scale:1,x:0,y:0};
        return [(x-w/2)*view.scale+w/2+view.x, (y-h/2)*view.scale+h/2+view.y];
      }

      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = toXY(pts[i - 1].lat, pts[i - 1].lng);
        const [x1, y1] = toXY(pts[i].lat, pts[i].lng);
        ctx.beginPath();
        ctx.strokeStyle = pts[i].modeColor || '#38bdf8';
        ctx.lineWidth = 2.4;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      const takeoffPt = a.groundOnly ? null : (pts.find(p => p.sec >= a.takeoffSec) || pts[0]);
      const landingPt = a.groundOnly ? null : (pts.find(p => p.sec >= a.landingSec) || pts[pts.length - 1]);

      if (takeoffPt) {
        const [tx, ty] = toXY(takeoffPt.lat, takeoffPt.lng);
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 10px "Inter", sans-serif';
        ctx.fillStyle = '#dbe2ec';
        ctx.fillText(`▲ 이륙 (${a.takeoffKst})`, tx + 9, ty - 4);
      }

      if (landingPt) {
        const [lx, ly] = toXY(landingPt.lat, landingPt.lng);
        ctx.fillStyle = a.isLogCutoff ? '#be123c' : '#4f46e5';
        ctx.beginPath();
        ctx.arc(lx, ly, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = 'bold 10px "Inter", sans-serif';
        ctx.fillStyle = a.isLogCutoff ? '#be123c' : '#dbe2ec';
        ctx.fillText(a.isLogCutoff ? `⚠️ 로그끊김 (${a.landingKst})` : `▼ 착륙 (${a.landingKst})`, lx + 9, ly + 12);
      }

      if (a.chartErrorMarkers && a.chartErrorMarkers.length > 0) {
        a.chartErrorMarkers.forEach(em => {
          if (!em.lat || !em.lng) return;
          const [ex, ey] = toXY(em.lat, em.lng);
          ctx.fillStyle = em.color || '#dc2626';
          ctx.beginPath();
          ctx.arc(ex, ey, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        });
      }

      const cur = a.timeline[appState.scrubberIndex];
      if (cur && pts.includes(cur)) {
        const [cx, cy] = toXY(cur.lat, cur.lng);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((cur.yaw * Math.PI) / 180);

        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(244, 63, 94, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(0, -10);
        ctx.lineTo(7, 8);
        ctx.lineTo(0, 4);
        ctx.lineTo(-7, 8);
        ctx.closePath();
        ctx.fillStyle = '#f43f5e';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      }
    }

    function renderAttitudeHud(sample) {
      const canvas = document.getElementById('hudHorizonCanvas');
      if (!canvas || !sample) return;
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = Math.max(120, rect.width);
      canvas.height = Math.max(120, rect.height);
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-sample.roll * Math.PI) / 180);

      const pitchOffset = (sample.pitch / 45) * (h * 0.5);
      ctx.fillStyle = '#0369a1';
      ctx.fillRect(-w, -h * 2 + pitchOffset, w * 2, h * 2);
      ctx.fillStyle = '#78350f';
      ctx.fillRect(-w, pitchOffset, w * 2, h * 2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-w, pitchOffset);
      ctx.lineTo(w, pitchOffset);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      for (const deg of [-20, -10, 10, 20]) {
        const py = pitchOffset - (deg / 45) * (h * 0.5);
        ctx.beginPath();
        ctx.moveTo(-18, py);
        ctx.lineTo(18, py);
        ctx.stroke();
      }
      ctx.restore();

      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx - 26, cy);
      ctx.lineTo(cx - 8, cy);
      ctx.moveTo(cx + 8, cy);
      ctx.lineTo(cx + 26, cy);
      ctx.stroke();
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    function syncScrubberToSec(targetSec, updateSlider = true) {
      const a = appState.analysis;
      if (!a || !a.timeline.length) return;
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < a.timeline.length; i++) {
        const d = Math.abs(a.timeline[i].sec - targetSec);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      appState.scrubberIndex = bestIdx;
      const sample = a.timeline[bestIdx];
      if (!sample) return;

      if (updateSlider) {
        const slider = document.getElementById('timelineScrubber');
        slider.max = Math.max(1, a.timeline.length - 1);
        slider.value = bestIdx;
      }

      document.getElementById('scrubberTimeKST').textContent = a.hasAbsoluteTime ? `${sample.kstStr} KST` : sample.bootStr;
      document.getElementById('scrubberTimeBoot').textContent = `(${sample.bootStr})`;
      document.getElementById('chartHoverReadout').textContent =
        `시각: ${sample.kstStr} (${sample.bootStr}) · 모드: ${sample.modeName} · 상대고도: ${sample.autoRelAlt.toFixed(1)}m (해발 ${sample.gpsAmsl.toFixed(1)}m) · 스로틀: ${sample.thO.toFixed(0)}% · 전압: ${sample.volt.toFixed(2)}V`;

      const statusEl = document.getElementById('scrubberPhaseStatus');
      if (sample.sec < a.armSec) {
        statusEl.textContent = '○ 시동 전 대기 (PRE-ARM)';
        statusEl.className = 'text-slate-400 font-semibold';
      } else if (a.groundOnly && sample.sec >= a.disarmSec) {
        statusEl.textContent = '○ 비행 미감지 · 시동 해제';
        statusEl.className = 'text-slate-400 font-semibold';
      } else if (a.groundOnly || sample.sec < a.takeoffSec) {
        statusEl.textContent = a.groundOnly ? '○ 비행 미감지' : '◐ 지상 시동 대기 (ARMED IDLE)';
        statusEl.className = 'text-amber-400 font-semibold';
      } else if (sample.sec <= a.landingSec) {
        statusEl.textContent = `● 공중 비행 중 (${sample.modeName})`;
        statusEl.className = 'text-emerald-400 font-semibold';
      } else if (sample.sec <= a.disarmSec) {
        if (a.isLogCutoff && sample.sec >= a.maxSec - 1.5) {
          statusEl.textContent = '⚠️ 로그 끊김 (시동 해제 없이 기록 중단)';
          statusEl.className = 'text-rose-400 font-bold';
        } else {
          statusEl.textContent = '◑ 착륙 완료 · 시동 유지 중';
          statusEl.className = 'text-indigo-400 font-semibold';
        }
      } else {
        statusEl.textContent = a.isLogCutoff ? '⚠️ 로그 끊김 (비정상 기록 중단)' : '○ 시동 해제 완료 (DISARMED)';
        statusEl.className = a.isLogCutoff ? 'text-rose-400 font-bold' : 'text-slate-400 font-semibold';
      }

      document.getElementById('mapOverlayCoords').textContent =
        `위도: ${sample.lat?.toFixed(6) ?? '—'}° · 경도: ${sample.lng?.toFixed(6) ?? '—'}°`;
      document.getElementById('mapOverlayAltMode').textContent =
        `상대고도: ${sample.autoRelAlt.toFixed(1)}m · 속도: ${sample.spd.toFixed(1)}m/s · 모드: ${sample.modeName} · 위성: ${sample.nSats}`;

      document.getElementById('hudModeBadge').textContent = sample.modeName;
      document.getElementById('hudRollPitch').textContent =
        `${sample.roll >= 0 ? '+' : ''}${sample.roll.toFixed(1)}° / ${sample.pitch >= 0 ? '+' : ''}${sample.pitch.toFixed(1)}°`;
      document.getElementById('hudYaw').textContent = `${sample.yaw.toFixed(1)}°`;
      document.getElementById('hudAltVz').textContent = `${sample.autoRelAlt.toFixed(1)}m / ${sample.vz >= 0 ? '+' : ''}${sample.vz.toFixed(1)}m/s`;
      document.getElementById('hudVoltCurr').textContent = `${sample.volt.toFixed(1)}V / ${sample.curr.toFixed(1)}A`;
      document.getElementById('hudMotorText').textContent = `${sample.c1} / ${sample.c2} / ${sample.c3} / ${sample.c4} µs`;

      const pwmPct = pwm => Math.min(100, Math.max(8, ((pwm - 1000) / 1000) * 100));
      document.getElementById('barM1').style.width = `${pwmPct(sample.c1)}%`;
      document.getElementById('barM2').style.width = `${pwmPct(sample.c2)}%`;
      document.getElementById('barM3').style.width = `${pwmPct(sample.c3)}%`;
      document.getElementById('barM4').style.width = `${pwmPct(sample.c4)}%`;

      renderGpsMap();
      renderAttitudeHud(sample);
      if (mainChart) mainChart.draw();
      if (overviewChart) overviewChart.draw();
    }

    // Build the exact multi-log & multi-sortie logbook text requested:
    // 1회 이착륙당 1쏘티 (한 로그에 2회 이착륙 시 2줄로 자동 기록)
    // ex: 13:35:52 13:46:57 :00:11:05
    function buildAllLogsCopyText() {
      const includeName = document.getElementById('chkIncludeFilename') && document.getElementById('chkIncludeFilename').checked;
      const lines = [];
      appState.logs.forEach(item => {
        const sorties = (item.analysis && item.analysis.sorties && item.analysis.sorties.length > 0)
          ? item.analysis.sorties
          : [{ index: 1, logbookLine: item.analysis.logbookLine }];
        sorties.forEach(s => {
          if (includeName) {
            const sortieSuffix = sorties.length > 1 ? ` (${s.index}쏘티)` : '';
            lines.push(`${item.fileName}${sortieSuffix}\t${s.logbookLine}`);
          } else {
            lines.push(s.logbookLine);
          }
        });
      });
      return lines.join('\n');
    }
