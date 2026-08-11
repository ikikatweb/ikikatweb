-- Personel bildirge takibi — "İPTAL" durumu. Aynı gün giriş+çıkış gibi durumlarda muhasebe işlem yapmaz,
-- bildirge hiç gelmez → admin ana sayfadan kaydı "Kaldır"ır (durum='iptal'). Kayıt SİLİNMEZ (denetim için kalır);
-- sync + dashboard yalnız durum='bekliyor' baktığı için iptal edilen kayda bir daha dokunulmaz/gösterilmez.
-- durum CHECK kısıtını (adı ne olursa olsun) bulup 'iptal'i kapsayanla değiştir:
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'personel_islem_takip'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%durum%'
  loop
    execute 'alter table personel_islem_takip drop constraint ' || quote_ident(c);
  end loop;
end $$;
alter table personel_islem_takip add constraint personel_islem_takip_durum_check
  check (durum in ('bekliyor', 'tamamlandi', 'iptal'));
