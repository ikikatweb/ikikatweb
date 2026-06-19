@echo off
REM Arvento anlik konum senkronu - bu .bat'in bulundugu klasorun ustu = proje koku
cd /d "%~dp0.."
node scripts\arvento-anlik-sync.mjs
