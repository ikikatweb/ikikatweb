# UETS TEBLIGAT CEKME GOREVINI KUR — Windows Gorev Zamanlayici.
#
# NEDEN AYRI BETIK: S4U gorevi (oturum acilmadan calisan gorev) kaydetmek YONETICI
# yetkisi ister; normal kabukta "Erisim engellendi" doner. Yonetici olarak acilmis bir
# PowerShell'de tek satirla calistirilsin diye duruyor:
#
#   powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\uets-gorev-kur.ps1
#
# NE KURAR: 2 SAATTE BIR donen "UETS Tebligat Cek" gorevi. Gelen tebligatlarin
# LISTESINI ceker, yenilerini panele dusurur. BELGEYI INDIRMEZ — UETS'te indirmek
# acmak sayiliyor (taahhutname md. 7), acma karari kullanicida.
#
# NIYE 2 SAAT: tarife firma basina gunde 12 sorgu veriyor, yani 2 saatte 1. Daha sik
# calisirsa PTT "406 · istek limiti asildi (kod 501)" doner ve tur bosa gider.
#
# NIYE ILK CALISMA GECIKMELI: 07.11.2026'da kurulum denemeleri gunun hakkini yedi.
# Ilk tur, hak yenilendikten SONRASINA ayarli; erken kurulsa ilk tur 406 alip bos donerdi.
#
# AYRICA: "UETS Anahtar Dene" saatlik yoklama gorevi KAPATILIR. Isi bitti — anahtarin
# calismadigi sanilmasinin sebebi anahtar degil, istegin pilot sunucuya (apipp.*)
# gitmesiydi; asil sunucu api.etebligat.gov.tr. Yoklama surerse her turda bir sorgu
# hakki bosa gider.

$ErrorActionPreference = 'Stop'

$kimlik = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $kimlik.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Bu betik YONETICI olarak calistirilmali." -ForegroundColor Red
  Write-Host "Baslat > PowerShell > sag tik > 'Yonetici olarak calistir', sonra:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File C:\ikikatweb\scripts\uets-gorev-kur.ps1"
  exit 1
}

$bat = Join-Path $PSScriptRoot 'uets-tebligat-cek.bat'
if (-not (Test-Path $bat)) { throw "Bulunamadi: $bat" }

# Ilk tur: bugun 14:10. Sonraki turlar 2 saatte bir. Kurulum bu saatten sonra yapilirsa
# StartWhenAvailable sayesinde gecikmis tur hemen calisir.
$ilk = (Get-Date -Date '2026-11-07 14:10:00')
if ((Get-Date) -gt $ilk) { $ilk = (Get-Date).AddMinutes(5) }

$eylem = New-ScheduledTaskAction -Execute $bat
$tetik = New-ScheduledTaskTrigger -Once -At $ilk -RepetitionInterval (New-TimeSpan -Hours 2)
$asil  = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
$ayar  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -StartWhenAvailable

Register-ScheduledTask -TaskName 'UETS Tebligat Cek' -Action $eylem -Trigger $tetik `
  -Principal $asil -Settings $ayar -Force `
  -Description 'PTT UETS gelen tebligat listesini ceker, yenileri panele duser. Belge INDIRILMEZ; acma karari kullanicida (taahhutname md. 7).' | Out-Null

$g = Get-ScheduledTask -TaskName 'UETS Tebligat Cek'
Write-Host "KURULDU: $($g.TaskName) | $($g.Principal.UserId) | LogonType=$($g.Principal.LogonType) | State=$($g.State)" -ForegroundColor Green
$g.Triggers | ForEach-Object { Write-Host "  ilk tur=$($_.StartBoundary)  tekrar=$($_.Repetition.Interval)" }

# Saatlik yoklama gorevini kapat — isi bitti, her turu bir sorgu hakki yiyor.
try {
  Disable-ScheduledTask -TaskName 'UETS Anahtar Dene' -ErrorAction Stop | Out-Null
  Write-Host "KAPATILDI: UETS Anahtar Dene (artik gereksiz)." -ForegroundColor Yellow
} catch {
  Write-Host "NOT: 'UETS Anahtar Dene' kapatilamadi ($($_.Exception.Message)). Elle kapatilmali, yoksa sorgu hakki bosa gider." -ForegroundColor Yellow
}
