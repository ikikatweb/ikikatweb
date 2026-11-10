@echo off
REM Tebligat acma isteklerini isle - UETS'e giden tek yer (statik IP sarti).
REM Dakikada bir calisir; bekleyen istek yoksa hemen cikar.
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
if not exist "logs\uets-ac-isle.log" copy /b "%~dp0.utf8-bom" "logs\uets-ac-isle.log" >nul
node scripts\uets-ac-isle.mjs >> logs\uets-ac-isle.log 2>&1
set KOD=%ERRORLEVEL%
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "UETS Acma Istekleri" %KOD% "logs\uets-ac-isle.log"
exit /b %KOD%
