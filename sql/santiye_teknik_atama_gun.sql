-- Şantiye — teknik personel ATAMA SÜRESİ (gün). İşyeri tesliminden sonra teknik personelin bordro/işçilik
-- takibinde atanması için tanınan süre. Ana sayfa uyarısı: teslim + gün son tarihine kadar (geri sayım) ve
-- geçince (gecikti) teknik atama eksikse uyarır. Boş = takip yok. Bkz. components/shared/teknik-atama-hatirlatma.
alter table santiyeler add column if not exists teknik_atama_gun integer;
