-- ÇOĞALTILAN KULLANICI YETKİYİ HER YOLDAN İZLESİN
--
-- Neden: Dilanur, Özge'den çoğaltılarak açıldı (yetki_kaynak_id = Özge) ve Özge'ye verilen
-- her yetkinin ona da geçmesi bekleniyordu. Yayma YALNIZ /api/kullanicilar/[id] içinde
-- yazılıydı; Özge 13.10'da Amasya şantiyesini kendisi açınca yetki
-- /api/santiyeler/kendime-ata üzerinden doğrudan kendi satırına yazıldı (şantiye 12:52:22'de
-- açıldı, yetki 12:52:24'te eklendi) ve yayma hiç çalışmadı. Dilanur'un yetkisi eksik kaldı.
--
-- Çözüm: yayma tek bir API yolunda değil, TABLONUN KENDİSİNDE. Hangi yoldan yazılırsa
-- yazılsın (API, betik, SQL, yeni şantiye yan etkisi) izleyenlere geçer.
--
-- YAYILMAYANLAR: ad_soyad / kullanici_adi / şifre (kişiye özel), aktif (birini pasife almak
-- diğerini kapatmamalı), son_giris · bildirim_ayarlari · arvento_genis_son (kişisel tercih),
-- yetki_kaynak_id (bağın kendisi).

create or replace function public.kullanici_yetki_yay()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Yayılan yazım yeniden yaymasın (sonsuz döngü koruması).
  if pg_trigger_depth() > 1 then
    return NEW;
  end if;

  update public.kullanicilar f set
    rol                             = NEW.rol,
    izinler                         = NEW.izinler,
    santiye_ids                     = NEW.santiye_ids,
    firma_ids                       = NEW.firma_ids,
    geriye_donus_gun                = NEW.geriye_donus_gun,
    puantaj_islem_gun               = NEW.puantaj_islem_gun,
    puantaj_goruntuleme_gun         = NEW.puantaj_goruntuleme_gun,
    yakit_islem_gun                 = NEW.yakit_islem_gun,
    yakit_goruntuleme_gun           = NEW.yakit_goruntuleme_gun,
    kasa_islem_gun                  = NEW.kasa_islem_gun,
    kasa_goruntuleme_gun            = NEW.kasa_goruntuleme_gun,
    santiye_defteri_islem_gun       = NEW.santiye_defteri_islem_gun,
    santiye_defteri_goruntuleme_gun = NEW.santiye_defteri_goruntuleme_gun,
    dashboard_widgets               = NEW.dashboard_widgets,
    santiyesiz_veri_gor             = NEW.santiyesiz_veri_gor,
    santiyesiz_evrak_gor            = NEW.santiyesiz_evrak_gor,
    updated_at                      = now()
  where f.yetki_kaynak_id = NEW.id;

  return NEW;
end;
$$;

drop trigger if exists trg_kullanici_yetki_yay on public.kullanicilar;

-- WHEN: yalnız yetki alanlarından biri gerçekten değiştiyse çalışsın. son_giris her oturum
-- açılışında yazılıyor; o yazımlarda tetiklenmesi boş iş olurdu.
create trigger trg_kullanici_yetki_yay
after update on public.kullanicilar
for each row
when (
  OLD.rol                             is distinct from NEW.rol
  or OLD.izinler                      is distinct from NEW.izinler
  or OLD.santiye_ids                  is distinct from NEW.santiye_ids
  or OLD.firma_ids                    is distinct from NEW.firma_ids
  or OLD.geriye_donus_gun             is distinct from NEW.geriye_donus_gun
  or OLD.puantaj_islem_gun            is distinct from NEW.puantaj_islem_gun
  or OLD.puantaj_goruntuleme_gun      is distinct from NEW.puantaj_goruntuleme_gun
  or OLD.yakit_islem_gun              is distinct from NEW.yakit_islem_gun
  or OLD.yakit_goruntuleme_gun        is distinct from NEW.yakit_goruntuleme_gun
  or OLD.kasa_islem_gun               is distinct from NEW.kasa_islem_gun
  or OLD.kasa_goruntuleme_gun         is distinct from NEW.kasa_goruntuleme_gun
  or OLD.santiye_defteri_islem_gun    is distinct from NEW.santiye_defteri_islem_gun
  or OLD.santiye_defteri_goruntuleme_gun is distinct from NEW.santiye_defteri_goruntuleme_gun
  or OLD.dashboard_widgets            is distinct from NEW.dashboard_widgets
  or OLD.santiyesiz_veri_gor          is distinct from NEW.santiyesiz_veri_gor
  or OLD.santiyesiz_evrak_gor         is distinct from NEW.santiyesiz_evrak_gor
)
execute function public.kullanici_yetki_yay();

-- GEÇMİŞİ HİZALA: hâlihazırda ayrışmış izleyiciler kaynağına eşitlenir.
update public.kullanicilar f set
  rol                             = k.rol,
  izinler                         = k.izinler,
  santiye_ids                     = k.santiye_ids,
  firma_ids                       = k.firma_ids,
  geriye_donus_gun                = k.geriye_donus_gun,
  puantaj_islem_gun               = k.puantaj_islem_gun,
  puantaj_goruntuleme_gun         = k.puantaj_goruntuleme_gun,
  yakit_islem_gun                 = k.yakit_islem_gun,
  yakit_goruntuleme_gun           = k.yakit_goruntuleme_gun,
  kasa_islem_gun                  = k.kasa_islem_gun,
  kasa_goruntuleme_gun            = k.kasa_goruntuleme_gun,
  santiye_defteri_islem_gun       = k.santiye_defteri_islem_gun,
  santiye_defteri_goruntuleme_gun = k.santiye_defteri_goruntuleme_gun,
  dashboard_widgets               = k.dashboard_widgets,
  santiyesiz_veri_gor             = k.santiyesiz_veri_gor,
  santiyesiz_evrak_gor            = k.santiyesiz_evrak_gor,
  updated_at                      = now()
from public.kullanicilar k
where f.yetki_kaynak_id = k.id;
