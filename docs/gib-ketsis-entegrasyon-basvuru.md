# GİB e-Tebligat (KETSİS) Kurumsal Entegrasyon — Başvuru Dosyası

Hazırlayan: panel ekibi · Tarih: 09.11.2026

Amaç: vergi dairesi ve kurum tebligatlarının panele **otomatik** düşmesi. Bugün bu iş
iki yarım yoldan yürüyor (aşağıda "Bugünkü durum"), entegrasyon onayı alınırsa ikisi de
gereksiz hale gelir.

---

## 1. Önce dürüst değerlendirme

**Başvurunun reddedilme ihtimali yüksek.** GİB bu yöntemi "yüksek sayıda e-tebligat alan
tüzel kişiler" için tanımlamış; örnek olarak bankalar veriliyor. Bizim hacmimiz:

| | |
|---|---|
| İkikat İnş. (VKN 4700614586) | 103 tebligat / 2019–2026 → **yılda ~15** |
| Kad-Tem Müh. (VKN 4860131760) | 138 okunmuş tebligat (portal sayacı) |

Bir banka günde bunun katını alıyor. Yine de başvurmanın maliyeti düşük, reddedilirse
bugünkü düzen çalışmaya devam ediyor. Karar sizin — bu dosya "hayır" cevabını da
kolaylaştırsın diye hazırlandı.

---

## 2. Kimler başvurabilir

- **Yalnız tüzel kişiler.** Şahsi (SHS) firma bu yöntemden yararlanamaz.
- Başvuru GİB onayına tabi; onay olmadan uç nokta açılmıyor.

Bizde tüzel kişi olan firmalar: İkikat İnş. Ltd. Şti., Kad-Tem Müh. A.Ş. ve diğer
limited/anonim şirketler. Her biri için ayrı başvuru gerekip gerekmediği GİB'e
sorulmalı — **bu dosyada varsayılmıyor.**

---

## 3. GİB'in istediği teknik şartlar

Başvuru formundan ve GİB belgelerinden çıkarılanlar:

1. **Web servis uç noktası HTTPS, 443 portu.** Geçerli DNS kaydı olacak.
2. **İstemci ve sunucu IP'leri yerel (local) OLMAYACAK**, internet adresi olacak.
3. **IP'ler Türkiye adres evreninde olacak.**
4. Test tanım formu ve BIS raporu **mali mühür sertifikasıyla** imzalanacak.

### Bu bizde ne demek — dikkat edilecek nokta

**Panel Vercel'de barınıyor; sabit IP'si yok ve Türkiye adres evreninde değil.**
Yani `ikikat.net` bu şartları KARŞILAMIYOR.

Bu daha önce PTT UETS'te de başımıza geldi ve çözümü biliniyor: **çekme işi ofisteki
makineden yapılıyor**, çünkü UETS yalnız kayıtlı IP'den çalışıyor. KETSİS entegrasyonu
da aynı şekilde kurulmalı:

- Uç nokta / istemci = **ofisteki makine** (zamanlanmış görevlerin çalıştığı makine).
- O makinenin **sabit ve Türkiye'de bir internet IP'si** olmalı. Bugün dinamik IP
  kullanılıyorsa **internet sağlayıcıdan sabit IP alınması gerekir** — başvurudan önce
  halledilecek iş budur.
- DNS kaydı: o IP'ye bakan bir alan adı (ör. `ketsis.ikikat.net`).

---

## 4. Başvuruda verilecek bilgiler (doldurulacak)

| Alan | Değer |
|---|---|
| Firma unvanı | … |
| VKN | … |
| Vergi dairesi | … |
| Yetkili ad soyad / unvan | … |
| İletişim e-posta / telefon | … |
| Web servis uç noktası (HTTPS, 443) | ör. `https://ketsis.ikikat.net/…` |
| Sunucu IP | … (Türkiye, sabit) |
| İstemci IP | … (Türkiye, sabit) |
| Mali mühür | mevcut / alınacak |
| Tahmini yıllık tebligat adedi | İkikat ~15, Kad-Tem ~20 |

---

## 5. Sorulacak sorular (GİB'e)

Bunlar **varsayılmadı**, sorulmalı:

1. "Yüksek sayıda alıcı" için sayısal bir eşik var mı? Yılda ~15-20 tebligat alan bir
   inşaat şirketi kapsama giriyor mu?
2. Entegrasyon firma (VKN) başına mı, yoksa grup olarak tek başvuruyla mı yapılıyor?
3. Alıcı tarafı için teknik doküman (uç nokta sözleşmesi, mesaj şeması) başvurudan önce
   paylaşılıyor mu? Şart listesini görmeden IP/DNS yatırımı yapmak istemiyoruz.
4. GİB bizim uç noktamıza **mı gönderiyor** (push), yoksa biz mi sorguluyoruz (pull)?
   Form "web servis uç noktası" istediğine göre push gibi duruyor; bu, ofis makinesinin
   dışarıdan erişilebilir olması demek — güvenlik tarafı buna göre planlanmalı.
5. Test ortamı var mı?

---

## 6. Bugünkü durum (entegrasyon olmasa da çalışan düzen)

Başvuru reddedilse bile elimizde şunlar var:

**a) GİB bildirim maili → otomatik** (09.11.2026'da kuruldu)
Mail 5 dakikada bir okunuyor; geldiğinde defter kaydı kendiliğinden açılıyor.
Tarihler mailin metninden okunuyor, tahmin edilmiyor:

> "… tarafından **27/10/2026** tarihinde gönderilen MC09462508 sayılı belge
> **01/11/2026** tarihinde tebliğ edilmiş sayılacaktır."

Portal Excel'iyle birebir tuttuğu doğrulandı.

**b) Portal Excel'i → elle, tam liste**
Dijital Vergi Dairesi › e-Tebligat › *Excel'e Aktar* → panele yükle. Geçmişin tamamını
getiriyor, mailin kaçırdığı olursa yakalıyor.

**Zayıf nokta:** (a) mailin gelmesine bağlı ve bilgilendirme maili hukuken tebligatın
parçası değil (VUK 107/A) — gelmeyebilir. Bu yüzden (b) ayda bir yapılmalı.
Entegrasyon onayı alınırsa ikisi de gereksiz kalır.

---

## 7. Neden portal otomasyonu kurulamadı (kayıt için)

09.11.2026'da Dijital Vergi Dairesi üzerinde keşif yapıldı:

1. **Girişte CAPTCHA var** → sunucu kendi başına giremiyor. Atlatma denenmedi.
2. **Oturum ~6-8 dakikada düşüyor** → "bir kere gir, gece çek" kurulamıyor.
3. **CORS** → panel, portalın servislerini tarayıcıdan okuyamıyor.

Bu üçü yüzünden vergi dairesi şifresini panelde saklamanın **hiçbir faydası yok**;
yalnız riski var. O yüzden saklanmıyor.

Portalın iç servisleri (kayıt amaçlı, resmî değil):
`POST /apigateway/etebligat/etebligat/tebligat-listele` — oturum anahtarı
`sessionStorage.token`'da, `Authorization` başlığıyla gidiyor.
