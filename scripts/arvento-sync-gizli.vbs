' Arvento SpeedReport (guzergah) sync'ini PENCERE ACMADAN (gizli) calistirir.
' Gorev Zamanlayici bu dosyayi cagirir; her ~15 dk'da bir bugunun yogun rotasini Supabase'e yazar.
' Run(komut, 0, False): 0 = gizli pencere, False = bekleme.
CreateObject("WScript.Shell").Run """C:\Users\MSI\Desktop\ikikatweb\scripts\arvento-speed-sync.bat""", 0, False
