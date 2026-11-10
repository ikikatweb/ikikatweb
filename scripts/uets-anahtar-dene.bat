@echo off
REM UETS anahtari calisiyor mu - saat basi yoklama.
REM Calismaya basladigi an tebligatlari ceker, 2 saatlik gorevi kurar ve kendini kapatir.
REM Calismadiginda SUSAR (log'a yazar); sadece hata mesaji degisirse bildirim gider.
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
if not exist "logs\uets-anahtar-dene.log" copy /b "%~dp0.utf8-bom" "logs\uets-anahtar-dene.log" >nul
echo === %DATE% %TIME% - uets anahtar dene >> logs\uets-anahtar-dene.log
node scripts\uets-anahtar-dene.mjs >> logs\uets-anahtar-dene.log 2>&1
set KOD=%ERRORLEVEL%
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "UETS Anahtar Dene" %KOD% "logs\uets-anahtar-dene.log"
exit /b %KOD%
