' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-mail-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-mail-sync.bat""", 0, False
