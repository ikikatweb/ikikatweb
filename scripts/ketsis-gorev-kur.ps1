# KETSIS MAIL GOREVINI KUR - Windows Gorev Zamanlayici.
#
# BU DOSYA SADECE ASCII. Turkce harf, uzun tire (U+2014) vb. YAZMAYIN.
# Sebep (09.11.2026 yasandi): dosya UTF-8 (BOM yok) kaydediliyor, Windows
# PowerShell 5.1 ise BOM yoksa dosyayi ANSI sanip okuyor. "-" yerine uzun tire
# konunca UTF-8 baytlari (E2 80 94) ANSI-1254'te "a-euro-tirnak" diye cozuluyor;
# sondaki tirnak PowerShell icin DIZGI SONU sayiliyor ve satirin kalani kod degil
# metin oluyor. Yorumda zararsiz ama DIZGI ICINDE satiri bozuyor: dogrulama
# satirlari ekrana "-ForegroundColor Green }" diye basildi.
#
# NEDEN AYRI BETIK: S4U gorevi (oturum acilmadan calisan gorev) kaydetmek YONETICI
# yetkisi istiyor; normal kabukta "Erisim engellendi" doner. Bu dosya, yonetici olarak
# acilmis bir PowerShell'de tek satirla calistirilsin diye duruyor:
#
#   powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\ketsis-gorev-kur.ps1
#
# NE KURAR: 5 dakikada bir, dakikanin 30. SANIYESINDE donen "KETSIS Mail Cek" gorevi.
# Gorev, GIB'in (KETSIS)
# e-tebligat bilgilendirme mailini muhasebe kutularindan okuyup panele dusurur.
# Belgeyi INDIRMEZ - KETSIS'in alici tarafi icin API yok, tebligat yalniz Dijital
# Vergi Dairesi ekraninda okunur (gerekce: sql/ketsis_bildirim.sql).
#
# NIYE S4U: makine guc kesintisinden sonra kimse giris yapmadan toparliyor; diger
# gorevler de (Netsim, Bildirge, Yedek) ayni sekilde kurulu. Interactive kurulursa
# gorev yalniz kullanici oturum acikken calisir ve kesinti sonrasi sessizce durur.

$ErrorActionPreference = 'Stop'

# Yonetici mi? Degilse bos yere denemeyip sebebi soyle.
$kimlik = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $kimlik.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Bu betik YONETICI olarak calistirilmali." -ForegroundColor Red
  Write-Host "Baslat > PowerShell > sag tik > 'Yonetici olarak calistir', sonra:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\ketsis-gorev-kur.ps1"
  exit 1
}

$vbs = Join-Path $PSScriptRoot 'ketsis-mail-gizli.vbs'
if (-not (Test-Path $vbs)) { throw "Bulunamadi: $vbs" }

$eylem = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
# 00:00:30'da baslar, 5 dakikada bir doner.
#
# 30. SANIYE BILEREK (09.11.2026 olcumu). Bu makinede ayni posta kutularini okuyan iki
# gorev daha 2 DAKIKADA BIR donuyor: Personel Bildirge Sync (cift dakikalar) ve Sigorta
# Teklif Mail (tek dakikalar) - ikisi birlikte gunun HER dakikasini tutuyor, yani
# "cakismayan dakika" diye bir sey yok. Ama ucu de dakikanin :01'inde basliyor ve
# :04'te bitiyor (olculen sureler: bildirge ~1,2 sn, sigorta ~2,0 sn, ketsis ~2,5 sn).
# Bu yuzden cozum dakikayi degil SANIYEYI kaydirmak: 30. saniyede digerleri coktan
# bitmis oluyor, cakisma tamamen kalkiyor.
#
# NIYE ONEMLI: ayni posta kutusuna ikinci oturum acilinca sunucu baglantiyi dusuruyor
# (ECONNRESET). KETSIS bunu atlatiyor (20 sn sonra bir kez yeniden deniyor) ama SIGORTA
# ATLATMIYOR - baglanamazsa o posta kutusunu o tur atliyor. Yani cakismanin faturasini
# KETSIS degil, sigorta teklif okuyucusu oduyordu.
#
# NIYE 5 DAKIKA, 2 DEGIL: log her turda sifirdan yaziliyor (bat'ta ">"), yani log penceresi
# = calisma araligi. 2 dakikada bir donseydi bir ariza 2 dakika sonra izsiz kalirdi;
# "gorev sessizce olebilir, logs'a bak" kurali islemez olurdu. 5 dakika bu izi birakiyor.
# Daha sik olmasinin hukuki bir kazanci da yok: tebligat suresi belgenin ADRESE ULASTIGI
# gunden isliyor (VUK 107/A), bilgilendirme maili surenin parcasi degil.
$tetik = New-ScheduledTaskTrigger -Once -At '00:00:30' -RepetitionInterval (New-TimeSpan -Minutes 5)
$asil  = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$ayar  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable

Register-ScheduledTask -TaskName 'KETSIS Mail Cek' -Action $eylem -Trigger $tetik `
  -Principal $asil -Settings $ayar -Force `
  -Description 'GIB (KETSIS) e-tebligat bilgilendirme mailini okur, panele dusurur. Belge indirilmez; tebligat Dijital Vergi Dairesinde okunur.' | Out-Null

$g = Get-ScheduledTask -TaskName 'KETSIS Mail Cek'
Write-Host "KURULDU: $($g.TaskName) | $($g.Principal.UserId) | LogonType=$($g.Principal.LogonType) | State=$($g.State)" -ForegroundColor Green
$g.Triggers | ForEach-Object { Write-Host "  baslangic=$($_.StartBoundary)  tekrar=$($_.Repetition.Interval)" }
Write-Host "Ilk tur icin beklemek istemezseniz: Start-ScheduledTask -TaskName 'KETSIS Mail Cek'"
# Baslangic saniyesi gercekten 30 mu? Yanlissa cakisma geri doner, bu yuzden kontrol edilir.
$sb = ($g.Triggers | Select-Object -First 1).StartBoundary
if ($sb -match 'T\d{2}:\d{2}:30') { Write-Host "Baslangic saniyesi 30 - cakisma penceresi disinda." -ForegroundColor Green }
else { Write-Host "DIKKAT: baslangic saniyesi 30 DEGIL ($sb) - diger mail gorevleriyle cakisabilir." -ForegroundColor Red }
