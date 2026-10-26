-- KULLANICIYA ÖZEL GİZLENEN UYARILAR
--
-- Ana ekrandaki uyarı şeritlerinde "Anlaşıldı" düğmesi: kullanıcı onaylarsa o uyarı
-- KENDİSİNE bir daha gösterilmez. Başka kullanıcıları etkilemez.
--
-- Neden tarayıcı deposu (localStorage) değil: "kalıcı" istendi — kullanıcı başka
-- cihazdan/tarayıcıdan girdiğinde de kapalı kalmalı.
--
-- Anahtar biçimi: '<uyari-tipi>:<kayit-id>'  (ör. 'gecici-kabul-prim:<giden_evrak.id>')
-- Tip öneki sayesinde aynı sütun başka uyarılar için de kullanılabilir.

alter table kullanicilar
  add column if not exists gizlenen_uyarilar text[] not null default '{}'::text[];

comment on column kullanicilar.gizlenen_uyarilar is
  'Kullanıcının "Anlaşıldı" diyip kalıcı kapattığı uyarılar. Biçim: <uyari-tipi>:<kayit-id>';
