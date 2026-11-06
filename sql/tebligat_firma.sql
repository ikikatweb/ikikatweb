-- TEBLİGAT → FİRMA BAĞI
--
-- Tebligatın hangi şirkete geldiğini ekranda FİRMANIN KENDİ RENGİYLE göstermek için.
-- Renk uydurulmaz: firmalar.renk sistemde zaten tanımlı, araç formunda da o kullanılıyor.
--
-- Bağ çekme işinde kuruluyor: UETS yanıtındaki recipient_name (şirketin tam unvanı)
-- firmalar.firma_adi ile eşleştiriliyor. Eşleşmezse NULL kalır ve iş bunu LOGA YAZAR —
-- sessizce boş geçilmez, yoksa tebligat renksiz görünür ve kimse sebebini bilmez.
alter table public.tebligat add column if not exists firma_id uuid references public.firmalar(id);
create index if not exists tebligat_firma_idx on public.tebligat (firma_id);
comment on column public.tebligat.firma_id is
  'Tebligatın geldiği firma. UETS recipient_name → firmalar.firma_adi eşleşmesiyle kurulur; eşleşmezse boş kalır.';
