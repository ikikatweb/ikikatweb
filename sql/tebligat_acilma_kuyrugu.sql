-- TEBLİGAT AÇMA KUYRUĞU
--
-- NEDEN KUYRUK? UETS API'si yalnız PTT portalında tanımlı STATİK IP'den çalışıyor.
-- Panel Vercel'de duruyor ve onun çıkış adresi başka; oradan yapılan istek TCP
-- seviyesinde kesiliyor ("fetch failed", HTTP cevabı bile oluşmuyor). Ofisten gidince
-- bağlantı kuruluyor. Yani UETS'e giden HER istek ofisten yapılmak zorunda.
--
-- Bu yüzden "Aç ve oku" düğmesi tebligatı doğrudan indirmiyor: isteği buraya yazıyor,
-- ofisteki görev (scripts/uets-ac-isle.mjs) dakikada bir bakıp indiriyor. Ekran da
-- hazır olunca kendini tazeliyor. Kullanıcı açısından fark, cevabın anında değil
-- ~1 dakikada gelmesi.
--
-- TEK YERDEN İNİYOR: indirme mantığı yalnız o görevde. İki ayrı yerde (hem sunucu
-- rotasında hem görevde) dursaydı ikisi zamanla ayrışırdı; tebligat gibi bir konuda
-- "hangisi çalıştı" sorusunu sormak istemeyiz.
alter table public.tebligat
  add column if not exists acilma_durumu    text,        -- null | bekliyor | islemde | hata
  add column if not exists acilma_istegi_at timestamptz,
  add column if not exists acilma_isteyen_id uuid references public.kullanicilar(id),
  add column if not exists acilma_isteyen_ad text,       -- o anki ad; kullanıcı silinse de iz kalsın
  add column if not exists acilma_hatasi    text;

comment on column public.tebligat.acilma_durumu is
  'bekliyor = kullanıcı açmak istedi, ofisteki görev henüz almadı · islemde = indiriliyor · hata = indirilemedi (acilma_hatasi''na bakılır). Boşsa istek yok.';
comment on column public.tebligat.acilma_isteyen_ad is
  'Açılmasını isteyen kullanıcının o anki adı. Tebligatı fiilen açan da odur; okuyan_ad ile aynı kişi olur.';

-- Bekleyen istekler: görev saniyede bir bakacak, sorgu ucuz olsun.
create index if not exists tebligat_acilma_bekleyen_idx on public.tebligat (acilma_istegi_at)
  where acilma_durumu in ('bekliyor', 'islemde');

-- Koruma tetikleyicisi: kuyruk alanları da RESMÎ alan sayılır, tarayıcıdan elle
-- değiştirilemez. İstek /api/tebligat/ac rotasından (servis anahtarıyla) yazılır;
-- kullanıcı "ben açtım" diye kayda kendi adını yazamasın.
create or replace function public.tebligat_korumali_alanlar() returns trigger
language plpgsql as $$
begin
  -- Robot ve sunucu tarafı (service_role) muaf: UETS'teki gerçeği yazmakla görevliler.
  if current_user <> 'authenticated' then return new; end if;

  if  new.uets_id           is distinct from old.uets_id
   or new.hesap             is distinct from old.hesap
   or new.gonderen_adres    is distinct from old.gonderen_adres
   or new.gonderen_ad       is distinct from old.gonderen_ad
   or new.alici_adres       is distinct from old.alici_adres
   or new.alici_ad          is distinct from old.alici_ad
   or new.konu              is distinct from old.konu
   or new.ulasma_tarihi     is distinct from old.ulasma_tarihi
   or new.okuma_tarihi      is distinct from old.okuma_tarihi
   or new.durum             is distinct from old.durum
   or new.firma_id          is distinct from old.firma_id
   or new.okuyan_id         is distinct from old.okuyan_id
   or new.okuyan_ad         is distinct from old.okuyan_ad
   or new.paket_yolu        is distinct from old.paket_yolu
   or new.ekler             is distinct from old.ekler
   or new.acilma_durumu     is distinct from old.acilma_durumu
   or new.acilma_istegi_at  is distinct from old.acilma_istegi_at
   or new.acilma_isteyen_id is distinct from old.acilma_isteyen_id
   or new.acilma_isteyen_ad is distinct from old.acilma_isteyen_ad
  then
    raise exception 'Tebligatın resmî alanları değiştirilemez (yalnız notlar, arşiv ve ilgili şantiye).';
  end if;
  return new;
end $$;
