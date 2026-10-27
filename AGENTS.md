<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Proje kuralları

## Dosyalar (Supabase Storage) — kovalar ÖZEL

`haberler` dışındaki bütün kovalar özeldir. Veritabanındaki adresler eski "public"
biçiminde kaldı; o adrese doğrudan gidilirse **400** döner.

- **Arayüzde:** dosya bağlantısı `dosyaUrl()` ile verilir (`lib/utils/dosya-url`) —
  oturumlu imzalı geçitten geçer.
- **Sunucuda:** dosya `storageIndir()` ile indirilir (`lib/api/storage-indir`) —
  service role ile iner. Sunucuda `fetch(<kayıtlı dosya adresi>)` YAZMA.

## Sessiz hata yok

Bir ek, belge ya da görsel indirilemiyorsa **işlemi sessizce tamamlama.** Mail
gönderiliyorsa ya gönderme ya da kullanıcıya eksik gittiğini söyle. 27.10.2026'da
kasko teklif maili ruhsat eki olmadan gitti; hata `catch`'te yutulduğu için kimse
fark etmedi, acente teklif veremedi. `catch { /* sessiz */ }` yazmadan önce iki kez
düşün: kullanıcı bu eksiği başka nasıl anlayacak?
