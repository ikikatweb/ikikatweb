# İcra tablosunda karşılığı olmayan icra tebligatları

Çıkarılma tarihi: 09.11.2026 · Kaynak: `tebligat` ile `icra` tablolarının dosya esas
numarası üzerinden birebir karşılaştırılması.

**Yöntem ve sınırı:** tebligat konusundaki `YYYY/NNNNN` biçimindeki dosya numarası
alınıp `icra.dosya_esas_no` ile birebir eşleştirildi. Mahkeme ve hâkimlik tebligatları
(9 adet) listeden çıkarıldı — onların icra tablosunda yeri yok, eksik sayılmazlar.
Listedeki kayıtların **89/1 haciz ihbarnamesi olduğu doğrulanmadı**; icra dairesinden
başka yazılar da gelir ve hepsi icra kaydı gerektirmeyebilir. Belgeye bakılmadan
"eksik işlenmiş" denemez.

**UETS'te nasıl bulunur:** PTT UETS ekranında barkod numarasıyla aratın.

---

## Hiç açılmamış olanlar (6)

5 gün içinde açılmadığı için UETS otomatik "okundu" saymış. Kimse içeriğini görmemiş.

| Firma | İcra dairesi | Dosya | Barkod | Ulaşma |
|---|---|---|---|---|
| KAD | Ankara 7. Genel İcra Dairesi | 2026/27776 | `5002666925265` | 22.04.2026 |
| KAD | Ankara 7. Genel İcra Dairesi | 2026/27775 | `5002666923599` | 22.04.2026 |
| KAD | Ankara 7. Genel İcra Dairesi | 2026/27774 | `5002666883459` | 22.04.2026 |
| KAD | Kocaeli İcra Dairesi | 2026/342 | `5002393530176` | 26.01.2026 |
| KAD | Bakırköy Banka Alacakları İcra Dairesi | 2024/98571 | `5002358915376` | 15.01.2026 |
| KAD | Sivas İcra Dairesi | 2025/18135 | `5002144573612` | 27.10.2025 |

## Açılmış ama icra kaydı yok (8)

| Firma | İcra dairesi | Dosya | Barkod | Ulaşma |
|---|---|---|---|---|
| KAD | İstanbul Anadolu 1. Banka Alacakları İcra | 2024/57908 | `5002265646912` | 10.12.2025 |
| KAD | Gaziosmanpaşa İcra Dairesi | 2024/27828 | `5002191363228` | 13.11.2025 |
| IKI | Tokat İcra Dairesi | 2025/2443 | `5001503945718` | 31.01.2025 |
| KAD | Niğde İcra Dairesi | 2024/9687 | `5001283274732` | 23.10.2024 |
| IKI | Gaziantep İcra Dairesi | 2023/8211 | `5001063953741` | 27.06.2024 |
| KAD | İstanbul Anadolu 14. İcra Dairesi | 2017/26600 | `5000764773467` | 11.01.2024 |
| KAD | Diyarbakır İcra Dairesi | 2020/35115 | `4005113084059` | 18.11.2021 |
| IKI | Ankara 33. İcra Dairesi | 2020/34507 | `4004537131233` | 22.03.2021 |

---

## Not

Hepsi `read` ya da `readtimeout` durumunda — yani tebligat zaten açılmış sayılıyor.
İndirmek yeni bir hukuki sonuç doğurmaz, yalnız belgeyi getirir. Panelden "Belgeleri
getir" ile de indirilebilir; bu liste UETS'ten doğrudan indirmek isteyenler için.
