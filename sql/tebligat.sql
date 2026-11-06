-- ELEKTRONİK TEBLİGAT (UETS) — gelen tebligatların defteri
--
-- PTT'nin Ulusal Elektronik Tebligat Sistemi'nden çekilen tebligatlar burada durur.
-- Şirketin resmî yazışmaları buradan geliyor; kaçırılan bir tebligat hak kaybı demek.
--
-- ÜÇ TARİH VARDIR VE ASLA KARIŞTIRILMAZ
-- ---------------------------------------------------------------------------
--   ulasma_tarihi : tebligatın UETS adresimize ULAŞTIĞI an (API'de inserttime).
--                   HUKUKİ SÜRE BUNDAN İŞLER.
--   okuma_tarihi  : tebligatın AÇILDIĞI an. UETS'te "indirmek" açmak demektir
--                   (taahhütname md. 7); bu yüzden robot otomatik indirmez.
--   teblig_tarihi : tebliğ edilmiş SAYILDIĞI gün = ulaşma gününü izleyen 5. günün sonu.
--
-- 7201 sayılı Tebligat Kanunu 7/a: "Elektronik yolla tebligat, muhatabın elektronik
-- adresine ulaştığı tarihi izleyen beşinci günün sonunda yapılmış sayılır." Erken açmak
-- bunu değiştirmez (Yargıtay HGK bu yönde; uygulamada aksi kararlar da var — bu yüzden
-- üç tarihi de saklıyoruz, hangisinin gerektiği somut dosyada tartışılır).
--
-- UETS'in kendisi de aynı kuralı uyguluyor: 5 gün açılmayan tebligat "readtimeout"
-- durumuna düşüyor, yani sistem otomatik okundu sayıyor.
--
-- DURUMLAR (API'den geldiği gibi saklanır):
--   delivered   teslim edildi, HENÜZ AÇILMADI   ← bizim takip etmemiz gereken
--   read        açıldı (indirildi)
--   readtimeout 5 gün açılmadı, otomatik okundu sayıldı
create table if not exists public.tebligat (
  id                bigserial primary key,

  -- UETS kimlikleri
  uets_id           text        not null,   -- API'deki "id" (uuid biçiminde)
  hesap             text        not null,   -- hangi şirketin hesabına geldi: IKIKAT / KADTEM
  reference_id      text,

  -- taraflar (UETS adresleri xxxxx-xxxxx-xxxxx biçiminde)
  gonderen_adres    text,                   -- "sender"
  gonderen_ad       text,                   -- "sender_name"
  alici_adres       text,                   -- "recipient"
  alici_ad          text,                   -- "recipient_name"
  konu              text,                   -- "subject"

  -- ÜÇ TARİH (bkz. başlık)
  ulasma_tarihi     timestamptz not null,   -- API "inserttime" (unix saniye)
  guncelleme_tarihi timestamptz,            -- API "updatetime"
  okuma_tarihi      timestamptz,            -- indirildiği an; boşsa açılmamış
  teblig_tarihi     date generated always as
                      (((ulasma_tarihi at time zone 'Europe/Istanbul')::date) + 5) stored,

  -- durum
  durum             text        not null,   -- delivered / read / readtimeout / …
  klasor_id         integer,                -- 1 Gelen · 2 Giden · 4 Arşiv · 5 Silinmiş
  yon               text,                   -- incoming / outgoing
  boyut             bigint,                 -- paket boyutu (bayt)
  etag              text,                   -- indirilen EYP paketinin SHA1'i

  -- paket indirildiyse
  paket_yolu        text,                   -- storage yolu (EYP)
  -- İndirme denendi ve olmadıysa sebebi buraya yazılır ve satır EKSİK sayılır.
  -- SESSİZ GEÇİLMEZ: inmemiş bir tebligatı tam saymak, görmemekten kötüdür.
  indirme_hatasi    text,

  -- bizim takibimiz
  ilgili_santiye_id uuid,
  notlar            text,
  arsivlendi        boolean     not null default false,

  ham               jsonb,                  -- API'nin ham yanıtı
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Aynı tebligat iki kez yazılmasın; çekme işi tekrar çalışınca üzerine yazar.
create unique index if not exists tebligat_uets_uq  on public.tebligat (hesap, uets_id);
create index if not exists tebligat_ulasma_idx on public.tebligat (ulasma_tarihi desc);
create index if not exists tebligat_teblig_idx on public.tebligat (teblig_tarihi);
-- Açılmamış tebligatlar: ana ekrandaki uyarı bunu sorgulayacak.
create index if not exists tebligat_acilmamis_idx on public.tebligat (durum, teblig_tarihi)
  where durum = 'delivered';

comment on table  public.tebligat is
  'UETS''ten çekilen elektronik tebligatlar. teblig_tarihi = ulaşma + 5 gün (7201 s. K. 7/a), hesaplanan sütundur.';
comment on column public.tebligat.ulasma_tarihi is
  'UETS adresimize ulaştığı an (API inserttime). HUKUKİ SÜRE BUNDAN İŞLER.';
comment on column public.tebligat.okuma_tarihi is
  'Paketin indirildiği an. UETS''te indirmek açmak demektir; robot otomatik indirmez.';
comment on column public.tebligat.teblig_tarihi is
  'Tebliğ edilmiş sayıldığı gün: ulaşma gününü izleyen beşinci günün sonu. Elle yazılamaz.';
comment on column public.tebligat.durum is
  'delivered = açılmadı · read = açıldı · readtimeout = 5 gün açılmadı, otomatik okundu sayıldı.';
comment on column public.tebligat.indirme_hatasi is
  'Paket indirilemediyse sebebi. Doluysa satır EKSİKTİR; ekranda uyarı gösterilir.';

create or replace function public.tebligat_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists tebligat_updated_at on public.tebligat;
create trigger tebligat_updated_at before update on public.tebligat
  for each row execute function public.tebligat_updated_at();

-- Okumak oturum açmış kullanıcıya serbest; YAZMAK DEĞİL. Yalnız çekme işi (servis
-- anahtarıyla) yazar — kullanıcı bir tebligatı silemez, tarihini değiştiremez.
alter table public.tebligat enable row level security;
drop policy if exists tebligat_oku on public.tebligat;
create policy tebligat_oku on public.tebligat for select to authenticated using (true);
