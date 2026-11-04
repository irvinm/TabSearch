@echo off
setlocal
echo TabSearch native vertical tabs integration
echo Requesting administrator rights...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','%~dp0install.ps1')"
if errorlevel 1 (
  echo.
  echo Could not launch the elevated installer.
  pause
)
