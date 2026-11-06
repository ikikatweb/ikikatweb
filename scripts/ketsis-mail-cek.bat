@echo off
REM KETSIS / GIB e-tebligat bildirim mailini oku (vergi dairesi tebligati).
REM Belge indirilmez - KETSIS'in alici tarafi icin API yok; bu is "gel bak" uyarisini kurar.
REM Ofisteki makinede Gorev Zamanlayici ile calisir (Vercel IMAP'a baglanamiyor).
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === %DATE% %TIME% - ketsis mail > logs\ketsis-mail.log
node scripts\ketsis-mail-cek.mjs >> logs\ketsis-mail.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\ketsis-mail.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "KETSIS Mail Cek" %KOD% "logs\ketsis-mail.log"
exit /b %KOD%
