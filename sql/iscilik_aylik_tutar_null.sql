-- İşçilik durum raporu: "Yüklenici / Alt Yüklenici Tutarı" alanlarına BİLEREK 0 girilebilsin.
-- Yeni mantık: null = "henüz girilmedi" (bordro tahmini gösterilir), 0 = kullanıcı bilerek 0 girdi ("0,00" gösterilir).
--
-- Eskiden yeni ay 0 ile açılıyordu ve 0 girilemiyordu (0 girince tahmin gösteriliyordu) → mevcut TÜM 0 satırları
-- aslında "girilmemiş" demek. Bunları null'a çeviriyoruz ki tahmin gösterimleri korunsun; gerçek 0 girişleri
-- bundan sonra ayrışsın. (Gerçek para tutarları hiç tam 0 olmadığı için bu dönüşüm güvenli.)

UPDATE iscilik_aylik SET yuklenici_tutar = NULL WHERE yuklenici_tutar = 0;
UPDATE iscilik_aylik SET alt_yuklenici_tutar = NULL WHERE alt_yuklenici_tutar = 0;
