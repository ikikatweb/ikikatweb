-- MUHASEBENİN MESAJI PANELDE OKUNSUN · AVUKAT MAİLİNE EK KONULABİLSİN
--
-- 1) MUHASEBE CEVABININ METNİ VE EKLERİ
--    "Cevap geldi" işareti yanıyordu ama ne yazdığını görmek için mail kutusunu
--    açmak gerekiyordu. Mailin düz metni ve ekleri (hesap ekstresi) panele
--    kaydediliyor; işarete tıklayınca okunuyor.
--
--    METİN DÜZ METİNDİR, KARAR DEĞİL: borç durumu ve cevap şekli yine insan
--    tarafından giriliyor. Mailden "borcumuz yok" sonucu çıkarmak, yanlış
--    okunduğunda süre kaçırtan türden bir hata olur.
--
-- 2) AVUKAT MAİLİNE EK DOSYA
--    Avukata yalnız tebligat yazısı gidiyordu. Oysa çoğu zaman muhasebeden
--    gelen hesap ekstresi, sözleşme ya da yazışma da gitmeli. Eklenen dosyalar
--    KAYITTA DURUYOR: tekrar gönderimde aynı ekler gider, "neyi göndermiştik"
--    sorusu cevaplanabilir kalır.
--
-- EKLER NEREDE: yazismalar kovası (ÖZEL) — `icra-muhasebe/<id>/…` ve
-- `icra-avukat/<id>/…`. Arayüzde dosyaUrl() ile imzalı geçitten açılır,
-- sunucuda storageIndir() ile inilir (AGENTS.md).

-- ── 1) MUHASEBE CEVABININ İÇERİĞİ ──
alter table public.icra add column if not exists muhasebe_cevap_mail_metin text;
alter table public.icra add column if not exists muhasebe_cevap_mail_ekler jsonb;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_metin text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_ekler jsonb;

comment on column public.icra.muhasebe_cevap_mail_metin is
  'Muhasebe cevabının düz metni — panelde okunsun diye. Karar değil, bilgi.';
comment on column public.icra.muhasebe_cevap_mail_ekler is
  'Cevap mailinin ekleri: [{"ad":"ekstre.pdf","yol":"<storage adresi>"}] — yazismalar kovası (ÖZEL)';

-- ── 2) AVUKATA GİDEN EK DOSYALAR ──
alter table public.icra add column if not exists avukat_ek_dosyalar jsonb;
alter table public.icra_sirket_takip add column if not exists avukat_ek_dosyalar jsonb;

comment on column public.icra.avukat_ek_dosyalar is
  'Avukat mailine elle eklenen dosyalar: [{"ad":"ekstre.pdf","yol":"<storage adresi>"}]. '
  'Tebligat yazısı BU LİSTEDE DEĞİL — o her mailde kendiliğinden gidiyor.';
comment on column public.icra_sirket_takip.avukat_ek_dosyalar is
  'Avukat mailine elle eklenen dosyalar: [{"ad":"...","yol":"..."}]';
