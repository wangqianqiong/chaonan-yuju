@echo off
chcp 65001 >nul
cd /d C:\Users\Administrator\chaonan-yuju
echo 正在停止...
taskkill /f /im node.exe 2>nul
taskkill /f /im ngrok.exe 2>nul
echo 已停止
timeout /t 2 /nobreak >nul
exit
