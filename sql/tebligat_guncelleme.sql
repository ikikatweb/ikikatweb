-- TEBLİGAT: KULLANICI NEYİ DEĞİŞTİREBİLİR?
--
-- Tablo RLS ile salt okunurdu; not yazmak ve arşivlemek de mümkün olmuyordu.
-- Şimdi güncelleme açılıyor AMA SADECE ÜÇ ALAN İÇİN. Resmî alanlara (tarihler, durum,
-- gönderen, konu) kimse dokunamaz — tebligat resmî belgedir, izi bozulmamalı.
--
-- Kolon bazlı kısıt RLS ile yapılamadığı için tetikleyiciyle korunuyor: korunan bir alan
-- değiştirilmeye kalkılırsa işlem HATA VERİR, sessizce geri alınmaz. Sessiz geri alma,
-- "kaydettim" deyip kaydetmemek olurdu.
create or replace function public.tebligat_korumali_alanlar() returns trigger
language plpgsql as $$
begin
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
  then
    raise exception 'Tebligatın resmî alanları değiştirilemez (yalnız notlar, arşiv ve ilgili şantiye).';
  end if;
  return new;
end $$;

drop trigger if exists tebligat_korumali on public.tebligat;
create trigger tebligat_korumali before update on public.tebligat
  for each row execute function public.tebligat_korumali_alanlar();

drop policy if exists tebligat_guncelle on public.tebligat;
create policy tebligat_guncelle on public.tebligat
  for update to authenticated using (true) with check (true);
