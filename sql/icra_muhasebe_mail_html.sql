-- MUHASEBE CEVABININ ASLI (HTML)
--
-- NİYE: mailin yalnız düz metni saklanıyordu. HTML bir mail düz metne
-- çevrilince biçim dağılıyor — alıntılanan eski yazışma, tablolar ve satır
-- araları birbirine giriyor, okunmuyor (10.11.2026'da görüldü). Mailin aslı
-- saklanıp ayrı bir pencerede olduğu gibi gösteriliyor.
--
-- METİN DE KALIYOR: arama ve kısa gösterim için düz metin daha elverişli;
-- HTML yoksa (sade mail) metin gösteriliyor.
--
-- GÜVENLİK: bu HTML DIŞARIDAN GELİYOR. Ekranda yalnız sandbox'lı bir iframe
-- içinde gösteriliyor — betik çalıştırılmıyor, forma dönüştürülmüyor. Panelin
-- kendi sayfasına gömülseydi maille gelen betik panelde çalışırdı.
alter table public.icra add column if not exists muhasebe_cevap_mail_html text;
alter table public.icra_sirket_takip add column if not exists muhasebe_cevap_mail_html text;

comment on column public.icra.muhasebe_cevap_mail_html is
  'Muhasebe cevabının HTML aslı — yalnız sandbox iframe içinde gösterilir (dış kaynaklı içerik)';
comment on column public.icra_sirket_takip.muhasebe_cevap_mail_html is
  'Muhasebe cevabının HTML aslı — yalnız sandbox iframe içinde gösterilir (dış kaynaklı içerik)';
