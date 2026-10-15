-- SİLİNEN SATIRIN İÇERİĞİNİ DE SAKLA
--
-- Neden: 15.10.2026'da Hatice Ece İKİKAT'ın bir şantiye ataması yanlışlıkla silindi ve geri
-- istendi. Denetim kaydı silmenin OLDUĞUNU gösteriyordu ama satırın İÇERİĞİNİ tutmadığı için
-- hangi şantiye/tarih olduğu doğrudan okunamadı; aynı saniyede kapatılan dört akran satırdan
-- çıkarım yapmak gerekti. Silineni geri getirebilmek denetim kaydının asıl işi — bu açık kapandı.
--
-- Bu dosya kayit_gecmisi_yaz()'ı yalnız DELETE dalı değişmiş hâliyle yeniden tanımlar;
-- ekleme/değişiklik davranışı ve yok sayılan alanlar AYNI. Tetikleyicilere dokunulmaz,
-- fonksiyonu değiştirmek yeter (45 tablo aynı fonksiyona bağlı).

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
    -- Satırın TAMAMI eski_deger'e yazılır → kayıt birebir geri getirilebilir.
    -- Değişiklik satırlarındaki left(...,500) kırpması BURADA UYGULANMAZ: orada amaç
    -- "ne değişti"yi göstermek, burada amaç silineni geri yazabilmek.
    insert into public.kayit_gecmisi (tablo, kayit_id, islem, eski_deger, kullanici_id, kullanici_ad, kaynak)
    values (TG_TABLE_NAME, v_kayit, 'silme', to_jsonb(OLD)::text, v_kid, v_ad, v_kaynak);
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
