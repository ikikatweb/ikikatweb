# UETS ACMA ISLEYICISI GOREVINI KUR - Windows Gorev Zamanlayici.
#
# BU DOSYA SADECE ASCII. Turkce harf, uzun tire (U+2014) vb. YAZMAYIN.
# Sebep: dosya UTF-8 (BOM yok) kaydediliyor, Windows PowerShell 5.1 BOM yoksa ANSI
# sanip okuyor; dizgi icindeki cok baytli karakter satiri bozuyor (09.11.2026 yasandi).
#
#   powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\uets-ac-gorev-kur.ps1
#
# NIYE GEREKLI (09.11.2026'da ortaya cikti): panelde "Ac ve oku" dugmesine basilinca
# istek veritabaninda "bekliyor" olarak kuyruga giriyor; indirmeyi bu betik yapiyor.
# Ama bu gorev HIC KURULMAMISTI. Kullanici dugmeye basti, istek 3,5 saat kuyrukta
# bekledi, ekranda "sirada..." yazip durdu. Tebligatta sure 5 gun; asili kalan bir
# istek sessizce gun kaybettirir.
#
# NIYE 5 DAKIKA: "Ac ve oku" insan eylemidir, cevabi dakikalar icinde gelmeli.
# Kuyruk bossa betik UETS'e HIC dokunmuyor, yalniz veritabanina bakip cikiyor -
# yani sik calismak sorgu hakkindan yemiyor.
#
# NIYE 45. SANIYE: bu makinede dakikanin ilk saniyeleri dolu (bildirge ve sigorta
# mail gorevleri :01'de, KETSIS :30'da). 45. saniye bos pencere.

$ErrorActionPreference = 'Stop'

$kimlik = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $kimlik.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Bu betik YONETICI olarak calistirilmali." -ForegroundColor Red
  Write-Host "Baslat > PowerShell > sag tik > 'Yonetici olarak calistir', sonra:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\uets-ac-gorev-kur.ps1"
  exit 1
}

$bat = Join-Path $PSScriptRoot 'uets-ac-isle.bat'
if (-not (Test-Path $bat)) { throw "Bulunamadi: $bat" }

$eylem = New-ScheduledTaskAction -Execute $bat
$tetik = New-ScheduledTaskTrigger -Once -At '00:00:45' -RepetitionInterval (New-TimeSpan -Minutes 5)
$asil  = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$ayar  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable

Register-ScheduledTask -TaskName 'UETS Acma Istekleri' -Action $eylem -Trigger $tetik `
  -Principal $asil -Settings $ayar -Force `
  -Description 'Panelde "Ac ve oku" denen tebligatlari UETS ten indirir. Kuyruk bossa UETS e hic dokunmaz.' | Out-Null

$g = Get-ScheduledTask -TaskName 'UETS Acma Istekleri'
Write-Host "KURULDU: $($g.TaskName) | $($g.Principal.UserId) | LogonType=$($g.Principal.LogonType) | State=$($g.State)" -ForegroundColor Green
$g.Triggers | ForEach-Object { Write-Host "  baslangic=$($_.StartBoundary)  tekrar=$($_.Repetition.Interval)" }
$sb = ($g.Triggers | Select-Object -First 1).StartBoundary
if ($sb -match 'T\d{2}:\d{2}:45') { Write-Host "Baslangic saniyesi 45 - diger gorevlerle cakismiyor." -ForegroundColor Green }
else { Write-Host "DIKKAT: baslangic saniyesi 45 DEGIL ($sb)." -ForegroundColor Red }
