-- POLİÇE OTOMATİK KAYIT UYARISI
--
-- Poliçe PDF'i maille gelince kayıt artık otomatik açılıyor (scripts/sigorta-teklif-mail.mjs).
-- Kaydetmeden önce şu karşılaştırma yapılıyor: bu araç için hangi teklifi poliçeleştirmek
-- istemiştik (sigorta_teklif.police_talep_tarihi dolu olan satır), poliçe ONDAN mı kesilmiş?
--
-- Firma ya da tutar tutmuyorsa poliçe YİNE kaydedilir — kesilmiş bir poliçeyi kayda
-- almamak daha kötü olurdu — ama bu alana sebebi yazılır ve Acente Takip ekranında
-- kırmızı uyarı olarak görünür.
--
-- Örnek: "Neova Sigorta 10.330,46 TL istenmişti; Sompo Japan Sigorta 12.522,00 TL kesilmiş."
alter table arac_police add column if not exists otomatik_uyari text;

comment on column arac_police.otomatik_uyari is
  'Mailden otomatik kaydedilen poliçe, istenen teklifle uyuşmuyorsa sebebi (firma/tutar farkı)';

-- UYARI OKUNDU İŞARETİ
--
-- Aynı uyarı ana ekranda da çıkıyor ("13.000 teklif vermişti, 14.000 kesmiş" gibi).
-- "Tamam" denince ana ekrandan kalkar ama poliçe listesindeki kırmızı işaret KALIR —
-- oradaki kayıt kalıcı, ana ekrandaki yalnız haber verme amaçlı.
alter table arac_police add column if not exists uyari_okundu_at timestamptz;

comment on column arac_police.uyari_okundu_at is
  'Ana ekrandaki otomatik poliçe uyarısına "Tamam" denildiği an; liste uyarısı kalıcıdır';
