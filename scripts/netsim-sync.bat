@echo off
REM Netsim (Ofisnet/Firebird) -> Supabase senkronu. Tek yonlu, Netsim'e yazmaz.
REM Tamamlanan kesif -> santiyeler.sozlesme_fiyatlariyla_gerceklesen
REM Fiyat farki      -> iscilik_takibi.fiyat_farki
cd /d "%~dp0.."
call npx tsx scripts\netsim-sync.ts
