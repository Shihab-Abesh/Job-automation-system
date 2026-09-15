@echo off
REM Double-click this to run CareerPilot. Keep the window open while you use it.
cd /d "%~dp0"
py -3 run_local.py %*
if errorlevel 1 (
  echo.
  echo Something went wrong. If Python is missing, install it from python.org
  echo and tick "Add python.exe to PATH" during setup.
  pause
)
