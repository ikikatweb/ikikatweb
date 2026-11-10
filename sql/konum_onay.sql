-- KONUM AYDINLATMA ONAYI — KİM, NE ZAMAN, HANGİ METNİ ONAYLADI
--
-- NİYE: yakıt kaydında konum zorunlu hâle geldi. Çalışanın konumu kişisel veri;
-- ne topladığımızın, niçin topladığımızın ve ne kadar süreyle sakladığımızın
-- kişiye SÖYLENMİŞ olması gerekiyor. Tarayıcının "konumunuza erişmek istiyor"
-- penceresi bunu karşılamıyor — o yalnız teknik izin, aydınlatma değil.
--
-- METNİN SÜRÜMÜ SAKLANIR: metin ileride değişirse "hangi metni onayladı"
-- sorusu cevapsız kalmasın. Yeni sürüm yayımlandığında onay yeniden istenir
-- (kayıtta o sürüm yoksa ekran yine çıkar).
--
-- ONAY GERİ ALINABİLİR OLMALI mı? Burada tutulan şey AYDINLATMANIN OKUNDUĞU
-- beyanı; yakıt kaydı için konum zaten zorunlu (işin gereği). Onay satırı
-- silinirse ekran yeniden çıkar — geri alma yolu budur.

create table if not exists public.konum_onaylari (
  id           uuid primary key default gen_random_uuid(),
  kullanici_id uuid not null references public.kullanicilar(id) on delete cascade,
  -- Onaylanan metnin sürümü (tarih biçiminde). Metin değişirse sürüm değişir.
  metin_surum  text not null,
  onay_at      timestamptz not null default now(),
  -- HANGİ CİHAZDAN: aynı kişi telefondan onaylayıp bilgisayardan girebiliyor;
  -- anlaşmazlıkta "nereden onayladı" sorusu soruluyor.
  cihaz        text,
  -- Onay anında tarayıcı konum izni verilmiş miydi? ("Konumu aç" düğmesinin sonucu)
  konum_izni   boolean,
  -- AYNI SÜRÜM İKİ KEZ YAZILMAZ: ekran her açılışta onay istemesin.
  unique (kullanici_id, metin_surum)
);

create index if not exists konum_onaylari_kullanici_idx
  on public.konum_onaylari (kullanici_id, onay_at desc);

alter table public.konum_onaylari enable row level security;

-- Panel içi tablo: oturum açmış kullanıcı kendi onayını yazar, listeyi görür.
-- (Kim kimin onayını göremesin diye ayrı bir kısıt konmadı — yönetici denetim
--  için bakabilmeli; panelin erişimi zaten izin matrisiyle yönetiliyor.)
drop policy if exists "konum_onaylari_authenticated_all" on public.konum_onaylari;
create policy "konum_onaylari_authenticated_all"
  on public.konum_onaylari for all to authenticated using (true) with check (true);
