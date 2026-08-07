-- İhaleli iş bayrağı — İş Deneyim (santiyeler) formunda "İş Tanımları" yanındaki tik.
-- true (varsayılan) → ana sayfa "Projelerimiz" ve Bordro "Şantiye Özeti"nde görünür.
-- false → bu iki yerde gösterilmez. Mevcut tüm işler varsayılan true olur (davranış değişmez).
alter table santiyeler add column if not exists ihaleli boolean not null default true;
