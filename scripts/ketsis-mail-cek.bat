@echo off
REM KETSIS / GIB e-tebligat bildirim mailini oku (vergi dairesi tebligati).
REM Belge indirilmez - KETSIS'in alici tarafi icin API yok; bu is "gel bak" uyarisini kurar.
REM Ofisteki makinede Gorev Zamanlayici ile calisir (Vercel IMAP'a baglanamiyor).
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
copy /b "%~dp0.utf8-bom" "logs\ketsis-mail.log" >nul
echo === %DATE% %TIME% - ketsis mail >> logs\ketsis-mail.log
node scripts\ketsis-mail-cek.mjs >> logs\ketsis-mail.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\ketsis-mail.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "KETSIS Mail Cek" %KOD% "logs\ketsis-mail.log"
exit /b %KOD%
