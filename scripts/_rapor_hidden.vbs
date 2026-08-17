' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-rapor-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-rapor-sync.bat""", 0, False
