@echo off
chcp 65001 >nul
cd /d C:\Users\Administrator\chaonan-yuju
echo 正在停止...
pm2 stop chaonan-yuju 2>nul
pm2 delete chaonan-yuju 2>nul
echo 已停止
timeout /t 2 /nobreak >nul
exit
