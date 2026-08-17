# ============================================================================
#  ESKI makinedeki Arvento / Personel gorevlerini DEVRE DISI birakir.
#  Yeni makineye (Lenovo) tasima sonrasi CIFT YAZIMI onlemek icin calistirilir.
#  YALNIZCA YUKSELTILMIS (Yonetici) PowerShell'de ve EKSI makinede calistir.
#
#  Calistirma:  powershell -ExecutionPolicy Bypass -File .\gorev-kapat.ps1
#  Geri almak icin:  -GeriAl anahtari ile ayni script (gorevleri tekrar etkinlestirir)
#  Tamamen silmek icin:  -Sil  (geri donusu yok; oncelikle -GeriAl'siz devre disi deneyin)
# ============================================================================
param(
  [switch]$GeriAl,   # devre disi birakmak yerine tekrar ETKINLESTIR
  [switch]$Sil       # devre disi birakmak yerine gorevleri TAMAMEN SIL
)
$ErrorActionPreference = 'Stop'

$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()`
         ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "Bu script'i YONETICI PowerShell'de calistir (sag tik -> Yonetici olarak calistir)." }

$adlar = 'Arvento Anlik Senkron','Arvento Gercek Rapor','Arvento Mail Senkron',
         'ArventoDamperSync','ArventoGuzergahSync','Personel Bildirge Sync',
         'ikikatweb Haftalik Yedek'

$islem = if ($Sil) { 'SILINIYOR' } elseif ($GeriAl) { 'ETKINLESTIRILIYOR' } else { 'DEVRE DISI BIRAKILIYOR' }
Write-Host "Gorevler $islem ...`n"

foreach ($ad in $adlar) {
  $g = Get-ScheduledTask -TaskName $ad -ErrorAction SilentlyContinue
  if (-not $g) { Write-Host ("  yok      : {0}" -f $ad); continue }
  try {
    if     ($Sil)    { Unregister-ScheduledTask -TaskName $ad -Confirm:$false; Write-Host ("  silindi  : {0}" -f $ad) }
    elseif ($GeriAl) { Enable-ScheduledTask  -TaskName $ad | Out-Null; Write-Host ("  acildi   : {0}" -f $ad) }
    else             { Disable-ScheduledTask -TaskName $ad | Out-Null; Write-Host ("  kapatildi: {0}" -f $ad) }
  } catch {
    Write-Host ("  HATA     : {0} -> {1}" -f $ad, $_.Exception.Message)
  }
}

Write-Host "`n=== Bu makinedeki son durum ==="
Get-ScheduledTask | Where-Object { $_.TaskName -in $adlar } |
  Select-Object TaskName, State | Format-Table -AutoSize

if (-not $Sil -and -not $GeriAl) {
  Write-Host "Gorevler DEVRE DISI. Calisan bir ornek varsa bitene kadar surebilir; yenisi baslamaz."
  Write-Host "Yanlislikla kapattiysaniz:  powershell -ExecutionPolicy Bypass -File .\gorev-kapat.ps1 -GeriAl"
}
