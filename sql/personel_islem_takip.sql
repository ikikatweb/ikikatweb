-- Personel işe giriş / işten çıkış BİLDİRGE takibi.
-- Bordro Takibi'nden muhasebeye giriş/çıkış maili atıldığında her personel için "bekliyor" kaydı açılır
-- (app/api/bordro-mail-bulk). PC tarafındaki scripts/personel-bildirge-sync görevi muhasebenin
-- cevabındaki SGK bildirgesi PDF'ini (metninden) okuyup TC ile eşleyerek kaydı "tamamlandi" yapar.
-- Ana sayfa, bugün gönderilip gün sonuna kadar cevabı gelmeyen talepler için uyarı gösterir.
create table if not exists personel_islem_takip (
  id               uuid primary key default gen_random_uuid(),
  firma_id         uuid references firmalar(id) on delete set null,
  personel_ad      text not null,
  personel_tc      text,                          -- eşleştirme anahtarı (PDF içindeki TC ile)
  tip              text not null check (tip in ('giris','cikis')),
  islem_tarihi     date,                           -- işe giriş / işten çıkış tarihi (mailde geçen)
  gonderim_tarihi  date not null,                  -- talebin muhasebeye gönderildiği gün (TR)
  durum            text not null default 'bekliyor' check (durum in ('bekliyor','tamamlandi')),
  cevap_tarihi     timestamptz,                    -- bildirge PDF'i yakalandığı an
  cevap_pdf_ad     text,                           -- ekteki PDF dosya adı
  cevap_kutu       text,                           -- hangi posta kutusunda bulundu (ikikat/kadtem)
  cevap_gonderen   text,                           -- bilgi amaçlı (filtre değil)
  uyusmazlik       text,                           -- gelen bildirge kayıtla tutmuyorsa (ör. tarih farkı) açıklama → ana sayfada gösterilir
  created_by_ad    text,
  created_at       timestamptz not null default now()
);
-- Tabloyu önceki sürümde kurduysanız kolonu ekleyin:
alter table personel_islem_takip add column if not exists uyusmazlik text;
create index if not exists personel_islem_takip_durum_idx on personel_islem_takip (durum);
create index if not exists personel_islem_takip_tc_idx on personel_islem_takip (personel_tc);
create index if not exists personel_islem_takip_gonderim_idx on personel_islem_takip (gonderim_tarihi);

-- RLS: sigorta_teklif / bordro_gonderim ile aynı desen — giriş yapmış kullanıcı okuyup yazabilir,
-- servis rolü (PC scripti) RLS'i atlar.
alter table personel_islem_takip enable row level security;
drop policy if exists personel_islem_takip_all on personel_islem_takip;
create policy personel_islem_takip_all on personel_islem_takip
  for all to authenticated using (true) with check (true);
