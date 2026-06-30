-- Stabilize özetini TARAYICI doğrudan okusun (Vercel API'yi atla → ~2× hızlı). Bunun için
-- arvento_harita_ozet'e "authenticated SELECT" RLS politikası gerekir. (Yazma hâlâ yalnız service-role.)
-- Bu çalıştırılana kadar tarayıcı boş alır ve otomatik API'ye düşer (yavaş ama çalışır); çalıştırınca uçar.

create policy "ozet_authenticated_read"
  on public.arvento_harita_ozet
  for select
  to authenticated
  using (true);
