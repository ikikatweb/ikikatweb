' Yol-bagimsiz gizli calistirici. Kendi klasorunden arvento-gecmis-backfill.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\arvento-gecmis-backfill.bat""", 0, False
