-- NETSİM'DEKİ İŞE AİT EK BİLGİLER
--
-- Ana ekrandaki "Netsim'de yeni iş açılmış" uyarısı yalnız işin ADINI gösteriyordu;
-- ad da Netsim'de BÜYÜK HARF ve 40 karaktere kırpık olduğu için hangi iş olduğu çoğu
-- zaman anlaşılmıyordu. ISLMNOKT tablosunda aynı işe ait sözleşme bedeli, ihale tarihi,
-- İKN, ortaklık oranı gibi alanlar da duruyor — uyarıda bunlar da görünsün.
--
-- Hangi alanların alındığı ölçülerek seçildi (106 gerçek iş noktası üzerinde):
--   sözleşme bedeli 93, iş kodu 106, özel kod 105, İKN 39, ihale tarihi 38,
--   ortaklık oranı 40, pilot firma 40, sözleşme tarihi 29, işyeri teslim 25,
--   iş grubu 25, asgari işçilik 26, yaklaşık maliyet 10, ek sözleşme 4.
-- Alınmayanlar 106 noktanın hepsinde boştu: K_EKAP_BELGE_NO, K_BELGE_TUTARI, DIGER_BILGI.
alter table public.netsim_yeni_nokta
  add column if not exists kod                   text,
  add column if not exists sorumlu               text,
  add column if not exists is_grubu              text,
  add column if not exists sozlesme_bedeli       numeric,
  add column if not exists ek_sozlesme_bedeli    numeric,
  add column if not exists yaklasik_maliyet      numeric,
  add column if not exists ihale_tarihi          date,
  add column if not exists ilan_tarihi           date,
  add column if not exists ihale_kayit_no        text,
  add column if not exists sozlesme_tarihi       date,
  add column if not exists isyeri_teslim_tarihi  date,
  add column if not exists ortaklik_orani        numeric,
  add column if not exists pilot_firma           text,
  add column if not exists asgari_iscilik_orani  numeric;

comment on column public.netsim_yeni_nokta.sorumlu is
  'ISLMNOKT.OZEL_KOD — işten sorumlu kişi (Netsim bu alanı isim olarak kullanıyor)';

-- ── YÜKLENİCİ FİRMA ──
-- Netsim firma adını KISA yazıyor ("İKİKAT LTD. ŞTİ."), site UZUN ("İkikat İnş. Taah.
-- Hayv. San. Ve Tic. Ltd. Şti."). Eşleştirme senkronda yapılır ve sonucu buraya yazılır;
-- form o kaydı okur. Kural: Netsim'in firma KÜMESİ sitedeki kaydın firma kümesine birebir
-- eşitse o kayıt seçilir.
--   İKİKAT                 → İkikat İnş. Taah. ...
--   KAD-TEM                → Kad-Tem Müh. Müt. ...
--   KENAN TUGAY IKIKAT     → Kenan Tugay Ikıkat
--   KAD-TEM + ATILIM       → Kad-Tem – Atılım Adi Ortaklığı
--   İKİKAT + KAD-TEM       → sitede böyle bir ortaklık kaydı YOK → boş bırakılır
-- Kullanıcı kararı: Netsim'de ortaklık var ama sitede aynı ortaklık yoksa pilot firmaya
-- düşülmez, kutu boş bırakılır — yanlış firmayla kaydedilmesindense elle seçilsin.
alter table public.netsim_yeni_nokta
  add column if not exists yuklenici_firma_id uuid references public.firmalar(id) on delete set null,
  add column if not exists ortak_girisim      boolean,
  add column if not exists firma_adlari       text;

comment on column public.netsim_yeni_nokta.firma_adlari is
  'Netsim''deki firma adları (pilot + ortaklar), olduğu gibi — eşleşme tutmazsa kullanıcı neyi aradığını görsün';
