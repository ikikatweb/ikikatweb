' Yol-bagimsiz gizli calistirici. Kendi klasorunden bildirim-buda.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\bildirim-buda.bat""", 0, False
