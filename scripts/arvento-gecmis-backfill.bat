@echo off
REM ---------------------------------------------------------------------------
REM GECMIS GUN ROTA TAZELEME (gecelik backfill)
REM
REM NEDEN: ArventoGuzergahSync 15 dk'da bir YALNIZ BUGUNU ceker. Bir cihaz kapsama
REM disinda kalip (kara kutu) verisini GUNLER SONRA gonderirse, o gecmis gun bizde
REM sonsuza dek eksik kalir - kimse elle backfill calistirmazsa fark edilmez.
REM (05.11.2026: trencher 34-00-25-5586 02.11'den beri sessiz; gec gelecek veri
REM kendiliginden yerine oturmuyordu.)
REM
REM Bu gorev her gece DUNDEN GERIYE 7 GUNU yeniden ceker. Idempotent: ayni veri
REM gelirse ayni satir yazilir, eksik tamamlanmissa dolar.
REM BUGUNE DOKUNMAZ - o zaten 15 dk'da bir senkronlaniyor; cakisma/yaris olmasin.
REM
REM Elle genis backfill:  scripts\arvento-speed-sync.bat 2026-06-20 2026-06-25
REM ---------------------------------------------------------------------------
cd /d "%~dp0.."
if not exist logs mkdir logs
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-7).ToString('yyyy-MM-dd')"') do set BAS=%%i
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('yyyy-MM-dd')"') do set BIT=%%i
REM Log UTF-8 BOM ile baslar: BOM yoksa PowerShell 5.1 dosyayi ANSI sanip
REM Turkce harfleri bozuyor (10.11.2026).
copy /b "%~dp0.utf8-bom" "logs\arvento-backfill.log" >nul
echo === %DATE% %TIME% - gecmis rota backfill: %BAS% -^> %BIT% >> logs\arvento-backfill.log
node scripts\arvento-speed-sync.mjs %BAS% %BIT% --sadece-artir >> logs\arvento-backfill.log 2>&1
echo === bitis: %DATE% %TIME% (cikis kodu %ERRORLEVEL%) >> logs\arvento-backfill.log
