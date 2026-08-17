# ============================================================================
#  Lenovo Gorev Kurulumu  -  Arvento / Personel 7/24 zamanlanmis gorevleri
#  YALNIZCA YUKSELTILMIS (Yonetici) PowerShell'de calistir.
#  Onerilen konum: C:\ikikatweb\gorev-kur.ps1  (repo kokunde)
#  Calistirma:  powershell -ExecutionPolicy Bypass -File C:\ikikatweb\gorev-kur.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'

# --- Yonetici kontrolu ---
$admin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()`
         ).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $admin) { throw "Bu script'i YONETICI PowerShell'de calistir (sag tik -> Yonetici olarak calistir)." }

# --- scripts klasorunu bul (bu dosyanin yaninda ya da C:\ikikatweb) ---
$root = if ($PSScriptRoot) { $PSScriptRoot } else { 'C:\ikikatweb' }
$scripts = Join-Path $root 'scripts'
if (-not (Test-Path (Join-Path $scripts 'arvento-anlik-sync.bat'))) { $scripts = 'C:\ikikatweb\scripts' }
if (-not (Test-Path (Join-Path $scripts 'arvento-anlik-sync.bat'))) {
  throw "scripts klasoru bulunamadi. Repo C:\ikikatweb'de mi? Aranan: $scripts\arvento-anlik-sync.bat"
}
$user = "$env:USERDOMAIN\$env:USERNAME"
Write-Host "Kullanici : $user"
Write-Host "Scriptler : $scripts`n"

# --- 1) VBS sarmalayicilari YOL-BAGIMSIZ (kendi klasorunu bulur) olarak yaz ---
#     (repodaki eski sabit-yollu VBS'lerin uzerine yazilir; artik her makinede calisir)
$vbsMap = [ordered]@{
  '_anlik_hidden.vbs'           = 'arvento-anlik-sync.bat'
  '_rapor_hidden.vbs'           = 'arvento-rapor-sync.bat'
  '_mail_hidden.vbs'            = 'arvento-mail-sync.bat'
  'arvento-damper-gizli.vbs'    = 'arvento-damper-sync.bat'
  'arvento-sync-gizli.vbs'      = 'arvento-speed-sync.bat'
  'personel-bildirge-gizli.vbs' = 'personel-bildirge-sync.bat'
  '_yedek_hidden.vbs'           = 'yedek-al.bat'
}
foreach ($vbs in $vbsMap.Keys) {
  $bat = $vbsMap[$vbs]
  $c = @"
' Yol-bagimsiz gizli calistirici. Kendi klasorunden $bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\$bat""", 0, False
"@
  Set-Content -Path (Join-Path $scripts $vbs) -Value $c -Encoding Ascii
}
Write-Host "VBS sarmalayicilar yol-bagimsiz yazildi.`n"

# --- 2) Ortak nesneler ---
# S4U = "oturum acik olmasa da calis, parolayi saklama". Tum gorevler bunu kullanir ki
# elektrik kesintisi sonrasi bilgisayar kendi acilinca kimse giris yapmadan is donsun.
$prinS4U = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Limited
$setStd  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
$setPers = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
# Yedek: ilk calismada tum Storage (~480 MB) indigi icin sure limiti genis; makine kapaliysa
# acilinca calissin diye StartWhenAvailable.
$setYedek = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
             -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -StartWhenAvailable

function Rep([int]$m) { New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $m) }
function Act([string]$vbs) { New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f (Join-Path $scripts $vbs)) }
function Kur($name, $act, $trg, $prin, $set) {
  Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Principal $prin -Settings $set -Force | Out-Null
  Write-Host ("  kuruldu: {0}" -f $name)
}

Write-Host "Gorevler kuruluyor..."
# --- S4U: oturum acik olmasa da calisir ---
Kur 'Arvento Anlik Senkron' (Act '_anlik_hidden.vbs') (Rep 1) $prinS4U $setStd
Kur 'Arvento Gercek Rapor'  (Act '_rapor_hidden.vbs') (Rep 1) $prinS4U $setStd
# KALDIRILDI (17.08.2026): 'Arvento Mail Senkron' - gunde 7 kez calisiyordu ama isleyecek
#   mail yoktu. IMAP kutusu (muhasebe@kadtem.com.tr) 120 gun geriye tarandi: hicbir klasorde
#   (INBOX, Archive, Junk, Spam, INBOX_OLD) tek bir Arvento rapor maili yok. Veri artik
#   WS + damper senkronlarindan geliyor.
#   Yeniden acmak icin: Arvento panelinden periyodik rapor mailleri tekrar acilsin, sonra
#   asagidaki iki satirin basindaki # kaldirilip bu script yeniden calistirilsin.
#   (scripts/arvento-mail-sync.ts ve lib/arvento/mail-fetch.ts yerinde duruyor.)
# $mailTrgs = '08:03','10:03','12:03','14:03','16:03','18:03','20:03' | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
# Kur 'Arvento Mail Senkron' (Act '_mail_hidden.vbs') $mailTrgs $prinS4U $setStd
# --- Bunlar da S4U: oturum acik olmasa da calisirlar ---
#     Eskiden Interactive idiler (eski makinede oto-login vardi). Interactive gorevler
#     kimse Windows'a giris yapmadan calismaz -> elektrik kesintisinden sonra bilgisayar
#     kendi acilsa bile bu uc senkron duruyordu. Interactive olmalari gerekmiyor: damper
#     senkronu Playwright'i HEADLESS aciyor, digerleri sadece ag istegi yapiyor.
Kur 'ArventoDamperSync'   (Act 'arvento-damper-gizli.vbs') (Rep 1)  $prinS4U $setStd
Kur 'ArventoGuzergahSync' (Act 'arvento-sync-gizli.vbs')   (Rep 15) $prinS4U $setStd
Kur 'Personel Bildirge Sync' (Act 'personel-bildirge-gizli.vbs') (Rep 30) $prinS4U $setPers
# --- Haftalik TAM yedek: Cumartesi 12:00 (dashboard'daki Cumartesi hatirlatmasiyla ayni gun) ---
#     Veritabani JSON + Storage dosya aynasi -> C:\ikikatweb-yedek
Kur 'ikikatweb Haftalik Yedek' (Act '_yedek_hidden.vbs') `
    (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Saturday -At '12:00') $prinS4U $setYedek

Write-Host "`n=== Kurulan gorevler ==="
$adlar = 'Arvento Anlik Senkron','Arvento Gercek Rapor','ArventoDamperSync','ArventoGuzergahSync','Personel Bildirge Sync','ikikatweb Haftalik Yedek'
Get-ScheduledTask | Where-Object { $_.TaskName -in $adlar } | Select-Object TaskName,State | Format-Table -AutoSize
Write-Host "Tamam. Gorevler ETKIN; tetikleyicilerine gore calismaya baslayacaklar."
Write-Host "SONRAKI: eski dizustundeki gorevleri KAPATMADAN once burada birkac dakika calistigini dogrula."
