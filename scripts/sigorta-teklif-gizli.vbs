' Yol-bagimsiz gizli calistirici. Kendi klasorunden sigorta-teklif-mail.bat dosyasini penceresiz calistirir.
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\sigorta-teklif-mail.bat""", 0, False
