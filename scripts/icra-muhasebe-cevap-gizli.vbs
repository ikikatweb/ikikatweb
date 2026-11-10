' Yol-bagimsiz gizli calistirici. Kendi klasorunden icra-muhasebe-cevap.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\icra-muhasebe-cevap.bat""", 0, False
