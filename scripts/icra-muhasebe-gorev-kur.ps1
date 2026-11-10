# ICRA MUHASEBE CEVAP GOREVINI KUR - Windows Gorev Zamanlayici.
#
# BU DOSYA SADECE ASCII. Turkce harf, uzun tire (U+2014) vb. YAZMAYIN.
# Sebep: dosya BOM'suz UTF-8 kaydediliyor, PowerShell 5.1 BOM yoksa ANSI sanip
# okuyor; UTF-8 baytlari bozuluyor ve dizgiler satiri kesiyor.
#
# NEDEN AYRI BETIK: S4U gorevi (oturum acilmadan calisan gorev) kaydetmek YONETICI
# yetkisi istiyor. Yonetici olarak acilmis bir PowerShell'de tek satir:
#
#   powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\icra-muhasebe-gorev-kur.ps1
#
# NE KURAR: 15 dakikada bir, dakikanin 15. SANIYESINDE donen "Icra Muhasebe Cevap"
# gorevi. Muhasebeye gonderilen icra yazisina gelen cevabi posta kutusunda arar ve
# dosyanin yaninda "cevap geldi" isareti yakar. Cevabin ICERIGINI okumaz; borc
# durumu ve cevap sekli panele insan tarafindan girilir.
#
# NIYE 15. SANIYE: ayni posta kutularini okuyan baska gorevler var ve ayni kutuya
# ikinci oturum acilinca sunucu baglantiyi dusuruyor (ECONNRESET). Dolu saniyeler:
# :00 Personel Bildirge (2 dk) ve Sigorta Teklif (2 dk), :30 KETSIS (5 dk),
# :45 UETS Acma (5 dk). 15. saniye bos.
#
# NIYE 15 DAKIKA: muhasebe cevabi saniyelik bir is degil; isaretin yarim saat
# gecikmesi kimseyi beklemez. Daha sik donmek posta sunucusunu bos yere yorar.

$ErrorActionPreference = 'Stop'

$kimlik = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $kimlik.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Bu betik YONETICI olarak calistirilmali." -ForegroundColor Red
  Write-Host "Baslat > PowerShell > sag tik > 'Yonetici olarak calistir', sonra:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\icra-muhasebe-gorev-kur.ps1"
  exit 1
}

$vbs = Join-Path $PSScriptRoot 'icra-muhasebe-cevap-gizli.vbs'
if (-not (Test-Path $vbs)) { throw "Bulunamadi: $vbs" }

$eylem = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`""
$tetik = New-ScheduledTaskTrigger -Once -At '00:00:15' -RepetitionInterval (New-TimeSpan -Minutes 15)
$asil  = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$ayar  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable

Register-ScheduledTask -TaskName 'Icra Muhasebe Cevap' -Action $eylem -Trigger $tetik `
  -Principal $asil -Settings $ayar -Force `
  -Description 'Muhasebeye gonderilen icra yazisina gelen cevap mailini posta kutusunda bulur, dosyaya "cevap geldi" isareti koyar. Cevabin icerigi panele insan tarafindan girilir.' | Out-Null

$g = Get-ScheduledTask -TaskName 'Icra Muhasebe Cevap'
Write-Host "KURULDU: $($g.TaskName) | $($g.Principal.UserId) | LogonType=$($g.Principal.LogonType) | State=$($g.State)" -ForegroundColor Green
$g.Triggers | ForEach-Object { Write-Host "  baslangic=$($_.StartBoundary)  tekrar=$($_.Repetition.Interval)" }
Write-Host "Ilk tur icin beklemek istemezseniz: Start-ScheduledTask -TaskName 'Icra Muhasebe Cevap'"
$sb = ($g.Triggers | Select-Object -First 1).StartBoundary
if ($sb -match 'T\d{2}:\d{2}:15') { Write-Host "Baslangic saniyesi 15 - diger mail gorevleriyle cakismiyor." -ForegroundColor Green }
else { Write-Host "DIKKAT: baslangic saniyesi 15 DEGIL ($sb) - diger mail gorevleriyle cakisabilir." -ForegroundColor Red }
