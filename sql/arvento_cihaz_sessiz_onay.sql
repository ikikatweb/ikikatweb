-- SESSİZ CİHAZ UYARISINI ARAÇ BAZINDA SUSTURMA
--
-- Takip cihazı veri göndermeyi kesen araç için haritada kırmızı uyarı çıkıyor
-- (lib/arvento/cihaz-sessiz.ts). Ama bir cihaz İKİ sebeple susar:
--   1) arıza / kablo / akü  → gerçekten müdahale gerekir
--   2) araç uzun süredir hiç çalışmıyor (park) → cihaz da sonunda susar, normaldir
-- Veriden ikisini ayırmak mümkün değil; bunu yalnız kullanıcı bilir. (05.11.2026:
-- 6 sessiz araçtan 5'i "zaten çalışmıyor"du — hepsi kırmızı yanınca uyarı anlamsızlaşır.)
--
-- Bu kolon, kullanıcının "biliyorum, beklemede" dediği aracın O ANKİ SON PAKET zamanını
-- saklar. Uyarı yalnız bu değer son pakete EŞİTSE gizlenir; cihaz tekrar veri gönderip
-- sonra YİNE susarsa son paket değişir ve uyarı kendiliğinden geri gelir.
alter table arvento_cihaz add column if not exists sessiz_onay text;

comment on column arvento_cihaz.sessiz_onay is
  'Sessiz cihaz uyarısı susturulurken kaydedilen son paket zamanı (arvento_anlik.tarih). Son paket değişirse uyarı geri gelir.';
