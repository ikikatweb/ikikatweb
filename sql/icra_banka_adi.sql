-- İcra cevabı BANKA HAVALESİ ile verildiyse hangi bankadan ödendiği.
--
-- NİYE AYRI SÜTUN: cevap şekli "Banka Havalesi" olduğunda kayıtta üç şey gerekiyor —
-- dekont numarası (evrak_no), ödenen tutar (odenen_tutar) ve ÖDEMENİN YAPILDIĞI BANKA.
-- İlk ikisinin sütunu vardı, üçüncüsü yoktu; açıklama alanına yazılsaydı serbest metin
-- olduğu için ne süzülebilir ne de sorulabilirdi.
--
-- Serbest metin: panelde merkezî bir banka listesi yok (kredi_karti.banka_adi de öyle).
-- Liste istenirse Tanımlamalar'a bir kategori eklenir.
alter table public.icra add column if not exists banka_adi text;

comment on column public.icra.banka_adi is
  'Cevap şekli banka havalesi ise ödemenin yapıldığı banka. Diğer cevap şekillerinde boş.';
