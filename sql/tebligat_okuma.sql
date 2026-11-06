-- TEBLİGATI PANELDEN AÇMA — kim açtı, ne zaman açtı, paket nerede?
--
-- UETS'te tebligatı İNDİRMEK onu AÇMAK demek (taahhütname md. 7: indirilen paketler
-- okunmuş sayılır). Yani panelden "Aç" düğmesine basmak, UETS'te tıklamakla hukuken
-- aynı şey: geri dönüşü yok, tebligat o an okunmuş oluyor.
--
-- Bu yüzden KİMİN açtığı kayda geçer. "Özge Düzen tarafından 05.11.2026 18:32'de okundu"
-- diyebilmek için iki şey saklanır: kullanıcı kimliği (okuyan_id) ve O ANKİ adı
-- (okuyan_ad). Ad ayrıca saklanıyor çünkü kullanıcı kaydı sonradan silinse ya da adı
-- değişse bile tebligatı kimin açtığı değişmemeli — resmî bir işlemin izi.
alter table public.tebligat
  add column if not exists okuyan_id uuid references public.kullanicilar(id),
  add column if not exists okuyan_ad text,
  -- Paketin içinden çıkan dosyalar: [{ad, yol, tur, boyut}]
  add column if not exists ekler jsonb;

comment on column public.tebligat.okuyan_id is
  'Tebligatı panelden açan kullanıcı. UETS''te indirmek açmak demektir; işlemi kim yaptı, izi kalsın.';
comment on column public.tebligat.okuyan_ad is
  'Açan kullanıcının O ANKİ adı. Kullanıcı silinse/adı değişse de kim açtığı değişmesin diye ayrıca saklanır.';
comment on column public.tebligat.ekler is
  'EYP paketinden çıkan dosyalar: [{ad, yol, tur, boyut}]. Boşsa paket açılamamıştır; indirme_hatasi''na bakılır.';

-- ───────────────────────── koruma tetikleyicisi düzeltmesi ─────────────────────────
--
-- ESKİ HÂLİ HATALIYDI: tetikleyici role bakmadan çalışıyordu. Oysa resmî alanları
-- GÜNCELLEMESİ GEREKEN iki iş var:
--   1) UETS çekme işi — tebligat UETS'te açılınca durum delivered → read olur,
--      upsert bu satırı günceller ve eski tetikleyici "değiştirilemez" diye patlardı.
--      Yani robot, durumu değişen ilk tebligatta duracaktı.
--   2) Panelden açma rotası — okuma_tarihi, durum ve okuyanı yazar.
-- İkisi de servis anahtarıyla (service_role) çalışır.
--
-- Korunması gereken, TARAYICIDAKİ KULLANICI (authenticated): o yalnız not yazabilir,
-- arşivleyebilir, şantiye ilişkilendirebilir. Resmî alanlara dokunamaz.
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
  then
    raise exception 'Tebligatın resmî alanları değiştirilemez (yalnız notlar, arşiv ve ilgili şantiye).';
  end if;
  return new;
end $$;
