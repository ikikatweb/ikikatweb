' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-anlik-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-anlik-sync.bat""", 0, False
