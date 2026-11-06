    let mainChart = null;
    let overviewChart = null;
    let plotRefreshTimer=null,plotRevision=0,plotWorker=null,plotGesture=false;
    function setPlotQueryStatus(text){
      const title=document.getElementById?.('chartTitleLabel');if(!title)return;
      let status=document.getElementById('plotQueryStatus');if(!status){status=document.createElement('span');status.id='plotQueryStatus';status.setAttribute('role','status');status.style.cssText='position:absolute;right:8px;top:4px;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#64748b;pointer-events:none;background:rgba(255,255,255,.92);padding:0 3px';const card=title.closest('.glass-card')||title.parentElement;card.style.position='relative';card.append(status);}status.textContent=text;
    }
    function cancelPlotRefresh() {
      plotRevision++;if(plotRefreshTimer!==null){clearTimeout(plotRefreshTimer);plotRefreshTimer=null;}
      if(plotWorker){plotWorker.terminate();plotWorker=null;}
      if(appState.parsedLog?.nativeId)window.chrome?.webview?.postMessage(JSON.stringify({action:'disk.chart.cancel'}));
    }
    function previewPlotRange() {
      if(!mainChart||!appState.analysis)return;
      const range=appState.zoomWindow||{minSec:appState.analysis.minSec,maxSec:appState.analysis.maxSec};
      mainChart.options.scales.x.min=range.minSec;mainChart.options.scales.x.max=range.maxSec;
      setPlotQueryStatus('미리보기 · 조작이 끝나면 원본 구간을 갱신합니다.');
      mainChart.update('none');overviewChart?.draw();
    }
    function finishPlotGesture(){if(!plotGesture)return;plotGesture=false;requestPlotRefresh(0);}
    function requestPlotRefresh(delay=160){
      cancelPlotRefresh();const revision=plotRevision;previewPlotRange();if(plotGesture)return;
      plotRefreshTimer=setTimeout(()=>{plotRefreshTimer=null;renderTelemetryCharts(undefined,revision);},delay);
    }

    const flightMilestonePlugin = {
      id: 'flightMilestones',
      afterDraw(chart) {
        if(chart.canvas.id!=='mainTelemetryChart')return;
        const a = chart._overlayAnalysis || appState.analysis;
        if (!a || !a.timeline.length) return;
        const { ctx, chartArea, scales } = chart;
        const xScale = scales.x;
        if (!xScale || !chartArea) return;

        const markers = [
          { sec: a.armSec, label: 'ARM', color: '#d97706', dash: [3, 3], row: 0 }
        ];
        if (a.sorties && a.sorties.length > 1) {
          a.sorties.forEach((s) => {
            markers.push({
              sec: s.takeoffSec,
              label: `${s.index}쏘티 이륙 ${appState.timeMode === 'KST' ? s.takeoffKst : s.takeoffBoot}`,
              color: '#0284c7',
              dash: [],
              row: 0
            });
            markers.push({
              sec: s.landingSec,
              label: s.isCutoff
                ? `⚠️ ${s.index}쏘티 로그끊김 ${appState.timeMode === 'KST' ? s.landingKst : s.landingBoot}`
                : `${s.index}쏘티 착륙 ${appState.timeMode === 'KST' ? s.landingKst : s.landingBoot}`,
              color: s.isCutoff ? '#be123c' : '#4f46e5',
              dash: s.isCutoff ? [4, 3] : [],
              row: 0
            });
          });
        } else if (!a.groundOnly) {
          markers.push({ sec: a.takeoffSec, label: `이륙 ${appState.timeMode === 'KST' ? a.takeoffKst : a.takeoffBoot}`, color: '#0284c7', dash: [], row: 0 });
          markers.push({
            sec: a.landingSec,
            label: a.isLogCutoff && a.landingSec >= a.maxSec - 1
              ? `⚠️ 비행중 로그끊김 ${appState.timeMode === 'KST' ? a.landingKst : a.landingBoot}`
              : `착륙 ${appState.timeMode === 'KST' ? a.landingKst : a.landingBoot}`,
            color: (a.isLogCutoff && a.landingSec >= a.maxSec - 1) ? '#be123c' : '#4f46e5',
            dash: (a.isLogCutoff && a.landingSec >= a.maxSec - 1) ? [4, 3] : [],
            row: 0
          });
        }

        // End of flight marker: DISARM vs LOG CUTOFF (로그 끊김)
        if (a.isLogCutoff) {
          markers.push({
            sec: a.disarmSec,
            label: `⚠️ 로그 끊김 ${appState.timeMode === 'KST' ? a.disarmKst : a.disarmBoot}`,
            color: '#be123c',
            dash: [4, 2],
            row: 1,
            isError: true
          });
        } else {
          markers.push({ sec: a.disarmSec, label: 'DISARM', color: '#64748b', dash: [3, 3], row: 0 });
        }

        // Sensor Error & RC Failsafe Markers on Graph
        if (appState.showErrorMarkersOnChart !== false && a.chartErrorMarkers && a.chartErrorMarkers.length > 0) {
          a.chartErrorMarkers.forEach((em, idx) => {
            if (em.sensorName === '로그 끊김') return; // already drawn above
            markers.push({
              sec: em.sec,
              label: em.label,
              color: em.color || '#dc2626',
              dash: [3, 2],
              row: 1 + (idx % 2),
              isError: true
            });
          });
        }

        const curSample = chart._overlayAnalysis?{sec:a.cursorSec}:a.timeline[appState.scrubberIndex];
        if (curSample) {
          markers.push({ sec: curSample.sec, label: '', color: '#e11d48', dash: [2, 2], isCursor: true, row: 0 });
        }

        const occupiedLabels=[];
        ctx.save();
        for (const m of markers) {
          const xPx = xScale.getPixelForValue(m.sec);
          if (xPx < chartArea.left || xPx > chartArea.right) continue;

          ctx.beginPath();
          ctx.strokeStyle = m.color;
          ctx.lineWidth = m.isCursor ? 1.5 : (m.isError ? 2.2 : 1.8);
          ctx.setLineDash(m.dash);
          ctx.moveTo(xPx, chartArea.top);
          ctx.lineTo(xPx, chartArea.bottom);
          ctx.stroke();

          if (m.label) {
            ctx.setLineDash([]);
            ctx.font = m.isError ? 'bold 10px "JetBrains Mono", monospace' : '600 10px "JetBrains Mono", monospace';
            const textW = ctx.measureText(m.label).width + 8;
            const boxX = Math.max(chartArea.left+2,Math.min(chartArea.right-textW-2,xPx-textW/2));
            const row=reserveMilestoneLabelRow(occupiedLabels,boxX,textW,m.row||0);
            const boxY = chartArea.top + 4 + row * 19;
            ctx.fillStyle = m.isError ? '#fff1f2' : 'rgba(255, 255, 255, 0.94)';
            ctx.fillRect(boxX, boxY, textW, 16);
            ctx.strokeStyle = m.color;
            ctx.lineWidth = m.isError ? 1.4 : 1;
            ctx.strokeRect(boxX, boxY, textW, 16);
            ctx.fillStyle = m.color;
            ctx.fillText(m.label, boxX + 4, boxY + 11.5);
          }
        }
        ctx.restore();
      }
    };

    function milestoneTimeLabel(name,sec,analysis) {
      return analysis.hasAbsoluteTime?`${name} ${analysis.secToKstStr(sec)} KST (${analysis.secToBootStr(sec)})`:`${name} ${analysis.secToBootStr(sec)}`;
    }

    function reserveMilestoneLabelRow(occupied,left,width,preferred=0) {
      let row=preferred;
      while(occupied.some(box=>box.row===row && left<box.right+5 && left+width>box.left-5))row++;
      occupied.push({left,right:left+width,row});return row;
    }

    const dragZoomOverlayPlugin = {
      id: 'dragZoomOverlay',
      afterDraw(chart) {
        const drag = chart._dragZoomState;
        if (!drag || !drag.active || !chart.chartArea) return;
        const { ctx, chartArea, scales } = chart;
        const x0 = Math.max(chartArea.left, Math.min(chartArea.right, Math.min(drag.startX, drag.curX)));
        const x1 = Math.max(chartArea.left, Math.min(chartArea.right, Math.max(drag.startX, drag.curX)));
        if (x1 - x0 < 4) return;

        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.20)';
        ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);

        if (scales.x && appState.analysis) {
          const s0 = scales.x.getValueForPixel(x0);
          const s1 = scales.x.getValueForPixel(x1);
          const a = appState.analysis;
          const label = `구간 확대: ${a.secToKstStr(s0)} ~ ${a.secToKstStr(s1)} (${Math.max(0, s1 - s0).toFixed(1)}초)`;
          ctx.font = 'bold 11px "JetBrains Mono", monospace';
          const tw = ctx.measureText(label).width + 12;
          const bx = Math.min(chartArea.right - tw - 4, Math.max(chartArea.left + 4, (x0 + x1) / 2 - tw / 2));
          const by = chartArea.top + 24;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
          ctx.fillRect(bx, by, tw, 20);
          ctx.strokeStyle = '#38bdf8';
          ctx.strokeRect(bx, by, tw, 20);
          ctx.fillStyle = '#38bdf8';
          ctx.fillText(label, bx + 6, by + 14);
        }
        ctx.restore();
      }
    };

    Chart.register(flightMilestonePlugin, dragZoomOverlayPlugin, {
      id:'manualAxisLimits',
      beforeUpdate(chart) {
        if(chart.canvas.id!=='mainTelemetryChart')return;
        const group = chart.canvas.id === 'mainTelemetryChart' ? 'main' : 'secondary';
        if (group === 'main' && appState.customFields.length) return;
        for (const axis of ['y','y1']) {
          const limits = appState.axisLimits?.[group]?.[axis];
          if (limits && chart.options.scales[axis]) {
            chart.options.scales[axis].min = limits.min;
            chart.options.scales[axis].max = limits.max;
          }
        }
      }
    });

    function updateZoomRangeUI() {
      const el = document.getElementById('currentZoomRangeLabel');
      if (!el || !appState.analysis) return;
      const a = appState.analysis;
      if (!appState.zoomWindow) {
        el.textContent = `현재 보기: 전체 구간 (${a.secToKstStr(a.minSec)} ~ ${a.secToKstStr(a.maxSec)})`;
        el.className = 'text-[11px] text-slate-400 mono-num';
      } else {
        const span = Math.max(0, appState.zoomWindow.maxSec - appState.zoomWindow.minSec);
        el.textContent = `확대 구간: ${a.secToKstStr(appState.zoomWindow.minSec)} ~ ${a.secToKstStr(appState.zoomWindow.maxSec)} (${span.toFixed(1)}초)`;
        el.className = 'text-[11px] text-emerald-300 font-bold mono-num';
      }
    }

    function applyZoomRange(minSec, maxSec, allowOutside=false) {
      const a = appState.analysis;
      if (!a) return;
      const clampedMin = allowOutside ? minSec : Math.max(a.minSec, Math.min(a.maxSec - 1, minSec));
      const clampedMax = allowOutside ? Math.max(minSec+1,maxSec) : Math.min(a.maxSec, Math.max(clampedMin + 1, maxSec));
      if (Math.abs(clampedMin-a.minSec)<0.2 && Math.abs(clampedMax-a.maxSec)<0.2) {
        appState.zoomWindow = null;
      } else {
        appState.zoomWindow = { minSec: clampedMin, maxSec: clampedMax };
      }
      updateZoomRangeUI();
      requestPlotRefresh();
    }

    function zoomChartByFactor(factor, centerSec = null) {
      const a = appState.analysis;
      if (!a) return;
      const curMin = appState.zoomWindow ? appState.zoomWindow.minSec : a.minSec;
      const curMax = appState.zoomWindow ? appState.zoomWindow.maxSec : a.maxSec;
      const curSpan = Math.max(2, curMax - curMin);
      const totalSpan = Math.max(2, a.maxSec - a.minSec);
      const newSpan = Math.max(2, Math.min(totalSpan, curSpan * factor));

      const pivot = (centerSec !== null && Number.isFinite(centerSec))
        ? Math.max(curMin, Math.min(curMax, centerSec))
        : (curMin + curMax) / 2;
      const ratio = (pivot - curMin) / curSpan;
      let newMin = pivot - ratio * newSpan;
      let newMax = newMin + newSpan;
      if (newMin < a.minSec) {
        newMin = a.minSec;
        newMax = Math.min(a.maxSec, newMin + newSpan);
      }
      if (newMax > a.maxSec) {
        newMax = a.maxSec;
        newMin = Math.max(a.minSec, newMax - newSpan);
      }
      applyZoomRange(newMin, newMax);
    }

    function panChartByFraction(fraction) {
      const a = appState.analysis;
      if (!a) return;
      if (!appState.zoomWindow) {
        showToast('먼저 차트를 확대한 뒤 좌우 이동을 사용할 수 있습니다.');
        return;
      }
      const curMin = appState.zoomWindow.minSec;
      const curMax = appState.zoomWindow.maxSec;
      const span = curMax - curMin;
      let shift = span * fraction;
      if (curMin + shift < a.minSec) shift = a.minSec - curMin;
      if (curMax + shift > a.maxSec) shift = a.maxSec - curMax;
      applyZoomRange(curMin + shift, curMax + shift);
    }

    function getPannedTimeWindow(startMin, startMax, deltaSeconds, logMin, logMax, overscroll=0) {
      const span = Math.min(startMax - startMin, logMax - logMin);
      const minSec = Math.max(logMin-overscroll, Math.min(logMax+overscroll - span, startMin - deltaSeconds));
      return { minSec, maxSec: minSec + span };
    }

    function bindInteractiveChartZoom(canvasEl, getChartInstance) {
      if (!canvasEl || canvasEl._zoomBound) return;
      canvasEl._zoomBound = true;
      canvasEl.title = '왼쪽 드래그: 구간 확대 · 휠: 확대/축소 · 오른쪽 드래그: 시간축 이동 · 더블클릭: 전체 보기';
      let pan = null;
      let panFrame = null;
      let lastPanX = null;
      function applyPan() {
        panFrame = null;
        if (!pan || appState.analysis !== pan.analysis) return;
        const range = getPannedTimeWindow(pan.min, pan.max,
          (lastPanX - pan.clientX) * pan.secondsPerPixel, pan.analysis.minSec, pan.analysis.maxSec, (pan.max-pan.min)*0.8);
        applyZoomRange(range.minSec, range.maxSec, true);
      }
      function endPan() {
        if (panFrame !== null) { cancelAnimationFrame(panFrame); applyPan(); }
        pan = null;
        canvasEl.style.cursor = '';
        finishPlotGesture();
      }
      canvasEl.addEventListener('contextmenu', e => e.preventDefault());
      canvasEl.addEventListener('pointerdown', e => {
        if (e.button !== 2) return;
        const chart = getChartInstance();
        const analysis = appState.analysis;
        if (!chart?.chartArea || !analysis) return;
        const rect = canvasEl.getBoundingClientRect();
        const x = (e.clientX - rect.left) * chart.width / rect.width;
        if (x < chart.chartArea.left || x > chart.chartArea.right) return;
        e.preventDefault();
        cancelPlotRefresh();plotGesture=true;
        pan = { analysis, clientX:e.clientX,
          min:appState.zoomWindow?.minSec ?? analysis.minSec,
          max:appState.zoomWindow?.maxSec ?? analysis.maxSec,
          secondsPerPixel:(chart.scales.x.max-chart.scales.x.min) /
            ((chart.chartArea.right-chart.chartArea.left)*rect.width/chart.width) };
        lastPanX = e.clientX;
        canvasEl.setPointerCapture(e.pointerId);
        canvasEl.style.cursor = 'grabbing';
      });
      canvasEl.addEventListener('pointermove', e => {
        if (!pan) return;
        if (!(e.buttons & 2)) { endPan(); return; }
        e.preventDefault();
        lastPanX = e.clientX;
        if (panFrame === null) panFrame = requestAnimationFrame(applyPan);
      });
      for (const event of ['pointerup','pointercancel','lostpointercapture']) canvasEl.addEventListener(event,endPan);
      window.addEventListener('blur',endPan);

      canvasEl.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const chart = getChartInstance();
        if (!chart || !chart.chartArea) return;
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < chart.chartArea.left || x > chart.chartArea.right) return;
        cancelPlotRefresh();plotGesture=true;
        chart._dragZoomState = { active: true, startX: x, curX: x };
      });

      window.addEventListener('mousemove', (e) => {
        const chart = getChartInstance();
        if (!chart || !chart._dragZoomState || !chart._dragZoomState.active) return;
        const rect = canvasEl.getBoundingClientRect();
        chart._dragZoomState.curX = e.clientX - rect.left;
        chart.draw();
      });

      window.addEventListener('mouseup', () => {
        const chart = getChartInstance();
        if (!chart || !chart._dragZoomState || !chart._dragZoomState.active) return;
        const drag = chart._dragZoomState;
        drag.active = false;
        plotGesture=false;
        const x0 = Math.max(chart.chartArea.left, Math.min(chart.chartArea.right, Math.min(drag.startX, drag.curX)));
        const x1 = Math.max(chart.chartArea.left, Math.min(chart.chartArea.right, Math.max(drag.startX, drag.curX)));
        if (x1 - x0 >= 12 && chart.scales && chart.scales.x) {
          const s0 = chart.scales.x.getValueForPixel(x0);
          const s1 = chart.scales.x.getValueForPixel(x1);
          if (Number.isFinite(s0) && Number.isFinite(s1) && s1 > s0 + 0.5) {
            applyZoomRange(s0, s1);
            if (appState.analysis) {
              showToast(`선택 구간(${appState.analysis.secToKstStr(s0)} ~ ${appState.analysis.secToKstStr(s1)})으로 확대했습니다.`);
            }
            return;
          }
        }
        chart.draw();
      });

      canvasEl.addEventListener('wheel', (e) => {
        const chart = getChartInstance();
        if (!chart || !chart.scales || !chart.scales.x || !appState.analysis) return;
        e.preventDefault();
        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const centerSec = chart.scales.x.getValueForPixel(x);
        const factor = e.deltaY < 0 ? 0.72 : 1.38;
        zoomChartByFactor(factor, centerSec);
      }, { passive: false });

      canvasEl.addEventListener('dblclick', () => {
        if (!appState.analysis) return;
        appState.zoomWindow = null;
        updateZoomRangeUI();
        renderTelemetryCharts();
        showToast('차트 확대를 초기화하여 전체 비행 구간을 표시합니다.');
      });
    }

    function getFilteredTimeline() {
      const a = appState.analysis;
      if (!a) return [];
      if (!appState.zoomWindow) return a.timeline;
      if(a.timeline._packed){
        const bound=(value,upper)=>{let lo=0,hi=a.timeline.length;while(lo<hi){const mid=Math.floor((lo+hi)/2),sec=a.timeline[mid].sec;if(sec<value||upper&&sec===value)lo=mid+1;else hi=mid;}return lo;};
        return a.timeline.slice(bound(appState.zoomWindow.minSec,false),bound(appState.zoomWindow.maxSec,true));
      }
      return a.timeline.filter(pt => pt.sec >= appState.zoomWindow.minSec && pt.sec <= appState.zoomWindow.maxSec);
    }

    function detectMotorOutputs(parsed,analysis) {
      const parameters=new Map();for(const row of analysis.parmRows||[])parameters.set(row.Name,Number(row.Value));
      const columns=new Set(parsed.fmtList.filter(schema=>schema.name==='RCOU').flatMap(schema=>schema.columns));
      const recorded=[...columns].filter(column=>/^C\d+$/.test(column)).sort((a,b)=>Number(a.slice(1))-Number(b.slice(1)));
      const mapped=[];
      for(const column of recorded){const channel=Number(column.slice(1)),value=parameters.get(`SERVO${channel}_FUNCTION`);const motor=value>=33&&value<=40?value-32:value>=82&&value<=85?value-73:null;if(motor!==null)mapped.push({column,motor});}
      const frame=analysis.frameInfo?.name||'기체 형식 미확인';
      if(mapped.length)return {frame,source:'SERVO 출력 설정',outputs:mapped.sort((a,b)=>a.motor-b.motor)};
      const frameClass=Number(Object.keys(FRAME_CLASS_NAMES).find(key=>FRAME_CLASS_NAMES[key]===analysis.frameInfo?.name))||Number(parameters.get('FRAME_CLASS')||parameters.get('Q_FRAME_CLASS'));
      const count={1:4,2:6,3:8,4:8,5:6,7:3,9:2,10:2,12:12,13:4,14:10}[frameClass];
      if(count&&!recorded.some(column=>parameters.has(`SERVO${column.slice(1)}_FUNCTION`)))return {frame,source:'기체 기본 출력 순서 추정',outputs:recorded.filter(column=>Number(column.slice(1))<=count).map(column=>({column,motor:Number(column.slice(1))}))};
      return {frame,source:'모터 매핑 미확인 · 기록된 출력 채널',outputs:recorded.map(column=>({column,motor:null}))};
    }

    function buildPresetConfig(presetKey, pts) {
      if (presetKey === 'takeoff_alt') {
        const isAmsl = appState.altSourceMode === 'gps_amsl';
        return {
          title: isAmsl
            ? 'GPS 해발고도 (AMSL 원본 m) vs 영점보정 상대고도 (AGL m) 및 스로틀 (%)'
            : '이착륙 상대고도 (이륙지면 0m 영점보정 CTUN.Alt / BARO.Alt) 및 스로틀 출력 (CTUN.ThO %)',
          datasets: [
            { label: '목표 상대고도 (DAlt m)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.dAlt })), borderColor: '#94a3b8', borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: isAmsl ? '선택 고도: 해발(AMSL m)' : '선택 고도: 상대고도(AGL m)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.alt })), borderColor: '#38bdf8', backgroundColor: 'rgba(56, 189, 248, 0.12)', fill: true, borderWidth: 2.2, pointRadius: 0, yAxisID: 'y' },
            { label: '기압계 상대고도 (BARO 영점보정 m)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.bAlt })), borderColor: '#a855f7', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: '스로틀 출력 (CTUN.ThO %)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.thO })), borderColor: '#10b981', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' }
          ],
          yLabel: '고도 (m)',
          y1Label: '스로틀 (%)'
        };
      }
      if (presetKey === 'vibe') {
        const warnLine = appState.config.vibeWarn;
        return {
          title: `IMU 3축 진동 (VIBE.VibeX/Y/Z) 및 클리핑 — 매뉴얼 주의 기준 ${warnLine} m/s²`,
          datasets: [
            { label: 'VibeX (m/s²)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.vibeX })), borderColor: '#38bdf8', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: 'VibeY (m/s²)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.vibeY })), borderColor: '#10b981', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: 'VibeZ (m/s²)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.vibeZ })), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
            { label: `매뉴얼 주의선 (${warnLine} m/s²)`, data: mapPlotRows(pts,p => ({ x: p.sec, y: warnLine })), borderColor: '#f43f5e', borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: '누적 클리핑 (Clip0)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.clip0 })), borderColor: '#e879f9', borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }
          ],
          yLabel: '진동 가속도 (m/s²)',
          y1Label: '클리핑 횟수 (회)'
        };
      }
      if (presetKey === 'attitude') {
        return {
          title: '자세 제어 추종성 (ATT 목표 DesRoll/DesPitch vs 실제 Roll/Pitch)',
          datasets: [
            { label: '목표 롤 (DesRoll °)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.desRoll })), borderColor: '#38bdf8', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: '실제 롤 (Roll °)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.roll })), borderColor: '#0284c7', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
            { label: '목표 피치 (DesPitch °)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.desPitch })), borderColor: '#34d399', borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: '실제 피치 (Pitch °)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.pitch })), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, yAxisID: 'y' }
          ],
          yLabel: '각도 (deg)',
          y1Label: null
        };
      }
      if (presetKey === 'battery') {
        return {
          title: '배터리 전압 · 전류 (BAT.Volt / BAT.Curr)',
          datasets: [
            { label: '배터리 전압 (BAT.Volt V)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.volt })), borderColor: '#10b981', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
            { label: '소모 전류 (BAT.Curr A)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.curr })), borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' }
          ],
          yLabel: '전압 (V)',
          y1Label: '전류 (A)'
        };
      }
      if (presetKey === 'motors') {
        const mapping=detectMotorOutputs(appState.parsedLog,appState.analysis);
        const fields=mapping.outputs.map(output=>'RCOU.'+output.column);
        const config=buildCustomFieldConfig(fields,pts===appState.analysis.timeline);
        for(const dataset of config.datasets){const output=mapping.outputs.find(item=>dataset.label.startsWith('RCOU.'+item.column+' [')||dataset.label==='RCOU.'+item.column);dataset.label=(output?.motor?`모터 ${output.motor}`:'출력 '+output?.column)+` (${dataset.label} µs)`;dataset.yAxisID='y';}
        return {
          title: `모터 출력 · ${mapping.frame} · ${mapping.outputs.length}채널 (${mapping.source})`,
          datasets: config.datasets,
          yLabel: 'PWM 출력 (µs)',
          y1Label: null
        };
      }
      if (presetKey === 'gps_mag') {
        return {
          title: 'GPS 가시 위성 수 (NSats), 수평 정밀도 (HDOP) 및 자기장 변동률 (MAG %)',
          datasets: [
            { label: 'GPS 위성 수 (NSats)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.nSats })), borderColor: '#38bdf8', borderWidth: 2, pointRadius: 0, yAxisID: 'y' },
            { label: '자기장 변동률 (MAG %)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.magPct })), borderColor: '#a855f7', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' },
            { label: 'GPS HDOP', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.hdop })), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }
          ],
          yLabel: '위성 수 (개) / 자기장 변동 (%)',
          y1Label: 'HDOP'
        };
      }
      return {
        title: 'EKF3 추정 자세 (XKF1.Roll/Pitch) 및 수직 상승/하강 속도 (VZ m/s)',
        datasets: [
          { label: 'XKF1.Roll (°)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.roll })), borderColor: '#38bdf8', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y' },
          { label: 'XKF1.Pitch (°)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.pitch })), borderColor: '#10b981', borderWidth: 1.6, pointRadius: 0, yAxisID: 'y' },
          { label: '수직 속도 (Climb Rate m/s)', data: mapPlotRows(pts,p => ({ x: p.sec, y: p.vz })), borderColor: '#f59e0b', borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }
        ],
        yLabel: '자세 각도 (°)',
        y1Label: '수직 속도 (m/s)'
      };
    }

    function peakPreservingPoints(points, min, max, budget=2400) {
      const read=i=>{const p=points.pointAt?points.pointAt(i):points[i];return Number.isFinite(p.y)?p:{x:p.x,y:null};};
      let start=0,end=points.length;
      while(start<end){const mid=Math.floor((start+end)/2);if(read(mid).x<min)start=mid+1;else end=mid;}
      const first=Math.max(0,start-1);let upper=start;end=points.length;
      while(upper<end){const mid=Math.floor((upper+end)/2);if(read(mid).x<=max)upper=mid+1;else end=mid;}
      end=Math.min(points.length,upper+1);const length=end-first;
      if(length<=budget)return Array.from({length},(_,i)=>read(first+i));
      const result=[read(first)],size=Math.ceil((length-2)/Math.floor((budget-2)/4));
      for(let i=first+1;i<end-1;i+=size){
        const stop=Math.min(end-1,i+size);let low=null,high=null,gap=null,head;
        for(let j=i;j<stop;j++){
          const p=read(j);if(j===i)head=p;
          if(p.y===null){gap=[j,p];continue;}
          if(!low||p.y<low[1].y)low=[j,p];if(!high||p.y>high[1].y)high=[j,p];
        }
        const candidates=[[i,head],low,high,gap].filter(Boolean).sort((a,b)=>a[0]-b[0]);let previous=-1;
        for(const [index,p] of candidates)if(index!==previous){result.push(p);previous=index;}
      }
      result.push(read(end-1));return result;
    }

    function updateOrCreateChart(existing,context,config) {
      if(!existing)return new Chart(context,config);
      existing.data=config.data;existing.options=config.options;
      existing.update('none');return existing;
    }

    function normalizePlotDatasets(datasets, range=appState.zoomWindow) {
      for(const ds of datasets){
        if(ds.nativePrepared){ds.tension=0;ds.spanGaps=false;continue;}
        let data=ds.data,last=-Infinity,ordered=true,valid=true,lo=Infinity,hi=-Infinity,sum=0,count=0;
        const read=i=>data.pointAt?data.pointAt(i):data[i];
        for(let i=0;i<data.length;i++){
          const p=read(i);if(!Number.isFinite(p.x)){valid=false;continue;}
          if(p.x<last)ordered=false;last=p.x;
          if(Number.isFinite(p.y)){lo=Math.min(lo,p.y);hi=Math.max(hi,p.y);sum+=p.y;count++;}
        }
        ds.statistics=count?{min:lo,max:hi,mean:sum/count}:null;
        if(!valid||!ordered){data=data.filter(p=>Number.isFinite(p.x));data.sort((a,b)=>a.x-b.x);}
        ds.data=appState.analysis?peakPreservingPoints(data,range?.minSec??appState.analysis.minSec,range?.maxSec??appState.analysis.maxSec):Array.from(data,p=>({x:p.x,y:Number.isFinite(p.y)?p.y:null}));
        ds.tension=0;ds.spanGaps=false;
      }
    }

    function customFieldAxisId(index) { return index === 0 ? 'y' : `y${index}`; }

    // Match sibling quantities, not every column in a message (GPS altitude,
    // latitude and speed must retain independent ranges).
    function fieldRangeGroup(field) {
      const dot=field.indexOf('.'),message=field.slice(0,dot).replace(/\[[^\]]+\]$/,''),name=field.slice(dot+1);
      let family=name.replace(/\[\d+\]$/,'').replace(/\d+$/,'');
      if(/^(?:ATT|ANG|XKF\d+|NKF\d+)$/.test(message)&&/^(?:Des)?(?:Roll|Pitch|Yaw)$/.test(name))family='attitude';
      else if(/(?:X|Y|Z)$/.test(family))family=family.slice(0,-1);
      else if(/^(?:D|Des)?Alt$/.test(name))family='Alt';
      let unit='';
      if(appState.parsedLog&&typeof messageFieldUnit==='function')unit=messageFieldUnit(appState.parsedLog,message,name.replace(/\[\d+\]$/,''));
      return JSON.stringify([message,family,unit]);
    }

    function commonPlotBounds(min,max) {
      if(!Number.isFinite(min)||!Number.isFinite(max))return null;
      if(min===max){const padding=Math.abs(min)*.05||1;min-=padding;max+=padding;}
      const raw=(max-min)/5,power=10**Math.floor(Math.log10(raw)),ratio=raw/power;
      const step=(ratio<=1?1:ratio<=2?2:ratio<=5?5:10)*power;
      const low=Math.floor(min/step)*step,high=Math.ceil(max/step)*step;
      return Number.isFinite(low)&&Number.isFinite(high)&&low<high?{min:low,max:high}:null;
    }

    function synchronizePlotAxes(config,fields=[]) {
      const custom=!!config.customAxes,axes={},groups=new Map();
      const memberships=new Map();
      config.datasets.forEach((dataset,index)=>{
        const original=dataset.yAxisID||'y',axisId=custom?original:customFieldAxisId(index);
        const field=custom?fields.find((field,i)=>customFieldAxisId(i)===original):null;
        const group=custom?fieldRangeGroup(field||dataset.label):'preset:'+original;
        const previous=config.customAxes?.[original],color=dataset.borderColor;
        axes[axisId]??={...previous,type:'linear',position:previous?.position||'left',display:true,weight:config.datasets.length-index,
          title:{...previous?.title,display:true,text:field||dataset.label,color,font:{size:10}},
          ticks:{...previous?.ticks,color,font:{family:'Arial',size:11}},border:{...previous?.border,color},
          grid:{drawOnChartArea:index===0,color:'#e5e5e5'}};
        dataset.yAxisID=axisId;
        memberships.set(axisId,group);
        if(!groups.has(group))groups.set(group,{min:Infinity,max:-Infinity,axes:new Set()});
        const shared=groups.get(group);shared.axes.add(axisId);
        if(dataset.statistics){shared.min=Math.min(shared.min,dataset.statistics.min);shared.max=Math.max(shared.max,dataset.statistics.max);}
        if(!custom){const limits=appState.axisLimits?.main?.[original];if(limits){axes[axisId].min=limits.min;axes[axisId].max=limits.max;}}
      });
      for(const group of groups.values()){
        const bounds=commonPlotBounds(group.min,group.max);if(!bounds)continue;
        for(const axisId of group.axes){axes[axisId].min??=bounds.min;axes[axisId].max??=bounds.max;}
      }
      const shownRanges=new Set();
      for(const [axisId,axis] of Object.entries(axes)){
        const rangeKey=JSON.stringify([memberships.get(axisId),axis.min,axis.max]);
        if(shownRanges.has(rangeKey)){
          axis.ticks.display=false;axis.title.text=String(axis.title.text).replace(/^모터 (\d+).*$/,'M$1').replace(/^([^.[\]]+)\./,'');
          axis.title.font={size:9};axis.title.padding=1;axis.grid.drawTicks=false;
        }else {shownRanges.add(rangeKey);axis.ticks.display=true;axis.ticks.font={family:'Arial',size:10};axis.ticks.padding=2;axis.title.padding=2;}
      }
      config.customAxes=axes;return config;
    }

    function buildCustomFieldScales(fields, palette, limits = {}) {
      return Object.fromEntries(fields.map((field,index) => {
        const color = palette[index % palette.length];
        return [customFieldAxisId(index), {
          type:'linear', position:'left', weight:fields.length-index, display:true,
          title:{display:true,text:field,color,font:{size:10}},
          ticks:{color,font:{family:'Arial',size:11},minRotation:45,maxRotation:45},
          border:{color}, grid:{drawOnChartArea:index === 0,color:'rgba(149,163,184,0.18)'},
          min:limits[field]?.min, max:limits[field]?.max
        }];
      }));
    }

    function buildCustomFieldConfig(fields, fullRange=false) {
        const palette = ['#9467bd','#8c564b','#1f77b4','#2ca02c','#d62728','#ff7f0e','#17becf','#e377c2'];
        const ds = [];
        fields.forEach((mf, idx) => {
          const [messageName, fName] = mf.split('.');
          const selectedInstance=/^(.*)\[([^\]]+)\]$/.exec(messageName);
          const mName=selectedInstance?selectedInstance[1]:messageName;
          const rows = appState.parsedLog.tables[mName] || [];
          const instanceKey = messageInstanceField(appState.parsedLog,mName);
          if(appState.parsedLog.nativeId&&!appState.parsedLog.nativeMetadata.isText){
            for(const curve of nativeFieldPlot(appState.parsedLog,mName,fName,instanceKey,selectedInstance?.[2],fullRange))ds.push({
              label:instanceKey&&!selectedInstance?mf+' ['+instanceKey+'='+curve.instance+']':mf,
              data:curve.data,statistics:curve.statistics,nativePrepared:true,borderColor:palette[idx%palette.length],borderWidth:1.8,pointRadius:0,yAxisID:customFieldAxisId(idx)
            });
            return;
          }
          const filteredRows = rows.filter(r => {
            const s = (r.TimeUS || 0) / 1e6;
            return (!selectedInstance || (instanceKey && String(r[instanceKey])===selectedInstance[2])) &&
              (fullRange || !appState.zoomWindow || (s >= appState.zoomWindow.minSec && s <= appState.zoomWindow.maxSec));
          });
          const instances=instanceKey?new Set():new Set(['']);if(instanceKey)for(const row of filteredRows)instances.add(row[instanceKey]);
          for (const instance of instances) ds.push({
            label: instanceKey && !selectedInstance ? mf + ' [' + instanceKey + '=' + instance + ']' : mf,
            data: mapPlotRows(instanceKey?filteredRows.filter(r=>r[instanceKey]===instance):filteredRows,r=>({x:r.TimeUS/1e6,y:readPlotField(r,fName)})),
            borderColor: palette[idx % palette.length],
            borderWidth:1.8, pointRadius:0,
            yAxisID: customFieldAxisId(idx)
          });
        });
        return {
          title: `사용자 지정 필드 플롯 (${fields.join(', ')})`,
          datasets: ds,
          customAxes:buildCustomFieldScales(fields,palette,appState.customAxisLimits),
          yLabel: fields[0] || 'Value',
          y1Label: fields[1] || null
        };
    }

    function renderTelemetryCharts(prepared,expectedRevision) {
      const a = appState.analysis;
      if (!a) return;
      if(!prepared&&appState.parsedLog?.nativeId&&typeof startNativePlotRefresh==='function'){
        if(expectedRevision===undefined){cancelPlotRefresh();expectedRevision=plotRevision;}
        startNativePlotRefresh(expectedRevision);return;
      }
      if(expectedRevision!==undefined&&expectedRevision!==plotRevision)return;
      const pts = prepared?null:getFilteredTimeline();

      let cfg=prepared?.config;
      if(cfg){}else if (appState.customFields.length > 0) {
        cfg = buildCustomFieldConfig(appState.customFields);
      } else {
        cfg = buildPresetConfig(appState.activePreset, pts);
      }

      document.getElementById('chartTitleLabel').textContent = cfg.title;
      renderCustomAxisControls(appState.customFields);

      if(!prepared){normalizePlotDatasets(cfg.datasets);styleUavDatasets(cfg.datasets,!!cfg.customAxes);synchronizePlotAxes(cfg,appState.customFields);}
      renderPlotLegend(cfg.datasets);
      const commonXScale = {
        type: 'linear',
        min: appState.zoomWindow?.minSec ?? a.minSec,
        max: appState.zoomWindow?.maxSec ?? a.maxSec,
        grid: { color: '#e5e5e5' },
        border:{color:'#888'},
        ticks: {
          color: '#444',
          font: { family: 'JetBrains Mono', size: 10 },
          callback(val) {
            return appState.timeMode === 'KST' ? a.secToKstStr(val) : Number(val).toFixed(3);
          }
        }
      };

      const mainCtx = document.getElementById('mainTelemetryChart').getContext('2d');
      mainChart = updateOrCreateChart(mainChart, mainCtx, {
        type: 'line',
        data: { datasets: cfg.datasets },
        options: {
          layout:{padding:{top:4}},
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          onHover(event, elements, chart) {
            if(plotGesture||plotWorker||plotRefreshTimer!==null)return;
            if (!event.native) return;
            const rect = chart.canvas.getBoundingClientRect();
            const xPx = event.native.clientX - rect.left;
            const secVal = chart.scales.x.getValueForPixel(xPx);
            if (Number.isFinite(secVal)) {
              syncScrubberToSec(secVal, false);
            }
          },
          plugins: {
            manualAxisLimits:false,
            legend: {display:false},
            tooltip: {
              backgroundColor: 'rgba(15, 23, 42, 0.92)',
              borderColor: '#b5bfcc',
              borderWidth: 1,
              titleFont: { family: 'JetBrains Mono', size: 11 },
              bodyFont: { family: 'JetBrains Mono', size: 11 },
              callbacks: {
                title(items) {
                  if (!items.length) return '';
                  const s = items[0].parsed.x;
                  return a.hasAbsoluteTime ? `${a.secToKstStr(s)} KST (${a.secToBootStr(s)})` : `${a.secToBootStr(s)} · GPS 시각 없음`;
                }
              }
            }
          },
          scales: {
            x: commonXScale,
            y: {
              type: 'linear',
              position: 'left',
              title: { display: !!cfg.yLabel, text: cfg.yLabel, color: '#9467bd', font: { size: 11 } },
              grid: { color: '#e5e5e5' },border:{color:'#888'},
              ticks: { color: '#9467bd', font: { family: 'Arial', size: 11 } }
            },
            y1: {
              type: 'linear',
              position: 'right',
              display: !!cfg.y1Label,
              title: { display: !!cfg.y1Label, text: cfg.y1Label || '', color: '#8c564b', font: { size: 11 } },
              grid: { drawOnChartArea: false },
              ticks: { color: '#8c564b', font: { family: 'Arial', size: 11 } }
            },
            ...(cfg.customAxes || {})
          }
        }
      });

      updateZoomRangeUI();
      bindInteractiveChartZoom(document.getElementById('mainTelemetryChart'), () => mainChart);
      if(prepared){mainChart._overlayAnalysis=prepared.overlay;if(prepared.overview)appState.overviewCache={analysis:a,key:JSON.stringify([appState.customFields,appState.activePreset,appState.altSourceMode]),datasets:prepared.overview};}
      mainChart._plotAnalysis=a;setPlotQueryStatus('');
      renderTimelineOverview(cfg);
    }

    function styleUavDatasets(datasets,custom=false) {
      const colors=['#9467bd','#8c564b','#1f77b4','#2ca02c','#d62728','#ff7f0e'];
      datasets.forEach((ds,i)=>{
        const color=custom?ds.borderColor:colors[i%colors.length];
        ds.borderColor=color;ds.borderWidth=1.2;ds.pointRadius=0;
        ds.backgroundColor='transparent';ds.fill=false;
      });
    }

    function renderPlotLegend(datasets) {
      const el=document.getElementById('plotLegend');if(!el)return;
      el.replaceChildren();
      const number=value=>Number.isFinite(value)?value.toFixed(2):'—';
      datasets.forEach((ds,i)=>{
        const row=document.createElement('button');row.type='button';row.className='plot-legend-row';
        const swatch=document.createElement('span');swatch.className='plot-legend-swatch';swatch.style.background=ds.borderColor;
        const label=document.createElement('span');label.style.color=ds.borderColor;label.textContent=ds.label;
        const stats=document.createElement('span');stats.textContent=` | Min: ${number(ds.statistics?.min)}   Max: ${number(ds.statistics?.max)}   Mean: ${number(ds.statistics?.mean)}`;
        row.append(swatch,label,stats);row.addEventListener('click',()=>{
          if(!mainChart)return;mainChart.setDatasetVisibility(i,!mainChart.isDatasetVisible(i));mainChart.update('none');
          if(overviewChart){overviewChart.setDatasetVisibility(i,mainChart.isDatasetVisible(i));overviewChart.update('none');}
          row.style.opacity=mainChart.isDatasetVisible(i)?'1':'.4';
        });el.append(row);
      });
    }

    const overviewSelectionPlugin={id:'overviewSelection',afterDraw(chart){
      if(chart.canvas.id!=='timelineOverviewChart'||!appState.analysis||!chart.chartArea)return;
      const a=appState.analysis,range=appState.zoomWindow||{minSec:a.minSec,maxSec:a.maxSec};
      const {ctx,chartArea:area,scales}=chart;
      const left=Math.max(area.left,Math.min(area.right,scales.x.getPixelForValue(range.minSec)));
      const right=Math.max(area.left,Math.min(area.right,scales.x.getPixelForValue(range.maxSec)));
      ctx.save();ctx.fillStyle='rgba(100,100,100,.6)';ctx.fillRect(area.left,area.top,left-area.left,area.height);ctx.fillRect(right,area.top,area.right-right,area.height);
      ctx.strokeStyle='#777';ctx.strokeRect(left,area.top,right-left,area.height);
      for(const x of [left,right]){ctx.fillStyle='#fff';ctx.fillRect(x-3,area.top+area.height*.2,6,area.height*.6);ctx.strokeStyle='#777';ctx.strokeRect(x-3,area.top+area.height*.2,6,area.height*.6);}
      ctx.restore();
    }};
    Chart.register(overviewSelectionPlugin,{id:'whitePlotBackground',beforeDraw(chart){
      if(!['mainTelemetryChart','timelineOverviewChart'].includes(chart.canvas.id))return;
      const ctx=chart.ctx;ctx.save();ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,chart.width,chart.height);ctx.restore();
    }});

    function visibleModeSegments(segments,min,max) {
      return segments.filter(s=>s.endSec>min && s.startSec<max).map(s=>({...s,startSec:Math.max(min,s.startSec),endSec:Math.min(max,s.endSec)}));
    }

    function modeBackgroundColor(mode) {
      const colors={ALT_HOLD:'#fff6d6',LOITER:'#fde8ee',STABILIZE:'#eaf3ff',RTL:'#e6f5ec',AUTO:'#eeeafd',GUIDED:'#fff0df',LAND:'#edf1f6'};
      if(colors[mode.name])return colors[mode.name];
      const palette=['#fff6d6','#fde8ee','#eaf3ff','#e6f5ec','#eeeafd','#fff0df'];
      const hash=Array.from(mode.name||'').reduce((sum,c)=>sum+c.charCodeAt(0),0);
      return palette[hash%palette.length];
    }

    Chart.register({id:'flightModeSections',beforeDraw(chart){
      if(!['mainTelemetryChart','timelineOverviewChart'].includes(chart.canvas.id)||!chart.chartArea||!appState.analysis)return;
      const {ctx,chartArea:area,scales}=chart;
      const modes=visibleModeSegments((chart._overlayAnalysis||appState.analysis).modeSegments||[],scales.x.min,scales.x.max);
      ctx.save();ctx.beginPath();ctx.rect(area.left,area.top,area.width,area.height);ctx.clip();
      for(const mode of modes){
        const left=scales.x.getPixelForValue(mode.startSec),right=scales.x.getPixelForValue(mode.endSec);
        ctx.fillStyle=modeBackgroundColor(mode);ctx.fillRect(left,area.top,right-left,area.height);
      }
      ctx.restore();
    },beforeDatasetsDraw(chart){
      if(!['mainTelemetryChart','timelineOverviewChart'].includes(chart.canvas.id)||!chart.chartArea||!appState.analysis)return;
      const {ctx,chartArea:area,scales}=chart;const modes=(chart._overlayAnalysis||appState.analysis).modeSegments||[];
      ctx.save();ctx.beginPath();ctx.rect(area.left,area.top,area.width,area.height);ctx.clip();
      ctx.lineWidth=1;ctx.strokeStyle='#8b919a';ctx.setLineDash([5,4]);
      for(const mode of modes){
        if(mode.startSec<=scales.x.min || mode.startSec>=scales.x.max)continue;
        const x=scales.x.getPixelForValue(mode.startSec);ctx.beginPath();ctx.moveTo(x,area.top);ctx.lineTo(x,area.bottom);ctx.stroke();
      }
      ctx.restore();
    },afterDraw(chart){
      if(chart.canvas.id!=='mainTelemetryChart'||!chart.chartArea||!appState.analysis)return;
      const {ctx,chartArea:area,scales}=chart;
      const modes=visibleModeSegments((chart._overlayAnalysis||appState.analysis).modeSegments||[],scales.x.min,scales.x.max);
      ctx.save();ctx.font='bold 12px Arial';ctx.textBaseline='middle';ctx.textAlign='center';
      for(const mode of modes){
        const left=scales.x.getPixelForValue(mode.startSec),right=scales.x.getPixelForValue(mode.endSec),width=right-left;
        if(width<20)continue;
        let label=mode.name;
        while(label.length>1 && ctx.measureText(label).width>width-8)label=label.slice(0,-1);
        if(label!==mode.name)label=label.slice(0,-1)+'…';
        ctx.save();ctx.beginPath();ctx.rect(left,area.top,width,area.height);ctx.clip();
        const textWidth=ctx.measureText(label).width+14,center=(left+right)/2,y=area.bottom-17;
        ctx.fillStyle=modeBackgroundColor(mode);ctx.fillRect(center-textWidth/2,y-10,textWidth,20);
        ctx.strokeStyle='#7e879355';ctx.setLineDash([]);ctx.strokeRect(center-textWidth/2,y-10,textWidth,20);
        ctx.fillStyle='#3f4652';ctx.fillText(label,center,y);ctx.restore();
      }
      ctx.restore();
    }});

    function getOverviewRange(mode,startMin,startMax,startSec,currentSec,logMin,logMax) {
      startSec=Math.max(logMin,Math.min(logMax,startSec));currentSec=Math.max(logMin,Math.min(logMax,currentSec));
      const minimum=Math.min(1,logMax-logMin);
      if(mode==='move')return getPannedTimeWindow(startMin,startMax,startSec-currentSec,logMin,logMax);
      if(mode==='left')return {minSec:Math.max(logMin,Math.min(startMax-minimum,currentSec)),maxSec:startMax};
      if(mode==='right')return {minSec:startMin,maxSec:Math.min(logMax,Math.max(startMin+minimum,currentSec))};
      const minSec=Math.min(logMax-minimum,Math.min(startSec,currentSec));
      return {minSec,maxSec:Math.max(minSec+minimum,Math.max(startSec,currentSec))};
    }

    function bindTimelineOverview(canvas) {
      if(canvas._overviewBound)return;canvas._overviewBound=true;
      let drag=null,frame=null,pending=null;
      const apply=()=>{frame=null;if(pending){const range=pending;pending=null;applyZoomRange(range.minSec,range.maxSec);}};
      canvas.addEventListener('pointerdown',event=>{
        if(event.button!==0||!overviewChart?.scales.x||!appState.analysis)return;
        const a=appState.analysis,scale=overviewChart.scales.x,rect=canvas.getBoundingClientRect();
        cancelPlotRefresh();plotGesture=true;
        const pixel=(event.clientX-rect.left)*overviewChart.width/rect.width;
        const range=appState.zoomWindow||{minSec:a.minSec,maxSec:a.maxSec};
        const left=scale.getPixelForValue(range.minSec),right=scale.getPixelForValue(range.maxSec);
        const mode=Math.abs(pixel-left)<9?'left':Math.abs(pixel-right)<9?'right':pixel>left&&pixel<right?'move':'new';
        drag={mode,min:Math.max(a.minSec,range.minSec),max:Math.min(a.maxSec,range.maxSec),sec:scale.getValueForPixel(pixel),analysis:a};
        canvas.setPointerCapture(event.pointerId);event.preventDefault();
      });
      canvas.addEventListener('pointermove',event=>{
        if(!drag||drag.analysis!==appState.analysis)return;
        const rect=canvas.getBoundingClientRect();const sec=overviewChart.scales.x.getValueForPixel((event.clientX-rect.left)*overviewChart.width/rect.width);
        pending=getOverviewRange(drag.mode,drag.min,drag.max,drag.sec,sec,drag.analysis.minSec,drag.analysis.maxSec);
        if(frame===null)frame=requestAnimationFrame(apply);
      });
      const end=()=>{if(frame!==null){cancelAnimationFrame(frame);apply();}drag=null;finishPlotGesture();};
      for(const event of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(event,end);
      canvas.addEventListener('dblclick',()=>{appState.zoomWindow=null;renderTelemetryCharts();});
    }

    function renderTimelineOverview() {
      const a=appState.analysis,canvas=document.getElementById('timelineOverviewChart');if(!a||!canvas)return;
      const key=JSON.stringify([appState.customFields,appState.activePreset,appState.altSourceMode]);
      let cache=appState.overviewCache;
      if(!cache||cache.analysis!==a||cache.key!==key){
        const config=appState.customFields.length?buildCustomFieldConfig(appState.customFields,true):buildPresetConfig(appState.activePreset,a.timeline);
        normalizePlotDatasets(config.datasets,null);styleUavDatasets(config.datasets,!!config.customAxes);
        cache=appState.overviewCache={analysis:a,key,datasets:config.datasets.map(ds=>{
          const lo=ds.statistics?.min??0,span=(ds.statistics?.max??1)-lo||1;
          return {...ds,data:ds.data.map(p=>({x:p.x,y:p.y===null?null:(p.y-lo)/span})),yAxisID:'y',fill:false,borderWidth:1};
        })};
      }
      overviewChart=updateOrCreateChart(overviewChart,canvas.getContext('2d'),{type:'line',data:{datasets:cache.datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,events:[],plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{type:'linear',min:a.minSec,max:a.maxSec,display:false},y:{type:'linear',display:false,min:0,max:1}}}});
      bindTimelineOverview(canvas);
      const caption=document.getElementById('overviewRangeLabel');
      if(caption)caption.textContent=`${(appState.zoomWindow?.minSec??a.minSec).toFixed(3)} – ${(appState.zoomWindow?.maxSec??a.maxSec).toFixed(3)} s`;
    }
