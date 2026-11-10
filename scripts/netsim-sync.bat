@echo off
chcp 65001 >nul
REM Netsim (Ofisnet/Firebird) -> Supabase. Tek yonlu, Netsim'e yazmaz.
REM Gorev Zamanlayici'da 15 dakikada bir doner ("Netsim Senkron").
REM
REM 1) ESLESTIR: yeni acilan is deneyim belgesi (santiye) Netsim'deki isle ad olarak
REM    birebir ortusuyorsa kendiliginden baglanir. Supheli olanlara DOKUNMAZ -
REM    ayni Netsim isini birden fazla santiye talep ederse hicbiri baglanmaz.
REM 2) SENKRON: bagli tum santiyelerin tamamlanan kesif ve fiyat farki tutarlarini ceker.
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026). Bu log gecmisi tuttugu icin
REM BOM yalnizca dosya ilk kez olusurken yazilir.
if not exist "logs\netsim-sync.log" copy /b "%~dp0.utf8-bom" "logs\netsim-sync.log" >nul
echo. >> "logs\netsim-sync.log"
echo ===== %DATE% %TIME% ===== >> "logs\netsim-sync.log"
call npx tsx scripts\netsim-eslestir.ts --uygula --kisa >> "logs\netsim-sync.log" 2>&1
call npx tsx scripts\netsim-sync.ts --kisa >> "logs\netsim-sync.log" 2>&1
