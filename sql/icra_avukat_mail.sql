-- AVUKATA GÖNDERİM — not alanı ve gönderim izi.
--
-- avukat_notu: cevap penceresinde avukat seçilince yazılan not. Mailin içine
--   eklenir. Saklanıyor çünkü "avukata ne yazmışız" sonradan sorulabiliyor;
--   yalnız mail gidip kaybolsaydı o cevap panelde hiç kalmazdı.
--
-- avukat_mail_at / avukat_mail_ek: mail GERÇEKTEN gitti mi, eki neydi.
--   AGENTS.md "Sessiz hata yok": ek inmeden mail GÖNDERİLMİYOR. Gönderim izi de
--   tutuluyor ki "gönderdim sanıyordum" durumu doğmasın — 27.10.2026'da kasko
--   teklifi ruhsat eki olmadan gitmiş ve kimse fark etmemişti.
--
-- CEVAP TARİHİ = MAİLİN GİTTİĞİ GÜN. Avukat aracılığıyla cevapta icraya cevap
-- tarihi ayrıca sorulmuyor; mail başarıyla gidince cevap_tarihi sunucuda
-- yazılıyor. Mail gitmezse cevap_tarihi BOŞ KALIR ve dosya "Cevap Bekleyen"
-- listesinde durmaya devam eder — gitmemiş bir cevabı cevaplanmış göstermek,
-- süre kaçırtan türden bir yanlıştır.
alter table public.icra add column if not exists avukat_notu text;
alter table public.icra add column if not exists avukat_mail_at timestamptz;
alter table public.icra add column if not exists avukat_mail_ek text;

comment on column public.icra.avukat_notu is
  'Avukata gönderilen mailin içine eklenen serbest not';
comment on column public.icra.avukat_mail_at is
  'Avukata mail BAŞARIYLA gönderildiği an. Boşsa gönderilmemiştir.';
comment on column public.icra.avukat_mail_ek is
  'Maile eklenen tebligat belgesinin adı — hangi belgenin gittiği sonradan sorulabiliyor.';
