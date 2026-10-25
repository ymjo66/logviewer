// Auto-update UI for the desktop exe (GitHub Releases).
// Talks to the Python side (x_drone_log_viewer.py Api) through window.pywebview.api;
// in a plain browser there is no bridge, so the startup check is skipped.
(function () {
  const appInfo = window.XDLV_APP || {};
  const el = (id) => document.getElementById(id);
  let latestInfo = null;

  function bridge() {
    const api = window.pywebview && window.pywebview.api;
    return api && typeof api.check_update === 'function' ? api : null;
  }

  function setModalOpen(open) {
    const modal = el('updateModal');
    modal.classList.toggle('hidden', !open);
    modal.classList.toggle('flex', open);
  }

  function setError(message) {
    const box = el('updateErrorText');
    box.textContent = message || '';
    box.classList.toggle('hidden', !message);
  }

  function setBusy(busy) {
    el('btnUpdateNow').disabled = busy || !!(latestInfo && latestInfo.blocker);
    el('btnUpdateLater').disabled = busy;
    el('btnCloseUpdateModal').disabled = busy;
  }

  function setProgress(fraction, text) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    el('updateProgressBox').classList.remove('hidden');
    el('updateProgressBar').style.width = `${pct}%`;
    el('updateProgressPct').textContent = `${pct}%`;
    if (text) el('updateProgressText').textContent = text;
  }

  async function checkForUpdate(manual) {
    const api = bridge();
    if (!api) {
      if (manual) showToast('업데이트 확인은 X_Drone_Log_Viewer.exe에서만 가능합니다.');
      return;
    }
    if (manual) showToast('GitHub 릴리즈에서 새 버전을 확인하는 중...');
    const info = await api.check_update();
    if (info.error) {
      if (manual) showToast(`업데이트 확인 실패: ${info.error}`);
      return;
    }
    if (!info.available) {
      if (manual) showToast(`현재 최신 버전(v${info.current})을 사용 중입니다.`);
      return;
    }

    latestInfo = info;
    const sizeMb = info.size ? ` · ${(info.size / 1048576).toFixed(1)} MB` : '';
    el('updateVersionBadge').textContent = `v${info.latest}`;
    el('updateSubtitle').textContent = `현재 v${info.current} → 최신 v${info.latest}${sizeMb}`;
    el('updateNotes').textContent = info.notes || '(등록된 업데이트 내용이 없습니다)';
    el('lnkReleasePage').href = info.url;
    el('updateProgressBox').classList.add('hidden');
    setError(info.blocker);
    setBusy(false);
    setModalOpen(true);
  }

  async function startUpdate() {
    const api = bridge();
    if (!api || !latestInfo || latestInfo.blocker) return;
    setError('');
    setBusy(true);
    setProgress(0, '새 버전 다운로드 중...');
    if (!(await api.start_update())) {
      setBusy(false);
      setError('업데이트를 시작하지 못했습니다. 다시 시도해 주세요.');
      return;
    }

    const timer = setInterval(async () => {
      const status = await api.update_status();
      if (status.state === 'downloading') {
        setProgress(status.progress, '새 버전 다운로드 중...');
      } else if (status.state === 'restarting') {
        clearInterval(timer);
        setProgress(1, '설치를 위해 프로그램을 다시 시작합니다...');
      } else if (status.state === 'error') {
        clearInterval(timer);
        el('updateProgressBox').classList.add('hidden');
        setBusy(false);
        setError(`업데이트 실패: ${status.error}`);
      }
    }, 250);
  }

  function init() {
    el('appVersionLabel').textContent = appInfo.version ? `v${appInfo.version}` : '-';
    if (appInfo.justUpdated) showToast(`v${appInfo.version}(으)로 업데이트되었습니다.`);

    el('btnCheckUpdateNow').addEventListener('click', () => checkForUpdate(true));
    el('btnUpdateNow').addEventListener('click', startUpdate);
    el('btnUpdateLater').addEventListener('click', () => setModalOpen(false));
    el('btnCloseUpdateModal').addEventListener('click', () => setModalOpen(false));

    if (bridge()) {
      checkForUpdate(false);
    } else {
      window.addEventListener('pywebviewready', () => checkForUpdate(false), { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
