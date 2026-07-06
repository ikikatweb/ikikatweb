' Arvento DAMPER API sync'ini PENCERE ACMADAN (gizli) calistirir.
' Gorev Zamanlayici bu dosyayi HER SAAT BASI cagirir; script, Tanimlamalar'daki "Damper Senkron Saatleri"
' penceresi disindaysa hemen cikar (Playwright bile acmaz). Run(komut, 0, False): 0 = gizli, False = bekleme.
CreateObject("WScript.Shell").Run """C:\Users\MSI\Desktop\ikikatweb\scripts\arvento-damper-sync.bat""", 0, False
