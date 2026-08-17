' Yol-bagimsiz gizli calistirici. Kendi klasorunden personel-bildirge-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\personel-bildirge-sync.bat""", 0, False
