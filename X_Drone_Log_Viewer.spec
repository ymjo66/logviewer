# -*- mode: python ; coding: utf-8 -*-
# PyInstaller build: pyinstaller --noconfirm --clean X_Drone_Log_Viewer.spec
# Produces a single windowed dist/X_Drone_Log_Viewer.exe whose file properties
# carry the version from version.py.
import os

from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
)

ROOT = os.path.abspath(SPECPATH)

version_ns = {}
with open(os.path.join(ROOT, 'version.py'), encoding='utf-8-sig') as f:
    exec(f.read(), version_ns)
VERSION = version_ns['__version__']
VERSION_TUPLE = tuple(int(part) for part in VERSION.split('.')) + (0,)

version_info = VSVersionInfo(
    ffi=FixedFileInfo(filevers=VERSION_TUPLE, prodvers=VERSION_TUPLE),
    kids=[
        StringFileInfo([StringTable('041204B0', [
            StringStruct('FileDescription', 'X Drone Log Viewer (Ardupilot ver)'),
            StringStruct('FileVersion', VERSION),
            StringStruct('ProductName', 'X Drone Log Viewer'),
            StringStruct('ProductVersion', VERSION),
            StringStruct('OriginalFilename', 'X_Drone_Log_Viewer.exe'),
        ])]),
        VarFileInfo([VarStruct('Translation', [0x0412, 1200])]),
    ],
)

a = Analysis(
    [os.path.join(ROOT, 'x_drone_log_viewer.py')],
    pathex=[ROOT],
    datas=[(os.path.join(ROOT, 'app'), 'app')],
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='X_Drone_Log_Viewer',
    console=False,
    upx=False,
    icon=os.path.join(ROOT, 'app', 'icon.ico'),
    version=version_info,
)
