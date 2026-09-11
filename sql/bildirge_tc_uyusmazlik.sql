-- Bildirge TC uyuşmazlığı: gelen bildirgedeki TC, bekleyen talebin TC'si ile tutmuyorsa
-- kullanıcıya "TC hatalı girilmiş, düzelteyim mi?" diye sorulur (tarih uyuşmazlığındaki akışın aynısı).
--
-- 11.09.2026: Fatih SOYLU'nun kartı 10535968163 ile açıldı, sonra 10535968164 olarak düzeltildi.
-- Muhasebenin gönderdiği bildirge (10535968164_iseGiris.pdf) bekleyen talepteki eski TC ile
-- eşleşemedi ve SESSİZCE atlandı — kimse fark etmedi. Artık atlanmıyor, soruluyor.
--
-- Supabase SQL editöründe bir kez çalıştırın.

alter table personel_islem_takip
  add column if not exists bildirge_tc text;

comment on column personel_islem_takip.bildirge_tc is
  'TC uyuşmazlığında gelen bildirgedeki (doğru) TC. Kullanıcı onaylayınca talebin personel_tc''si bununla düzeltilir. uyusmazlik_tip = ''tc''.';
