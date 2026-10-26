-- GÜVENLİK PAKETİ — 26.10.2026
--
-- Üç iş: (1) Storage'da anonim LİSTELEME iznini kaldır, (2) açık metin şifre
-- kopyasını sil, (3) bucket'ları özele çevir (bu adım koddan sonra yapılır).
--
-- Kod tarafı hazır ve yayında: dosyalar /api/dosya geçidinden imzalı adresle
-- geliyor, /api/* rotalarında oturum kapısı var, şifre artık yalnız Supabase
-- Auth'ta (hash'li) duruyor.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) STORAGE: anonim listeleme kapanır
--
-- Ölçüm: anon anahtarıyla kasa-slipleri (531), santiyeler (132), araclar (51),
-- arac-bakim (21), firmalar (5) bucket'larının İÇERİĞİ LİSTELENEBİLİYORDU.
-- Listeleme storage.objects üzerindeki RLS ile çalışır; bucket özele çevrilse
-- bile izin verici bir policy varsa dosya ADLARI yine sayılır.
--
-- Uygulama artık storage'ı doğrudan OKUMUYOR (geçit service-role kullanıyor),
-- yükleme de /api/upload üzerinden service-role ile yapılıyor → anon ve
-- authenticated rollerine SELECT izni gerekmiyor.
--
-- public bucket'tan (haberler) anahtarsız indirme bu policy'lerden ETKİLENMEZ;
-- Supabase /object/public/... yolunu RLS'siz servis eder. Kurumsal sitedeki
-- haber görselleri çalışmaya devam eder (uygulandıktan sonra doğrulanacak).
do $$
declare p record;
begin
  for p in
    select policyname, roles
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and cmd in ('SELECT', 'ALL')
  loop
    -- Yalnız anon/public (yani "herkes") kapsayan policy'ler düşürülür.
    if p.roles::text[] && array['anon','public'] then
      execute format('drop policy %I on storage.objects', p.policyname);
      raise notice 'Düşürülen policy: %', p.policyname;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) AÇIK METİN ŞİFRE KOPYASI SİLİNİR
--
-- kullanicilar.sifre_gorunur, yönetici listede görebilsin diye şifrenin
-- OKUNABİLİR kopyasını tutuyordu. Giriş zaten Supabase Auth ile (hash'li)
-- yapılıyor; bu sütun yalnız risk: tek bir sızıntı ya da yönetici hesabının ele
-- geçmesi herkesin gerçek şifresini verir ve insanlar aynı şifreyi başka
-- yerlerde de kullanır.
--
-- Yönetici artık şifre GÖREMEZ, yalnız yeni şifre ATAYABİLİR (kullanıcı
-- düzenleme ekranındaki Şifre alanı).
alter table kullanicilar drop column if exists sifre_gorunur;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) BUCKET'LAR ÖZELE ÇEVRİLİR  (haberler HARİÇ)
--
-- haberler: kurumsal sitede oturumsuz gösterildiği için GENEL kalır.
-- Diğerleri: dosyaya erişim yalnız /api/dosya geçidinden, imzalı ve oturumlu.
--
-- Bu adımı KOD YAYINA ALINDIKTAN SONRA çalıştırın; eski paket doğrudan genel
-- URL kullanıyor, önce çevrilirse o sekmelerde dosyalar görünmez (yenilenince
-- düzelir).
update storage.buckets
   set public = false
 where name in ('araclar','santiyeler','firmalar','kasa-slipleri','arac-bakim','mesaj-dosya','yazismalar');

-- Doğrulama
select name, public from storage.buckets order by name;
