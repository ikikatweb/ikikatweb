-- Şantiye (iş deneyim belgesi) için ÇALIŞILMAYAN DÖNEM — HER YIL TEKRAR EDER (yıl YOK).
-- Gün+Ay olarak "AA-GG" metniyle saklanır (ör. "12-15" = 15 Aralık). Genel Bilgiler sekmesinde girilir.
-- Bordro Takibi'nde: seçili ayın ayı bu tekrar eden aralığa düşüyorsa o şantiyedeki personeller
-- GRİ + İTALİK gösterilir (gözden kaçmasın) — hem ekranda hem Excel/PDF çıktısında.
-- NOT: daha önce date olarak eklendiyse önce düşürülür (yıl içeren veri anlamsız).
alter table santiyeler drop column if exists calisilmayan_bas;
alter table santiyeler drop column if exists calisilmayan_bit;
alter table santiyeler add column if not exists calisilmayan_bas text; -- "AA-GG" (gün-ay, yıl yok)
alter table santiyeler add column if not exists calisilmayan_bit text; -- "AA-GG"
