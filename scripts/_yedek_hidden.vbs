' Yol-bagimsiz gizli calistirici. Kendi klasorunden yedek-al.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\yedek-al.bat""", 0, False
