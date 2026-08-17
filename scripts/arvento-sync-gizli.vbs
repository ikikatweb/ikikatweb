' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-speed-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-speed-sync.bat""", 0, False
