-- VERGİ DAİRESİ TEBLİGATI — ELLE TUTULAN DEFTER
--
-- NİYE ELLE: KETSİS'in alıcı tarafı için API yok (gerekçe: sql/ketsis_bildirim.sql).
-- Tebligat yalnız Dijital Vergi Dairesi ekranında görülüyor. Program göremiyorsa da
-- SÜRE İŞLİYOR — ve bu ekranın işi tebligatı göstermek değil, SÜRENİN NE ZAMAN
-- DOLDUĞUNU göstermek. O yüzden daireye bakan kişi gördüğünü buraya yazıyor; panel
-- bundan sonra PTT tarafıyla birebir aynı şeyi yapıyor: son günü hesaplıyor, kalan
-- günü renklendiriyor, geçeni kırmızıya çeviriyor.
--
-- ketsis_bildirim ile farkı: orası GİB'in bilgilendirme MAİLİ ("gel bak"), burası
-- tebligatın kendisi. Mail gelmeyebilir, geç gelebilir, spam'e düşebilir; bu tablo
-- mailden bağımsız doldurulabilir.
--
-- VUK 107/A: elektronik tebligat, muhatabın elektronik adresine ULAŞTIĞI TARİHİ İZLEYEN
-- BEŞİNCİ GÜNÜN SONUNDA tebliğ edilmiş sayılır. Açılmış olması bu günü öne çekmez,
-- açılmamış olması ertelemez. teblig_tarihi bu yüzden hesaplanan sütun: elle girilemez,
-- yanlış yazılamaz.

create table if not exists public.ketsis_tebligat (
  id              bigserial primary key,

  firma_id        uuid references public.firmalar(id),
  -- Firma bilinmiyorsa boş kalır ve ekranda "belirsiz" yazar. Tahminle firma bağlanmaz.
  vergi_dairesi   text,                      -- gönderen daire / birim
  konu            text,
  belge_no        text,                      -- portaldaki belge/tebligat numarası

  -- Portalda "tebligat tarihi" diye görünen gün: adrese ulaştığı gün.
  ulasma_tarihi   date not null,
  teblig_tarihi   date generated always as (ulasma_tarihi + 5) stored,

  -- Portalda AÇILDIĞI an. Panel açamıyor; buraya bakan kişi yazıyor.
  okundu_at       timestamptz,
  okuyan_ad       text,

  -- Hangi bildirim mailinden çıktı (varsa). Mail gelmeden girilenlerde boş.
  bildirim_id     bigint references public.ketsis_bildirim(id) on delete set null,

  notlar          text,
  kaydeden_id     uuid references public.kullanicilar(id),
  kaydeden_ad     text,
  created_at      timestamptz not null default now()
);

create index if not exists ketsis_tebligat_teblig_idx on public.ketsis_tebligat (teblig_tarihi);
create index if not exists ketsis_tebligat_acik_idx   on public.ketsis_tebligat (teblig_tarihi)
  where okundu_at is null;

comment on table public.ketsis_tebligat is
  'Dijital Vergi Dairesi''nde görülen tebligatların elle tutulan defteri. KETSİS''in alıcı API''si olmadığı için otomatik dolmaz; süreyi (VUK 107/A) panel hesaplar.';
comment on column public.ketsis_tebligat.teblig_tarihi is
  'Hesaplanır: ulaşma + 5 gün (VUK 107/A). Elle girilemez.';
comment on column public.ketsis_tebligat.okundu_at is
  'Portalda açıldığı an. Süreyi DEĞİŞTİRMEZ; yalnız "bakıldı mı" bilgisidir.';

alter table public.ketsis_tebligat enable row level security;
drop policy if exists ketsis_tebligat_oku on public.ketsis_tebligat;
create policy ketsis_tebligat_oku on public.ketsis_tebligat for select to authenticated using (true);
