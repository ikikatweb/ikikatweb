-- İCRA DOSYASINA ELLE YÜKLENEN TEBLİGAT BELGESİ
--
-- NEDEN: Üçüncü şahıs haciz dosyalarında tebligat belgesi, dosya esas numarası ile
-- UETS'ten gelen tebligat kaydı eşleştirilerek bulunuyordu (lib/api/icra-tebligat-belge).
-- Fiziki posta ile gelen icra yazısının UETS'te karşılığı YOK; bu dosyalarda belge
-- bulunamadığı için muhasebeye mail HİÇ gitmiyordu ("tebligat belgesi panelde yok").
-- Oysa kural açık: ek inmeden mail gitmez. Yani fiziki tebligatta süreç hiç başlamıyordu.
--
-- NE YAPAR: Kullanıcının taradığı/çektiği belgenin depodaki yolunu kayda bağlar.
-- Belge bağlıysa UETS araması yapılmaz, doğrudan bu dosya eklenir.
--
-- Şirkete açılan takip defterinde (icra_sirket_takip) aynı adla aynı alan zaten var;
-- iki defter artık aynı mantıkla çalışıyor.

alter table icra add column if not exists belge_yolu text;

comment on column icra.belge_yolu is
  'Elle yüklenen tebligat belgesinin depo yolu (fiziki posta ile gelen dosyalar için). Doluysa UETS eşleştirmesi yapılmaz.';
