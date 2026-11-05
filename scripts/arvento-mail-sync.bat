@echo off
REM Arvento mail senkronu - son 7 gunun raporlarini IMAP'tan cekip DB'ye yazar
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === %DATE% %TIME% - arvento mail sync > logs\arvento-mail-sync.log
call npx tsx scripts\arvento-mail-sync.ts 7 >> logs\arvento-mail-sync.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\arvento-mail-sync.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Arvento Mail Sync" %KOD% "logs\arvento-mail-sync.log"
exit /b %KOD%
