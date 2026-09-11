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
echo. >> "logs\netsim-sync.log"
echo ===== %DATE% %TIME% ===== >> "logs\netsim-sync.log"
call npx tsx scripts\netsim-eslestir.ts --uygula --kisa >> "logs\netsim-sync.log" 2>&1
call npx tsx scripts\netsim-sync.ts --kisa >> "logs\netsim-sync.log" 2>&1
