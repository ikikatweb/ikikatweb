@echo off
REM Arvento SpeedReport yogun rota senkronu - bu .bat'in bulundugu klasorun ustu = proje koku
REM Varsayilan: BUGUNU senkronlar (o ana kadarki tam yogun iz). EN GUNCEL rota icin Gorev Zamanlayici
REM ile gun ici her ~15 dk calistirin. Gecmis aralik (backfill):  arvento-speed-sync.bat 2026-06-20 2026-06-25
cd /d "%~dp0.."
node scripts\arvento-speed-sync.mjs %*
