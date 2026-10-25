"""X Drone Log Viewer (Ardupilot ver) - Windows desktop app.

Hosts the original HTML/JS viewer (app/index.html) in a native window using
the Edge WebView2 runtime built into Windows 10/11, so the UI and analysis
logic stay identical to the web version. All assets (Tailwind, Chart.js,
fonts) are bundled locally, so the app works offline.

.bin / .log paths passed on the command line (dropping files on the exe icon,
or "Open with") are loaded automatically on startup. On startup the app also
checks GitHub Releases for a newer version (see updater.py).
"""

import json
import os
import sys
import threading

import bottle
import webview

from updater import Updater
from version import UPDATE_REPO, __version__

APP_TITLE = f'X Drone Log Viewer — Ardupilot ver v{__version__}'
LOG_EXTENSIONS = ('.bin', '.log')


def _base_dir():
    # PyInstaller extracts bundled data to sys._MEIPASS
    return getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))


APP_DIR = os.path.join(_base_dir(), 'app')

CLI_LOGS = [
    os.path.abspath(arg)
    for arg in sys.argv[1:]
    if arg.lower().endswith(LOG_EXTENSIONS) and os.path.isfile(arg)
]
# Set by the update helper when it restarts the app after swapping the exe
JUST_UPDATED = '--updated' in sys.argv[1:]

# Exposes app info to the page and feeds command-line logs through the page's
# own multi-file upload path (same progress bar, sorting and toast as picking
# files in the dialog).
PRELOAD_JS = """window.XDLV_APP = __APP_INFO__;
(function () {
  var entries = __ENTRIES__;
  if (!entries.length) return;
  window.addEventListener('load', async function () {
    var files = [];
    for (var i = 0; i < entries.length; i++) {
      try {
        var res = await fetch(entries[i].url);
        if (!res.ok) continue;
        files.push(new File([await res.blob()], entries[i].name));
      } catch (err) {
        console.error(err);
      }
    }
    if (files.length && typeof handleMultipleFilesUpload === 'function') {
      handleMultipleFilesUpload(files);
    }
  });
})();
"""

server = bottle.Bottle()


@server.route('/')
def index():
    return bottle.static_file('index.html', root=APP_DIR)


@server.route('/preload.js')
def preload_js():
    app_info = {'version': __version__, 'repo': UPDATE_REPO, 'justUpdated': JUST_UPDATED}
    entries = [
        {'name': os.path.basename(path), 'url': f'/__cli_log/{i}'}
        for i, path in enumerate(CLI_LOGS)
    ]
    bottle.response.content_type = 'application/javascript; charset=utf-8'
    bottle.response.set_header('Cache-Control', 'no-store')
    return (
        PRELOAD_JS
        .replace('__APP_INFO__', json.dumps(app_info, ensure_ascii=False))
        .replace('__ENTRIES__', json.dumps(entries, ensure_ascii=False))
    )


@server.route('/__cli_log/<idx:int>')
def cli_log(idx):
    if not 0 <= idx < len(CLI_LOGS):
        bottle.abort(404)
    path = CLI_LOGS[idx]
    return bottle.static_file(
        os.path.basename(path), root=os.path.dirname(path), mimetype='application/octet-stream'
    )


@server.route('/<path:path>')
def asset(path):
    return bottle.static_file(path, root=APP_DIR)


class Api:
    """Called from app/updater.js via window.pywebview.api."""

    def __init__(self, updater):
        self._updater = updater
        self._window = None

    def check_update(self):
        return self._updater.check()

    def start_update(self):
        return self._updater.start(on_restart=self._close_for_restart)

    def update_status(self):
        return self._updater.status()

    def _close_for_restart(self):
        # Short delay so the page can show the "restarting" state
        threading.Timer(1.0, self._window.destroy).start()


def main():
    # CSV / file exports open a native "Save as" dialog instead of being blocked
    webview.settings['ALLOW_DOWNLOADS'] = True
    # ArduPilot manual / release page links (target=_blank) open in the default browser
    webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = True

    api = Api(Updater(__version__, UPDATE_REPO))
    api._window = webview.create_window(
        APP_TITLE,
        server,
        js_api=api,
        width=1440,
        height=900,
        min_size=(960, 640),
        maximized=True,
        text_select=True,
        zoomable=True,
        background_color='#F1F5F9',
    )
    webview.start(gui='edgechromium')


if __name__ == '__main__':
    main()
