-- KONUM ONAYI SAVUNMA BELGESİ OLSUN — METNİN KENDİSİ, KİŞİ, CİHAZ, IP
--
-- NİYE: onay kaydı sonradan "bu kişiye ne söylendi, ne zaman, neyi kabul etti"
-- sorusuna cevap verebilmeli. Yalnız sürüm numarası tutmak yetmiyor: kod
-- değişince o sürümün metni kaybolur ve elde dayanak kalmaz.
--
-- NE EKLENİYOR:
--   metin     → onaylandığı ANDAKİ metnin tamamı (ekranda ne yazıyorsa o)
--   ad_soyad  → kişinin o günkü adı (ANLIK KOPYA; kullanıcı silinse/adı
--               değişse de kaydın kime ait olduğu okunabilsin)
--   ip        → isteğin geldiği adres (sunucu tarafında okunur, tarayıcı
--               söylemez — kullanıcı değiştiremesin)
--
-- KAYIT SUNUCUDA YAZILIR: /api/konum-onay rotası oturumdan kullanıcıyı çözer,
-- IP'yi başlıktan alır ve service role ile yazar. Tarayıcının kendi beyanına
-- bırakılsaydı kayıt savunma belgesi sayılmazdı.
alter table public.konum_onaylari add column if not exists metin text;
alter table public.konum_onaylari add column if not exists ad_soyad text;
alter table public.konum_onaylari add column if not exists ip text;

comment on column public.konum_onaylari.metin is
  'Onaylandığı andaki aydınlatma metninin TAMAMI — kod değişse de kişiye ne söylendiği kalsın';
comment on column public.konum_onaylari.ad_soyad is
  'Kişinin onay anındaki adı (anlık kopya)';
comment on column public.konum_onaylari.ip is
  'İsteğin geldiği IP (sunucuda okunur; tarayıcı beyanı değildir)';

-- YAZMA ARTIK SUNUCUDAN: tarayıcıya yazma yetkisi bırakılmıyor. Kullanıcı kendi
-- onayını (ve başkasınınkini) elle yazabiliyor olsaydı kayıt dayanak olmazdı.
-- Okuma authenticated kalıyor: pencere "onay var mı" diye bakıyor, yönetici de
-- listeyi görebiliyor.
drop policy if exists "konum_onaylari_authenticated_all" on public.konum_onaylari;
drop policy if exists "konum_onaylari_authenticated_read" on public.konum_onaylari;
create policy "konum_onaylari_authenticated_read"
  on public.konum_onaylari for select to authenticated using (true);
