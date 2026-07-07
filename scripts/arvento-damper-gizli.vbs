' Arvento DAMPER API sync'ini PENCERE ACMADAN (gizli) calistirir.
' Gorev Zamanlayici bu dosyayi HER 5 DAKIKADA BIR cagirir; asil sikligi Tanimlamalar'daki "Guncelleme Sikligi"
' (periyot) belirler. Script; saat penceresi disindaysa VEYA son cekimden periyot kadar dk gecmediyse hemen
' cikar (Playwright bile acmaz). Run(komut, 0, False): 0 = gizli, False = bekleme.
CreateObject("WScript.Shell").Run """C:\Users\MSI\Desktop\ikikatweb\scripts\arvento-damper-sync.bat""", 0, False
