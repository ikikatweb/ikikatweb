-- KAYIT GEÇMİŞİ — her değişikliği kimin yaptığı
--
-- Neden: ortaklık oranı iki işte %200 girilmişti; kimin yazdığını bulmanın yolu yoktu.
-- santiyeler tablosunda yalnız created_at/updated_at vardı, kullanıcı alanı yoktu ve
-- hiçbir yerde değişiklik günlüğü tutulmuyordu.
--
-- Nasıl: tetikleyiciyle. Panel yazmaları tarayıcıdan kullanıcının kendi oturumuyla
-- gittiği için veritabanı auth.uid()'i görüyor; her forma tek tek kod eklemek gerekmiyor
-- ve bundan sonra açılacak ekranlar kendiliğinden kapsama giriyor. Servis anahtarıyla
-- çalışan betikler (netsim senkronu, mail okuyucu) auth.uid() vermez; onlar "sistem"
-- olarak işaretlenir.
--
-- Ne yazılır: UPDATE'te DEĞİŞEN HER ALAN için ayrı satır (eski değer → yeni değer).
-- INSERT ve DELETE için tek satır. Değişmeyen alanlar yazılmaz.

create table if not exists public.kayit_gecmisi (
  id            bigserial primary key,
  tablo         text        not null,
  kayit_id      text        not null,
  islem         text        not null check (islem in ('ekleme','degisiklik','silme')),
  alan          text,
  eski_deger    text,
  yeni_deger    text,
  kullanici_id  uuid,
  kullanici_ad  text,          -- anlık kopya: kullanıcı sonradan silinse de kim olduğu kalır
  kaynak        text        not null default 'panel',  -- 'panel' | 'sistem'
  tarih         timestamptz not null default now()
);

comment on table public.kayit_gecmisi is
  'Alan bazında değişiklik günlüğü — kim, ne zaman, neyi neye çevirdi';

-- Bir kaydın geçmişini açmak en sık sorgu.
create index if not exists kayit_gecmisi_kayit_idx on public.kayit_gecmisi (tablo, kayit_id, tarih desc);
create index if not exists kayit_gecmisi_tarih_idx on public.kayit_gecmisi (tarih desc);
create index if not exists kayit_gecmisi_kullanici_idx on public.kayit_gecmisi (kullanici_id, tarih desc);

alter table public.kayit_gecmisi enable row level security;

-- Okumak serbest, YAZMAK DEĞİL. Günlüğe yalnız tetikleyici yazar (security definer);
-- kullanıcı kendi izini silemesin diye insert/update/delete politikası verilmiyor.
drop policy if exists "kayit_gecmisi_oku" on public.kayit_gecmisi;
create policy "kayit_gecmisi_oku"
  on public.kayit_gecmisi for select to authenticated using (true);

-- ── TETİKLEYİCİ ──────────────────────────────────────────────────────────────
create or replace function public.kayit_gecmisi_yaz()
returns trigger
language plpgsql
security definer           -- günlüğe yazmak çağıranın RLS'ine takılmasın
set search_path = public
as $$
declare
  v_kid   uuid;
  v_ad    text;
  v_kaynak text := 'panel';
  v_eski  jsonb;
  v_yeni  jsonb;
  v_alan  text;
  v_e     text;
  v_y     text;
  v_kayit text;
  -- Gürültü alanları: her yazmada değişir, bilgi taşımaz.
  v_atla  text[] := array['updated_at','created_at','netsim_son_senkron'];
begin
  -- MAKİNENİN SÜREKLİ YAZDIĞI SÜTUNLAR tablo bazında elenir. Arvento senkronu araçların
  -- göstergesini yarım dakikada bir yazıyor; ilk kurulumda günlüğe 30 saniyede 4 satır
  -- düştü, bu hızla günde ~11.500 satır eder ve kullanıcı değişiklikleri içinde kaybolur.
  -- Gösterge değerinin kendi geçmişi zaten arac_puantaj ve arvento tablolarında duruyor.
  if TG_TABLE_NAME = 'araclar' then
    v_atla := v_atla || array['guncel_gosterge','arvento_gosterge'];
  end if;
  select k.id, k.ad_soyad into v_kid, v_ad
  from public.kullanicilar k
  where k.auth_id = auth.uid();

  if v_kid is null then
    v_kaynak := 'sistem';   -- servis anahtarıyla çalışan betikler
  end if;

  v_kayit := coalesce(
    (to_jsonb(coalesce(NEW, OLD)) ->> 'id'),
    (to_jsonb(coalesce(NEW, OLD)) ->> 'nokta_no'),
    ''
  );

  if TG_OP = 'INSERT' then
    insert into public.kayit_gecmisi (tablo, kayit_id, islem, kullanici_id, kullanici_ad, kaynak)
    values (TG_TABLE_NAME, v_kayit, 'ekleme', v_kid, v_ad, v_kaynak);
    return NEW;
  end if;

  if TG_OP = 'DELETE' then
    insert into public.kayit_gecmisi (tablo, kayit_id, islem, kullanici_id, kullanici_ad, kaynak)
    values (TG_TABLE_NAME, v_kayit, 'silme', v_kid, v_ad, v_kaynak);
    return OLD;
  end if;

  v_eski := to_jsonb(OLD);
  v_yeni := to_jsonb(NEW);

  for v_alan in select jsonb_object_keys(v_yeni) loop
    if v_alan = any(v_atla) then continue; end if;
    v_e := v_eski ->> v_alan;
    v_y := v_yeni ->> v_alan;
    if v_e is distinct from v_y then
      insert into public.kayit_gecmisi
        (tablo, kayit_id, islem, alan, eski_deger, yeni_deger, kullanici_id, kullanici_ad, kaynak)
      values
        -- Uzun değerler (izinler, teknik_personeller gibi jsonb alanlar) kırpılır;
        -- günlük kaydın tamamını saklamak için değil, neyin değiştiğini göstermek için.
        (TG_TABLE_NAME, v_kayit, 'degisiklik', v_alan, left(v_e, 500), left(v_y, 500), v_kid, v_ad, v_kaynak);
    end if;
  end loop;

  return NEW;
end;
$$;

-- ── TABLOLARA TAK ────────────────────────────────────────────────────────────
-- Yalnız insanın elle girdiği tablolar. Arvento telemetrisi (arvento_*,
-- makine_calisma_noktasi), bildirim geçmişi ve mesajlar DIŞARIDA: makine üretimi,
-- on binlerce satır, günlüğü şişirir ve egress'i yakar.
do $$
declare
  t text;
  tablolar text[] := array[
    'santiyeler','santiye_ortaklari','santiye_is_gruplari','santiye_defteri','santiye_defteri_kayit',
    'iscilik_takibi','iscilik_aylik','bordro_gunluk_ucret',
    'personel','personel_santiye','personel_teknik','personel_brut_ucret',
    'personel_atama_gecmisi','personel_atama_bilgi_notu','personel_atama_manuel_gun',
    'personel_islem_takip','personel_puantaj',
    'araclar','arac_police','arac_bakim','arac_kira_bedeli','arac_yakit','arac_puantaj',
    'arac_puantaj_override','arac_cinsi_yakit_limit',
    'yakit_alim','yakit_virman',
    'kasa_hareketi','kasa_hareketi_limit','kredi_karti','odeme_plani_kasa','odeme_plani_satir',
    'firmalar','kullanicilar','tanimlamalar',
    'gelen_evrak','giden_evrak','banka_yazismalari','icra','ihale','ihale_katilimci',
    'haberler','sigorta_teklif','goruntuleme_limit','maliyet_gizli_santiye'
  ];
begin
  foreach t in array tablolar loop
    if to_regclass('public.' || t) is null then
      raise notice 'tablo yok, atlandı: %', t;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', 'kayit_gecmisi_trg_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.kayit_gecmisi_yaz()',
      'kayit_gecmisi_trg_' || t, t);
  end loop;
end $$;

-- ── BUDAMA ───────────────────────────────────────────────────────────────────
-- Günlük sınırsız büyümesin. 2 yıldan eski kayıtlar silinir; aylık görevden çağrılır.
create or replace function public.kayit_gecmisi_buda(gun integer default 730)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  delete from public.kayit_gecmisi where tarih < now() - (gun || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end;
$$;
