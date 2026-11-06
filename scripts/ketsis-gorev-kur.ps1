# KETSIS MAIL GOREVINI KUR — Windows Gorev Zamanlayici.
#
# NEDEN AYRI BETIK: S4U gorevi (oturum acilmadan calisan gorev) kaydetmek YONETICI
# yetkisi istiyor; normal kabukta "Erisim engellendi" doner. Bu dosya, yonetici olarak
# acilmis bir PowerShell'de tek satirla calistirilsin diye duruyor:
#
#   powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\ketsis-gorev-kur.ps1
#
# NE KURAR: 30 dakikada bir donen "KETSIS Mail Cek" gorevi. Gorev, GIB'in (KETSIS)
# e-tebligat bilgilendirme mailini muhasebe kutularindan okuyup panele dusurur.
# Belgeyi INDIRMEZ — KETSIS'in alici tarafi icin API yok, tebligat yalniz Dijital
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
# 00:11'de baslar, 30 dakikada bir doner. Dakika 11 bilerek: bu makinede sigorta (tek
# dakikalar) ve bildirge (cift dakikalar) mail gorevleri 2 DAKIKADA BIR donuyor; ayni
# posta kutusuna ikinci oturum acilinca sunucu baglantiyi dusuruyor (ECONNRESET).
# Script zaten bir kez yeniden deniyor ve tek seferlik kopmayi ariza saymiyor.
$tetik = New-ScheduledTaskTrigger -Once -At '00:11' -RepetitionInterval (New-TimeSpan -Minutes 30)
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
