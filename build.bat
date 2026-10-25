@echo off
rem Local build of dist\X_Drone_Log_Viewer.exe (releases are built by GitHub Actions).
rem Requires Python 3.12 (py launcher or python on PATH).
setlocal
cd /d "%~dp0"
set "BUILD=%TEMP%\xdlv_build"

if not exist "%BUILD%\venv\Scripts\python.exe" (
  py -3.12 -m venv "%BUILD%\venv" 2>nul || python -m venv "%BUILD%\venv" || goto :fail
)
"%BUILD%\venv\Scripts\python.exe" -m pip install -q --upgrade pip || goto :fail
"%BUILD%\venv\Scripts\python.exe" -m pip install -q -r requirements.txt || goto :fail

"%BUILD%\venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean ^
  --workpath "%BUILD%\work" --distpath "%~dp0dist" ^
  "%~dp0X_Drone_Log_Viewer.spec" || goto :fail

echo.
echo Built: %~dp0dist\X_Drone_Log_Viewer.exe
exit /b 0

:fail
echo Build failed.
exit /b 1
