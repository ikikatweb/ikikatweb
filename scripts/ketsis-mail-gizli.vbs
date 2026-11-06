' Yol-bagimsiz gizli calistirici. Kendi klasorunden ketsis-mail-cek.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\ketsis-mail-cek.bat""", 0, False
