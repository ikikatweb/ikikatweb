-- KETSİS: "TEBLİĞ EDİLMİŞTİR" TEYİT MAİLİ — SÜRE BAŞLADI BİLDİRİMİ
--
-- NİYE: GİB aynı belge için İKİ mail yolluyor (doğrulandı, 16.11.2026):
--   1) gönderildiği gün : "… 16/11/2026 tarihinde tebliğ edilmiş SAYILACAKTIR"
--   2) beşinci gün      : "… 16/11/2026 tarihinde tebliğ EDİLMİŞTİR"
-- İkincisi yeni belge değil; VUK 107/A'daki beş günün dolduğunun, yani sürenin
-- işlemeye başladığının teyidi. Yeni satır açmaz (belge numarasından tanınır) ama
-- kullanıcı kararıyla (17.11.2026) kısa bir "süre başladı" bildirimi atar.
--
-- BU SÜTUN NE İŞE YARAR: tarama aynı maili bir gün boyunca tekrar tekrar görüyor
-- (son tarihten bir gün geriye bakıyor). Teyit bir kez işlenince buraya yazılır,
-- bildirim İKİNCİ KEZ gitmez.

alter table public.ketsis_bildirim add column if not exists teblig_teyit_at timestamptz;

comment on column public.ketsis_bildirim.teblig_teyit_at is
  'GİB''in "tebliğ edilmiştir" teyit mailinin tarihi. Boşsa teyit maili henüz gelmedi/işlenmedi.';

-- GEÇMİŞ İÇİN BİLDİRİM YAĞMASIN: tebliğ günü geçmiş kayıtların teyit maili çoktan
-- gelmiştir; işlenmiş sayılır. Tebliğ günü ileride olanlar boş kalır, teyit maili
-- geldiğinde bildirim atılır.
update public.ketsis_bildirim
   set teblig_teyit_at = now()
 where teblig_teyit_at is null
   and (teblig_tarihi is null or teblig_tarihi <= current_date);
