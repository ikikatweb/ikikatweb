-- YER İMİ YOLU KALDIRILDI (09.11.2026) — yerine Excel aktarımı geldi.
--
-- Yer imi çalışıyordu (test edildi, kayıt yazdı) ama kurulumu kullanıcı için zahmetli:
-- yer imi çubuğunu açmak, javascript: adresini sürüklemek/yapıştırmak, her kullanıcının
-- kendi tarayıcısına kurması. Portal zaten "Excel'e Aktar" düğmesi veriyor; indir-bırak
-- hem daha az adım hem daha az kırılgan.
--
-- NİYE SADECE DURMUYOR DA SİLİNİYOR: yer imi kapısı (api/ketsis/portal-aktar) dışarıya
-- CORS ile açılmış TEK uçtu ve paylaşımlı anahtar geri okunabiliyordu. Kullanılmayacak
-- bir kapıyı açık bırakmak, kazanç olmadan risk taşımak demek. Excel aktarımı panelin
-- kendi oturumundan geçiyor, ayrı anahtara gerek yok.
--
-- Defterdeki portal sütunları KALIYOR (kurum, belge_turu, portal_teblig_tarihi): Excel
-- aktarımı da onları dolduruyor. portal_teblig_id artık yazılmıyor, eski kayıtlar için duruyor.

drop table if exists public.ketsis_portal_anahtar;
