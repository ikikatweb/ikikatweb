-- HACİZ KALDIRMA DEFTERDE GÖRÜNSÜN
--
-- Kaldırma yazısı YENİ bir icra dosyası değil, VAR OLAN bir dosyanın haczinin
-- kaldırılması. Yeni satır açmak kaldırılmış bir haczi açık borç gibi gösterirdi
-- (bkz. scripts/icra-belge-oku.mjs). Ama hiç göstermemek de yanlış: defterde duran
-- dosyanın haczi kalkmışsa bunu bilmek gerekiyor.
--
-- Çözüm: dosyanın KENDİ satırına işaretlenir, ekranda rozetle görünür.
--
-- DOSYA KAPATILMIYOR: kaldırma kısmi olabiliyor ("bu dosyamıza şamil olmak üzere"),
-- yani başka dosyalardan gelen hacizler sürebilir. Kapatma kararı insanın.
alter table public.icra add column if not exists haciz_kaldirma_tarihi date;
alter table public.icra add column if not exists haciz_kaldirma_notu text;

comment on column public.icra.haciz_kaldirma_tarihi is
  'İcra dairesinden haczin kaldırıldığına dair yazı geldiyse o yazının tarihi.
   Tebligat belgesinden okunur. Dosyayı KAPATMAZ — kısmi kaldırma olabilir.';
