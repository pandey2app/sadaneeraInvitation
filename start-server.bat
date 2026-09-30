@echo off
title Sadanira Invitation Server

echo ========================================
echo   SADANIRA INVITATION SERVER
echo ========================================
echo.

echo [1/2] Starting Express Server...
start "Sadanira Express Server" cmd /k "cd /d C:\Users\pande\Desktop\sadaneeraInvitation && npm start"

timeout /t 5 /nobreak >nul

echo [2/2] Starting Cloudflare Tunnel...
start "Sadanira Cloudflare Tunnel" cmd /k "C:\cloudflared\cloudflared.exe tunnel --url http://localhost:5000"

echo.
echo ========================================
echo   Both services are starting...
echo ========================================
echo.
pause