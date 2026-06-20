@echo off
REM Arvento mail senkronu - son 7 gunun raporlarini IMAP'tan cekip DB'ye yazar
cd /d "%~dp0.."
call npx tsx scripts\arvento-mail-sync.ts 7
