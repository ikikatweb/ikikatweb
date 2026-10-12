-- NETSİM'DE YENİ AÇILAN İŞLEM NOKTALARI
--
-- Netsim'de yeni bir iş açıldığında sitede karşılığı (iş deneyim belgesi / şantiye) yoksa
-- bu fark edilmiyor: hakedişler Netsim'de işlendiği hâlde iş sitede hiç görünmüyor ve
-- tamamlanan keşif tutarı hiçbir yere akmıyor. Şu an böyle 64 nokta var.
--
-- Senkron artık gördüğü her noktayı buraya yazıyor. Bu tabloda OLMAYAN bir nokta çıkarsa
-- "yeni açılmış" demektir ve ana ekranda sorulur: "Netsim'de şu iş açıldı, iş deneyim
-- belgelerine ekleyelim mi?"
--
-- durum: 'bekliyor'  → ana ekranda sorulur
--        'eklendi'   → şantiye açıldı, santiye_id dolu
--        'yoksayildi'→ kullanıcı "hayır" dedi ya da ilk kurulumda zaten vardı
create table if not exists netsim_yeni_nokta (
  nokta_no     integer primary key,
  ad           text not null,
  ilk_gorulme  timestamptz not null default now(),
  durum        text not null default 'bekliyor',
  santiye_id   uuid references santiyeler(id) on delete set null,
  karar_veren  text,
  karar_at     timestamptz
);

comment on table netsim_yeni_nokta is
  'Netsim işlem noktalarının görülme kaydı — yeni açılanlar ana ekranda sorulur';

create index if not exists netsim_yeni_nokta_durum_idx on netsim_yeni_nokta (durum);
