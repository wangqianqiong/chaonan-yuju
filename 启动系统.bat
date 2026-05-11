@echo off
chcp 65001 >nul
cd /d C:\Users\Administrator\chaonan-yuju
echo 正在启动订货系统...
start "辉煌雨具-隧道" node tunnel.js
timeout /t 4 /nobreak >nul
echo.
echo 系统启动中，浏览器打开后即可使用
echo 公网地址保存在 public_url.txt
timeout /t 2 /nobreak >nul
exit
