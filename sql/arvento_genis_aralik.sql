-- Arvento Raporu'nda GENİŞ TARİH ARALIĞI hakkı (yönetici hariç haftada bir gün).
--
-- Neden: Arvento rota tablosu (arac_arvento_guzergah) satır başına ~34 KB — veritabanının
-- geri kalanının tamamı ~25 MB iken bu tablo tek başına ondan büyük. Geniş aralık seçmek
-- o aralıktaki TÜM araçların GPS noktalarını indiriyor (2 ay ≈ 65 MB) ve Supabase çıkış
-- kotasının asıl tüketicisi bu. Yönetici dışındaki kullanıcılar 7 günden uzun aralığı
-- haftada yalnız BİR GÜN açabilsin; o gün boyunca serbest çalışsın, gün bitince 7 gün beklesin.
--
-- Bu kolon, kullanıcının hakkı en son KULLANDIĞI anı tutar. Boş = hiç kullanmamış.
alter table kullanicilar add column if not exists arvento_genis_son timestamptz;
