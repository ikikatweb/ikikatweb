-- Canlı konum (arvento_anlik) ve cihaz eşlemesini (arvento_cihaz) TARAYICI doğrudan okusun →
-- /api/arvento/anlik ve /api/arvento/cihaz Vercel fonksiyonları sıcak yoldan tamamen çıkar
-- (Fluid Active CPU tasarrufu). Yazma hâlâ yalnız service-role (senkron script + Excel upload).
-- Bu çalıştırılana kadar tarayıcı boş alır ve otomatik API'ye düşer (bugünkü davranış, çalışır);
-- çalıştırınca Vercel'e istek gitmez.

create policy "anlik_authenticated_read"
  on public.arvento_anlik
  for select
  to authenticated
  using (true);

create policy "cihaz_authenticated_read"
  on public.arvento_cihaz
  for select
  to authenticated
  using (true);
