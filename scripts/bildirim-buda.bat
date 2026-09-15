@echo off
chcp 65001 >nul
REM bildirim_gecmisi tablosundan 60 gunden eski bildirimleri siler.
REM Gorev Zamanlayici'da ayda bir doner ("Bildirim Budama").
REM
REM Neden: bildirimler hic silinmiyordu, tablo ayda ~11.000 satir buyuyor. Zil rozeti
REM bu tabloyu 30 saniyede bir sorguladigi icin tablo buyudukce hem sorgu hem Supabase
REM cikis trafigi pahalilasiyor. 60 gunden eski bildirimin kimseye faydasi yok.
cd /d "%~dp0.."
if not exist "logs" mkdir "logs"
echo. >> "logs\bildirim-buda.log"
echo ===== %DATE% %TIME% ===== >> "logs\bildirim-buda.log"
call npx tsx scripts\bildirim-buda.ts >> "logs\bildirim-buda.log" 2>&1
