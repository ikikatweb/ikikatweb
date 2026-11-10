@echo off
REM Personel bildirge senkronu - muhasebe cevabindaki SGK bildirgesi PDF'ini yakalayip acik talebi kapatir
REM Bu script de pdfjs kullanir; sessiz olmemesi icin log + cokme bildirimi var.
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
copy /b "%~dp0.utf8-bom" "logs\personel-bildirge.log" >nul
echo === %DATE% %TIME% - personel bildirge >> logs\personel-bildirge.log
call npx tsx scripts\personel-bildirge-sync.ts 7 >> logs\personel-bildirge.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\personel-bildirge.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Personel Bildirge Sync" %KOD% "logs\personel-bildirge.log"
exit /b %KOD%
