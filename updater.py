"""Self-update from GitHub Releases.

Only releases tagged ``logviewer-vX.Y.Z`` that carry ``X_Drone_Log_Viewer.exe``
are considered. The same repository also serves XDroneGCS releases (plain
``vX.Y.Z`` tags, "Latest" release), so the two apps must never pick up each
other's binaries; for the same reason log viewer releases are published without
the "Latest" mark (see .github/workflows/release.yml).

Applying an update: the new exe is downloaded next to the running one as
``<exe>.new`` and verified (size + SHA-256 digest from the release API), then a
hidden PowerShell helper waits for every running instance to exit, swaps the
file in place and restarts the app with ``--updated``.
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request

TAG_PREFIX = 'logviewer-v'
ASSET_NAME = 'X_Drone_Log_Viewer.exe'
# Overridable only to test the update flow against a local mock server
API_BASE = os.environ.get('XDLV_UPDATE_API_BASE', 'https://api.github.com').rstrip('/')
USER_AGENT = 'X-Drone-Log-Viewer-Updater'

_VERSION_RE = re.compile(r'^(\d+)\.(\d+)\.(\d+)$')


def parse_version(text):
    match = _VERSION_RE.match((text or '').strip())
    return tuple(int(part) for part in match.groups()) if match else None


def find_latest_release(repo):
    """Newest non-draft, non-prerelease log viewer release that has the exe asset."""
    request = urllib.request.Request(
        f'{API_BASE}/repos/{repo}/releases?per_page=50',
        headers={
            'User-Agent': USER_AGENT,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        releases = json.load(response)

    best = None
    for release in releases:
        tag = release.get('tag_name') or ''
        if release.get('draft') or release.get('prerelease') or not tag.startswith(TAG_PREFIX):
            continue
        version = parse_version(tag[len(TAG_PREFIX):])
        asset = next((a for a in release.get('assets') or [] if a.get('name') == ASSET_NAME), None)
        if version is None or asset is None:
            continue
        if best is None or version > best['version']:
            best = {'version': version, 'release': release, 'asset': asset}
    return best


class Updater:
    def __init__(self, current_version, repo):
        self.current_version = current_version
        self.repo = repo
        self._latest = None
        self._lock = threading.Lock()
        self._status = {'state': 'idle', 'progress': 0.0, 'error': ''}

    def check(self):
        """Returns update info for the UI; never raises."""
        info = {'current': self.current_version, 'available': False}
        try:
            latest = find_latest_release(self.repo)
        except Exception as exc:
            info['error'] = str(exc)
            return info

        current = parse_version(self.current_version) or (0, 0, 0)
        if latest is None or latest['version'] <= current:
            return info

        self._latest = latest
        release = latest['release']
        info.update(
            available=True,
            latest='.'.join(map(str, latest['version'])),
            notes=(release.get('body') or '').strip(),
            url=release.get('html_url') or f'https://github.com/{self.repo}/releases',
            size=latest['asset'].get('size') or 0,
            blocker=self._apply_blocker(),
        )
        return info

    def status(self):
        with self._lock:
            return dict(self._status)

    def start(self, on_restart):
        """Downloads the update in the background, then swaps it in and calls on_restart()."""
        with self._lock:
            if self._latest is None or self._status['state'] in ('downloading', 'restarting'):
                return False
            self._status = {'state': 'downloading', 'progress': 0.0, 'error': ''}
        threading.Thread(target=self._run, args=(on_restart,), daemon=True).start()
        return True

    def _set_status(self, **changes):
        with self._lock:
            self._status.update(changes)

    def _apply_blocker(self):
        """Why the update cannot be applied in place, or '' if it can."""
        if not getattr(sys, 'frozen', False):
            return '개발 모드(python 실행)에서는 실행파일을 자동 교체할 수 없습니다. 릴리즈 페이지에서 받아 주세요.'
        exe_dir = os.path.dirname(sys.executable)
        try:
            with tempfile.TemporaryFile(dir=exe_dir):
                pass
        except OSError:
            return f'실행파일 폴더({exe_dir})에 쓰기 권한이 없습니다. 릴리즈 페이지에서 받아 직접 교체해 주세요.'
        return ''

    def _run(self, on_restart):
        target = sys.executable
        new_path = target + '.new'
        try:
            self._download(self._latest['asset'], new_path)
            self._launch_swap_helper(new_path, target)
        except Exception as exc:
            try:
                os.remove(new_path)
            except OSError:
                pass
            self._set_status(state='error', error=str(exc))
            return
        self._set_status(state='restarting', progress=1.0)
        on_restart()

    def _download(self, asset, path):
        request = urllib.request.Request(asset['browser_download_url'], headers={'User-Agent': USER_AGENT})
        expected_size = asset.get('size') or 0
        sha256 = hashlib.sha256()
        received = 0
        with urllib.request.urlopen(request, timeout=30) as response, open(path, 'wb') as out:
            total = expected_size or int(response.headers.get('Content-Length') or 0)
            while chunk := response.read(256 * 1024):
                out.write(chunk)
                sha256.update(chunk)
                received += len(chunk)
                if total:
                    self._set_status(progress=min(received / total, 1.0))

        if expected_size and received != expected_size:
            raise ValueError(f'다운로드 크기가 릴리즈 정보와 다릅니다 ({received:,} / {expected_size:,} bytes).')
        digest = asset.get('digest') or ''
        if digest.startswith('sha256:') and sha256.hexdigest() != digest.split(':', 1)[1].lower():
            raise ValueError('다운로드한 파일의 SHA-256 해시가 릴리즈 정보와 다릅니다.')

    def _launch_swap_helper(self, new_path, target):
        def quote(value):
            return "'" + value.replace("'", "''") + "'"

        script = f"""
$ErrorActionPreference = 'SilentlyContinue'
$target = {quote(target)}
$new = {quote(new_path)}
Get-Process | Where-Object {{ $_.Path -eq $target }} | ForEach-Object {{ [void]$_.WaitForExit(60000) }}
$moved = $false
for ($i = 0; $i -lt 40 -and -not $moved; $i++) {{
  try {{ Move-Item -LiteralPath $new -Destination $target -Force -ErrorAction Stop; $moved = $true }}
  catch {{ Start-Sleep -Milliseconds 500 }}
}}
if ($moved) {{ Start-Process -FilePath $target -ArgumentList '--updated' }}
else {{ Remove-Item -LiteralPath $new -Force; Start-Process -FilePath $target }}
"""
        powershell = os.path.join(
            os.environ.get('SystemRoot', r'C:\Windows'), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'
        )
        # Let the restarted onefile exe unpack itself fresh instead of reusing this instance's _MEI dir
        env = {k: v for k, v in os.environ.items() if not k.startswith('_PYI_') and k != '_MEIPASS2'}
        env['PYINSTALLER_RESET_ENVIRONMENT'] = '1'
        subprocess.Popen(
            [
                powershell, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-EncodedCommand', base64.b64encode(script.encode('utf-16-le')).decode('ascii'),
            ],
            env=env,
            close_fds=True,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )
