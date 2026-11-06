    function renderMultiLogManager() {
      refreshLogComparison();
      const emptySec = document.getElementById('emptyUploadSection');
      const loadedSec = document.getElementById('loadedWorkspaceContainer');
      document.getElementById('topAnalysisTools')?.classList.toggle('hidden',appState.logs.length===0);
      const clearBtn = document.getElementById('btnClearAllLogs');

      if (appState.logs.length === 0) {
        emptySec.classList.remove('hidden');
        loadedSec.classList.add('hidden');
        clearBtn.classList.add('hidden');
        clearBtn.classList.remove('inline-flex');
        renderFrameTypeLabel(undefined);
        return;
      }

      emptySec.classList.add('hidden');
      loadedSec.classList.remove('hidden');
      clearBtn.classList.remove('hidden');
      clearBtn.classList.add('inline-flex');

      const totalSortiesCount = appState.logs.reduce((acc, item) => acc + ((item.analysis && item.analysis.sorties) ? item.analysis.sorties.length : 1), 0);
      document.getElementById('attachedCountBadge').textContent = `총 ${appState.logs.length}개 파일 · 총 ${totalSortiesCount}쏘티`;
      document.getElementById('logbookPreviewTextarea').value = buildAllLogsCopyText();

      const listEl = document.getElementById('multiLogListContainer');
      listEl.innerHTML = '';

      appState.logs.forEach((item, idx) => {
        const isSelected = idx === appState.activeLogIndex;
        const a = item.analysis;
        const sCount = a.sorties ? a.sorties.length : 0;
        const failCount = a.diagnostics.filter(d => d.status === 'FAIL').length;
        const warnCount = a.diagnostics.filter(d => d.status === 'WARN').length;
        const badgeClass = failCount > 0
          ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
          : (warnCount > 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40');
        const badgeLabel = failCount > 0 ? '경고' : (warnCount > 0 ? '주의' : '정상');
        const sortieBadgeClass = sCount > 1
          ? 'bg-amber-500/25 text-amber-300 border-amber-500/50'
          : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30';

        const sortieLinesHtml = a.groundOnly ? '<div class="text-slate-400">비행 미감지</div>' : (a.sorties || []).map(s =>
          sCount > 1
            ? `<div class="text-sky-300 font-semibold"><span class="text-amber-300 mr-1">[${s.index}쏘티]</span>${s.logbookLine}</div>`
            : `<div class="text-sky-300 font-semibold">${s.logbookLine}</div>`
        ).join('');

        const row = document.createElement('div');
        row.className = `flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs transition cursor-pointer ${
          isSelected ? 'bg-sky-500/15 border-l-4 border-l-sky-400' : 'hover:bg-slate-900/80'
        }`;

        row.innerHTML = `
          <div class="flex items-center gap-2 min-w-0">
            <span class="px-1.5 py-0.5 rounded text-[10px] font-bold mono-num ${isSelected ? 'bg-sky-500 text-white' : 'bg-slate-800 text-slate-400'}">#${idx + 1}</span>
            <span class="font-semibold text-white truncate max-w-[165px]" title="${item.fileName}">${item.fileName}</span>
            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold border mono-num ${sortieBadgeClass}">${sCount}쏘티</span>
            ${a.isLogCutoff ? '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold border mono-num bg-rose-500/20 text-rose-300 border-rose-500/40" title="시동 해제(DISARM) 없이 로그가 중간에 끊긴 파일입니다">⚠️ 로그끊김</span>' : ''}
            <span class="px-1.5 py-0.2 rounded text-[10px] font-bold border mono-num ${badgeClass}">${badgeLabel}</span>
          </div>
          <div class="flex items-center gap-3 mono-num">
            <div class="text-right leading-tight" title="1회 이착륙당 1쏘티 (이륙시각 착륙시각 :비행시간)">${sortieLinesHtml}</div>
            <span class="text-slate-400 text-[11px] hidden sm:inline">최고 ${a.maxRelAlt.toFixed(1)}m</span>
            <button type="button" data-copy-single="${idx}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px]" title="이 로그의 모든 소티 시간 복사">복사</button>
            <button type="button" data-remove-log="${idx}" class="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-rose-500/30 text-slate-400 hover:text-rose-300 text-[10px]" title="목록에서 제거">✕</button>
          </div>
        `;

        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-copy-single]') || e.target.closest('[data-remove-log]')) return;
          selectLogByIndex(idx);
        });

        row.querySelector('[data-copy-single]').addEventListener('click', (e) => {
          e.stopPropagation();
          copyTextToClipboard(a.logbookLine, `${item.fileName} 비행시간(${a.logbookLine}) 복사 완료!`);
        });

        row.querySelector('[data-remove-log]').addEventListener('click', (e) => {
          e.stopPropagation();
          if(idx===appState.activeLogIndex){mainChart?.destroy();overviewChart?.destroy();mainChart=null;overviewChart=null;}
          appState.logs[idx].parsedLog.releaseRawBytes?.();
          appState.logs[idx].parsedLog.dispose?.();
          appState.logs.splice(idx, 1);
          if (appState.logs.length === 0) {
            appState.activeLogIndex = -1;
            appState.parsedLog = null;
            appState.analysis = null;
            renderMultiLogManager();
          } else {
            const nextIdx = Math.min(appState.activeLogIndex, appState.logs.length - 1);
            selectLogByIndex(nextIdx);
          }
        });

        listEl.appendChild(row);
      });
    }

    // Quick view button 1 shows the active log's frame type instead of a fixed "(쿼드)".
    // frameInfo: undefined = no log loaded, null = log has no frame info.
    function renderFrameTypeLabel(frameInfo) {
      const label = document.getElementById('frameTypeLabel');
      const btn = document.getElementById('btnSampleNormal');
      if (frameInfo === undefined) {
        label.textContent = '';
        btn.title = '로그를 열면 기체 형태(쿼드/헥사 등)를 자동으로 판별해 표시합니다.';
      } else if (frameInfo) {
        label.textContent = `(${frameInfo.name})`;
        btn.title = `기체 형태 판별 근거: ${frameInfo.source}`;
      } else {
        label.textContent = '(기체 미확인)';
        btn.title = '로그에 Frame 메시지나 FRAME_CLASS 파라미터가 없어 기체 형태를 판별하지 못했습니다.';
      }
    }

    function selectLogByIndex(idx) {
      const item=appState.logs[idx];if(!item)return Promise.resolve();
      return queueLogTask(async()=>{const current=appState.logs.indexOf(item);if(current>=0)await activateLogByIndex(current);});
    }

    async function activateLogByIndex(idx) {
      if (idx < 0 || idx >= appState.logs.length) return;
      stopPlayback();
      const item=appState.logs[idx];
      // Chart datasets can retain views of the previous raw store. Those views
      // remain valid, but only the newly selected store is resident in memory.
      try{await item.parsedLog.ensureLoaded?.();}catch(error){showToast(`${item.fileName} — ${error.message}`);return;}
      for(const log of appState.logs)if(log!==item)log.parsedLog.releaseRawBytes?.();
      appState.activeLogIndex = idx;
      appState.mapView = createMapView(appState.mapView?.mode||'2d');
      appState.zoomWindow = null;
      appState.parsedLog = appState.logs[idx].parsedLog;
      appState.analysis = appState.logs[idx].analysis;
      renderMultiLogManager();
      // A newly opened/selected log always reveals its charts, even after
      // the previous log was inspected in the route or diagnostics view.
      switchMainTab('workspace');
      renderAllViews();
      document.getElementById('analysisMain')?.scrollTo({top:0});
      window.scrollTo({top:0});
    }

    function renderAllViews() {
      const p = appState.parsedLog;
      const a = appState.analysis;
      if (!p || !a) return;
      const timeButton=document.getElementById('btnTimeModeKST');
      timeButton.textContent=a.hasAbsoluteTime?'실제시각 (KST)':'GPS 시각 없음 · T+';
      for(const [id,mode] of [['btnTimeModeKST','KST'],['btnTimeModeBoot','BOOT']]){
        const button=document.getElementById(id);button.classList.toggle('bg-sky-600',appState.timeMode===mode);
        button.classList.toggle('text-white',appState.timeMode===mode);button.classList.toggle('text-slate-400',appState.timeMode!==mode);
      }
      timeButton.title=a.hasAbsoluteTime?'GPS 기준 실제 시각':'실제 날짜를 확인할 수 없어 부팅 후 경과시간으로 표시합니다.';

      document.getElementById('fileNameDisplay').textContent = p.fileName;
      document.getElementById('fileSizeDisplay').textContent =
        `(${(p.byteLength / 1024).toFixed(1)} KB · ${p.fmtList.length}개 FMT 스키마 · ${p.totalPackets.toLocaleString()} 패킷)`;
      document.getElementById('firmwareDisplay').textContent =
        `${a.firmwareStr}${a.hardwareStr ? ' · ' + a.hardwareStr : ''}`;
      renderFrameTypeLabel(a.frameInfo);
      document.getElementById('sourceModeBadge').textContent =
        `활성 로그 #${appState.activeLogIndex + 1} / ${appState.logs.length}`;

      const failCount = a.diagnostics.filter(d => d.status === 'FAIL').length;
      const warnCount = a.diagnostics.filter(d => d.status === 'WARN').length;
      const passCount = a.diagnostics.filter(d => d.status === 'PASS').length;
      const vBadge = document.getElementById('verdictBadge');
      const vText = document.getElementById('verdictText');
      const diagBadge = document.getElementById('diagAlertCountBadge');

      if (failCount > 0) {
        vBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wide flex items-center gap-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/40';
        vText.textContent = `경고 · 점검 필요 ${failCount}건`;
        diagBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-rose-500/20 text-rose-300 mono-num';
        diagBadge.textContent = `경고 ${failCount}건`;
      } else if (warnCount > 0) {
        vBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wide flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40';
        vText.textContent = `주의 · 확인 필요 ${warnCount}건`;
        diagBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-300 mono-num';
        diagBadge.textContent = `주의 ${warnCount}건`;
      } else {
        vBadge.className = 'px-3 py-1 rounded-full text-xs font-bold tracking-wide flex items-center gap-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
        vText.textContent = '정상 · 전 항목 정상';
        diagBadge.className = 'px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 mono-num';
        diagBadge.textContent = `${passCount}/${a.diagnostics.length} 정상`;
      }

      const sList = (a.sorties && a.sorties.length > 0) ? a.sorties : [];
      const curSortieIdx = Math.min(a.activeSortieIdx || 0, Math.max(0, sList.length - 1));
      const activeSortie = sList[curSortieIdx] || {
        index: 1,
        armSec: a.armSec, armKst: a.armKst, armBoot: a.armBoot,
        takeoffSec: a.takeoffSec, takeoffKst: a.takeoffKst, takeoffBoot: a.takeoffBoot, takeoffTrigger: a.takeoffTrigger,
        landingSec: a.landingSec, landingKst: a.landingKst, landingBoot: a.landingBoot, landingTrigger: a.landingTrigger,
        disarmSec: a.disarmSec, disarmKst: a.disarmKst, disarmBoot: a.disarmBoot,
        durationSec: a.airborneDurationSec, durationColonHHMMSS: a.durationColonHHMMSS, logbookLine: a.logbookLine
      };

      document.getElementById('flightDateLabel').textContent = `${a.dateStr} — ${p.fileName}`;
      document.getElementById('detectionMethodBadge').textContent =
        `판정 근거 (${activeSortie.index}쏘티): 이륙[${activeSortie.takeoffTrigger}] · 착륙[${activeSortie.landingTrigger}]`;

      // Render Sortie Selector Chips (1쏘티, 2쏘티, ...)
      const sortieBar = document.getElementById('sortieSelectorBar');
      if (sortieBar) {
        sortieBar.innerHTML = '';
        sList.forEach((s, sIdx) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          const isAct = sIdx === curSortieIdx;
          btn.className = isAct
            ? 'px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500 text-slate-950 shadow-sm mono-num transition'
            : 'px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 mono-num transition';
          btn.textContent = `${s.index}쏘티 (${s.durationColonHHMMSS})`;
          btn.title = `${s.index}쏘티: ${s.logbookLine} — 클릭 시 해당 소티 구간으로 이동`;
          btn.addEventListener('click', () => {
            a.activeSortieIdx = sIdx;
            switchMainTab('workspace');
            appState.zoomWindow = {
              minSec: Math.max(a.minSec, s.takeoffSec - 8),
              maxSec: Math.min(a.maxSec, s.landingSec + 8)
            };
            renderAllViews();
            syncScrubberToSec(s.takeoffSec, true);
            showToast(`${s.index}쏘티 (${s.logbookLine}) 구간으로 포커스했습니다.`);
          });
          sortieBar.appendChild(btn);
        });
      }

      document.getElementById('valArmTimeKST').textContent = `${activeSortie.armKst}`;
      document.getElementById('valArmTimeBoot').textContent = `부팅 ${activeSortie.armBoot}`;

      document.getElementById('valTakeoffTimeKST').textContent = `${activeSortie.takeoffKst}`;
      document.getElementById('valTakeoffTimeBoot').textContent =
        `부팅 ${activeSortie.takeoffBoot} (${activeSortie.index}쏘티 이륙)`;
      document.getElementById('badgeTakeoffTrigger').textContent = activeSortie.takeoffTrigger.split(' ')[0];

      document.getElementById('valLandingTimeKST').textContent = `${activeSortie.landingKst}`;
      document.getElementById('valLandingTimeBoot').textContent =
        `부팅 ${activeSortie.landingBoot} (소티비행 ${activeSortie.durationColonHHMMSS})`;
      document.getElementById('badgeLandingTrigger').textContent = activeSortie.landingTrigger.split(' ')[0];

      const disarmCardEl = document.getElementById('cardJumpDisarm');
      const disarmTitleSpan = disarmCardEl ? disarmCardEl.querySelector('div > span:first-child') : null;
      const disarmBadgeSpan = disarmCardEl ? disarmCardEl.querySelector('div > span:last-child') : null;

      if (activeSortie.isCutoff || (a.isLogCutoff && curSortieIdx === sList.length - 1)) {
        if (disarmTitleSpan) {
          disarmTitleSpan.textContent = '④ ⚠️ 로그 끊김 (기록중단)';
          disarmTitleSpan.className = 'text-rose-400 font-bold';
        }
        if (disarmBadgeSpan) {
          disarmBadgeSpan.textContent = 'LOG CUT';
          disarmBadgeSpan.className = 'text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 mono-num font-bold';
        }
        document.getElementById('valDisarmTimeKST').textContent = `${activeSortie.disarmKst}`;
        document.getElementById('valDisarmTimeBoot').textContent =
          `부팅 ${activeSortie.disarmBoot} (시동해제 미기록 · 고도 ${a.lastAltAtEnd.toFixed(1)}m)`;
      } else {
        if (disarmTitleSpan) {
          disarmTitleSpan.textContent = '④ 시동 해제 (DISARM)';
          disarmTitleSpan.className = '';
        }
        if (disarmBadgeSpan) {
          disarmBadgeSpan.textContent = 'EV 11';
          disarmBadgeSpan.className = 'text-[10px] px-1.5 py-0.2 rounded bg-slate-700 text-slate-300 mono-num';
        }
        document.getElementById('valDisarmTimeKST').textContent = `${activeSortie.disarmKst}`;
        document.getElementById('valDisarmTimeBoot').textContent =
          `부팅 ${activeSortie.disarmBoot}`;
      }

      document.getElementById('sortieCountLabel').textContent =
        `감지된 이착륙 소티: 총 ${sList.length}쏘티 · 선택(${activeSortie.index}쏘티): ${activeSortie.logbookLine}${a.isLogCutoff ? ' [⚠️ 마지막 로그 끊김]' : ''}`;

      // Render Sensor Error & RC Failsafe Quick Jump Badges above Main Chart
      const errBadgesBox = document.getElementById('sensorErrorBadgesContainer');
      if (errBadgesBox) {
        errBadgesBox.innerHTML = '<span class="text-[11px] font-bold text-slate-400 mr-1">차트 센서오류·페일세이프 시점:</span>';
        if (!a.chartErrorMarkers || a.chartErrorMarkers.length === 0) {
          const okSpan = document.createElement('span');
          okSpan.className = 'px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
          okSpan.textContent = '✓ 비행 중 센서 오류·RC 페일세이프·로그 끊김 없음';
          errBadgesBox.appendChild(okSpan);
        } else {
          a.chartErrorMarkers.forEach((em) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 mono-num transition flex items-center gap-1';
            b.textContent = `${em.label}`;
            b.title = `${em.detail} — 클릭 시 해당 오류 발생 시각으로 확대`;
            b.addEventListener('click', () => {
              if (em.presetTarget) {
                appState.customFields = [];
                appState.activePreset = em.presetTarget;
                updatePresetButtonsUI();
              }
              appState.zoomWindow = {
                minSec: Math.max(a.minSec, em.sec - 15),
                maxSec: Math.min(a.maxSec, em.sec + 15)
              };
              updateZoomRangeUI();
              renderTelemetryCharts();
              syncScrubberToSec(em.sec, true);
              showToast(`${em.detail}`);
            });
            errBadgesBox.appendChild(b);
          });
        }
      }

      document.getElementById('statAirborneDuration').textContent = `${a.durationColonHHMMSS} (${formatDurationKo(a.airborneDurationSec)})`;
      document.getElementById('statArmedDuration').textContent =
        `총 시동: ${formatColonHHMMSS(a.armedDurationSec)} (${a.groundOnly ? '비행 미감지' : '지상대기'} ${a.groundIdleSec}초)`;

      const isAmsl = appState.altSourceMode === 'gps_amsl';
      document.getElementById('statAltCardTitle').textContent = isAmsl
        ? '최대 해발고도(AMSL) / 최고 속도'
        : '최대 상대고도(AGL) / 최고 속도';
      document.getElementById('statMaxAltSpeed').textContent = `${a.maxAlt.toFixed(1)} m / ${a.maxSpeed.toFixed(1)} m/s`;
      document.getElementById('statTotalDist').textContent =
        `해발 ${a.maxAmslAlt.toFixed(1)}m (지면 +${a.gpsAmslOffset.toFixed(1)}m 영점제외) · 거리 ${a.totalDistKm.toFixed(2)}km`;

      document.getElementById('statBatteryVolt').textContent = `${a.startVolt.toFixed(1)}V → ${a.minVolt.toFixed(1)}V`;
      document.getElementById('statBatteryCell').textContent =
        a.detectedCells ? `평균 셀전압 최저: ${a.minCellVolt.toFixed(2)}V/cell (${a.detectedCells}S · ${a.cellDetection.source})` : a.cellDetection.source;

      const vibeEl = document.getElementById('statMaxVibe');
      vibeEl.textContent = `${a.maxVibeAll.toFixed(1)} m/s²`;
      vibeEl.className = `text-base font-bold mono-num mt-1 ${a.maxVibeAll > appState.config.vibeCrit ? 'text-rose-400' : (a.maxVibeAll > appState.config.vibeWarn ? 'text-amber-400' : 'text-emerald-400')}`;
      document.getElementById('statClipCount').textContent =
        `IMU 클리핑: ${a.maxClip}회 (기준 <${appState.config.vibeWarn})`;

      document.getElementById('statGpsQuality').textContent = `${a.minSats} ~ ${a.maxSats}개 / ${a.maxHdop.toFixed(2)}`;
      document.getElementById('statMagInterference').textContent =
        `자기장 변동: ${a.magVarPct.toFixed(1)}% (${a.magVarPct > 30 ? '간섭 주의' : '양호'})`;
      document.getElementById('statAttitudeErr').textContent = `RMS ±${(a.rmsAttErr || 0).toFixed(1)}° (${(a.maxSustainedAttWarnSec || 0).toFixed(1)}s) / ${a.motorSpreadUs.toFixed(0)} µs`;
      document.getElementById('statErrorCount').textContent = `페일세이프/에러: ${a.activeErrCount}건`;

      const ribbon = document.getElementById('modeRibbonContainer');
      ribbon.innerHTML = '';
      const totalSpan = Math.max(1, a.maxSec - a.minSec);
      a.modeSegments.forEach(seg => {
        const pct = Math.max(2, ((seg.endSec - seg.startSec) / totalSpan) * 100);
        const div = document.createElement('div');
        div.style.width = `${pct}%`;
        div.style.backgroundColor = seg.color;
        div.className = 'h-full flex items-center justify-center text-slate-950 truncate px-1 cursor-pointer hover:opacity-85 transition';
        div.title = `${seg.name} (${a.secToKstStr(seg.startSec)} ~ ${a.secToKstStr(seg.endSec)}, ${formatDurationKo(seg.endSec - seg.startSec)})`;
        div.textContent = pct > 7 ? seg.name : '';
        div.addEventListener('click', () => {
          appState.zoomWindow = { minSec: seg.startSec, maxSec: seg.endSec };
          renderTelemetryCharts();
          syncScrubberToSec(seg.startSec, true);
          showToast(`${seg.name} 모드 구간(${a.secToKstStr(seg.startSec)} ~ ${a.secToKstStr(seg.endSec)})으로 확대했습니다.`);
        });
        ribbon.appendChild(div);
      });

      document.getElementById('scrubberStartLabel').textContent = a.secToKstStr(a.minSec);
      document.getElementById('scrubberEndLabel').textContent = a.secToKstStr(a.maxSec);

      renderCustomFieldExplorer();

      const diagGrid = document.getElementById('diagnosticsGrid');
      diagGrid.innerHTML = '';
      for (const d of a.diagnostics) {
        const badgeStyle = d.status === 'PASS'
          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
          : (d.status === 'WARN' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40');
        const statusKo = d.status === 'PASS' ? '정상' : (d.status === 'WARN' ? '주의' : '경고');
        const card = document.createElement('div');
        card.className = 'bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-2';
        card.innerHTML = `
          <div>
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <h4 class="text-xs font-bold text-white">${d.title}</h4>
              <span class="px-2 py-0.5 rounded text-[11px] font-bold border ${badgeStyle}">${statusKo}</span>
            </div>
            <div class="text-sm font-bold text-sky-300 mono-num mb-1">${d.metric}</div>
            <div class="text-[11px] text-slate-400 mono-num mb-2">판정 기준: ${d.threshold}</div>
            <p class="text-xs text-slate-300 leading-relaxed">${d.detail}</p>
          </div>
          <div class="pt-2 border-t border-slate-800/80 flex justify-end">
            <button type="button" data-jump-preset="${d.presetTarget}" class="text-[11px] text-sky-400 hover:text-sky-300 font-semibold">해당 파형 차트에서 보기 →</button>
          </div>
        `;
        card.querySelector('[data-jump-preset]').addEventListener('click', () => {
          appState.customFields = [];
          appState.activePreset = d.presetTarget;
          updatePresetButtonsUI();
          switchMainTab('workspace');
          renderTelemetryCharts();
        });
        diagGrid.appendChild(card);
      }

      const phaseBody = document.getElementById('phaseBreakdownTableBody');
      phaseBody.innerHTML = '';
      const milestones = [
        { label: a.groundOnly ? '비행 미감지 구간' : '시동 ~ 첫 이륙 준비 (지상 대기)', start: a.armSec, end: a.groundOnly ? a.disarmSec : a.takeoffSec, note: a.groundOnly ? '비행 여부를 확정하지 않습니다.' : '지면 영점(0m) 기준 구간', color: 'text-amber-300' }
      ];
      (a.sorties || []).forEach((s, idx) => {
        milestones.push({
          label: `★ ${s.index}쏘티 공중 비행 (이륙 ~ 착륙)`,
          start: s.takeoffSec,
          end: s.landingSec,
          note: `${s.logbookLine} · 최고 ${s.maxRelAlt.toFixed(1)}m`,
          color: 'text-sky-300 font-bold'
        });
        if (idx + 1 < a.sorties.length) {
          const nextS = a.sorties[idx + 1];
          milestones.push({
            label: `↳ ${s.index}쏘티 착륙 후 ~ ${nextS.index}쏘티 재이륙 대기`,
            start: s.landingSec,
            end: nextS.takeoffSec,
            note: '지상 재이륙 준비 구간',
            color: 'text-amber-200'
          });
        }
      });
      if (a.isLogCutoff) {
        milestones.push({
          label: '⚠️ 로그 끊김 (시동 해제 없이 기록 중단)',
          start: a.landingSec,
          end: a.disarmSec,
          note: `비정상 로그 종료 (마지막 고도 ${a.lastAltAtEnd.toFixed(1)}m · 스로틀 ${a.lastThOAtEnd.toFixed(0)}%)`,
          color: 'text-rose-400 font-bold'
        });
      } else if (!a.groundOnly) {
        milestones.push({
          label: '최종 착륙 ~ 시동 해제 (지상 정리)',
          start: a.landingSec,
          end: a.disarmSec,
          note: '착륙 완료 후 대기',
          color: 'text-indigo-300'
        });
      }
      milestones.forEach(m => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60 cursor-pointer';
        tr.innerHTML = `
          <td class="py-2 px-2 ${m.color}">${m.label}</td>
          <td class="py-2 px-2">${a.secToKstStr(m.start)} (${a.secToBootStr(m.start)})</td>
          <td class="py-2 px-2">${formatColonHHMMSS(m.end - m.start)}</td>
          <td class="py-2 px-2 text-slate-400">${m.note}</td>
        `;
        tr.addEventListener('click', () => {
          switchMainTab('workspace');
          appState.zoomWindow = { minSec: Math.max(a.minSec, m.start - 5), maxSec: Math.min(a.maxSec, m.end + 5) };
          renderTelemetryCharts();
          syncScrubberToSec(m.start, true);
        });
        phaseBody.appendChild(tr);
      });
      a.modeSegments.forEach(seg => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60 cursor-pointer';
        tr.innerHTML = `
          <td class="py-2 px-2"><span class="inline-block w-2 h-2 rounded-full mr-1.5" style="background:${seg.color}"></span>${seg.name}</td>
          <td class="py-2 px-2">${a.secToKstStr(seg.startSec)}</td>
          <td class="py-2 px-2">${formatColonHHMMSS(seg.endSec - seg.startSec)}</td>
          <td class="py-2 px-2 text-slate-400">${seg.desc || '비행 모드'}</td>
        `;
        tr.addEventListener('click', () => {
          switchMainTab('workspace');
          appState.zoomWindow = { minSec: seg.startSec, maxSec: seg.endSec };
          renderTelemetryCharts();
          syncScrubberToSec(seg.startSec, true);
        });
        phaseBody.appendChild(tr);
      });

      renderEventLogTable();
      renderParmAndFmtTables();
      if (a.groundOnly) {
        document.getElementById('verdictText').textContent = '비행 미감지';
        document.getElementById('sortieCountLabel').textContent = '감지된 이착륙 소티: 총 0쏘티 · 비행 미감지';
        for (const id of ['valTakeoffTimeKST','valLandingTimeKST']) document.getElementById(id).textContent = '—';
        for (const id of ['valTakeoffTimeBoot','valLandingTimeBoot']) document.getElementById(id).textContent = '비행 미감지';
        document.getElementById('detectionMethodBadge').textContent = '비행 미감지 · 고도 오차만으로 이착륙을 생성하지 않습니다.';
      }
      renderTelemetryCharts();
      syncScrubberToSec(a.takeoffSec, true);
    }

    function readPlotField(row, field) {
      const match=/^(.*)\[(\d+)\]$/.exec(field);
      const value=match?row[match[1]]?.[Number(match[2])]:row[field];
      return typeof value==='number' && Number.isFinite(value)?value:null;
    }

    function messageInstanceField(parsed, name) {
      const schemas=parsed.fmtList.filter(s=>s.name===name);
      for(const schema of schemas){
        const metadata=(parsed.tables.FMTU||[]).find(r=>Number(r.FmtType)===Number(schema.typeId));
        const index=String(metadata?.UnitIds||'').indexOf('#');
        if(index>=0 && schema.columns[index])return schema.columns[index];
        if(metadata)return null; // An I field may be a PID integral value, not an instance.
      }
      const rows=parsed.tables[name]||[];
      if(schemas.length)return ['I','Instance','IMU'].find(key=>schemas.some(schema=>schema.columns.includes(key)))||null;
      return ['I','Instance','IMU'].find(key=>rows.some(r=>r[key]!==undefined)) || null;
    }

    function messageFieldUnit(parsed,name,column) {
      if(column==='TimeUS')return 'µs';
      const schema=parsed.fmtList.find(s=>s.name===name && s.columns.includes(column));
      if(!schema)return '';
      const metadata=(parsed.tables.FMTU||[]).find(r=>Number(r.FmtType)===Number(schema.typeId));
      const id=String(metadata?.UnitIds||'')[schema.columns.indexOf(column)];
      if(!id || ['#','-','?'].includes(id))return '';
      return (parsed.tables.UNIT||[]).find(r=>Number(r.Id)===id.charCodeAt(0))?.Label || '';
    }

    function buildFieldCatalog(parsed) {
      if(parsed._fieldCatalog)return parsed._fieldCatalog;
      const names=new Set([...parsed.fmtList.map(s=>s.name),...Object.keys(parsed.tables)]);
      return parsed._fieldCatalog=[...names].sort().flatMap(name=>{
        const rows=parsed.tables[name]||[];
        if(!rows.length)return [];
        const instanceField=messageInstanceField(parsed,name);
        const instances=new Map();
        const catalogRows=instanceField?rows:rows.slice(0,64);
        for(const row of catalogRows){
          const id=instanceField?row[instanceField]:null;
          if(!instances.has(id))instances.set(id,{count:0,sample:[]});
          const bucket=instances.get(id);bucket.count++;
          if(bucket.sample.length<64)bucket.sample.push(row);
        }
        if(!instanceField&&instances.has(null))instances.get(null).count=rows.length;
        return [...instances].sort(([a],[b])=>Number(a)-Number(b)).map(([instance,bucket])=>{
        const sample=bucket.sample;
        const columns=new Set(parsed.fmtList.filter(s=>s.name===name).flatMap(s=>s.columns));
        for(const row of sample)for(const col of Object.keys(row))columns.add(col);
        const fields=[];
        for(const col of columns){
          const array=sample.find(r=>Array.isArray(r[col]))?.[col];
          const keys=array?Array.from({length:array.length},(_,i)=>`${col}[${i}]`):[col];
          for(const field of keys)fields.push({name:field,unit:messageFieldUnit(parsed,name,col),numeric:sample.some(r=>readPlotField(r,field)!==null)});
        }
        return {name:instanceField?`${name}[${instance}]`:name,baseName:name,instanceField,instance,rows:bucket.count,fields};
        });
      });
    }

    function renderCustomFieldExplorer() {
      const container = document.getElementById('customFieldExplorer');
      const query = (document.getElementById('fieldSearchInput').value || '').trim().toLowerCase();
      container.innerHTML = '';

      const p = appState.parsedLog;
      if (!p) return;

      const catalog=buildFieldCatalog(p);
      let shown=0;
      for (const schema of catalog) {
        const numericCols = schema.fields.map(f=>f.name);
        const matchedCols = query
          ? numericCols.filter(c => `${schema.name}.${c} ${schema.baseName}.${c}`.toLowerCase().includes(query))
          : numericCols;

        if (matchedCols.length === 0) continue;
        shown+=matchedCols.length;

        const group = document.createElement('details');
        group.open=!!query || numericCols.some(c=>appState.customFields.includes(`${schema.name}.${c}`));
        group.className = 'bg-slate-900/90 border border-slate-800 rounded-lg p-2';
        group.innerHTML = `
          <summary class="flex items-center justify-between text-[11px] font-bold text-sky-400 mb-1 cursor-pointer">
            <span></span>
            <span class="text-[10px] text-slate-400 mono-num">${schema.rows}pt</span>
          </summary>
          <div class="space-y-1"></div>
        `;
        group.querySelector('summary>span').textContent=schema.name;
        const listEl = group.querySelector('div.space-y-1');
        matchedCols.forEach(col => {
          const key = `${schema.name}.${col}`;
          const checked = appState.customFields.includes(key);
          const label = document.createElement('label');
          label.className = 'flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-white cursor-pointer';
          label.innerHTML = `
            <input type="checkbox" ${checked ? 'checked' : ''} class="rounded border-slate-600 text-sky-500 focus:ring-0" />
            <span class="mono-num truncate"></span>
          `;
          const fieldInfo=schema.fields.find(f=>f.name===col);
          label.querySelector('span').textContent=col+(fieldInfo.unit?` (${fieldInfo.unit})`:'');
          if(!schema.fields.find(f=>f.name===col).numeric){
            label.querySelector('input').disabled=true;
            label.title='문자열 또는 정밀도 보존 정수: 수치 그래프 대상이 아닙니다.';
            label.style.opacity='0.5';
          }
          label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
              if (!appState.customFields.includes(key)) appState.customFields.push(key);
            } else {
              appState.customFields = appState.customFields.filter(k => k !== key);
            }
            renderTelemetryCharts();
          });
          listEl.appendChild(label);
        });
        container.appendChild(group);
      }
      const count=document.getElementById('fieldCatalogCount');
      if(count)count.textContent=`${catalog.length}개 메시지 · ${shown}/${catalog.reduce((sum,s)=>sum+s.fields.length,0)}개 필드${query?' · 검색 중':''}`;
    }

    function renderEventLogTable() {
      const a = appState.analysis;
      if (!a) return;
      const tbody = document.getElementById('eventLogTableBody');
      tbody.innerHTML = '';

      const filtered = a.unifiedEvents.filter(ev => appState.evFilter === 'all' || ev.type === appState.evFilter);
      filtered.forEach(ev => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/80 cursor-pointer transition';
        const typeBadge = ev.type === 'EV'
          ? 'bg-sky-500/20 text-sky-300 border-sky-500/30'
          : (ev.type === 'ERR' ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' : 'bg-slate-800 text-slate-300 border-slate-700');
        const rowColor = ev.severity === 'error' ? 'text-rose-300 font-semibold' : (ev.severity === 'highlight' ? 'text-sky-300 font-semibold' : 'text-slate-200');

        tr.innerHTML = `
          <td class="py-2 px-3 mono-num whitespace-nowrap text-slate-300">${ev.kstStr} <span class="text-slate-400">(${ev.bootStr})</span></td>
          <td class="py-2 px-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold border ${typeBadge}">${ev.type}</span></td>
          <td class="py-2 px-3 mono-num ${rowColor}">${ev.code}</td>
          <td class="py-2 px-3 text-slate-300">${ev.ko}</td>
        `;
        tr.addEventListener('click', () => {
          switchMainTab('workspace');
          syncScrubberToSec(ev.sec, true);
          showToast(`이벤트 시각(${ev.kstStr})으로 차트 커서를 이동했습니다.`);
        });
        tbody.appendChild(tr);
      });
    }

    function renderParmAndFmtTables() {
      const p = appState.parsedLog;
      const a = appState.analysis;
      if (!p || !a) return;

      const parmQuery = (document.getElementById('parmSearchInput').value || '').trim().toLowerCase();
      const parmBody = document.getElementById('parmTableBody');
      parmBody.innerHTML = '';

      const seenParms = new Map();
      for (const row of a.parmRows) {
        if (row.Name) seenParms.set(row.Name, row.Value);
      }
      for (const [name, val] of seenParms.entries()) {
        if (parmQuery && !name.toLowerCase().includes(parmQuery)) continue;
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60';
        const desc = PARM_DOCS[name] || 'ArduPilot 기체 제어/센서 설정 파라미터';
        tr.innerHTML = `
          <td class="py-2 px-3 font-semibold text-sky-300">${name}</td>
          <td class="py-2 px-3 text-white">${Number(val).toFixed(4).replace(/\.?0+$/, '')}</td>
          <td class="py-2 px-3 text-slate-400 font-sans">${desc}</td>
        `;
        parmBody.appendChild(tr);
      }

      const fmtBody = document.getElementById('fmtTableBody');
      fmtBody.innerHTML = '';
      for (const f of p.fmtList) {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-900/60';
        tr.innerHTML = `
          <td class="py-1.5 px-2.5 text-slate-400">0x${f.typeId.toString(16).toUpperCase().padStart(2, '0')} (${f.typeId})</td>
          <td class="py-1.5 px-2.5 font-bold text-emerald-300">${f.name}</td>
          <td class="py-1.5 px-2.5 text-slate-300">${f.length}B</td>
          <td class="py-1.5 px-2.5 text-slate-400 truncate max-w-[200px]" title="${f.columns.join(', ')}"><span class="text-amber-300 mr-1">[${f.format}]</span>${f.columns.join(',')}</td>
          <td class="py-1.5 px-2.5 text-right text-slate-200">${(p.rawCounts[f.name] || f.count || 0).toLocaleString()}</td>
        `;
        fmtBody.appendChild(tr);
      }
    }

    function showToast(msg) {
      const box = document.getElementById('toastBox');
      document.getElementById('toastMessage').textContent = msg;
      box.classList.remove('hidden');
      clearTimeout(box._timer);
      box._timer = setTimeout(() => box.classList.add('hidden'), 3200);
    }

    function switchMainTab(tabName) {
      const requestedTab = tabName;
      if (tabName === 'route') tabName = 'workspace';
      document.getElementById('sidebarFieldExplorer')?.classList.toggle('hidden', tabName !== 'workspace');
      const views = {
        overview: document.getElementById('tabViewOverview'),
        workspace: document.getElementById('tabViewWorkspace'),
        diagnostics: document.getElementById('tabViewDiagnostics'),
        events: document.getElementById('tabViewEvents'),
        params: document.getElementById('tabViewParams')
      };
      Object.entries(views).forEach(([k, el]) => {
        if (!el) return;
        if (k === tabName) el.classList.remove('hidden');
        else el.classList.add('hidden');
      });

      document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.setAttribute('aria-current',btn.dataset.mainTab === requestedTab ? 'page' : 'false');
        if (btn.dataset.mainTab === requestedTab) {
          btn.className = 'main-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition bg-sky-600 text-white shadow-sm flex items-center gap-1.5';
        } else {
          btn.className = 'main-tab-btn px-3.5 py-2 rounded-lg text-xs font-bold transition bg-slate-900 text-slate-300 hover:text-white hover:bg-slate-800 flex items-center gap-1.5';
        }
      });

      if (tabName === 'workspace' && appState.analysis) {
        const route = requestedTab === 'route';
        document.getElementById('tabViewWorkspace').dataset.focus = route ? 'route' : 'charts';
        document.getElementById('workbenchTitle').textContent = route ? '경로 · 재생' : '차트 분석';
        document.getElementById('workbenchDescription').textContent = route ? '비행경로를 확대하고 시간에 따른 기체 상태를 확인합니다.' : '필드를 비교하고 아래 전체 구간 그래프에서 분석 범위를 조절합니다.';
        requestAnimationFrame(() => {
          renderTelemetryCharts();
          renderGpsMap();
          mainChart?.resize();
          overviewChart?.resize();
        });
      }
    }

    function updatePresetButtonsUI() {
      document.querySelectorAll('.preset-btn').forEach(btn => {
        if (appState.customFields.length === 0 && btn.dataset.preset === appState.activePreset) {
          btn.className = 'preset-btn px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-600 text-white';
        } else {
          btn.className = 'preset-btn px-2.5 py-1 rounded-md text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700';
        }
      });
    }

    function highlightTopViewButtons(viewKey) {
      const btnMap = {
        normal: document.getElementById('btnSampleNormal'),
        vibe: document.getElementById('btnSampleVibe'),
        gps: document.getElementById('btnSampleGps')
      };
      Object.entries(btnMap).forEach(([k, b]) => {
        if (k === viewKey) {
          b.className = 'px-2.5 py-1.5 rounded-md font-medium transition bg-sky-600 text-white shadow-sm';
        } else {
          b.className = 'px-2.5 py-1.5 rounded-md font-medium transition text-slate-300 hover:text-white hover:bg-slate-800';
        }
      });
    }

    // Top 1, 2, 3 buttons strictly switch the active chart view on the currently selected log (no demo mode!)
    function handleTopViewSwitch(viewKey) {
      highlightTopViewButtons(viewKey);
      const presetMap = {
        normal: { main: 'takeoff_alt', sec: 'att', msg: '1. 이착륙·고도 및 자세 추종성 파형 뷰로 전환했습니다.' },
        vibe: { main: 'vibe', sec: 'bat', msg: '2. 진동·클리핑(VIBE) 및 배터리 전압강하(BAT) 파형 뷰로 전환했습니다.' },
        gps: { main: 'gps_mag', sec: 'gps', msg: '3. 자기장 간섭(MAG) 및 GPS 위성·HDOP 글리치 파형 뷰로 전환했습니다.' }
      };
      const targetView = presetMap[viewKey] || presetMap.normal;
      appState.customFields = [];
      appState.activePreset = targetView.main;
      updatePresetButtonsUI();

      if (!appState.analysis) {
        showToast('먼저 분석할 .bin 또는 .log 파일을 첨부해 주세요.');
        return;
      }
      switchMainTab('workspace');
      renderTelemetryCharts();
      showToast(targetView.msg);
    }

    async function readSingleFilePromise(file) {
      const progress=(fraction,phase)=>{
        const label=document.getElementById('uploadProgressText');
        if(label)label.textContent=`${file.name} · ${phase} ${Math.floor(fraction*100)}%`;
      };
      const parsedLog=file.nativeId?await importNativeFile(file,progress):await parseDataFlashFile(file,progress);
      const label=document.getElementById('uploadProgressText');
      if(label)label.textContent=`${file.name} · 전체 데이터 분석 중`;
      await new Promise(resolve=>setTimeout(resolve,0));
      try{
        const analysis=parsedLog.nativeId?await analyzeNativeLog(parsedLog,appState.config,progress):analyzeParsedLog(parsedLog,appState.config);
        analysis.timeline._packed?.backend.compact?.();
        return {fileName:file.name,parsedLog,analysis};
      }catch(error){try{parsedLog.dispose?.();}catch{}throw error;}
    }

    function sortLogsByFileName() {
      const currentActiveObj = appState.logs[appState.activeLogIndex] || null;
      appState.logs.sort((a, b) =>
        a.fileName.localeCompare(b.fileName, 'ko', { numeric: true, sensitivity: 'base' })
      );
      if (currentActiveObj) {
        const newIdx = appState.logs.indexOf(currentActiveObj);
        appState.activeLogIndex = newIdx >= 0 ? newIdx : 0;
      }
    }

    let uploadQueue=Promise.resolve();
    function queueLogTask(action){
      const task=uploadQueue.then(async()=>{
        document.body?.setAttribute('aria-busy','true');
        const main=document.getElementById('dropZone'),nav=document.getElementById('topAnalysisTools');
        if(main)main.inert=true;if(nav)nav.inert=true;
        try{return await action();}finally{if(main)main.inert=false;if(nav)nav.inert=false;document.body?.removeAttribute('aria-busy');}
      });
      uploadQueue=task.catch(error=>{console.error(error);showToast(`로그 처리 실패: ${error.message||error}`);});
      return task;
    }
    function handleMultipleFilesUpload(fileList) {
      const files=Array.from(fileList||[]);
      return queueLogTask(()=>processMultipleFilesUpload(files));
    }

    async function reanalyzeAllLogs(){
      for(const item of appState.logs){
        await item.parsedLog.ensureLoaded?.();
        try{item.analysis=item.parsedLog.nativeId?await analyzeNativeLog(item.parsedLog,appState.config):analyzeParsedLog(item.parsedLog,appState.config);item.analysis.timeline._packed?.backend.compact?.();}
        finally{if(item!==appState.logs[appState.activeLogIndex])item.parsedLog.releaseRawBytes?.();}
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      if(appState.logs.length)await activateLogByIndex(Math.max(0,appState.activeLogIndex));
    }

    function renderUploadReport(report) {
      let panel=document.getElementById('uploadResultReport');
      if(!panel){panel=document.createElement('details');panel.id='uploadResultReport';panel.style.cssText='margin:12px;padding:12px;border:1px solid #596170;border-radius:6px;color:white;overflow-wrap:anywhere';document.getElementById('uploadProgressBanner').after(panel);}
      panel.replaceChildren();panel.open=report.failures.length>0;
      const summary=document.createElement('summary');summary.textContent=`불러오기 결과: 선택 ${report.selected}개 · 성공 ${report.loaded}개 · 실패 ${report.failures.length}개${Number.isFinite(report.totalBytes)?' · 원본 '+(report.totalBytes/1024**3).toFixed(2)+' GB':''}`;panel.append(summary);
      for(const failure of report.failures){const row=document.createElement('p');row.textContent=`${failure.fileName} — ${failure.message}`;panel.append(row);}
      if(!report.failures.length){const row=document.createElement('p');row.textContent='선택한 모든 파일을 불러왔습니다. 고정된 개수 제한은 없으며 전체 용량에 따라 사용 가능한 메모리의 영향을 받습니다.';panel.append(row);}
    }

    async function processMultipleFilesUpload(fileList) {
      if (!fileList || fileList.length === 0) return;
      stopPlayback();
      // Copy FileList BEFORE resetting input value, and sort by filename ascending
      const files = Array.from(fileList).sort((a, b) =>
        a.name.localeCompare(b.name, 'ko', { numeric: true, sensitivity: 'base' })
      );
      const fileInputEl = document.getElementById('fileInput');
      if (fileInputEl) fileInputEl.value = '';

      const banner = document.getElementById('uploadProgressBanner');
      const progText = document.getElementById('uploadProgressText');
      const progPct = document.getElementById('uploadProgressPct');
      const progBar = document.getElementById('uploadProgressBar');

      if (banner) {
        banner.classList.remove('hidden');
        progBar.style.width = '2%';
        progPct.textContent = `0 / ${files.length}`;
      }

      const newlyParsed = [];
      const failures=[];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (banner) {
          const pct = Math.round(((i) / files.length) * 100);
          progText.textContent = `다중 로그 고속 분석 중 (${i + 1} / ${files.length}) — ${f.name}`;
          progPct.textContent = `${pct}%`;
          progBar.style.width = `${Math.max(5, pct)}%`;
        }
        // Yield to browser UI thread so 10~50+ files never freeze the screen
        await new Promise(resolve => setTimeout(resolve, 15));
        try {
          const item = await readSingleFilePromise(f);
          item.parsedLog.releaseRawBytes?.();
          newlyParsed.push(item);
        } catch (err) {
          console.error(err);
          failures.push({fileName:f.name,message:err?.message||String(err)});
        }
      }

      const report={selected:files.length,totalBytes:files.reduce((n,file)=>n+file.size,0),loaded:newlyParsed.length,failures};
      appState.lastUploadReport=report;
      renderUploadReport(report);

      if (banner) {
        progBar.style.width = '100%';
        progPct.textContent = '100%';
        setTimeout(() => banner.classList.add('hidden'), 350);
      }

      if (newlyParsed.length === 0) {
        showToast('유효한 .bin / .log 파일을 읽지 못했습니다.');
        return;
      }

      appState.logs.push(...newlyParsed);
      sortLogsByFileName();
      const firstNewIdx = Math.max(0, appState.logs.indexOf(newlyParsed[0]));
      await activateLogByIndex(firstNewIdx);
      showToast(`선택 ${files.length}개 · 성공 ${newlyParsed.length}개 · 실패 ${failures.length}개${failures.length?' — 불러오기 결과에서 파일별 원인을 확인하세요.':''}`);
    }

    function stopPlayback() {
      if (appState.playTimer) {
        clearInterval(appState.playTimer);
        appState.playTimer = null;
      }
      document.getElementById('playIconText').textContent = '▶ 재생';
    }

    function togglePlayback() {
      if (appState.playTimer) {
        stopPlayback();
        return;
      }
      const a = appState.analysis;
      if (!a || !a.timeline.length) return;
      document.getElementById('playIconText').textContent = '⏸ 일시정지';
      appState.playTimer = setInterval(() => {
        const speed = parseInt(document.getElementById('playbackSpeedSelect').value, 10) || 5;
        let nextIdx = appState.scrubberIndex + Math.max(1, Math.floor(speed / 2));
        if (nextIdx >= a.timeline.length) {
          nextIdx = 0;
        }
        const pt = a.timeline[nextIdx];
        if (pt) syncScrubberToSec(pt.sec, true);
      }, 120);
    }

    function copyTextToClipboard(text, toastMsg) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        showToast(toastMsg);
      } catch (err) {
        showToast('클립보드 복사에 실패했습니다.');
      }
      document.body.removeChild(ta);
    }

    // Copies strictly:
    // 13:35:52 13:46:57 :00:11:05
    // (one line per attached log)
    function copyFlightLogbookSummary() {
      if (appState.logs.length === 0) {
        showToast('먼저 .bin 또는 .log 파일을 첨부해 주세요.');
        return;
      }
      const totalSorties = appState.logs.reduce((acc, item) => acc + ((item.analysis && item.analysis.sorties) ? item.analysis.sorties.length : 1), 0);
      const text = buildAllLogsCopyText();
      copyTextToClipboard(text, `총 ${appState.logs.length}개 파일 (${totalSorties}쏘티)의 [이륙 착륙 :비행시간]이 복사되었습니다!`);
    }

    function exportCurrentTimelineCsv() { openCsvExport('telemetry'); }

    window.addEventListener('DOMContentLoaded', () => {
      setupWorkbench();
      document.getElementById('btnSampleNormal').addEventListener('click', () => handleTopViewSwitch('normal'));
      document.getElementById('btnSampleVibe').addEventListener('click', () => handleTopViewSwitch('vibe'));
      document.getElementById('btnSampleGps').addEventListener('click', () => handleTopViewSwitch('gps'));

      document.getElementById('btnClearAllLogs').addEventListener('click', () => {
        stopPlayback();
        mainChart?.destroy();overviewChart?.destroy();mainChart=null;overviewChart=null;
        for(const item of appState.logs){item.parsedLog.releaseRawBytes?.();item.parsedLog.dispose?.();}
        appState.logs = [];
        appState.activeLogIndex = -1;
        appState.parsedLog = null;
        appState.analysis = null;
        document.getElementById('fileInput').value = '';
        renderMultiLogManager();
        showToast('첨부된 로그 목록을 모두 비웠습니다.');
      });

      document.getElementById('btnResetToDemo').addEventListener('click', () => {
        document.getElementById('btnClearAllLogs').click();
      });
      document.getElementById('btnDownloadSampleBin').addEventListener('click', () => {
        exportCurrentTimelineCsv();
      });

      document.getElementById('chkIncludeFilename').addEventListener('change', () => {
        document.getElementById('logbookPreviewTextarea').value = buildAllLogsCopyText();
      });

      document.getElementById('altSourceSelect').addEventListener('change', (e) => {
        appState.altSourceMode = e.target.value;
        if (appState.logs.length > 0) {
          queueLogTask(async()=>{await reanalyzeAllLogs();showToast('고도 기준 소스를 변경하여 전체 로그를 재계산했습니다.');});
        }
      });

      document.getElementById('fileInput').addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
          handleMultipleFilesUpload(e.target.files);
        }
      });

      const dropZone = document.getElementById('dropZone');
      window.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drop-active');
      });
      window.addEventListener('dragleave', (e) => {
        if (e.target === document.body || e.target === dropZone) {
          dropZone.classList.remove('drop-active');
        }
      });
      window.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drop-active');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handleMultipleFilesUpload(e.dataTransfer.files);
        }
      });

      document.getElementById('btnTimeModeKST').addEventListener('click', () => {
        appState.timeMode = 'KST';
        document.getElementById('btnTimeModeKST').className = 'px-2 py-0.5 rounded text-[11px] font-medium bg-sky-600 text-white';
        document.getElementById('btnTimeModeBoot').className = 'px-2 py-0.5 rounded text-[11px] font-medium text-slate-400 hover:text-white';
        renderTelemetryCharts();
      });
      document.getElementById('btnTimeModeBoot').addEventListener('click', () => {
        appState.timeMode = 'BOOT';
        document.getElementById('btnTimeModeBoot').className = 'px-2 py-0.5 rounded text-[11px] font-medium bg-sky-600 text-white';
        document.getElementById('btnTimeModeKST').className = 'px-2 py-0.5 rounded text-[11px] font-medium text-slate-400 hover:text-white';
        renderTelemetryCharts();
      });

      document.querySelectorAll('.main-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchMainTab(btn.dataset.mainTab));
      });

      document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          appState.customFields = [];
          appState.activePreset = btn.dataset.preset;
          updatePresetButtonsUI();
          renderCustomFieldExplorer();
          renderTelemetryCharts();
        });
      });

      document.getElementById('fieldSearchInput').addEventListener('input', () => renderCustomFieldExplorer());
      document.getElementById('btnClearCustomFields').addEventListener('click', () => {
        appState.customFields = [];
        updatePresetButtonsUI();
        renderCustomFieldExplorer();
        renderTelemetryCharts();
      });

      document.getElementById('btnZoomAll').addEventListener('click', () => {
        appState.zoomWindow = null;
        updateZoomRangeUI();
        renderTelemetryCharts();
      });
      document.getElementById('btnChartZoomIn').addEventListener('click', () => zoomChartByFactor(0.65));
      document.getElementById('btnChartZoomOut').addEventListener('click', () => zoomChartByFactor(1.45));
      document.getElementById('btnChartPanLeft').addEventListener('click', () => panChartByFraction(-0.35));
      document.getElementById('btnChartPanRight').addEventListener('click', () => panChartByFraction(0.35));
      document.getElementById('btnChartZoomReset').addEventListener('click', () => {
        appState.zoomWindow = null;
        updateZoomRangeUI();
        renderTelemetryCharts();
        showToast('차트 확대를 초기화하여 전체 비행 구간을 표시합니다.');
      });
      document.getElementById('btnZoomAirborne').addEventListener('click', () => {
        const a = appState.analysis;
        if (!a) return;
        appState.zoomWindow = { minSec: Math.max(a.minSec, a.takeoffSec - 5), maxSec: Math.min(a.maxSec, a.landingSec + 5) };
        renderTelemetryCharts();
        showToast('이륙부터 착륙까지의 순수 비행 구간으로 확대했습니다.');
      });
      document.getElementById('btnZoomTakeoff').addEventListener('click', () => {
        const a = appState.analysis;
        if (!a) return;
        appState.zoomWindow = { minSec: Math.max(a.minSec, a.takeoffSec - 15), maxSec: Math.min(a.maxSec, a.takeoffSec + 25) };
        renderTelemetryCharts();
        syncScrubberToSec(a.takeoffSec, true);
        showToast(`이륙 시각(${a.takeoffKst}) 전후 구간을 확대했습니다.`);
      });
      document.getElementById('btnZoomLanding').addEventListener('click', () => {
        const a = appState.analysis;
        if (!a) return;
        appState.zoomWindow = { minSec: Math.max(a.minSec, a.landingSec - 25), maxSec: Math.min(a.maxSec, a.landingSec + 15) };
        renderTelemetryCharts();
        syncScrubberToSec(a.landingSec, true);
        showToast(`착륙 시각(${a.landingKst}) 전후 구간을 확대했습니다.`);
      });

      document.getElementById('cardJumpArm').addEventListener('click', () => {
        if (!appState.analysis) return;
        switchMainTab('workspace');
        syncScrubberToSec(appState.analysis.armSec, true);
      });
      document.getElementById('cardJumpTakeoff').addEventListener('click', () => {
        switchMainTab('workspace');
        document.getElementById('btnZoomTakeoff').click();
      });
      document.getElementById('cardJumpLanding').addEventListener('click', () => {
        switchMainTab('workspace');
        document.getElementById('btnZoomLanding').click();
      });
      document.getElementById('cardJumpDisarm').addEventListener('click', () => {
        if (!appState.analysis) return;
        switchMainTab('workspace');
        syncScrubberToSec(appState.analysis.disarmSec, true);
      });

      document.getElementById('btnPlayPause').addEventListener('click', togglePlayback);
      document.getElementById('timelineScrubber').addEventListener('input', (e) => {
        stopPlayback();
        const idx = parseInt(e.target.value, 10) || 0;
        const pt = appState.analysis && appState.analysis.timeline[idx];
        if (pt) syncScrubberToSec(pt.sec, false);
      });
      document.getElementById('btnResetMapZoom').addEventListener('click', () => {
        appState.mapView = createMapView(appState.mapView?.mode||'2d');
        renderGpsMap();
        showToast('비행 경로를 초기화했습니다.');
      });
      for(const [id,mode] of [['btnMap2D','2d'],['btnMap3D','3d']])document.getElementById(id).addEventListener('click',()=>{
        appState.mapView=createMapView(mode);renderGpsMap();
      });

      document.querySelectorAll('.ev-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          appState.evFilter = btn.dataset.evFilter;
          document.querySelectorAll('.ev-filter-btn').forEach(b => {
            b.className = b.dataset.evFilter === appState.evFilter
              ? 'ev-filter-btn px-2.5 py-1 rounded bg-sky-600 text-white font-semibold'
              : 'ev-filter-btn px-2.5 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700';
          });
          renderEventLogTable();
        });
      });
      document.getElementById('parmSearchInput').addEventListener('input', () => renderParmAndFmtTables());

      document.getElementById('btnCopyLogbookInline').addEventListener('click', copyFlightLogbookSummary);
      document.getElementById('btnExportCsv').addEventListener('click', exportCurrentTimelineCsv);

      const modal = document.getElementById('settingsModal');
      document.getElementById('btnOpenSettings').addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      });
      document.getElementById('btnCloseSettings').addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
      });
      const chkErrEl = document.getElementById('chkShowErrorMarkersOnChart');
      if (chkErrEl) {
        chkErrEl.addEventListener('change', (e) => {
          appState.showErrorMarkersOnChart = e.target.checked;
          if (mainChart) mainChart.draw();
          if (overviewChart) overviewChart.draw();
        });
      }

      document.getElementById('btnResetSettings').addEventListener('click', () => {
        document.getElementById('cfgTakeoffAlt').value = '1.0';
        document.getElementById('cfgLandingAlt').value = '0.5';
        document.getElementById('cfgVibeWarn').value = '30';
        document.getElementById('cfgVibeCrit').value = '60';
        document.getElementById('cfgCellCount').value = '0';
        document.getElementById('cfgCellMinVolt').value = '3.50';
        if (document.getElementById('cfgAttErrDeg')) document.getElementById('cfgAttErrDeg').value = '10.0';
        if (document.getElementById('cfgAttSustainSec')) document.getElementById('cfgAttSustainSec').value = '2.0';
        if (document.getElementById('cfgMagWarn')) document.getElementById('cfgMagWarn').value = '35';
        if (document.getElementById('cfgMagCrit')) document.getElementById('cfgMagCrit').value = '60';
      });
      document.getElementById('btnApplySettings').addEventListener('click', () => {
        const requestedCells=Number(document.getElementById('cfgCellCount').value);
        if (!Number.isInteger(requestedCells) || requestedCells<0 || requestedCells>24) {
          showToast('배터리 셀 수는 0(자동) 또는 1~24 사이의 정수로 입력하세요.');
          return;
        }
        appState.config.takeoffAlt = parseFloat(document.getElementById('cfgTakeoffAlt').value) || 1.0;
        appState.config.landingAlt = parseFloat(document.getElementById('cfgLandingAlt').value) || 0.5;
        appState.config.vibeWarn = parseFloat(document.getElementById('cfgVibeWarn').value) || 30;
        appState.config.vibeCrit = parseFloat(document.getElementById('cfgVibeCrit').value) || 60;
        appState.config.cellCount = parseInt(document.getElementById('cfgCellCount').value, 10) || 0;
        appState.config.cellMinVolt = parseFloat(document.getElementById('cfgCellMinVolt').value) || 3.50;
        if (document.getElementById('cfgAttErrDeg')) appState.config.attErrDeg = parseFloat(document.getElementById('cfgAttErrDeg').value) || 10.0;
        if (document.getElementById('cfgAttSustainSec')) appState.config.attSustainSec = parseFloat(document.getElementById('cfgAttSustainSec').value) || 2.0;
        if (document.getElementById('cfgMagWarn')) appState.config.magWarn = parseFloat(document.getElementById('cfgMagWarn').value) || 35;
        if (document.getElementById('cfgMagCrit')) appState.config.magCrit = parseFloat(document.getElementById('cfgMagCrit').value) || 60;
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        if (appState.logs.length > 0) {
          queueLogTask(async()=>{await reanalyzeAllLogs();showToast('진단 기준이 적용되어 첨부된 모든 로그를 재분석했습니다.');});
        }
      });

      window.addEventListener('resize', () => {
        if (!appState.analysis) return;
        renderGpsMap();
        if (appState.analysis.timeline[appState.scrubberIndex]) {
          renderAttitudeHud(appState.analysis.timeline[appState.scrubberIndex]);
        }
      });

      // Start cleanly in empty state (Demo mode removed!)
      renderMultiLogManager();


    });
