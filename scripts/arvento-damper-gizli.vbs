' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-damper-sync.bat dosyasini penceresiz calistirir.
' BEKLE=True + Quit(cikis kodu): boylece Gorev Zamanlayici'daki "Son calisma sonucu" GERCEGI gosterir.
' (Onceden async baslatiliyordu -> script her koşumda patlasa bile gorev "0 = basarili" diyordu ve
'  damper senkronunun gunlerdir kirik oldugu fark edilmiyordu.) Gorevde MultipleInstances=IgnoreNew
'  oldugu icin beklemek ust uste calismaya yol acmaz.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
rc = CreateObject("WScript.Shell").Run("""" & dir & "\arvento-damper-sync.bat""", 0, True)
WScript.Quit(rc)
