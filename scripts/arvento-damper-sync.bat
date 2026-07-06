@echo off
REM Arvento DAMPER senkronu - web.arvento.com'da Genel Rapor'u UI'dan tetikleyip indirir, DB'ye yazar (e-posta/periyodik BAGIMSIZ)
cd /d "%~dp0.."
call npx tsx scripts\arvento-damper-sync.ts
