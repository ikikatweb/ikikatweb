-- ANTETİN TARİHLİ GEÇMİŞİ
--
-- SORUN: antet firmaya bağlıydı, evraka değil. Bir firmanın anteti değişince GEÇMİŞ
-- bütün yazışmalar da yeni antetle açılıyordu. 05.11.2026'da Kad-Tem–Atılım ortaklığının
-- anteti yenilenince, nisan–ekim arasında yazılmış 30 belge (12 giden evrak + 18 banka
-- yazışması) bir anda yeni anteti göstermeye başladı. Resmî yazışmada belgenin o günkü
-- hâliyle kalması gerekir.
--
-- ÇÖZÜM: her antet, "şu tarihten itibaren geçerli" kaydıyla burada saklanır. Belge
-- açılırken KENDİ TARİHİNDE geçerli olan antet seçilir (lib/utils/antet-gecmis.ts).
-- firmalar.antet_url / antet_renkli_url "şu anki antet" olarak kalır: yeni belgeler ve
-- MAİLLER onu kullanır (mail bugün gidiyor, bugünkü antetle gitmeli).
--
-- Yüklemeler artık aynı adrese yazmıyor (antet-<zaman>.png): eski dosya storage'da
-- duruyor, geçmiş kayıtların adresi geçerli kalıyor.

create table if not exists firma_antet_gecmisi (
  id uuid primary key default gen_random_uuid(),
  firma_id uuid not null references firmalar(id) on delete cascade,
  antet_url text not null,
  antet_renkli_url text,
  -- Bu antet hangi tarihten itibaren geçerli. Belge tarihi >= bu tarih olanlar bunu kullanır.
  gecerli_baslangic date not null,
  created_at timestamptz not null default now()
);

create index if not exists firma_antet_gecmisi_firma_tarih
  on firma_antet_gecmisi (firma_id, gecerli_baslangic desc);

alter table firma_antet_gecmisi enable row level security;

drop policy if exists "antet gecmisi okuma" on firma_antet_gecmisi;
create policy "antet gecmisi okuma" on firma_antet_gecmisi for select using (true);
drop policy if exists "antet gecmisi yazma" on firma_antet_gecmisi;
create policy "antet gecmisi yazma" on firma_antet_gecmisi for all using (true) with check (true);

-- TOHUM: her firmanın ŞU ANKİ anteti "başlangıçtan beri geçerli" sayılır.
-- Böylece bu göç çalıştığında hiçbir belgenin görünümü değişmez; sonraki yüklemeler
-- kendi tarihleriyle üste eklenir. (Ortaklığın ESKİ anteti ayrıca eklenecek.)
insert into firma_antet_gecmisi (firma_id, antet_url, antet_renkli_url, gecerli_baslangic)
select id, antet_url, antet_renkli_url, date '2000-01-01'
from firmalar
where antet_url is not null
  and not exists (select 1 from firma_antet_gecmisi g where g.firma_id = firmalar.id);
