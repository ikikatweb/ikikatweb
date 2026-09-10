' Yol-bagimsiz gizli calistirici. Kendi klasorunden netsim-sync.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\netsim-sync.bat""", 0, False
