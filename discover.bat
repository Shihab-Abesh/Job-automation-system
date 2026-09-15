@echo off
REM Discovery only, no browser. This is what Windows Task Scheduler runs.
cd /d "%~dp0"
py -3 -m backend.pipeline run >> state\run.log 2>&1
