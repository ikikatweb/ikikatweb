@echo off
REM Personel bildirge senkronu - muhasebe cevabindaki SGK bildirgesi PDF'ini yakalayip acik talebi kapatir
cd /d "%~dp0.."
call npx tsx scripts\personel-bildirge-sync.ts 7
