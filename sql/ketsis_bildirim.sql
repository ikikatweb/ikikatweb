-- KETSİS / GİB E-TEBLİGAT İZLEME — vergi dairesi tebligatının bildirim maili
--
-- NİYE BÖYLE, NİYE API DEĞİL
-- ---------------------------------------------------------------------------
-- Vergi dairesi tebligatları UETS'te DEĞİL: GİB'in işlettiği KETSİS (Kurumsal
-- Elektronik Tebligat Sistemi) üzerinde durur. İkisi ayrı sistem — PTT UETS
-- entegrasyonumuz (sql/tebligat.sql) KETSİS'i hiç görmez.
--
-- KETSİS'in ALICI tarafı için yayınlanmış bir API'si yok. Tebligata ancak Dijital
-- Vergi Dairesi (dijital.gib.gov.tr → e-Tebligatlarım) ya da e-Devlet ekranından,
-- kullanıcı kodu + şifreyle bakılır. Belgeyi program indiremez.
--   · Kurum–kurum entegrasyonunda KETSİS'e bağlanan taraf tebligatı GÖNDEREN kamu
--     kurumudur (örn. Ticaret Bakanlığı TÜBİS'i bağladı) — alıcı şirket değil.
--   · "Yüksek hacimli tüzel kişi alıcılar GİB onayıyla çekebilir" bilgisi yalnız
--     danışmanlık yazılarında geçiyor; GİB'in yayınlanmış teknik kılavuzu/uç noktası
--     yok. Bizim hacmimizde o kapı açılmaz.
--
-- ELDE KALAN TEK OTOMATİK SİNYAL: GİB yeni tebligat gelince başvuruda bildirilen
-- e-postaya/telefona bilgilendirme yolluyor. Bu tablo o maili kayda geçirir; muhasebe
-- kutularını zaten okuyan altyapımız var (bkz. scripts/sigorta-teklif-mail.mjs,
-- lib/personel/bildirge-fetch.ts).
--
-- BU BİR UYARI SİSTEMİ, GARANTİ DEĞİL — VE ÖYLE DAVRANIR
-- ---------------------------------------------------------------------------
-- Bilgilendirme maili hukuken tebligatın parçası değil: gelmemesi, spam'e düşmesi ya
-- da adresin güncel olmaması süreyi DURDURMAZ. Tebligat, elektronik adrese ulaştığı
-- tarihi izleyen beşinci günün sonunda tebliğ edilmiş sayılır (VUK 107/A).
--
-- Bu yüzden iki şey birlikte var:
--   1) ketsis_bildirim → mail geldiyse haber ver,
--   2) ketsis_kontrol  → mail GELMESE DE haftalık "Dijital Vergi Dairesi'ne bak"
--      hatırlatması. Sessizlik "tebligat yok" demek değildir; projenin "sessiz hata
--      yok" kuralı burada da geçerli: mail akmıyorsa ekran susmaz, sorar.
--
-- GÖNDERENİ UYDURMUYORUZ
-- ---------------------------------------------------------------------------
-- GİB'in bildirim mailini hangi adresten yolladığı resmî bir kaynakta yazılı değil.
-- Tek bir adrese bel bağlayıp "eşleşmedi → yok" demek, tam da kaçırmak istemediğimiz
-- şeyi kaçırmak olur. O yüzden iki güven seviyesi var:
--   guven = 'kesin' → gönderen gib.gov.tr / gelirler.gov.tr gibi resmî alandan, YA DA
--                     daha önce bu panelde onaylanmış bir gönderenden.
--   guven = 'aday'  → konu/gövde vergi tebligatına benziyor ama gönderen tanıdık değil.
--                     Ekranda "doğrula" diye görünür; kullanıcı onaylarsa o gönderen
--                     bundan sonra 'kesin' sayılır (öğrenir).
-- Hiçbir ipucu yoksa satır AÇILMAZ — her maili tebligat sanmak uyarıyı değersizleştirir.

-- ───────────────────────────── bildirimler ─────────────────────────────
create table if not exists public.ketsis_bildirim (
  id            bigserial primary key,

  -- mail kimliği
  kutu          text        not null,      -- hangi posta kutusunda bulundu (muhasebe@…)
  -- Hangi KLASÖRDE bulundu. INBOX dışındaki bir değer tek başına bir bulgudur:
  -- Junk'a düşmüş bir tebligat bildirimi, hiç görülmemiş olabilir demektir.
  klasor        text,
  tekil         text        not null,      -- Message-ID, yoksa "uid:<n>" — tekilleştirme anahtarı
  mail_uid      bigint,
  mail_tarihi   timestamptz not null,
  gonderen      text,                      -- görünen ad
  gonderen_adres text,                     -- küçük harfe indirilmiş e-posta adresi
  konu          text,
  ozet          text,                      -- gövdeden kısa alıntı (ekran için, ~600 karakter)

  -- hangi şirket
  firma_id      uuid references public.firmalar(id),
  vkn           text,                       -- gövdede bulunabilirse
  -- GİB mailinin konusunda geçen belge numarası: "… İletisi - BELGE NO[MC09994486]".
  -- Dijital Vergi Dairesi'nde tebligatlar bu numarayla listeleniyor; kullanıcı hangi
  -- satıra bakacağını bilsin.
  belge_no      text,

  guven         text        not null default 'aday',  -- kesin | aday  (bkz. başlık)

  -- takip
  durum         text        not null default 'yeni',  -- yeni | kontrol_edildi | ilgisiz
  kontrol_eden_id uuid references public.kullanicilar(id),
  kontrol_eden_ad text,                     -- o anki ad; kullanıcı silinse de iz kalsın
  kontrol_at    timestamptz,
  notlar        text,

  created_at    timestamptz not null default now()
);

-- Tablo bir kez kurulduktan SONRA eklenen sütunlar (dosya yeniden çalıştırılabilir kalsın).
-- Yukarıdaki create bloğu kaynaktır; buradakiler kurulu veritabanını ona getirir.
alter table public.ketsis_bildirim add column if not exists belge_no text;
alter table public.ketsis_bildirim add column if not exists klasor   text;

-- Aynı mail iki kez yazılmasın; script her turda pencereyi yeniden tarayabilir.
create unique index if not exists ketsis_bildirim_tekil_uq
  on public.ketsis_bildirim (kutu, tekil);
create index if not exists ketsis_bildirim_tarih_idx
  on public.ketsis_bildirim (mail_tarihi desc);
-- Ana ekran uyarısı ve menü rozeti bunu sorgular.
create index if not exists ketsis_bildirim_yeni_idx
  on public.ketsis_bildirim (durum) where durum = 'yeni';

comment on table  public.ketsis_bildirim is
  'GİB (KETSİS) e-tebligat bilgilendirme mailleri. Tebligatın KENDİSİ burada değil — belge yalnız Dijital Vergi Dairesi ekranından görülür. Bu tablo "git bak" uyarısıdır.';
comment on column public.ketsis_bildirim.guven is
  'kesin = resmî/onaylanmış göndereneden · aday = konuya göre tahmin, kullanıcı doğrulamalı.';
comment on column public.ketsis_bildirim.durum is
  'yeni = kimse bakmadı · kontrol_edildi = Dijital Vergi Dairesi''ne girilip bakıldı (kim, ne zaman kayıtlı) · ilgisiz = aday yanlış çıktı.';
comment on column public.ketsis_bildirim.ozet is
  'Mail gövdesinden alıntı. Mail metninde tebligatın konusu/vergi dairesi geçebiliyor; belgenin yerine geçmez.';

-- ───────────────────────── posta kutusu durumu ─────────────────────────
-- "YAŞIYORUM" DAMGASI: son_calisma her turda yazılır, yeni mail olmasa da. Görev sessizce
-- ölürse (bkz. memory: görev sessizce ölebilir) tek belirti bu alanın eskimesi olur.
create table if not exists public.ketsis_imap_durum (
  kutu          text primary key,
  son_tarih     timestamptz,                -- işlenen en yeni mailin tarihi
  son_calisma   timestamptz,
  son_sonuc     text,
  son_hata      text
);
comment on table public.ketsis_imap_durum is
  'KETSİS mail tarayıcısının kutu başına durumu. son_calisma eskimişse görev çalışmıyor demektir.';

-- ───────────────────────── elle kontrol defteri ─────────────────────────
-- Mail hiç gelmese bile birinin Dijital Vergi Dairesi'ne bakması gerekiyor. Bu tablo o
-- bakışın kaydı; ana ekrandaki hatırlatma son kayda göre "kaç gündür bakılmadı" der.
create table if not exists public.ketsis_kontrol (
  id            bigserial primary key,
  kontrol_at    timestamptz not null default now(),
  kullanici_id  uuid references public.kullanicilar(id),
  kullanici_ad  text,
  bulgu         text        not null default 'temiz',  -- temiz | tebligat_var
  notlar        text
);
create index if not exists ketsis_kontrol_tarih_idx on public.ketsis_kontrol (kontrol_at desc);
comment on table public.ketsis_kontrol is
  'Dijital Vergi Dairesi''nin elle kontrol kaydı. Bilgilendirme maili gelmeyebilir; haftalık hatırlatma bu tabloya bakar.';

-- ───────────────────────────── RLS ─────────────────────────────
-- Okumak oturum açmış kullanıcıya serbest, YAZMAK DEĞİL. Yazan iki yer var:
--   · scripts/ketsis-mail-cek.mjs (servis anahtarı) → bildirimleri yazar
--   · /api/ketsis/kontrol        (servis anahtarı) → kontrol kaydı / durum değişikliği
-- Böylece "ben baktım" kaydına kullanıcı başkasının adını yazamaz.
alter table public.ketsis_bildirim  enable row level security;
alter table public.ketsis_kontrol   enable row level security;
alter table public.ketsis_imap_durum enable row level security;

drop policy if exists ketsis_bildirim_oku on public.ketsis_bildirim;
create policy ketsis_bildirim_oku on public.ketsis_bildirim for select to authenticated using (true);

drop policy if exists ketsis_kontrol_oku on public.ketsis_kontrol;
create policy ketsis_kontrol_oku on public.ketsis_kontrol for select to authenticated using (true);

drop policy if exists ketsis_imap_durum_oku on public.ketsis_imap_durum;
create policy ketsis_imap_durum_oku on public.ketsis_imap_durum for select to authenticated using (true);
