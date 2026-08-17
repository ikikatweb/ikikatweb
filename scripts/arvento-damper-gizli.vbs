' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-damper-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-damper-sync.bat""", 0, False
