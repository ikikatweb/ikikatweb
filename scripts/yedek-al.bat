@echo off
REM Haftalik TAM yedek - veritabani JSON + Storage dosya aynasi (C:\ikikatweb-yedek)
REM Bu .bat'in bulundugu klasorun ustu = proje koku
cd /d "%~dp0.."
call npx tsx scripts\yedek-al.ts %*
