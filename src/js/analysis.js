    const FRAME_CLASS_NAMES = {
      1: '쿼드', 2: '헥사', 3: '옥타', 4: '옥타쿼드', 5: 'Y6', 6: '헬리', 7: '트라이', 8: '싱글콥터',
      9: '코액스콥터', 10: '바이콥터', 11: '듀얼 헬리', 12: '도데카헥사', 13: '헬리쿼드', 14: '데카',
      15: '스크립팅 매트릭스', 16: '6DOF', 17: '동적 매트릭스'
    };
    const FRAME_MSG_CLASSES = {
      QUAD: 1, HEXA: 2, OCTA: 3, OCTAQUAD: 4, OCTA_QUAD: 4, Y6: 5, HELI: 6, TRI: 7, SINGLE: 8, COAX: 9,
      BICOPTER: 10, HELI_DUAL: 11, DODECAHEXA: 12, DODECA_HEXA: 12, HELI_QUAD: 13, DECA: 14, SCRIPTING: 15, '6DOF': 16
    };

    // Frame type read from the log itself: the boot message (what the firmware actually ran) first,
    // then the FRAME_CLASS parameter (Q_FRAME_CLASS for QuadPlane). Returns null if the log has neither.
    function detectFrameType(msgRows, parmRows) {
      for (const m of msgRows) {
        const match = /Frame:\s*([A-Z0-9_]+)(?:\/(\S+))?/i.exec(m.Message || '');
        const frameClass = match && FRAME_MSG_CLASSES[match[1].toUpperCase()];
        if (frameClass) {
          return { name: FRAME_CLASS_NAMES[frameClass], source: `부팅 메시지 "${match[0].trim()}"` };
        }
      }
      for (const paramName of ['FRAME_CLASS', 'Q_FRAME_CLASS']) {
        let value = null;
        for (const p of parmRows) {
          if (p.Name === paramName) value = Math.round(Number(p.Value));
        }
        if (FRAME_CLASS_NAMES[value]) {
          return { name: FRAME_CLASS_NAMES[value], source: `파라미터 ${paramName} = ${value}` };
        }
      }
      return null;
    }

    // Format seconds difference as :HH:MM:SS (e.g. :00:11:05)
    function formatColonHHMMSS(totalSecondsInt) {
      const s = Math.max(0, Math.round(totalSecondsInt));
      const hh = String(Math.floor(s / 3600)).padStart(2, '0');
      const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      return `:${hh}:${mm}:${ss}`;
    }

    const appState = {
      logs: [], // Array of { id, fileName, parsedLog, analysis }
      activeLogIndex: -1,
      parsedLog: null,
      analysis: null,
      timeMode: 'KST',
      altSourceMode: 'auto_rel',
      zoomWindow: null,
      activePreset: 'motors',
      customFields: [],
      scrubberIndex: 0,
      playTimer: null,
      evFilter: 'all',
      showErrorMarkersOnChart: true,
      config: {
        takeoffAlt: 1.0,
        landingAlt: 0.5,
        vibeWarn: 30,
        vibeCrit: 60,
        cellCount: 0,
        cellMinVolt: 3.50,
        attErrDeg: 10.0,
        attSustainSec: 2.0,
        magWarn: 35,
        magCrit: 60
      }
    };

    function gpsWeekToUtcMs(week,milliseconds) {
      const gpsMs=315964800000+week*604800000+milliseconds;
      const dates=['1981-07-01','1982-07-01','1983-07-01','1985-07-01','1988-01-01','1990-01-01','1991-01-01','1992-07-01','1993-07-01','1994-07-01','1996-01-01','1997-07-01','1999-01-01','2006-01-01','2009-01-01','2012-07-01','2015-07-01','2017-01-01'];
      let leap=0;
      for(let i=0;i<dates.length;i++)if(gpsMs>=Date.parse(dates[i]+'T00:00:00Z')+(i+1)*1000)leap=i+1;
      return gpsMs-leap*1000;
    }

    function analyzeParsedLog(parsed, cfg) {
      // Nearest-sample lookup requires ordered timestamps. Keep one sensor instance
      // for derived telemetry; raw field plots retain every instance separately.
      parsed.beginSensorScan?.();
      const overviewOnly=!!cfg.__overviewOnly;
      const analysisMessages=new Set(['GPS','GPS2','CTUN','POS','BARO','BAR2','AHR2','ATT','VIBE','BAT','CURR','BCL','BCL2','RCOU','RCIN','MAG','MAG2','POWR','XKF1','NKF1','EV','ERR','MSG','MODE','PARM']);
      const t = Object.fromEntries(Object.entries(parsed.tables).filter(([name])=>analysisMessages.has(name)&&(!overviewOnly||['GPS','GPS2','CTUN','POS','BARO','BAR2','AHR2','ATT','RCOU','EV','MSG'].includes(name))).map(([name, rows]) => {
        if(rows._packed){
          let primary=Infinity,last=-Infinity,ordered=true;
          const key=typeof messageInstanceField==='function'?messageInstanceField(parsed,name):null;
          for(const row of rows){const time=row.TimeUS;if(Number.isFinite(time)){if(time<last)ordered=false;last=time;}if(key&&Number.isFinite(row[key]))primary=Math.min(primary,row[key]);}
          const selected=rows.filter(row=>(row.TimeUS===undefined||Number.isFinite(row.TimeUS))&&(!key||!Number.isFinite(primary)||row[key]===primary));
          if(!ordered)selected.sort((a,b)=>(a.TimeUS||0)-(b.TimeUS||0));
          return [name,selected];
        }
        const ordered = rows.filter(r => r.TimeUS === undefined || Number.isFinite(r.TimeUS))
          .slice().sort((a,b) => (a.TimeUS || 0) - (b.TimeUS || 0));
        const instanceKey = ['I', 'Instance', 'IMU'].find(key => ordered.some(r => r[key] !== undefined));
        const primary = instanceKey ? Math.min(...new Set(ordered.map(r => r[instanceKey]).filter(Number.isFinite))) : null;
        return [name, instanceKey && Number.isFinite(primary) ? ordered.filter(r => r[instanceKey] === primary) : ordered];
      }));
      parsed.endSensorScan?.();
      parsed.onAnalysisPhase?.('sensor-selection-and-ordering');
      const gpsRows = (t['GPS'] && t['GPS'].length) ? t['GPS'] : (t['GPS2'] || []);
      const ctunRows = t['CTUN'] || [];
      const posRows = t['POS'] || [];
      const baroRows = (t['BARO'] && t['BARO'].length) ? t['BARO'] : (t['BAR2'] || []);
      const ahr2Rows = t['AHR2'] || [];
      const attRows = t['ATT'] || [];
      const vibeRows = t['VIBE'] || [];
      const batRows = (t['BAT'] && t['BAT'].length) ? t['BAT'] : (t['CURR'] || []);
      const rcouRows = t['RCOU'] || [];
      const rcinRows = t['RCIN'] || [];
      const magRows = (t['MAG'] && t['MAG'].length) ? t['MAG'] : (t['MAG2'] || []);
      const powrRows = t['POWR'] || [];
      const xkfRows = (t['XKF1'] && t['XKF1'].length) ? t['XKF1'] : (t['NKF1'] || []);
      const evRows = t['EV'] || [];
      const errRows = t['ERR'] || [];
      const msgRows = t['MSG'] || [];
      const modeRows = t['MODE'] || [];
      const parmRows = t['PARM'] || [];

      let gpsEpochOffsetMs = null;
      for (const g of gpsRows) {
        const gWk = g.GWk ?? g.Week ?? 0;
        const gms = g.GMS ?? g.TimeMS ?? 0;
        const status = g.Status ?? 3;
        if (status >= 3 && Number.isInteger(gWk) && gWk > 0 && Number.isFinite(gms) && gms >= 0 && gms < 604800000 && Number.isFinite(g.TimeUS)) {
          const utcMs = gpsWeekToUtcMs(gWk,gms);
          gpsEpochOffsetMs = utcMs - (g.TimeUS / 1000.0);
          break;
        }
      }
      if (!gpsEpochOffsetMs) {
        gpsEpochOffsetMs = null;
      }

      function timeUsToSec(us) {
        return (us || 0) / 1e6;
      }

      function secToBootStr(sec) {
        const tenths = Math.round(Math.abs(sec)*10);
        const mins = Math.floor(tenths / 600);
        const rem = ((tenths % 600)/10).toFixed(1).padStart(4, '0');
        return `T${sec<0?'-':'+'}${String(mins).padStart(2, '0')}:${rem}`;
      }

      // Exact integer-second KST HH:MM:SS formatter
      function secToKstHHMMSS(sec) {
        if (gpsEpochOffsetMs === null) return secToBootStr(sec);
        const totalKstSec = Math.floor((gpsEpochOffsetMs + sec * 1000 + 9 * 3600 * 1000) / 1000);
        const d = new Date(totalKstSec * 1000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        const ss = String(d.getUTCSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
      }

      function secToKstStr(sec) {
        return secToKstHHMMSS(sec);
      }

      function secToDateKstStr(sec) {
        if (gpsEpochOffsetMs === null) return '날짜 미확인 (GPS 시각 없음)';
        const kstMs = gpsEpochOffsetMs + sec * 1000 + 9 * 3600 * 1000;
        const d = new Date(kstMs);
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} (${days[d.getUTCDay()]})`;
      }

      const spineCandidates = [ctunRows, posRows, baroRows, attRows, gpsRows, rcouRows];
      let spineRows = ctunRows;
      for (const cand of spineCandidates) {
        if (cand && cand.length > spineRows.length) {
          spineRows = cand;
        }
      }
      if (ctunRows.length >= 50) spineRows = ctunRows;

      let minSec = 0;
      let maxSec = 60;
      if (spineRows.length > 0) {
        minSec = timeUsToSec(spineRows[0].TimeUS);
        maxSec = timeUsToSec(spineRows[spineRows.length - 1].TimeUS);
      }

      let armSec = null, armTrigger = '추정';
      let takeoffSec = null, takeoffTrigger = '고도 상승';
      let landingSec = null, landingTrigger = '고도 강하';
      let disarmSec = null, disarmTrigger = '추정';

      let explicitDisarmEvSec = null;
      let explicitLandEvSec = null;
      for (const ev of evRows) {
        const s = timeUsToSec(ev.TimeUS);
        if (ev.Id === 10 && armSec === null) { armSec = s; armTrigger = 'EV 10 (ARMED)'; }
        if (ev.Id === 28 && takeoffSec === null) { takeoffSec = s; takeoffTrigger = 'EV 28 (NOT_LANDED)'; }
        if (ev.Id === 18) { landingSec = s; explicitLandEvSec = s; landingTrigger = 'EV 18 (LAND_COMPLETE)'; }
        if (ev.Id === 11 && (armSec === null || s > armSec)) {
          disarmSec = s;
          explicitDisarmEvSec = s;
          disarmTrigger = 'EV 11 (DISARMED)';
        }
      }
      for (const m of msgRows) {
        const txt = m.Message || '';
        const s = timeUsToSec(m.TimeUS);
        if (/DISARMING MOTORS/i.test(txt)) {
          disarmSec = s;
          explicitDisarmEvSec = s;
          disarmTrigger = 'MSG (DISARMING MOTORS)';
        }
      }

      // DataFlash float fields are already metres; integer format scaling is
      // handled by the parser. Magnitude-based guessing corrupts high flights.
      const ctunScale = 1.0;

      const groundCutoffSec = armSec !== null ? (armSec + 1.0) : (minSec + Math.min(8, (maxSec - minSec) * 0.05));
      function calcBaseline(rows, field, scale = 1.0) {
        if (!rows || !rows.length) return 0;
        let sum = 0, cnt = 0;
        for (let i = 0; i < rows.length; i++) {
          const s = timeUsToSec(rows[i].TimeUS);
          const val = rows[i][field];
          if (val !== undefined && Number.isFinite(val)) {
            if (s <= groundCutoffSec || cnt < 5) {
              sum += val * scale;
              cnt++;
            }
            if (s > groundCutoffSec && cnt >= 5) break;
          }
        }
        return cnt > 0 ? (sum / cnt) : 0;
      }

      const ctunAltOffset = calcBaseline(ctunRows, 'Alt', ctunScale);
      const ctunBAltOffset = calcBaseline(ctunRows, 'BAlt', ctunScale);
      const baroTableOffset = calcBaseline(baroRows, 'Alt', 1.0);
      const posRelOffset = calcBaseline(posRows, 'RelHomeAlt', 1.0);
      const gpsAmslOffset = calcBaseline(gpsRows, 'Alt', 1.0);

      parsed.onAnalysisPhase?.('time-and-ground-reference');
      const timeline = parsed.nativeId?createNativeWritableRows(parsed.nativeAnalysisStore||parsed.nativeId,'timeline',{kstStr:secToKstStr,bootStr:secToBootStr}):parsed.storage==='lossless-packed'?createColumnRows({kstStr:secToKstStr,bootStr:secToBootStr}):[];
      for (let i = 0; i < spineRows.length; i++) {
        const sp = spineRows[i];
        const tUs = sp.TimeUS || 0;
        const sec = timeUsToSec(tUs);

        const c = ctunRows.length ? findNearestByTimeUS(ctunRows, tUs) : {};
        const pos = posRows.length ? findNearestByTimeUS(posRows, tUs) : {};
        const baro = baroRows.length ? findNearestByTimeUS(baroRows, tUs) : {};
        const ahr = ahr2Rows.length ? findNearestByTimeUS(ahr2Rows, tUs) : {};
        const g = gpsRows.length ? findNearestByTimeUS(gpsRows, tUs) : {};
        const a = !overviewOnly && attRows.length ? findNearestByTimeUS(attRows, tUs) : {};
        const v = !overviewOnly && vibeRows.length ? findNearestByTimeUS(vibeRows, tUs) : {};
        const b = !overviewOnly && batRows.length ? findNearestByTimeUS(batRows, tUs) : {};
        const r = rcouRows.length ? findNearestByTimeUS(rcouRows, tUs) : {};
        const m = !overviewOnly && magRows.length ? findNearestByTimeUS(magRows, tUs) : {};
        const p = !overviewOnly && powrRows.length ? findNearestByTimeUS(powrRows, tUs) : {};
        const x = !overviewOnly && xkfRows.length ? findNearestByTimeUS(xkfRows, tUs) : {};

        const rawCtunAlt = (c.Alt !== undefined) ? (c.Alt * ctunScale) : ((pos.RelHomeAlt !== undefined) ? pos.RelHomeAlt : null);
        const relCtunAlt = (c.Alt !== undefined) ? (c.Alt * ctunScale - ctunAltOffset) : ((pos.RelHomeAlt !== undefined) ? (pos.RelHomeAlt - posRelOffset) : null);

        const rawBaroAlt = (baro.Alt !== undefined) ? baro.Alt : ((c.BAlt !== undefined) ? (c.BAlt * ctunScale) : null);
        const relBaroAlt = (baro.Alt !== undefined) ? (baro.Alt - baroTableOffset) : ((c.BAlt !== undefined) ? (c.BAlt * ctunScale - ctunBAltOffset) : null);

        const rawGpsAmsl = (g.Alt !== undefined) ? g.Alt : ((pos.Alt !== undefined) ? pos.Alt : ((ahr.Alt !== undefined) ? ahr.Alt : 0));
        const relGpsAlt = rawGpsAmsl - gpsAmslOffset;

        const autoRelAlt = relCtunAlt !== null ? relCtunAlt : (relBaroAlt !== null ? relBaroAlt : relGpsAlt);
        const dAlt = (c.DAlt !== undefined) ? (c.DAlt * ctunScale) : autoRelAlt;

        let chosenAlt = autoRelAlt;
        if (appState.altSourceMode === 'ctun_raw') {
          chosenAlt = rawCtunAlt !== null ? rawCtunAlt : autoRelAlt;
        } else if (appState.altSourceMode === 'baro_rel') {
          chosenAlt = relBaroAlt !== null ? relBaroAlt : autoRelAlt;
        } else if (appState.altSourceMode === 'gps_amsl') {
          chosenAlt = rawGpsAmsl;
        }

        let thOPct = 0;
        if (c.ThO !== undefined) {
          thOPct = c.ThO <= 1.5 ? (c.ThO * 100) : c.ThO;
        } else if (r.C1 !== undefined) {
          const avgPwm = ((r.C1 || 1000) + (r.C2 || 1000) + (r.C3 || 1000) + (r.C4 || 1000)) / 4;
          thOPct = Math.max(0, Math.min(100, ((avgPwm - 1100) / 800) * 100));
        }

        if(overviewOnly){timeline.push({sec,autoRelAlt,thO:thOPct,c1:r.C1??1000,c2:r.C2??1000,c3:r.C3??1000,c4:r.C4??1000});continue;}
        timeline.push({
          sec,
          kstStr: secToKstStr(sec),
          bootStr: secToBootStr(sec),
          modeName: 'STABILIZE',
          modeColor: '#38bdf8',
          dAlt,
          alt: chosenAlt,
          autoRelAlt,
          bAlt: relBaroAlt !== null ? relBaroAlt : autoRelAlt,
          gpsAmsl: rawGpsAmsl,
          thO: thOPct,
          lat: g.Lat ?? pos.Lat ?? null,
          lng: g.Lng ?? pos.Lng ?? null,
          spd: g.Spd ?? 0,
          nSats: g.NSats ?? 0,
          hdop: g.HDop ?? 0,
          desRoll: a.DesRoll ?? 0,
          roll: a.Roll ?? x.Roll ?? 0,
          desPitch: a.DesPitch ?? 0,
          pitch: a.Pitch ?? x.Pitch ?? 0,
          yaw: a.Yaw ?? x.Yaw ?? 0,
          vibeX: v.VibeX ?? 0,
          vibeY: v.VibeY ?? 0,
          vibeZ: v.VibeZ ?? 0,
          clip0: Math.max(v.Clip0 || 0, v.Clip1 || 0, v.Clip2 || 0),
          volt: b.Volt ?? 0,
          voltR: b.VoltR ?? b.Volt ?? 0,
          cellVolt: 0,
          curr: b.Curr ?? 0,
          currTot: b.CurrTot ?? 0,
          c1: r.C1 ?? 1000,
          c2: r.C2 ?? 1000,
          c3: r.C3 ?? 1000,
          c4: r.C4 ?? 1000,
          magX: m.MagX ?? 0,
          magY: m.MagY ?? 0,
          magZ: m.MagZ ?? 0,
          magPct: 0,
          vcc: p.Vcc ?? null,
          vz: -(x.VZ ?? 0)
        });
      }

      parsed.onAnalysisPhase?.('timeline-construction');
      // Multi-Sortie Detection (1회 이착륙 = 1쏘티, 한 로그 내 다중 이착륙 완벽 분리)
      const rawSorties = [];

      // Strategy A: Explicit ArduPilot EV 28 (NOT_LANDED) -> EV 18 (LAND_COMPLETE) / EV 11 (DISARMED) pairs
      let pendingEvTakeoff = null;
      let lastEvArm = null;
      for (const ev of evRows) {
        const s = timeUsToSec(ev.TimeUS);
        if (ev.Id === 10 || ev.Id === 15) {
          lastEvArm = s;
        } else if (ev.Id === 28) {
          if (pendingEvTakeoff === null) {
            pendingEvTakeoff = {
              armSec: lastEvArm !== null ? lastEvArm : Math.max(minSec, s - 3),
              takeoffSec: s,
              takeoffTrigger: 'EV 28 (NOT_LANDED)'
            };
          }
        } else if ((ev.Id === 18 || ev.Id === 11) && pendingEvTakeoff !== null) {
          if (s > pendingEvTakeoff.takeoffSec + 2.0) {
            rawSorties.push({
              armSec: pendingEvTakeoff.armSec,
              takeoffSec: pendingEvTakeoff.takeoffSec,
              landingSec: s,
              disarmSec: ev.Id === 11 ? s : Math.min(maxSec, s + 3),
              takeoffTrigger: pendingEvTakeoff.takeoffTrigger,
              landingTrigger: ev.Id === 18 ? 'EV 18 (LAND_COMPLETE)' : 'EV 11 (DISARMED)'
            });
            pendingEvTakeoff = null;
          }
        }
      }
      let evCutOffMidAir = false;
      if (pendingEvTakeoff !== null && maxSec > pendingEvTakeoff.takeoffSec + 3.0) {
        const lastPt = timeline[timeline.length - 1] || { autoRelAlt: 0, thO: 0 };
        const stillFlyingAtEnd = (lastPt.autoRelAlt > cfg.landingAlt + 1.0) || (lastPt.thO > 22);
        evCutOffMidAir = stillFlyingAtEnd && (explicitDisarmEvSec === null || explicitDisarmEvSec < pendingEvTakeoff.takeoffSec);
        let fallbackLand = maxSec;
        if (!evCutOffMidAir) {
          for (let i = timeline.length - 1; i >= 0; i--) {
            if (timeline[i].sec > pendingEvTakeoff.takeoffSec + 3 && timeline[i].autoRelAlt >= cfg.landingAlt) {
              fallbackLand = Math.min(maxSec, timeline[i].sec + 1);
              break;
            }
          }
        }
        rawSorties.push({
          armSec: pendingEvTakeoff.armSec,
          takeoffSec: pendingEvTakeoff.takeoffSec,
          landingSec: fallbackLand,
          disarmSec: maxSec,
          takeoffTrigger: pendingEvTakeoff.takeoffTrigger,
          landingTrigger: evCutOffMidAir ? '로그 끊김 (비행 중 기록 중단)' : `RelAlt ≤ ${cfg.landingAlt}m`,
          isCutoff: evCutOffMidAir
        });
      }

      // Strategy B: Altitude + Throttle Hysteresis State Machine
      const altSorties = [];
      let inAir = false;
      let curStartPt = null;
      let groundCandidateSec = null;
      let takeoffCandidate = null;
      const armEvents = evRows.filter(e => e.Id === 10 || e.Id === 11);
      let armEventIndex = -1;

      for (let i = 0; i < timeline.length; i++) {
        const pt = timeline[i];
        while (armEventIndex + 1 < armEvents.length && armEvents[armEventIndex + 1].TimeUS <= pt.sec * 1e6) armEventIndex++;
        const lastArmEvent = armEvents[armEventIndex];
        const armed = !lastArmEvent ? true : lastArmEvent.Id === 10;
        const isFlyingNow = armed && pt.autoRelAlt >= cfg.takeoffAlt && pt.thO >= 30;
        const isOnGroundNow = (pt.autoRelAlt <= cfg.landingAlt && pt.thO < 35) || (pt.autoRelAlt <= cfg.landingAlt * 0.75);

        if (!inAir) {
          if (!isFlyingNow) takeoffCandidate = null;
          else {
            if (!takeoffCandidate) takeoffCandidate = pt;
            if (pt.sec - takeoffCandidate.sec >= 2.0) {
              inAir = true;
              curStartPt = takeoffCandidate;
              groundCandidateSec = null;
            }
          }
        } else {
          if (isOnGroundNow) {
            if (groundCandidateSec === null) groundCandidateSec = pt.sec;
            if (pt.sec - groundCandidateSec >= 2.5) {
              if (groundCandidateSec - curStartPt.sec >= 4.0) {
                altSorties.push({
                  armSec: Math.max(minSec, curStartPt.sec - 3),
                  takeoffSec: curStartPt.sec,
                  landingSec: groundCandidateSec,
                  disarmSec: Math.min(maxSec, groundCandidateSec + 3),
                  takeoffTrigger: `RelAlt ≥ ${cfg.takeoffAlt}m + ThO ≥ 30% (2초 지속)`,
                  landingTrigger: `RelAlt ≤ ${cfg.landingAlt}m`,
                  isCutoff: false
                });
              }
              inAir = false;
              curStartPt = null;
              takeoffCandidate = null;
              groundCandidateSec = null;
            }
          } else {
            groundCandidateSec = null;
          }
        }
      }
      if (inAir && curStartPt && (maxSec - curStartPt.sec >= 4.0)) {
        const lastPt = timeline[timeline.length - 1] || { autoRelAlt: 0, thO: 0 };
        const cutMidAir = (explicitDisarmEvSec === null || explicitDisarmEvSec < curStartPt.sec) &&
                          ((lastPt.autoRelAlt > cfg.landingAlt + 0.8) || (lastPt.thO > 20));
        let lastFlySec = maxSec;
        if (!cutMidAir) {
          for (let i = timeline.length - 1; i >= 0; i--) {
            if (timeline[i].sec > curStartPt.sec + 3 && timeline[i].autoRelAlt >= cfg.landingAlt) {
              lastFlySec = Math.min(maxSec, timeline[i].sec + 1);
              break;
            }
          }
        }
        altSorties.push({
          armSec: Math.max(minSec, curStartPt.sec - 3),
          takeoffSec: curStartPt.sec,
          landingSec: lastFlySec,
          disarmSec: maxSec,
          takeoffTrigger: `RelAlt ≥ ${cfg.takeoffAlt}m + ThO ≥ 30% (2초 지속)`,
          landingTrigger: cutMidAir ? '로그 끊김 (비행 중 기록 중단)' : `RelAlt ≤ ${cfg.landingAlt}m`,
          isCutoff: cutMidAir
        });
      }

      // Explicit autopilot flight events have priority over inferred altitude.
      const chosenRawSorties = evRows.some(e => e.Id === 28) ? rawSorties : altSorties;

      const mergedRawSorties = [];
      for (const s of chosenRawSorties) {
        if (mergedRawSorties.length > 0) {
          const prev = mergedRawSorties[mergedRawSorties.length - 1];
          if (s.takeoffSec - prev.landingSec < 3.0) {
            prev.landingSec = s.landingSec;
            prev.disarmSec = s.disarmSec;
            prev.landingTrigger = s.landingTrigger;
            prev.isCutoff = s.isCutoff;
            continue;
          }
        }
        mergedRawSorties.push({ ...s });
      }

      // Determine whether the log ended with a normal DISARM or an abrupt LOG CUTOFF (로그 끊김)
      const lastTimelinePt = timeline[timeline.length - 1] || { autoRelAlt: 0, thO: 0, c1: 1000, c2: 1000, c3: 1000, c4: 1000 };
      const lastAvgPwm = ((lastTimelinePt.c1 || 1000) + (lastTimelinePt.c2 || 1000) + (lastTimelinePt.c3 || 1000) + (lastTimelinePt.c4 || 1000)) / 4;
      const groundOnly = mergedRawSorties.length === 0;
      const groundSummary = {
        armSec: armSec ?? minSec, disarmSec: disarmSec ?? maxSec,
        takeoffSec: maxSec, landingSec: maxSec,
        takeoffKst: '—', landingKst: '—',
        takeoffTrigger: '비행 미감지', landingTrigger: '비행 미감지'
      };
      const lastSortieRaw = mergedRawSorties.at(-1) || groundSummary;
      const hasDisarmAfterLastTakeoff = (explicitDisarmEvSec !== null && explicitDisarmEvSec >= lastSortieRaw.takeoffSec);

      // A log is considered "로그 끊김 (Log Cutoff)" if there was NO explicit Disarm event after the last takeoff
      // AND (the aircraft was still airborne, OR motors/throttle were still spinning, OR explicit Land Complete EV 18 was also missing)
      const isLogCutoff = !groundOnly && !hasDisarmAfterLastTakeoff && (
        Boolean(lastSortieRaw.isCutoff) ||
        lastTimelinePt.autoRelAlt > cfg.landingAlt + 0.8 ||
        lastTimelinePt.thO > 15 ||
        lastAvgPwm > 1150 ||
        (explicitLandEvSec === null || explicitLandEvSec < lastSortieRaw.takeoffSec)
      );

      if (isLogCutoff) {
        lastSortieRaw.isCutoff = true;
        lastSortieRaw.disarmSec = maxSec;
        if (lastTimelinePt.autoRelAlt > cfg.landingAlt + 0.8 || lastTimelinePt.thO > 20) {
          lastSortieRaw.landingSec = maxSec;
          lastSortieRaw.landingTrigger = '로그 끊김 (비행 중 기록 중단)';
        }
        disarmSec = maxSec;
        disarmTrigger = '⚠️ 로그 끊김 (시동해제 미기록)';
      }

      if(overviewOnly)return {sorties:mergedRawSorties.map((s,index)=>({index:index+1,takeoffSec:s.takeoffSec,landingSec:s.landingSec})),groundOnly,isLogCutoff,minSec,maxSec};

      const sorties = mergedRawSorties.map((s, idx) => {
        const nextTakeoff = mergedRawSorties[idx + 1]?.takeoffSec ?? Infinity;
        const actualDisarm = evRows.find(e => e.Id === 11 && e.TimeUS / 1e6 >= s.landingSec && e.TimeUS / 1e6 < nextTakeoff);
        if (actualDisarm) s.disarmSec = actualDisarm.TimeUS / 1e6;
        const tkInt = Math.round(s.takeoffSec);
        const ldInt = Math.round(s.landingSec);
        const durSec = Math.max(0, ldInt - tkInt);
        const tkKst = secToKstHHMMSS(tkInt);
        const ldKst = secToKstHHMMSS(ldInt);
        const durColon = formatColonHHMMSS(durSec);
        let sMaxRelAlt = 0;
        for (const pt of timeline) {
          if (pt.sec >= s.takeoffSec && pt.sec <= s.landingSec && pt.autoRelAlt > sMaxRelAlt) {
            sMaxRelAlt = pt.autoRelAlt;
          }
        }
        const isLastAndCut = (idx === mergedRawSorties.length - 1) && isLogCutoff;
        return {
          index: idx + 1,
          isCutoff: isLastAndCut,
          armSec: s.armSec,
          armKst: secToKstHHMMSS(Math.round(s.armSec)),
          armBoot: secToBootStr(s.armSec),
          takeoffSec: s.takeoffSec,
          takeoffKst: tkKst,
          takeoffBoot: secToBootStr(s.takeoffSec),
          takeoffTrigger: s.takeoffTrigger,
          landingSec: s.landingSec,
          landingKst: ldKst,
          landingBoot: secToBootStr(s.landingSec),
          landingTrigger: s.landingTrigger,
          disarmSec: s.disarmSec,
          disarmKst: secToKstHHMMSS(Math.round(s.disarmSec)),
          disarmBoot: secToBootStr(s.disarmSec),
          durationSec: durSec,
          durationColonHHMMSS: durColon,
          logbookLine: `${tkKst} ${ldKst} ${durColon}`,
          maxRelAlt: sMaxRelAlt
        };
      });

      const firstSortie = sorties[0] || groundSummary;
      const lastSortie = sorties[sorties.length - 1] || groundSummary;
      if (armSec === null) armSec = firstSortie.armSec;
      takeoffSec = firstSortie.takeoffSec;
      takeoffTrigger = firstSortie.takeoffTrigger;
      landingSec = lastSortie.landingSec;
      landingTrigger = lastSortie.landingTrigger;
      if (disarmSec === null || disarmSec < landingSec) disarmSec = lastSortie.disarmSec;

      const airborneDurationSec = sorties.reduce((acc, s) => acc + s.durationSec, 0);
      const armedDurationSec = Math.max(0, Math.round(disarmSec) - Math.round(armSec));
      const groundIdleSec = Math.max(0, armedDurationSec - airborneDurationSec);

      const takeoffHHMMSS = firstSortie.takeoffKst;
      const landingHHMMSS = lastSortie.landingKst;
      const durationColonHHMMSS = formatColonHHMMSS(airborneDurationSec);
      const logbookLine = groundOnly ? '비행 미감지' : sorties.map(s => s.logbookLine).join('\n');

      const modeSegments = [];
      const sortedModes = [...modeRows].sort((a, b) => (a.TimeUS || 0) - (b.TimeUS || 0));
      if (sortedModes.length === 0) {
        modeSegments.push({ modeNum: 0, name: 'STABILIZE', color: '#0284c7', startSec: minSec, endSec: maxSec });
      } else {
        for (let i = 0; i < sortedModes.length; i++) {
          const mNum = sortedModes[i].ModeNum ?? sortedModes[i].Mode ?? 0;
          const mInfo = COPTER_MODES[mNum] || { name: `MODE_${mNum}`, color: '#64748b', desc: '비행 모드' };
          const sSec = i === 0 ? minSec : timeUsToSec(sortedModes[i].TimeUS);
          const eSec = i + 1 < sortedModes.length ? timeUsToSec(sortedModes[i + 1].TimeUS) : maxSec;
          if (eSec > sSec) {
            modeSegments.push({
              modeNum: mNum,
              name: mInfo.name,
              desc: mInfo.desc,
              color: mInfo.color,
              startSec: sSec,
              endSec: eSec
            });
          }
        }
      }

      let maxAlt = 0, maxRelAlt = 0, maxAmslAlt = 0;
      let maxSpeed = 0, totalDistM = 0;
      let prevLat = null, prevLng = null;
      let minSats = 99, maxSats = 0, maxHdop = 0;
      let maxVibeX = 0, maxVibeY = 0, maxVibeZ = 0, maxClip = 0;
      let startVolt = 0, minVolt = 999, maxCurr = 0, totalMah = 0;
      let minVcc = 99, maxVcc = 0;
      let maxAttErr = 0, sumAttErrSq = 0, attCount = 0;
      let sumC1 = 0, sumC2 = 0, sumC3 = 0, sumC4 = 0, rcouCount = 0;
      const attThresholdDeg = cfg.attErrDeg || 10.0;
      const attCritDeg = Math.max(15.0, attThresholdDeg * 1.5);
      const attSustainReqSec = cfg.attSustainSec || 2.0;
      let curAttWarnStartSec = null;
      let curAttCritStartSec = null;
      let maxSustainedAttWarnSec = 0;
      let maxSustainedAttCritSec = 0;
      let firstSustainedAttErrSec = null;

      // ========================================================================
      // 4. REFINED MAG_FIELD (COMPASS INTERFERENCE) CALCULATION
      //    Separates natural Heading(Yaw)/Attitude variation from true
      //    Throttle/Current-Correlated EMI Interference (CompassMot principle)
      // ========================================================================
      // First compute raw mag_field norm and 5-point smoothed mag_field to reject 1-sample spike noise
      parsed.onAnalysisPhase?.('flight-sorties-and-mode');
      const rawMagNorms = timeline.map(pt => Math.hypot(pt.magX, pt.magY, pt.magZ));
      const smoothMagNorms = rawMagNorms.map((val, idx) => {
        if (val <= 10) return 0;
        let sum = 0, c = 0;
        for (let k = Math.max(0, idx - 2); k <= Math.min(rawMagNorms.length - 1, idx + 2); k++) {
          if (rawMagNorms[k] > 10) { sum += rawMagNorms[k]; c++; }
        }
        return c > 0 ? (sum / c) : val;
      });

      // Establish clean baseline magnetic field (median of low-throttle armed/early hover points)
      const baselineCandidates = [];
      for (let i = 0; i < timeline.length; i++) {
        const pt = timeline[i];
        const sm = smoothMagNorms[i];
        if (sm > 50 && pt.sec >= armSec && pt.thO < 35) {
          baselineCandidates.push(sm);
        }
      }
      if (baselineCandidates.length === 0) {
        for (let i = 0; i < smoothMagNorms.length; i++) {
          if (smoothMagNorms[i] > 50) baselineCandidates.push(smoothMagNorms[i]);
        }
      }
      baselineCandidates.sort((a, b) => a - b);
      const baseMagField = baselineCandidates.length > 0
        ? baselineCandidates[Math.floor(baselineCandidates.length / 2)]
        : 0;

      let minMagField = 99999, maxMagField = 0;
      let lowThMagSum = 0, lowThMagCnt = 0;
      let highThMagSum = 0, highThMagCnt = 0;
      const airborneThList = [];
      const airborneMagList = [];

      for (let i = 0; i < timeline.length; i++) {
        const pt = timeline[i];
        for (const seg of modeSegments) {
          if (pt.sec >= seg.startSec && pt.sec <= seg.endSec) {
            pt.modeName = seg.name;
            pt.modeColor = seg.color;
            break;
          }
        }
        if (pt.alt > maxAlt) maxAlt = pt.alt;
        if (pt.autoRelAlt > maxRelAlt) maxRelAlt = pt.autoRelAlt;
        if (pt.gpsAmsl > maxAmslAlt) maxAmslAlt = pt.gpsAmsl;
        if (pt.spd > maxSpeed) maxSpeed = pt.spd;

        if (pt.sec >= armSec && pt.sec <= disarmSec) {
          if (pt.nSats > 0 && pt.nSats < minSats) minSats = pt.nSats;
          if (pt.nSats > maxSats) maxSats = pt.nSats;
          if (pt.hdop > maxHdop) maxHdop = pt.hdop;
        }
        if (pt.lat && pt.lng) {
          if (prevLat !== null && prevLng !== null) {
            const dLat = (pt.lat - prevLat) * 111320;
            const dLng = (pt.lng - prevLng) * 111320 * Math.cos(pt.lat * Math.PI / 180);
            const stepM = Math.hypot(dLat, dLng);
            if (stepM < 200) totalDistM += stepM;
          }
          prevLat = pt.lat;
          prevLng = pt.lng;
        }

        if (pt.vibeX > maxVibeX) maxVibeX = pt.vibeX;
        if (pt.vibeY > maxVibeY) maxVibeY = pt.vibeY;
        if (pt.vibeZ > maxVibeZ) maxVibeZ = pt.vibeZ;
        if (pt.clip0 > maxClip) maxClip = pt.clip0;

        if (Number.isFinite(pt.volt) && pt.volt > 1.5) {
          if (startVolt === 0) startVolt = pt.volt;
          if (pt.volt < minVolt) minVolt = pt.volt;
        }
        if (pt.curr > maxCurr) maxCurr = pt.curr;
        if (pt.currTot > totalMah) totalMah = pt.currTot;

        if (pt.vcc > 1 && pt.vcc < minVcc) minVcc = pt.vcc;
        if (pt.vcc > maxVcc) maxVcc = pt.vcc;

        if (pt.sec >= takeoffSec && pt.sec <= landingSec) {
          const err = Math.max(Math.abs(pt.desRoll - pt.roll), Math.abs(pt.desPitch - pt.pitch));
          if (err > maxAttErr) maxAttErr = err;
          sumAttErrSq += err * err;
          attCount++;

          if (err >= attThresholdDeg) {
            if (curAttWarnStartSec === null) curAttWarnStartSec = pt.sec;
            const durW = pt.sec - curAttWarnStartSec;
            if (durW > maxSustainedAttWarnSec) maxSustainedAttWarnSec = durW;
            if (durW >= attSustainReqSec && firstSustainedAttErrSec === null) {
              firstSustainedAttErrSec = curAttWarnStartSec;
            }
          } else {
            curAttWarnStartSec = null;
          }

          if (err >= attCritDeg) {
            if (curAttCritStartSec === null) curAttCritStartSec = pt.sec;
            const durC = pt.sec - curAttCritStartSec;
            if (durC > maxSustainedAttCritSec) maxSustainedAttCritSec = durC;
          } else {
            curAttCritStartSec = null;
          }

          sumC1 += pt.c1;
          sumC2 += pt.c2;
          sumC3 += pt.c3;
          sumC4 += pt.c4;
          rcouCount++;
        }

        const smMf = smoothMagNorms[i];
        if (smMf > 50 && baseMagField > 50) {
          pt.magPct = ((smMf - baseMagField) / baseMagField) * 100;
          if (pt.sec >= takeoffSec && pt.sec <= landingSec) {
            if (smMf < minMagField) minMagField = smMf;
            if (smMf > maxMagField) maxMagField = smMf;
            airborneThList.push(pt.thO);
            airborneMagList.push(smMf);
            if (pt.thO <= 40) {
              lowThMagSum += smMf;
              lowThMagCnt++;
            } else if (pt.thO >= 58) {
              highThMagSum += smMf;
              highThMagCnt++;
            }
          }
        }
      }

      if (minSats === 99) minSats = 0;
      if (minVolt === 999) minVolt = 0;
      const cellDetection = detectBatteryCells(cfg.cellCount, batRows, t.BCL || [], t.BCL2 || []);
      const detectedCells = cellDetection.cells;
      const minCellVolt = detectedCells > 0 ? (minVolt / detectedCells) : 0;
      for (const pt of timeline) {
        pt.cellVolt = detectedCells > 0 ? (pt.volt / detectedCells) : 0;
      }

      const maxVibeAll = Math.max(maxVibeX, maxVibeY, maxVibeZ);
      const vccRipple = maxVcc > minVcc ? (maxVcc - minVcc) : 0;
      const rmsAttErr = attCount > 0 ? Math.sqrt(sumAttErrSq / attCount) : 0;

      let motorSpreadUs = 0;
      let avgMotors = [0, 0, 0, 0];
      if (rcouCount > 0) {
        avgMotors = [sumC1 / rcouCount, sumC2 / rcouCount, sumC3 / rcouCount, sumC4 / rcouCount];
        motorSpreadUs = Math.max(...avgMotors) - Math.min(...avgMotors);
      }

      // Compute Pearson correlation r(Throttle, MagField) & Throttle-Induced Mag Interference %
      let magThrottleCorr = 0;
      if (airborneThList.length > 10) {
        const meanTh = airborneThList.reduce((a, b) => a + b, 0) / airborneThList.length;
        const meanMg = airborneMagList.reduce((a, b) => a + b, 0) / airborneMagList.length;
        let num = 0, denTh = 0, denMg = 0;
        for (let i = 0; i < airborneThList.length; i++) {
          const dt = airborneThList[i] - meanTh;
          const dm = airborneMagList[i] - meanMg;
          num += dt * dm;
          denTh += dt * dt;
          denMg += dm * dm;
        }
        if (denTh > 1e-6 && denMg > 1e-6) {
          magThrottleCorr = num / Math.sqrt(denTh * denMg);
        }
      }

      // Raw peak-to-peak variation during airborne flight (mostly caused by 360° Yaw rotation + tilt)
      const rawHeadingMagRangePct = (baseMagField > 50 && maxMagField > minMagField)
        ? (((maxMagField - minMagField) / baseMagField) * 100)
        : 0;

      // True Throttle-Correlated Magnetic Interference % (what ArduPilot CompassMot actually measures)
      let throttleMagDiffPct = 0;
      if (baseMagField > 50 && lowThMagCnt >= 3 && highThMagCnt >= 3) {
        const avgLow = lowThMagSum / lowThMagCnt;
        const avgHigh = highThMagSum / highThMagCnt;
        throttleMagDiffPct = (Math.abs(avgHigh - avgLow) / baseMagField) * 100;
      } else if (baseMagField > 50 && Math.abs(magThrottleCorr) >= 0.45) {
        throttleMagDiffPct = rawHeadingMagRangePct * Math.abs(magThrottleCorr);
      }

      // Effective EMI interference metric: only penalize when throttle correlation or compass error exists
      const magVarPct = Math.abs(magThrottleCorr) >= 0.35
        ? Math.max(throttleMagDiffPct, rawHeadingMagRangePct * Math.abs(magThrottleCorr) * 0.7)
        : (throttleMagDiffPct * 0.6);

      const hasCompassErrEvent = errRows.some(e => e.Subsys === 3 && (e.ECode || 0) !== 0);
      const hasEkfYawReset = evRows.some(ev => ev.Id === 62);
      const isAbnormalBaseMag = baseMagField > 0 && (baseMagField < 180 || baseMagField > 850);

      parsed.onAnalysisPhase?.('magnetic-and-telemetry-metrics');
      let firmwareStr = 'ArduPilot Vehicle';
      let hardwareStr = '';
      for (const m of msgRows) {
        const txt = m.Message || '';
        if (/ArduCopter|ArduPlane|ArduRover|QuadPlane/i.test(txt)) firmwareStr = txt;
        if (/Cube|Pixhawk|Matek|Kakute|Durandal/i.test(txt)) hardwareStr = txt.split(' ')[0];
      }
      const frameInfo = detectFrameType(msgRows, parmRows);

      // ========================================================================
      // 2. COLLECT ALL SENSOR ERRORS & FAILSAFES FOR GRAPH MARKERS
      // ========================================================================
      const chartErrorMarkers = [];
      function addErrorMarker(sec, sensorName, shortLabel, detail, color = '#dc2626', presetTarget = 'takeoff_alt') {
        // Avoid duplicate markers of the same sensor within 2 seconds
        if (chartErrorMarkers.some(m => m.sensorName === sensorName && Math.abs(m.sec - sec) < 2.0)) return;
        const pt = findNearestByTimeUS(spineRows, sec * 1e6);
        const tlPt = timeline.find(p => Math.abs(p.sec - sec) < 1.0) || timeline[0] || { lat: 37.3824, lng: 126.6541 };
        chartErrorMarkers.push({
          sec,
          kstStr: secToKstStr(sec),
          bootStr: secToBootStr(sec),
          sensorName,
          label: shortLabel,
          detail,
          color,
          presetTarget,
          lat: tlPt.lat,
          lng: tlPt.lng
        });
      }

      // A) Explicit ERR table records (RC Failsafe Subsys=5, Radio=2, Compass=3, Battery=6, GPS=11, EKF=16/17, Baro=18, Crash=12, Thrust=25, Vibe=29)
      for (const er of errRows) {
        const s = timeUsToSec(er.TimeUS);
        const sub = er.Subsys;
        const ecode = er.ECode || 0;
        if (ecode === 0) continue; // ECode 0 = Resolved
        if (sub === 5 || sub === 2) {
          addErrorMarker(s, 'RC Failsafe', `⚠ RC Failsafe (${secToKstStr(s)})`, `무선조종(RC) 신호 두절 페일세이프 발동 (Subsys ${sub}, ECode ${ecode})`, '#dc2626', 'takeoff_alt');
        } else if (sub === 3) {
          addErrorMarker(s, 'Compass 센서', `⚠ 콤파스 오류 (${secToKstStr(s)})`, `자기장(Compass) 센서 에러 발생 (Subsys 3, ECode ${ecode})`, '#d97706', 'gps_mag');
        } else if (sub === 6) {
          addErrorMarker(s, '배터리 FS', `⚠ 배터리 FS (${secToKstStr(s)})`, `배터리 저전압 페일세이프 발동 (Subsys 6, ECode ${ecode})`, '#dc2626', 'battery');
        } else if (sub === 8) {
          addErrorMarker(s, 'GCS 통신 FS', `⚠ GCS FS (${secToKstStr(s)})`, `지상관제(GCS) 텔레메트리 신호 두절 (Subsys 8, ECode ${ecode})`, '#ea580c', 'takeoff_alt');
        } else if (sub === 11) {
          addErrorMarker(s, 'GPS 센서', `⚠ GPS 글리치 (${secToKstStr(s)})`, `GPS 위치 수신 글리치/오류 발생 (Subsys 11, ECode ${ecode})`, '#d97706', 'gps_mag');
        } else if (sub === 12) {
          addErrorMarker(s, '추락 감지', `⚠ 추락감지 (${secToKstStr(s)})`, `기체 추락 감지(Crash Check) 발동 (Subsys 12, ECode ${ecode})`, '#dc2626', 'attitude');
        } else if (sub === 16 || sub === 17 || sub === 24) {
          addErrorMarker(s, 'EKF 센서', `⚠ EKF 오류 (${secToKstStr(s)})`, `EKF 관성항법 분산 초과 / 페일세이프 (Subsys ${sub}, ECode ${ecode})`, '#dc2626', 'ekf');
        } else if (sub === 18) {
          addErrorMarker(s, '기압계 센서', `⚠ 기압계 오류 (${secToKstStr(s)})`, `기압고도계(Barometer) 센서 오류 (Subsys 18, ECode ${ecode})`, '#ea580c', 'takeoff_alt');
        } else if (sub === 25) {
          addErrorMarker(s, '추력 손실', `⚠ 추력손실 (${secToKstStr(s)})`, `모터/추진계 추력 손실 감지 (Subsys 25, ECode ${ecode})`, '#dc2626', 'motors');
        } else if (sub === 29) {
          addErrorMarker(s, 'IMU 진동', `⚠ 과진동 보상 (${secToKstStr(s)})`, `IMU 센서 과진동 페일세이프 작동 (Subsys 29, ECode ${ecode})`, '#ea580c', 'vibe');
        } else {
          const subName = ERR_SUBSYS[sub] || `센서#${sub}`;
          addErrorMarker(s, subName, `⚠ ${subName} (${secToKstStr(s)})`, `${subName} 오류 발생 (Subsys ${sub}, ECode ${ecode})`, '#dc2626', 'takeoff_alt');
        }
      }

      // B) Explicit EV table resets (EV 60 EKF_ALT_RESET, EV 62 EKF_YAW_RESET)
      for (const ev of evRows) {
        const s = timeUsToSec(ev.TimeUS);
        if (ev.Id === 60) {
          addErrorMarker(s, 'EKF 고도리셋', `⚠ EKF 고도리셋 (${secToKstStr(s)})`, 'EKF 고도 센서 기준점 강제 리셋 (EV 60)', '#ea580c', 'ekf');
        } else if (ev.Id === 62) {
          addErrorMarker(s, 'EKF 방위리셋', `⚠ EKF 방위리셋 (${secToKstStr(s)})`, '콤파스/기수(Yaw) 방위각 강제 리셋 (EV 62)', '#d97706', 'gps_mag');
        }
      }

      // C) MSG text-based Failsafe / Sensor Error detection (catches RC Failsafe even if ERR table is omitted)
      for (const ms of msgRows) {
        const s = timeUsToSec(ms.TimeUS);
        const txt = ms.Message || '';
        if (/Radio Failsafe|RC Failsafe|Throttle Failsafe|Lost RC/i.test(txt) && !/Cleared|Resolved/i.test(txt)) {
          addErrorMarker(s, 'RC Failsafe', `⚠ RC Failsafe (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#dc2626', 'takeoff_alt');
        } else if (/Battery Failsafe|Low Voltage|Critical Voltage/i.test(txt)) {
          addErrorMarker(s, '배터리 FS', `⚠ 배터리 FS (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#dc2626', 'battery');
        } else if (/GPS Glitch|GPS Primary/i.test(txt) && !/Cleared/i.test(txt)) {
          addErrorMarker(s, 'GPS 센서', `⚠ GPS 글리치 (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#d97706', 'gps_mag');
        } else if (/EKF.*variance|EKF.*Failsafe|DCM bad/i.test(txt)) {
          addErrorMarker(s, 'EKF 센서', `⚠ EKF 분산경고 (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#dc2626', 'ekf');
        } else if (/Compass.*error|Mag.*error| unhealthy compass/i.test(txt)) {
          addErrorMarker(s, 'Compass 센서', `⚠ 콤파스 오류 (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#d97706', 'gps_mag');
        } else if (/Vibration compensation ON/i.test(txt)) {
          addErrorMarker(s, 'IMU 진동', `⚠ 진동보상 작동 (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#ea580c', 'vibe');
        } else if (/Crash|Thrust Loss/i.test(txt)) {
          addErrorMarker(s, '추력/추락', `⚠ 추력/추락경고 (${secToKstStr(s)})`, `텍스트 메시지 감지: ${txt}`, '#dc2626', 'attitude');
        }
      }

      // D) RCIN throttle PWM drop below FS_THR_VALUE (typically < 975 µs during flight)
      if (rcinRows.length > 0) {
        for (const r of rcinRows) {
          const s = timeUsToSec(r.TimeUS);
          const c3 = r.C3 ?? 1500;
          if (s >= takeoffSec && s <= landingSec && c3 > 500 && c3 < 975) {
            addErrorMarker(s, 'RC Failsafe', `⚠ RC 신호저하 (${secToKstStr(s)})`, `비행 중 RC 스로틀 채널(RCIN.C3=${c3}µs)이 페일세이프 임계값(975µs) 미만으로 떨어짐`, '#dc2626', 'takeoff_alt');
            break;
          }
        }
      }

      // E) Telemetry-based sensor anomaly markers (IMU Clipping onset, severe GPS dropout in flight)
      let prevClipVal = 0;
      let gpsAnomalyMarked = false;
      for (const pt of timeline) {
        if (pt.clip0 > prevClipVal) {
          addErrorMarker(pt.sec, 'IMU 가속도계', `⚠ IMU 클리핑 (${pt.kstStr})`, `가속도계 센서 포화(Clipping 누적 ${pt.clip0}회) 발생 시점`, '#e11d48', 'vibe');
          prevClipVal = pt.clip0;
        }
        if (!gpsAnomalyMarked && pt.sec >= takeoffSec && pt.sec <= landingSec && pt.nSats > 0 && (pt.nSats < 7 || pt.hdop > 2.5)) {
          addErrorMarker(pt.sec, 'GPS 센서', `⚠ GPS 수신불량 (${pt.kstStr})`, `비행 중 GPS 위성(${pt.nSats}개) 급감 또는 HDOP(${pt.hdop.toFixed(2)}) 기준 초과 시점`, '#d97706', 'gps_mag');
          gpsAnomalyMarked = true;
        }
      }

      // F) If log cut off abruptly without disarm, add a prominent Log Cutoff marker at maxSec
      if (isLogCutoff) {
        addErrorMarker(
          maxSec,
          '로그 끊김',
          `⚠️ 로그 끊김 (${secToKstStr(maxSec)})`,
          `시동 해제(EV 11) 없이 ${secToKstStr(maxSec)}에 로그 기록이 비정상 중단됨 (마지막 상대고도 ${lastTimelinePt.autoRelAlt.toFixed(1)}m, 스로틀 ${lastTimelinePt.thO.toFixed(0)}%)`,
          '#be123c',
          'takeoff_alt'
        );
      }

      chartErrorMarkers.sort((a, b) => a.sec - b.sec);

      const diagnostics = [];

      let vibeStatus = 'PASS';
      let vibeCause = 'X, Y, Z 3축 진동이 모두 ArduPilot 권장 기준(30 m/s² 미만) 이내이며 IMU 클리핑이 전혀 없습니다.';
      if (maxVibeAll > cfg.vibeCrit || maxClip > 0) {
        vibeStatus = 'FAIL';
        if (maxVibeZ > maxVibeX && maxVibeZ > maxVibeY) {
          vibeCause = `Z축 최대 진동(${maxVibeZ.toFixed(1)} m/s²) 및 클리핑(${maxClip}회) 초과! ArduPilot 매뉴얼 기준 프로펠러 블레이드 변형(트래킹 불량) 또는 모터 축 수직 유격 점검이 필요합니다.`;
        } else {
          vibeCause = `수평(X/Y) 진동(${Math.max(maxVibeX, maxVibeY).toFixed(1)} m/s²) 및 클리핑(${maxClip}회) 과다! 모터 베어링 마모, 프롭 밸런스 불량 또는 FC 방진 마운트 점검이 필요합니다.`;
        }
      } else if (maxVibeAll > cfg.vibeWarn) {
        vibeStatus = 'WARN';
        vibeCause = `최대 진동(${maxVibeAll.toFixed(1)} m/s²)이 주의 구간(${cfg.vibeWarn}~${cfg.vibeCrit} m/s²)에 진입했습니다. 고도 유지(Loiter/PosHold) 정밀도가 저하될 수 있습니다.`;
      }
      diagnostics.push({
        id: 'vibe',
        title: '1. 기체 진동 및 가속도계 클리핑 (VIBE)',
        status: vibeStatus,
        metric: `X: ${maxVibeX.toFixed(1)} · Y: ${maxVibeY.toFixed(1)} · Z: ${maxVibeZ.toFixed(1)} m/s² (Clip: ${maxClip}회)`,
        threshold: `정상 < ${cfg.vibeWarn} m/s² / 위험 > ${cfg.vibeCrit} m/s² & Clip = 0`,
        detail: vibeCause,
        presetTarget: 'vibe'
      });

      if (firstSustainedAttErrSec !== null) {
        addErrorMarker(
          firstSustainedAttErrSec,
          '자세제어 추종오차',
          `⚠ 자세오차 지속 (${secToKstStr(firstSustainedAttErrSec)})`,
          `목표 자세와 실제 자세의 오차(≥${attThresholdDeg}°)가 ${maxSustainedAttWarnSec.toFixed(1)}초 연속 지속됨`,
          '#ea580c',
          'attitude'
        );
        chartErrorMarkers.sort((a, b) => a.sec - b.sec);
      }

      let attStatus = 'PASS';
      let attDetail = `비행 전체 평균(RMS) 자세 오차는 ±${rmsAttErr.toFixed(2)}°이며, ${attThresholdDeg.toFixed(1)}° 이상 오차가 ${attSustainReqSec.toFixed(1)}초 이상 연속 지속된 구간이 전혀 없습니다(최대 지속 ${maxSustainedAttWarnSec.toFixed(1)}초). 조종 스틱 급기동 시 순간 최대 피크(±${maxAttErr.toFixed(1)}°)는 정상적인 기체 관성 응답 지연입니다.`;

      if (maxSustainedAttCritSec >= attSustainReqSec || maxSustainedAttWarnSec >= attSustainReqSec * 1.8 || rmsAttErr >= 8.0) {
        attStatus = 'FAIL';
        attDetail = `목표 자세와 실제 자세의 오차(≥${attThresholdDeg.toFixed(1)}°)가 ${maxSustainedAttWarnSec.toFixed(1)}초 동안 연속으로 지속되었거나 전체 RMS 오차(±${rmsAttErr.toFixed(2)}°)가 과다합니다. 추력 부족, 모터/ESC 응답 불량 또는 심한 무게중심 불균형을 점검하세요.`;
      } else if (maxSustainedAttWarnSec >= attSustainReqSec || rmsAttErr >= 5.0) {
        attStatus = 'WARN';
        attDetail = `비행 중 ${attThresholdDeg.toFixed(1)}° 이상의 자세 추종 오차가 ${maxSustainedAttWarnSec.toFixed(1)}초 연속 지속(또는 평균 RMS ±${rmsAttErr.toFixed(2)}°)되었습니다. 강풍 외란 영향이거나 PID 게인/추력 여유 점검이 권장됩니다.`;
      }

      diagnostics.push({
        id: 'attitude',
        title: '2. 자세 제어 추종성 및 기구적 건전성 (ATT)',
        status: attStatus,
        metric: `평균 RMS: ±${rmsAttErr.toFixed(2)}° · ${attThresholdDeg}°이상 연속지속: ${maxSustainedAttWarnSec.toFixed(1)}초 (순간피크 ±${maxAttErr.toFixed(1)}°)`,
        threshold: `정상: 평균 RMS < 5.0° & 오차 ≥${attThresholdDeg}° 연속 ${attSustainReqSec}초 미만 (순간 기동피크 제외)`,
        detail: attDetail,
        presetTarget: 'attitude'
      });

      let motorStatus = motorSpreadUs > 120 ? 'FAIL' : (motorSpreadUs > 70 ? 'WARN' : 'PASS');
      diagnostics.push({
        id: 'motors',
        title: '3. 모터 PWM 출력 밸런스 및 무게중심 (RCOU)',
        status: motorStatus,
        metric: `평균 출력 편차: ${motorSpreadUs.toFixed(0)} µs (M1:${avgMotors[0].toFixed(0)} / M2:${avgMotors[1].toFixed(0)} / M3:${avgMotors[2].toFixed(0)} / M4:${avgMotors[3].toFixed(0)})`,
        threshold: '정상 편차 < 70 µs / 주의 70~120 µs / 불균형 > 120 µs',
        detail: motorStatus === 'PASS'
          ? '4개 모터의 평균 PWM 출력이 고르게 분포되어 기체 무게중심(CG)과 추진 계통이 균형을 이루고 있습니다.'
          : '특정 모터의 평균 PWM 출력이 다른 모터 대비 높습니다. 페이로드 편심(무게중심 쏠림) 또는 해당 모터/프롭 효율 저하를 점검하세요.',
        presetTarget: 'motors'
      });

      let batStatus = minCellVolt > 0 && minCellVolt < cfg.cellMinVolt - 0.15 ? 'FAIL' : (minCellVolt > 0 && minCellVolt < cfg.cellMinVolt ? 'WARN' : 'PASS');
      if (!detectedCells || !minVolt || cellDetection.source.includes('추정')) batStatus = batStatus === 'FAIL' ? 'FAIL' : 'WARN';
      diagnostics.push({
        id: 'battery',
        title: '4. 배터리 전압 및 전류 (BAT)',
        status: batStatus,
        metric: `최저 ${minVolt.toFixed(2)}V (${detectedCells ? minCellVolt.toFixed(2)+'V/cell, '+detectedCells+'S' : '셀 수 미확정'}) · 최대전류 ${maxCurr.toFixed(1)}A`,
        threshold: `평균 셀 전압 ≥ ${cfg.cellMinVolt.toFixed(2)}V`,
        detail: !minVolt || !detectedCells || cellDetection.source.includes('추정')
          ? `${cellDetection.source}. 셀 수나 전압 정보가 불충분하여 셀 전압의 정상 여부를 확정하지 않습니다. 기준 설정에서 실제 셀 수를 지정하세요.`
          : batStatus === 'PASS'
          ? '측정된 배터리 전압의 셀당 평균값이 설정 기준 이상입니다.'
          : `평균 셀 전압이 ${minCellVolt.toFixed(2)}V까지 낮아졌습니다. 배터리와 전압 측정값을 확인하세요.`,
        presetTarget: 'battery'
      });

      // Refined Mag Status: Only warn/fail on actual throttle-correlated EMI interference or explicit Compass/EKF error
      const magWarnLimit = cfg.magWarn || 35;
      const magCritLimit = cfg.magCrit || 60;
      let magStatus = 'PASS';
      let magDetail = `스로틀 연동 추정 지표는 ${magVarPct.toFixed(1)}%(상관계수 r=${magThrottleCorr.toFixed(2)})입니다. 전체 자기장 변화폭은 ${rawHeadingMagRangePct.toFixed(1)}%입니다. 전류는 이 수식에 사용하지 않으며 CompassMot 실측 간섭률과 구분해야 합니다.`;

      if (hasCompassErrEvent || magVarPct > magCritLimit) {
        magStatus = 'FAIL';
        magDetail = `고출력을 낼 때 모터/배터리 전력선 전류가 콤파스 자기장을 강하게 왜곡하고 있습니다(스로틀 연동 간섭률 ${magVarPct.toFixed(1)}%, 상관계수 r=${magThrottleCorr.toFixed(2)}). 전원 배선과 GPS/콤파스 모듈 간 거리를 띄우고 CompassMot 보정을 수행하세요.`;
      } else if (magVarPct > magWarnLimit || hasEkfYawReset || isAbnormalBaseMag) {
        magStatus = 'WARN';
        magDetail = hasEkfYawReset
          ? `비행 중 EKF 기수 방위 리셋(EV 62)이 발생했습니다. 이것만으로 자기장 간섭을 확정할 수는 없습니다. 스로틀 연동 추정 지표는 ${magVarPct.toFixed(1)}%입니다.`
          : `스로틀 상승 시 자기장 크기가 함께 변하는 경향(간섭률 ${magVarPct.toFixed(1)}%, r=${magThrottleCorr.toFixed(2)})이 감지되었습니다. 전력선 이격 상태를 점검하세요.`;
      }

      diagnostics.push({
        id: 'mag',
        title: '5. 스로틀 연동 자기장 간섭 추정 (Compass / MAG)',
        status: magStatus,
        metric: `스로틀 연동 추정: ${magVarPct.toFixed(1)}% (전체 변화폭 ${rawHeadingMagRangePct.toFixed(1)}% · 기준장 ${baseMagField ? baseMagField.toFixed(0) : 0} mG)`,
        threshold: `스로틀 비례 간섭 < ${magWarnLimit}% 정상 / > ${magCritLimit}% 위험 (단순 기수 회전 변화 제외)`,
        detail: magDetail,
        presetTarget: 'gps_mag'
      });

      let gpsStatus = (minSats > 0 && (minSats < 10 || maxHdop > 2.0)) ? 'FAIL' : ((minSats > 0 && (minSats < 12 || maxHdop > 1.5)) ? 'WARN' : 'PASS');
      diagnostics.push({
        id: 'gps',
        title: '6. GPS 위성 수신 및 수평 정밀도 (GPS HDOP)',
        status: gpsStatus,
        metric: `가시 위성: 최저 ${minSats}개 ~ 최대 ${maxSats}개 · 최대 HDOP: ${maxHdop.toFixed(2)}`,
        threshold: 'ArduPilot 매뉴얼: 위성 ≥ 12개 & HDOP < 1.5 (글리치 기준 > 2.0)',
        detail: gpsStatus === 'PASS'
          ? '전 비행 구간에서 위성 12개 이상 및 HDOP 1.5 미만의 우수한 GPS 수신 품질을 유지했습니다.'
          : '비행 중 위성 수 감소(<12개) 및 HDOP 상승(>2.0) 구간이 감지되었습니다. 차폐 지형 영향 또는 GPS 글리치로 인한 급기동 위험이 있습니다.',
        presetTarget: 'gps_mag'
      });

      const activeErrs = errRows.filter(e => (e.ECode || 0) !== 0);
      let errStatus = (isLogCutoff || activeErrs.some(e => [5, 6, 12, 16, 17].includes(e.Subsys)))
        ? 'FAIL'
        : ((activeErrs.length > 0 || chartErrorMarkers.length > 0) ? 'WARN' : 'PASS');
      let errDetail = '시동부터 착륙 후 시동 해제까지 어떠한 페일세이프나 서브시스템 에러(ERR), 로그 끊김도 발생하지 않았습니다.';
      if (isLogCutoff) {
        errDetail = `⚠️ [로그 끊김 감지] 정상적인 시동 해제(EV 11 / DISARM) 없이 ${secToKstStr(maxSec)}에 로그 기록이 비정상 중단되었습니다(마지막 고도 ${lastTimelinePt.autoRelAlt.toFixed(1)}m, 스로틀 ${lastTimelinePt.thO.toFixed(0)}%). 전원 차단, 배터리 커넥터/브라운아웃 또는 SD카드 접촉 불량을 점검하세요.`;
      } else if (activeErrs.length > 0 || chartErrorMarkers.length > 0) {
        const names = chartErrorMarkers.map(m => `${m.sensorName}(${m.kstStr})`).join(', ');
        errDetail = `비행 중 센서 오류/페일세이프 마커가 기록되었습니다: ${names}. 메인 차트 상단의 오류 배지를 클릭하면 해당 시점으로 즉시 이동합니다.`;
      }

      diagnostics.push({
        id: 'errors',
        title: '7. 온보드 센서 오류 · RC 페일세이프 · 로그 끊김 (ERR / EV)',
        status: errStatus,
        metric: `센서/FS 마커: ${chartErrorMarkers.length}건 · ERR 레코드: ${activeErrs.length}건 · 종료상태: ${isLogCutoff ? '⚠️ 로그 끊김' : '정상 DISARM'}`,
        threshold: '비행 중 페일세이프·센서 오류 0건 & 정상 시동 해제(EV 11)',
        detail: errDetail,
        presetTarget: 'takeoff_alt'
      });

      const unifiedEvents = [];
      for (const ev of evRows) {
        const sec = timeUsToSec(ev.TimeUS);
        const info = EV_DESCRIPTIONS[ev.Id] || { name: `EV_${ev.Id}`, ko: `온보드 이벤트 ID ${ev.Id}`, badge: 'slate' };
        unifiedEvents.push({
          sec,
          kstStr: secToKstStr(sec),
          bootStr: secToBootStr(sec),
          type: 'EV',
          code: `EV ${ev.Id} (${info.name})`,
          ko: info.ko,
          severity: ev.Id === 28 || ev.Id === 18 ? 'highlight' : (ev.Id === 60 || ev.Id === 62 ? 'error' : 'normal')
        });
      }
      for (const er of errRows) {
        const sec = timeUsToSec(er.TimeUS);
        const subName = ERR_SUBSYS[er.Subsys] || `Subsys ${er.Subsys}`;
        const resolved = er.ECode === 0;
        unifiedEvents.push({
          sec,
          kstStr: secToKstStr(sec),
          bootStr: secToBootStr(sec),
          type: 'ERR',
          code: `Subsys ${er.Subsys} / ECode ${er.ECode}`,
          ko: `${subName} — ${resolved ? '정상 복구됨 (Resolved)' : '⚠ 센서 오류 / 페일세이프 발동 (Triggered)'}`,
          severity: resolved ? 'normal' : 'error'
        });
      }
      for (const ms of msgRows) {
        const sec = timeUsToSec(ms.TimeUS);
        unifiedEvents.push({
          sec,
          kstStr: secToKstStr(sec),
          bootStr: secToBootStr(sec),
          type: 'MSG',
          code: ms.Message || '',
          ko: translateMsgToKo(ms.Message || ''),
          severity: /Failsafe|variance|Glitch|Warning|Error|Crash/i.test(ms.Message || '') ? 'error' : 'normal'
        });
      }
      if (isLogCutoff) {
        unifiedEvents.push({
          sec: maxSec,
          kstStr: secToKstStr(maxSec),
          bootStr: secToBootStr(maxSec),
          type: 'ERR',
          code: 'LOG_CUTOFF (비정상 기록 중단)',
          ko: `⚠️ 시동 해제(DISARM) 없이 로그가 끊겼습니다 (고도 ${lastTimelinePt.autoRelAlt.toFixed(1)}m · 스로틀 ${lastTimelinePt.thO.toFixed(0)}%)`,
          severity: 'error'
        });
      }
      unifiedEvents.sort((a, b) => a.sec - b.sec);
      parsed.onAnalysisPhase?.('diagnostics-and-events');

      return {
        isLogCutoff,
        lastAltAtEnd: lastTimelinePt.autoRelAlt,
        lastThOAtEnd: lastTimelinePt.thO,
        chartErrorMarkers,
        rawHeadingMagRangePct,
        magThrottleCorr,
        rmsAttErr,
        maxSustainedAttWarnSec,
        dateStr: secToDateKstStr(takeoffSec),
        hasAbsoluteTime: gpsEpochOffsetMs !== null,
        gpsEpochOffsetMs,
        firmwareStr,
        hardwareStr,
        frameInfo,
        minSec,
        maxSec,
        armSec,
        armKst: secToKstHHMMSS(armSec),
        armBoot: secToBootStr(armSec),
        armTrigger,
        takeoffSec,
        takeoffKst: takeoffHHMMSS,
        takeoffBoot: secToBootStr(takeoffSec),
        takeoffTrigger,
        landingSec,
        landingKst: landingHHMMSS,
        landingBoot: secToBootStr(landingSec),
        landingTrigger,
        disarmSec,
        disarmKst: secToKstHHMMSS(disarmSec),
        disarmBoot: secToBootStr(disarmSec),
        disarmTrigger,
        sorties,
        groundOnly,
        activeSortieIdx: 0,
        airborneDurationSec,
        durationColonHHMMSS,
        logbookLine,
        armedDurationSec,
        groundIdleSec,
        maxAlt,
        maxRelAlt,
        maxAmslAlt,
        gpsAmslOffset,
        maxSpeed,
        totalDistKm: totalDistM / 1000.0,
        startVolt,
        minVolt,
        detectedCells,
        cellDetection,
        minCellVolt,
        maxCurr,
        totalMah,
        maxVibeAll,
        maxClip,
        minSats,
        maxSats,
        maxHdop,
        magVarPct,
        maxAttErr,
        motorSpreadUs,
        activeErrCount: activeErrs.length,
        modeSegments,
        diagnostics,
        timeline,
        unifiedEvents,
        parmRows,
        secToKstStr,
        secToBootStr
      };
    }

    function translateMsgToKo(msg) {
      if (/ArduCopter|ArduPlane/i.test(msg)) return '펌웨어 버전 및 빌드 식별자';
      if (/ChibiOS/i.test(msg)) return '실시간 운영체제(RTOS) 커널 초기화';
      if (/EKF3.*initialised/i.test(msg)) return '확장 칼만 필터(EKF3) 듀얼 IMU 초기화 완료';
      if (/ARMING MOTORS/i.test(msg)) return '비행 제어기 모터 시동(Arming) 진입';
      if (/using GPS/i.test(msg)) return 'EKF3 위치 추정에 GPS 신호 결합 시작';
      if (/TakeoffComplete|Reached command/i.test(msg)) return '이륙 목표 고도 도달 및 자동 임무 명령 수행';
      if (/Returning to Launch/i.test(msg)) return '이륙 지점 자동 복귀(RTL) 모드 활성화';
      if (/Land Complete/i.test(msg)) return '지면 접지 확인 및 착륙 완료 판정';
      if (/DISARMING MOTORS/i.test(msg)) return '모터 시동 해제 및 비행 종료';
      if (/Vibration compensation/i.test(msg)) return '과진동 감지로 인한 진동 보상 알고리즘 작동';
      if (/Low Voltage Failsafe/i.test(msg)) return '배터리 저전압 페일세이프 발동 (즉시 착륙 권고)';
      if (/GPS Glitch/i.test(msg)) return 'GPS 위치 튀는 현상(Glitch) 및 EKF 분산 경고';
      return '시스템 상태 텍스트 메시지';
    }

    function formatDurationKo(sec) {
      const s = Math.max(0, Math.round(sec));
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m > 0 ? `${m}분 ${String(r).padStart(2, '0')}초` : `${r}초`;
    }
