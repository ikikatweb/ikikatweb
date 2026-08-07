-- Bizden Haberler — ana sayfada gösterilen firma haberleri. Yönetim: /dashboard/yonetim/haberler.
create table if not exists haberler (
  id uuid primary key default gen_random_uuid(),
  baslik text not null,
  ozet text,
  icerik text not null,
  gorsel_url text,
  yayinda boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid
);

create index if not exists haberler_created_at_idx on haberler (created_at desc);

alter table haberler enable row level security;

-- Herkes (anon dahil) okuyabilir — public ana sayfada gösterilir.
drop policy if exists "haberler_select_public" on haberler;
create policy "haberler_select_public" on haberler for select using (true);

-- Ekleme/güncelleme/silme: giriş yapmış kullanıcılar (uygulama içi izinle 'yonetim-haberler' modülüyle kısıtlanır).
drop policy if exists "haberler_insert_auth" on haberler;
create policy "haberler_insert_auth" on haberler for insert to authenticated with check (true);
drop policy if exists "haberler_update_auth" on haberler;
create policy "haberler_update_auth" on haberler for update to authenticated using (true) with check (true);
drop policy if exists "haberler_delete_auth" on haberler;
create policy "haberler_delete_auth" on haberler for delete to authenticated using (true);

-- GÖRSEL YÜKLEME İÇİN: Supabase Storage'da PUBLIC bir bucket oluştur → ad: "haberler".
-- (Dashboard > Storage > New bucket > Name: haberler, Public: açık.) Dosya yükleme /api/upload ile yapılır.
