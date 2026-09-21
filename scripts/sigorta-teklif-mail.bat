@echo off
REM Gelen sigorta teklifi maillerini oku - bu .bat'in bulundugu klasorun ustu = proje koku
cd /d "%~dp0.."
node scripts\sigorta-teklif-mail.mjs
