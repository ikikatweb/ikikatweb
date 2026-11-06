@echo off
REM Tebligat acma isteklerini isle - UETS'e giden tek yer (statik IP sarti).
REM Dakikada bir calisir; bekleyen istek yoksa hemen cikar.
cd /d "%~dp0.."
if not exist logs mkdir logs
node scripts\uets-ac-isle.mjs >> logs\uets-ac-isle.log 2>&1
set KOD=%ERRORLEVEL%
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "UETS Acma Istekleri" %KOD% "logs\uets-ac-isle.log"
exit /b %KOD%
