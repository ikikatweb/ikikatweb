@echo off
REM Gelen sigorta teklifi maillerini oku - bu .bat'in bulundugu klasorun ustu = proje koku
REM Log + cokme bildirimi: 05.11.2026'da pdfjs bagimliligi dustu, script her calismada ilk
REM satirda oldu ama gorev "basarili" gorundu ve 5 saat kimse fark etmedi. Artik iz kaliyor.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo === %DATE% %TIME% - sigorta teklif mail > logs\sigorta-teklif-mail.log
node scripts\sigorta-teklif-mail.mjs >> logs\sigorta-teklif-mail.log 2>&1
set KOD=%ERRORLEVEL%
echo === bitis: %DATE% %TIME% (cikis kodu %KOD%) >> logs\sigorta-teklif-mail.log
if not "%KOD%"=="0" node scripts\gorev-hata-bildir.mjs "Sigorta Teklif Mail" %KOD% "logs\sigorta-teklif-mail.log"
exit /b %KOD%
