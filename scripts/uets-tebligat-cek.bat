@echo off
REM UETS e-tebligat cekme - bu .bat'in bulundugu klasorun ustu = proje koku
REM Log + cokme bildirimi: sessiz ariza en tehlikelisi. Tebligat suresi 5 gun;
REM is iki gun calismazsa kimse fark etmeden sure doluyor.
cd /d "%~dp0.."
if not exist logs mkdir logs
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Icerik zaten UTF-8 idi; eksik olan
REM okuyucuya hangi kodlama oldugunu soyleyen uc bayt.
copy /b "%~dp0.utf8-bom" "logs\uets-tebligat.log" >nul
echo === %DATE% %TIME% - uets tebligat cek >> logs\uets-tebligat.log
node scripts\uets-tebligat-cek.mjs >> logs\uets-tebligat.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\uets-tebligat.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "UETS Tebligat Cek" %KOD% "logs\uets-tebligat.log"
exit /b %KOD%
