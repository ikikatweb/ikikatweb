@echo off
REM UETS anahtari calisiyor mu - saat basi yoklama.
REM Calismaya basladigi an tebligatlari ceker, 2 saatlik gorevi kurar ve kendini kapatir.
REM Calismadiginda SUSAR (log'a yazar); sadece hata mesaji degisirse bildirim gider.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === %DATE% %TIME% - uets anahtar dene >> logs\uets-anahtar-dene.log
node scripts\uets-anahtar-dene.mjs >> logs\uets-anahtar-dene.log 2>&1
set KOD=%ERRORLEVEL%
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "UETS Anahtar Dene" %KOD% "logs\uets-anahtar-dene.log"
exit /b %KOD%
