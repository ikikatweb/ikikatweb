@echo off
REM Arvento GERCEK calisma raporu senkronu (km/kontak/rolanti/hareket/maks + ilk-son kontak)
cd /d "%~dp0.."
node scripts\arvento-rapor-sync.mjs
