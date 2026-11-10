@echo off
REM Arvento mail senkronu - son 7 gunun raporlarini IMAP'tan cekip DB'ye yazar
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
copy /b "%~dp0.utf8-bom" "logs\arvento-mail-sync.log" >nul
echo === %DATE% %TIME% - arvento mail sync >> logs\arvento-mail-sync.log
call npx tsx scripts\arvento-mail-sync.ts 7 >> logs\arvento-mail-sync.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\arvento-mail-sync.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Arvento Mail Sync" %KOD% "logs\arvento-mail-sync.log"
exit /b %KOD%
