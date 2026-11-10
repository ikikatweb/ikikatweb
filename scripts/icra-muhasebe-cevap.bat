@echo off
REM Muhasebenin icra cevabini posta kutusunda yakalar; dosyanin yaninda "cevap geldi" isareti yanar.
REM Sessiz olmemesi icin log + cokme bildirimi var (gorev sessizce olebilir, logs klasorune bakilir).
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
copy /b "%~dp0.utf8-bom" "logs\icra-muhasebe-cevap.log" >nul
echo === %DATE% %TIME% - icra muhasebe cevap >> logs\icra-muhasebe-cevap.log
call npx tsx scripts\icra-muhasebe-cevap-sync.ts 14 >> logs\icra-muhasebe-cevap.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\icra-muhasebe-cevap.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Icra Muhasebe Cevap" %KOD% "logs\icra-muhasebe-cevap.log"
exit /b %KOD%
