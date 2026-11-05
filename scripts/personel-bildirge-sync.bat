@echo off
REM Personel bildirge senkronu - muhasebe cevabindaki SGK bildirgesi PDF'ini yakalayip acik talebi kapatir
REM Bu script de pdfjs kullanir; sessiz olmemesi icin log + cokme bildirimi var.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === %DATE% %TIME% - personel bildirge > logs\personel-bildirge.log
call npx tsx scripts\personel-bildirge-sync.ts 7 >> logs\personel-bildirge.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\personel-bildirge.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Personel Bildirge Sync" %KOD% "logs\personel-bildirge.log"
exit /b %KOD%
