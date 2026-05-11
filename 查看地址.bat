@echo off
chcp 65001 >nul
cd /d C:\Users\Administrator\chaonan-yuju
if exist public_url.txt (
    set /p URL=<public_url.txt
    echo 当前公网地址：%URL%
    start %URL%
) else (
    echo 系统未启动，请先双击「启动系统.bat」
)
pause
