// HAKKINDA — sistemin ne olduğunu, neyi neden yaptığını anlatan bilgi sayfası.
// Veri içermez, sorgu atmaz; herkese açıktır (bkz. sidebar canView istisnası).
import {
  Briefcase, MailOpen, Shield, Satellite, FileBarChart2, Wrench, ClipboardList,
  Fuel, Wallet, NotebookPen, Settings, Link2, Users, Clock, Database,
  ShieldCheck, Lightbulb, AlertTriangle, Smartphone, Server, Route,
} from "lucide-react";

type Modul = { ad: string; aciklama: string };
type Grup = { baslik: string; ikon: React.ReactNode; renk: string; seritRenk: string; moduller: Modul[] };

const GRUPLAR: Grup[] = [
  {
    baslik: "Büro Yönetimi",
    ikon: <Briefcase size={18} />,
    renk: "bg-slate-100 text-slate-700",
    seritRenk: "bg-slate-500",
    moduller: [
      { ad: "İşçilik Durum Raporu", aciklama: "Her iş için SGK asgari işçilik primi takibi. Sözleşme bedeli, ek sözleşme bedeli, fiyat farkı ve tahmini fiyat farkından yatması gereken prim hesaplanır; yatanla ve bordro tahminiyle karşılaştırılır. Eksik prim varsa geçici kabul tarihi girilirken uyarı çıkar." },
      { ad: "Bordro Takibi", aciklama: "Personelin hangi ay hangi şantiyede olduğu, günlük/brüt ücretleri ve aylık bordro tahmini. İşçilik primi hesabının bordro ayağı buradan gelir. Her iş için SGK prim dengesi iki yönlü izlenir: bitime kadar prim dolmayacaksa kaç kişi eklenmeli, erken dolacaksa kaç kişi çıkarılabilir — fazla ödeme de para kaybıdır." },
      { ad: "Ödeme Planı", aciklama: "Vadesi gelen ödemelerin takvimi." },
      { ad: "Kredi Kartları", aciklama: "Şirket kartlarının limit, ekstre ve harcama takibi." },
      { ad: "İcra Dosyaları", aciklama: "Üçüncü şahıs haciz yazıları ve şirkete açılan takipler. Yazı sisteme girer girmez muhasebeye kendiliğinden mail gider (tebligat eki ekli) — borcumuz olup olmadığını onlar çıkarır. Muhasebenin cevabı e-posta kutusundan okunup dosyaya iliştirilir; satırdaki iki ikondan hangi aşamada olduğu görülür. Cevap yazısı avukata ek dosyalarla birlikte gönderilebilir, yasal süre geri sayılır." },
      { ad: "Sınır Değer Hesabı", aciklama: "İhalede sınır değer ve aşırı düşük sorgulaması hesabı." },
    ],
  },
  {
    baslik: "Yazışmalar",
    ikon: <MailOpen size={18} />,
    renk: "bg-emerald-50 text-emerald-700",
    seritRenk: "bg-emerald-500",
    moduller: [
      { ad: "Gelen / Giden Evrak", aciklama: "Kurum yazışmalarının kayıt altına alınması, numaralandırılması ve aranması." },
      { ad: "Banka Yazışmaları", aciklama: "Teminat mektubu ve kredi yazışmaları ayrı tutulur." },
      { ad: "Tebligatlar", aciklama: "Tek ekranda İKİ AYRI resmî tebligat sistemi. Üstte PTT UETS (mahkeme ve icra): tebligatlar iki saatte bir çekilir, menüdeki kırmızı rozet açılmamışları sayar. Tebligatı AÇMAK geri alınamaz — indirilen paket okunmuş sayılır — o yüzden yalnız kullanıcı \"aç ve oku\" dediğinde indirilir ve kimin istediği kayda geçer. İcra tebligatı açıldığında belgeden dosya no, alacaklı, borçlu ve tutar okunup icra sayfasına taslak satır düşer. Altta GİB KETSİS (vergi dairesi): alıcı tarafı için API olmadığından belge yalnız Dijital Vergi Dairesi ekranından görülür; sistem GİB'in bilgilendirme mailini yakalar, mail hiç gelmese de haftada bir \"gidip bak\" hatırlatması çıkar — çünkü mailin gelmemesi tebligat süresini durdurmaz." },
      { ad: "Silinen", aciklama: "Silinen evrak burada bekler; yanlışlıkla silinen geri alınabilir." },
    ],
  },
  {
    baslik: "Kasko & Sigorta",
    ikon: <Shield size={18} />,
    renk: "bg-blue-50 text-blue-700",
    seritRenk: "bg-blue-500",
    moduller: [
      { ad: "Araç Listesi", aciklama: "Her aracın trafik sigortası, kasko ve muayene bitiş tarihleri. Süresi dolana yaklaşanlar ana sayfada uyarı verir, geçmiş olanlar kırmızı şeritle en üste çıkar." },
      { ad: "Belgeler", aciklama: "Poliçe ve muayene belgelerinin saklandığı yer." },
      { ad: "Acente Raporu", aciklama: "Hangi acenteye ne kadar kasko ve trafik primi ödendiği." },
    ],
  },
  {
    baslik: "Araç Takip",
    ikon: <Satellite size={18} />,
    renk: "bg-sky-50 text-sky-700",
    seritRenk: "bg-sky-500",
    moduller: [
      { ad: "Araç Çalışma Raporu", aciklama: "Arvento GPS cihazlarından gelen günlük güzergâh, çalışma süresi, mesafe ve damper sayıları. Stabilize serme, reglaj ve sıkıştırma gibi işler harita üzerinde ayrı ayrı izlenir." },
      { ad: "Harita ve araç arama", aciklama: "Bir günde 20-30 aracın izi aynı haritada çizilir; her araç ayrı renktedir. Plaka (son haneleri de yeter), marka, model ya da \"greyder\" gibi araç sınıfı yazılınca aranan araç bulunur ve haritanın tam ortasına, son bilinen konumuna odaklanılır." },
      { ad: "İş makinesi çalışma saati", aciklama: "İş makinelerinde kilometre anlamsızdır; gösterge saati esastır. Cihazdan gelen kontak süresinden günlük saat projeksiyonu üretilir, araç kartındaki gösterge değeri buna göre ilerletilir. Bakım ve yakıt denetimi bu saatten hesaplanır." },
    ],
  },
  {
    baslik: "Maliyet Raporu",
    ikon: <FileBarChart2 size={18} />,
    renk: "bg-rose-50 text-rose-700",
    seritRenk: "bg-rose-500",
    moduller: [
      { ad: "Sezon Maliyeti", aciklama: "Bir sezonun toplam maliyetinin kalem kalem dökümü. Yalnız yöneticiye açıktır." },
    ],
  },
  {
    baslik: "Araç Bakım",
    ikon: <Wrench size={18} />,
    renk: "bg-cyan-50 text-cyan-700",
    seritRenk: "bg-cyan-500",
    moduller: [
      { ad: "Bakım, Tamirat, Yedek Parça", aciklama: "Yapılan her iş; tarihi, kilometresi, tutarı ve yaptıran kişisiyle kayıt altında. Sonraki bakım km'si veya tarihi yaklaşınca hatırlatma çıkar." },
      { ad: "Araç Listesi", aciklama: "Filodaki araçların bakım durumuna göre topluca görünümü." },
    ],
  },
  {
    baslik: "Puantaj",
    ikon: <ClipboardList size={18} />,
    renk: "bg-purple-50 text-purple-700",
    seritRenk: "bg-purple-500",
    moduller: [
      { ad: "Personel Puantaj", aciklama: "Kim hangi gün hangi şantiyede çalıştı. Bordro ve işçilik primi hesabının temeli." },
      { ad: "Araç Puantaj", aciklama: "Araç ve iş makinelerinin günlük durumu (çalıştı, yarım gün, arızalı, operatör yok, tatil, dış görev). Bir araç bir günde yalnız tek şantiyede puantajlanabilir. Kira hesabı, özet rapor ve yakıt denetlemesi bu veriden çıkar." },
    ],
  },
  {
    baslik: "Yakıt",
    ikon: <Fuel size={18} />,
    renk: "bg-red-50 text-red-700",
    seritRenk: "bg-red-500",
    moduller: [
      { ad: "Yakıt Hareketleri", aciklama: "Depoya alınan yakıt, araçlara dağıtımı ve şantiyeler arası virman. Her dolumda sayaç değeri girilir; sistem bundan tüketim ortalamasını (L/100km veya L/saat) hesaplar ve araç cinsine tanımlı limitlerin dışına çıkanı işaretler. Depo sayımında fark çıkarsa ± düzeltme kaydı girilir." },
      { ad: "Kaydın konumu", aciklama: "Araca yakıt verilirken telefonun konumu zorunlu olarak alınır ve aracın o andaki GPS konumuyla karşılaştırılır. İki nokta arasındaki YOL mesafesi (kuşbakışı değil) kayıt anında hesaplanıp saklanır; haritada araçtan kayda yol tarifi olarak açılır. Konum alınmadan ilk girişte kişiye KVKK aydınlatma metni okutulur, onayı adı, cihazı, IP'si ve metnin tamamıyla saklanır." },
    ],
  },
  {
    baslik: "Kasa",
    ikon: <Wallet size={18} />,
    renk: "bg-teal-50 text-teal-700",
    seritRenk: "bg-teal-500",
    moduller: [
      { ad: "Kasa Hareketleri", aciklama: "Günlük nakit giriş çıkışı ve kasa defteri; satır satır kümülatif bakiye ve önceki dönemden devreden tutar görünür." },
      { ad: "Kullanıcı özeti", aciklama: "Kimde ne kadar nakit var — ana sayfada kişi kişi bakiye. Bakiye kişiye aittir, şantiyeye değil: devir dahil, ve kim bakarsa baksın aynı rakamı görür." },
    ],
  },
  {
    baslik: "Şantiye Defteri",
    ikon: <NotebookPen size={18} />,
    renk: "bg-indigo-50 text-indigo-700",
    seritRenk: "bg-indigo-500",
    moduller: [
      { ad: "Günlük Kayıtlar", aciklama: "Sahadan günlük not, hava durumu ve yapılan iş kayıtları. Şantiyede çalışılmayan dönemler (kış tatili gibi) burada tanımlı dönemle birlikte yürür; prim ve puantaj hesapları o günleri saymaz." },
    ],
  },
  {
    baslik: "Ayarlar",
    ikon: <Settings size={18} />,
    renk: "bg-[#1E3A5F]/10 text-[#1E3A5F]",
    seritRenk: "bg-[#1E3A5F]",
    moduller: [
      { ad: "Kullanıcılar", aciklama: "Kullanıcı açma ve modül bazında yetkilendirme. Yalnız yönetici erişir. Bir kullanıcı başka birinin kopyası olarak açılabilir: kaynağa sonradan verilen yetkiler kopyalara da kendiliğinden geçer. Listede her kişinin e-posta adresinin doğrulanıp doğrulanmadığı görünür — doğrulanmamışsa doğrulama maili oradan gönderilir. Konum sütunu kimin aydınlatmayı onayladığını, kimin izni reddettiğini ayırır." },
      { ad: "Firmalar", aciklama: "Grup firmaları ve ortaklıklar; her firmanın kendi rengi vardır, listelerde bu renkle ayrışır." },
      { ad: "İş Deneyim Belgeleri", aciklama: "İşlerin (şantiyelerin) kartı: sözleşme bedeli, ihale ve sözleşme tarihleri, iş süresi, süre uzatımları, geçici ve kesin kabul tarihleri." },
      { ad: "Personeller", aciklama: "Personel kartları, öğrenim bilgileri, teknik personel atamaları." },
      { ad: "Araçlar", aciklama: "Araç kartları: plaka, cins, sayaç tipi (km/saat), 1 depo menzili, sahiplik (özmal/kiralık)." },
      { ad: "Yi-ÜFE", aciklama: "Fiyat farkı hesabında kullanılan Yurt İçi Üretici Fiyat Endeksi tablosu." },
      { ad: "Tanımlamalar", aciklama: "Açılır listelerin içeriği: görevler, meslekler, araç cinsleri, yakıt limitleri." },
      { ad: "Bizden Haberler", aciklama: "Kurumsal sitede yayımlanan haber ve duyurular buradan yönetilir. Haber görselleri herkese açık kovada durur — sitenin oturumsuz gösterebilmesi için; panelin diğer bütün dosyaları özeldir." },
      { ad: "Veri Yedeği", aciklama: "Verinin dışa aktarımı. Yalnız yöneticiye açıktır." },
    ],
  },
];

const ENTEGRASYONLAR = [
  {
    ad: "Netsim / Ofisnet",
    renk: "border-sky-300 bg-sky-50",
    baslikRenk: "text-sky-800",
    metin: "Şirket ağındaki ön muhasebe programından (Firebird veritabanı) 15 dakikada bir hakediş tutarları çekilir: tamamlanan keşif ve alınan fiyat farkı. Site bu rakamları kendi kaydıyla karşılaştırır. Bir tutar Netsim'den geldiyse yanında mavi \"N\" rozeti çıkar; elle değiştirirseniz rozet düşer, bir sonraki senkronda Netsim'in değeri geri yazılır ve rozet geri gelir. Yani rozet \"bu rakama kimse elle dokunmadı\" demektir.",
  },
  {
    ad: "Arvento GPS",
    renk: "border-indigo-300 bg-indigo-50",
    baslikRenk: "text-indigo-800",
    metin: "Araçlardaki takip cihazlarından günlük güzergâh, mesafe, çalışma süresi ve damper sayıları alınır. Geçmiş günlerin rotası değişmediği için tarayıcıda saklanır; ağdan yalnız yeni günler iner.",
  },
  {
    ad: "E-posta (IMAP) — gelen kutusu okunur",
    renk: "border-emerald-300 bg-emerald-50",
    baslikRenk: "text-emerald-800",
    metin: "Posta kutusu sistemin sessiz veri kaynağıdır. SGK bildirgeleri, Arvento raporları, muhasebenin icra cevapları ve vergi dairesinin KETSİS bilgilendirme mailleri kutudan okunur; ekleri indirilip ilgili personel, araç ya da dosyayla eşleştirilir. Bir ek inmiyorsa işlem sessizce tamamlanmaz — eksik gittiği söylenir.",
  },
  {
    ad: "UETS (PTT e-Tebligat)",
    renk: "border-rose-300 bg-rose-50",
    baslikRenk: "text-rose-800",
    metin: "Ulusal Elektronik Tebligat Sistemi'ndeki tebligatlar iki saatte bir çekilir; gönderen, konu, ulaşma ve tebliğ tarihleri panele işlenir. TEBLİGATI AÇMAK GERİ ALINAMAZ — indirilen paket okunmuş sayılır, o yüzden açma işi yalnız kullanıcının açıkça istediği kayıtta yapılır ve kimin istediği kayda geçer. UETS yalnız PTT'de tanımlı sabit IP'den cevap verdiği için indirme ofisteki bilgisayardan yürür; panel isteği kuyruğa yazar.",
  },
  {
    ad: "Harita ve yol mesafesi",
    renk: "border-teal-300 bg-teal-50",
    baslikRenk: "text-teal-800",
    metin: "Yakıt kaydının girildiği yer ile aracın o anki konumu arasındaki YOL mesafesi açık rota servisinden alınır; harita uydu görüntüsüyle panel içinde küçük bir pencerede açılır. Hesaplanamazsa uydurulmaz, kuşbakışı mesafeye düşülür ve bu ekranda belli olur.",
  },
  {
    ad: "Belge okuma",
    renk: "border-violet-300 bg-violet-50",
    baslikRenk: "text-violet-800",
    metin: "Taranmış belgeler elle okunup forma geçirilmek yerine makineye okutulur. İş deneyim belgesi yüklendiğinde sözleşme bedeli, tarihler ve ortaklık oranı önerilir; icra tebligatı açıldığında dosya no, alacaklı, borçlu ve tutar çıkarılır. ÖNERİ KENDİLİĞİNDEN YAZILMAZ: her değer, belgede okunduğu SATIRLA birlikte gösterilir ve kullanıcı onaylar — taranmış belgelerde satır karışabildiği için bu şart.",
  },
  {
    ad: "Push Bildirim",
    renk: "border-amber-300 bg-amber-50",
    baslikRenk: "text-amber-800",
    metin: "Sigorta ve muayene bitişi, eksik bilgi, yaklaşan bakım gibi durumlar telefona anlık bildirim olarak düşer. Uygulama telefona kurulabilir (PWA); ayrı bir mağaza kurulumu gerekmez.",
  },
];

const OTOMATIK_ISLER = [
  { ad: "Arvento anlık konum", sure: "Dakikada bir", ne: "Araçların o anki konumu — yakıt kaydının konumu bununla karşılaştırılır" },
  { ad: "Arvento rapor / damper", sure: "Dakikada bir", ne: "Gün içi çalışma raporu ve damper sayıları" },
  { ad: "Bildirge okuma", sure: "2 dakikada bir", ne: "Posta kutusundan SGK işe giriş/çıkış bildirgelerinin alınıp TC ile eşleştirilmesi" },
  { ad: "Sigorta teklif maili", sure: "2 dakikada bir", ne: "Acentelerden gelen tekliflerin okunup poliçe kartına işlenmesi" },
  { ad: "KETSİS mail kontrolü", sure: "5 dakikada bir", ne: "Vergi dairesi tebligatının bilgilendirme mailinin yakalanması" },
  { ad: "Tebligat açma istekleri", sure: "5 dakikada bir", ne: "Panelden \"aç ve oku\" denen tebligatın PTT'den indirilmesi — geri alınamaz işlem" },
  { ad: "Arvento güzergâh", sure: "15 dakikada bir", ne: "Gün içi rota izleri" },
  { ad: "Netsim senkronu", sure: "15 dakikada bir", ne: "Hakediş tutarları ve yeni açılan işlerin eşleştirmesi" },
  { ad: "İcra muhasebe cevabı", sure: "15 dakikada bir", ne: "Muhasebenin icra yazısına verdiği cevabın ekleriyle birlikte dosyaya iliştirilmesi" },
  { ad: "UETS tebligat", sure: "2 saatte bir", ne: "PTT e-Tebligat kutusunun taranması; yeni tebligat panele düşer" },
  { ad: "Bildirim budama", sure: "Ayın 1'i 03:20", ne: "60 günden eski bildirimlerin temizlenmesi" },
  { ad: "Geçmiş güzergâh tamamlama", sure: "Her gün 03:40", ne: "Eksik kalan eski günlerin rota verisinin doldurulması" },
  { ad: "Yaklaşan uyarılar", sure: "Her sabah 08:00", ne: "Sigorta, muayene, bakım ve kabul tarihlerinin taranıp bildirime dönüşmesi" },
  { ad: "Yi-ÜFE çekimi", sure: "Ayın 3-6'sı 11:00", ne: "TÜİK endeksinin fiyat farkı hesabı için alınması (endeks açıklanana kadar denenir)" },
  { ad: "Veri yedeği", sure: "Cumartesi 12:00", ne: "Tüm verinin yerel diske ŞİFRELİ olarak yedeklenmesi" },
  { ad: "Arvento gece raporu", sure: "Her akşam 21:00", ne: "Arvento'nun mail ile gönderdiği günlük Excel raporunun içe aktarılması" },
  { ad: "Makine saati", sure: "Her gece 22:00", ne: "İş makinelerinin gösterge saatinin kontak süresinden ilerletilmesi" },
];

/** Görev çökerse haber verilir — sessizce durmasın. */
const GOREV_NOTU = "Saatler Türkiye saatidir. Bu işlerden biri çalışmazsa sebebi "
  + "sınıflandırılıp bildirime dönüşür: \"sunucu bakımda\", \"bağlantı kurulamadı\", "
  + "\"yetki/anahtar sorunu\" gibi. Zamanlayıcı \"başarılı\" dese bile betik içeride "
  + "çökmüş olabilir; o yüzden sonuç görevin kendi günlüğünden okunur.";


const UYARILAR = [
  {
    ad: "SGK primi dolmayacak / fazla ödeniyor",
    nokta: "bg-red-500",
    metin: "Her iş için yatması gereken prim ile yatan ve bordro tahmini sürekli karşılaştırılır. Bitime kadar prim dolmayacaksa \"kaç kişi eklenmeli\", erken dolacaksa \"kaç kişi çıkarılmalı\" yazar. Hesap takvim günü değil ÇALIŞILAN gün üzerinden yapılır (şantiyenin kış tatili düşülür) ve sözleşme gereği kalması gereken teknik personel sayısının altına inilmesi önerilmez.",
  },
  {
    ad: "Geçici kabul dilekçesi verildi ama prim eksik",
    nokta: "bg-amber-500",
    metin: "Giden evraklar taranır; bir işe geçici kabul dilekçesi verilmişse ve o işin primi hâlâ eksikse uyarı çıkar. Dilekçe metni uyarının içinden okunabilir. Kullanıcı durumu gördüyse \"Anlaşıldı\" diyerek uyarıyı kendisi için kapatabilir.",
  },
  {
    ad: "SGK primi girilmemiş işler",
    nokta: "bg-amber-500",
    metin: "Ana ekrandaki kart, devam eden işlerde geçen ayın SGK prim tutarının muhasebeden alınıp girilmediğini gösterir. Liste kalabalıklaşıp gerçek eksiği gizlemesin diye iki tür iş gösterilmez. Fiilen bitmiş iş: geçici kabul dilekçesi verilmiş ya da sözleşme süresi dolmuş ve primi girilmiş son aydan bu yana üstünde hiç sigortalı personel çalışmamış. Henüz başlamamış iş: yer teslim tarihi girilmemiş, hiç prim girilmemiş ve hiç personel atanmamış. Girilmemiş bir ayda tek kişi bile çalışmışsa iş listede kalır. Gösterilmeyen işler kartın altında \"5 iş fiilen bitmiş, 1 iş henüz başlamamış\" diye sayılır; üstüne gelince hangi iş, neden elendi görünür.",
  },
  {
    ad: "Teknik personel ataması eksik",
    nokta: "bg-purple-500",
    metin: "Sözleşmede şartı olan teknik personel (inşaat mühendisi, harita mühendisi vb.) o işe atanmamışsa ya da çıkmışsa bildirilir.",
  },
  {
    ad: "Sigorta, muayene ve bakım tarihleri",
    nokta: "bg-blue-500",
    metin: "Trafik sigortası, kasko ve muayene bitişine kalan gün sayısı izlenir; kasko için ayrı bir eşik tanımlanabilir. Bakımda ise hem tarih hem kilometre/saat eşiği izlenir.",
  },
  {
    ad: "Yakıt tüketimi normalin dışında",
    nokta: "bg-orange-500",
    metin: "Her dolumda girilen sayaç değerinden tüketim ortalaması (L/100km veya L/saat) hesaplanır; araç cinsine tanımlı alt-üst sınırın dışına çıkan dolum işaretlenir. Araç çalıştı görünüp hiç yakıt almadıysa bu da çelişki olarak görünür.",
  },
  {
    ad: "Bekleyen SGK bildirgesi",
    nokta: "bg-emerald-500",
    metin: "İşe giriş/çıkış için muhasebeye mail gönderilir; cevap bildirgesi e-posta kutusundan otomatik okunup TC ve tarihle eşleştirilir. Cevabı gelmeyen işlemler \"bildirge bekleniyor\" olarak listelenir. Bildirgedeki TC kayıttakiyle tutmazsa düzeltme önerilir.",
  },
  {
    ad: "Netsim ile ayrışma",
    nokta: "bg-sky-500",
    metin: "Ön muhasebedeki hakediş tutarı ile sitedeki kayıt ayrışırsa rapor uyarır; hangi rakamın elle değiştirildiği rozetten anlaşılır.",
  },
  {
    ad: "İcra yazısı geldi, muhasebe cevabı bekleniyor",
    nokta: "bg-indigo-500",
    metin: "Yeni bir haciz yazısı girildiğinde muhasebeye kendiliğinden mail gider ve ana ekranda \"cevap bekleniyor\" olarak durur. Muhasebenin cevabı posta kutusundan okunup dosyaya iliştirilince ikon değişir. Yasal cevap süresi geri sayılır; son güne yaklaşan dosya öne çıkar.",
  },
  {
    ad: "Vergi dairesi tebligatına bakılmadı",
    nokta: "bg-amber-600",
    metin: "GİB tebligatı panelden açılamıyor — belge yalnız Dijital Vergi Dairesi'nde. Bilgilendirme maili yakalandıysa uyarı çıkar; mail hiç gelmese de haftada bir hatırlatılır, çünkü mailin gelmemesi tebligatın olmadığı anlamına gelmez.",
  },
  {
    ad: "Yakıt kaydı araçtan uzakta girildi",
    nokta: "bg-rose-500",
    metin: "Dolum kaydının girildiği yer ile aracın o anki GPS konumu karşılaştırılır. Aradaki yol mesafesi ekranda yazar; eşiği aşan kayıt işaretlenir. Araçta cihaz yoksa bu da açıkça söylenir — \"uzak değil\" diye geçiştirilmez.",
  },
  {
    ad: "Okunmamış tebligat",
    nokta: "bg-cyan-500",
    metin: "UETS'te açılmamış tebligat varsa menüdeki satırda kırmızı rozet durur ve ana ekran uyarır. Rozet LİSTEYİ GÖRÜNCE DÜŞMEZ: burada \"açmak\" tebligatı UETS'te açmak demektir ve süre açılsa da açılmasa da işler (7201 s. K. 7/a). Tebligat açılınca rozet kendiliğinden iner.",
  },
  {
    ad: "Avukattaki dosyanın son günü geldi",
    nokta: "bg-fuchsia-500",
    metin: "Dosyayı avukata göndermek işi bitirmiyor; sonrası panelde görünmüyor. Gönderilip unutulan dosya süresi dolduğunda kimsenin haberi olmadan kapanabiliyor. Son gün geldiğinde ekran tek bir şey soruyor: ne oldu?",
  },
  {
    ad: "Bordro gönderilmedi",
    nokta: "bg-lime-600",
    metin: "Her ayın 1'inden itibaren, biten ayın bordrosu muhasebeye gönderilene kadar hatırlatma durur. Yalnız bordro yetkisi olanlara gösterilir; gönderildiği an kaybolur.",
  },
  {
    ad: "Haftalık yedek alınmadı",
    nokta: "bg-teal-600",
    metin: "Cumartesi günü yedek alınmamışsa uyarı çıkar. Durum paylaşımlıdır: biri yedeği alınca uyarı HERKESTE kalkar, aynı iş iki kez yapılmaz.",
  },
  {
    ad: "Şantiyede çalışılmayan dönem başladı",
    nokta: "bg-slate-600",
    metin: "Kış tatili gibi çalışılmayan dönemler şantiye kaydında gün-ay olarak tutulur ve her yıl tekrar eder. Dönem başlayınca hatırlatılır — prim ve puantaj hesapları o günleri saymıyor.",
  },
  {
    ad: "İşçilik takibinde sicil no / oran eksik",
    nokta: "bg-amber-500",
    metin: "İhaleli ve aktif bir iş açıldıktan sonra SGK sicil numarası ya da asgari işçilik oranı girilmemişse uyarı çıkar — bu ikisi olmadan prim hesabı yapılamaz. Değerler uyarının içinden girilip kaydedilebilir.",
  },
  {
    ad: "Sözleşme tarihi girilmedi",
    nokta: "bg-stone-500",
    metin: "\"Henüz sözleşme imzalanmadı\" diye boş bırakılan aktif işlerde, kayıttan bir hafta sonra tarihin girilmesi hatırlatılır. İş süresi ve bitim tarihi bu tarihten yürüyor.",
  },
  {
    ad: "Poliçe, istenen teklifle uyuşmuyor",
    nokta: "bg-blue-600",
    metin: "Acenteden gelen poliçe PDF'i mailden okunup kendiliğinden kaydediliyor. Kesilen poliçe, poliçeleştirilmesi istenen teklifle tutmuyorsa (başka firma ya da başka rakam) uyarı çıkar.",
  },
  {
    ad: "Netsim'de yeni iş açılmış",
    nokta: "bg-sky-600",
    metin: "Ön muhasebede yeni bir işlem noktası açılmış ama sitede karşılığı yoksa bildirilir — iş deneyim belgesi açılmadan hakediş rakamları bağlanamaz.",
  },
  {
    ad: "Süresi dolmuş işler",
    nokta: "bg-gray-500",
    metin: "Bitim tarihi geçtiği hâlde kabul, tasfiye ya da devir işlemi yapılmamış işler listenin altında soluk olarak ayrışır; geçici kabul dilekçesi verilip verilmediği rozetle görünür.",
  },
];

const ROLLER = [
  {
    ad: "Yönetici",
    renk: "border-[#1E3A5F] bg-[#1E3A5F]/5",
    rozet: "bg-[#1E3A5F] text-white",
    metin: "Her şeye erişir. Maliyet Raporu ve Veri Yedeği yalnız bu rolde açıktır. Kullanıcı açma ve yetki verme de buradan yapılır.",
  },
  {
    ad: "Şantiye Admini",
    renk: "border-amber-400 bg-amber-50",
    rozet: "bg-amber-500 text-white",
    metin: "Yalnız atandığı şantiyeleri görür — ama o şantiyelerdeki bütün kullanıcıların kayıtlarını görür. Hangi modüllere gireceği izin matrisiyle belirlenir.",
  },
  {
    ad: "Kısıtlı Kullanıcı",
    renk: "border-slate-300 bg-slate-50",
    rozet: "bg-slate-500 text-white",
    metin: "Yalnız kendi girdiği kayıtları görür. Bazı ekranlarda geçmişe dönük görüntüleme de gün sayısıyla sınırlandırılabilir.",
  },
];

export default function HakkindaPage() {
  return (
    <div className="max-w-5xl mx-auto pb-12">
      {/* ---------- GİRİŞ ---------- */}
      <div className="rounded-xl bg-gradient-to-br from-[#1E3A5F] to-[#2c5278] text-white p-6 sm:p-8 mb-6 shadow-lg">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 mb-2">
          Hakkında
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold leading-tight mb-3">
          İkikat Yönetim Sistemi
        </h1>
        <p className="text-white/85 leading-relaxed max-w-3xl">
          Kamu ihaleli inşaat, arazi toplulaştırma ve kadastro işleri yürüten bir taahhüt şirketinin
          <strong className="text-white"> bürosunu, şantiyesini, araç filosunu ve parasını </strong>
          tek yerden yöneten sistem. İşin ihaleye girişinden kesin kabulüne kadar geçen her aşama —
          sözleşme, personel, araç, yakıt, hakediş, prim ve maliyet — aynı veri tabanında tutulur.
        </p>
        <div className="flex flex-wrap gap-2 mt-5">
          {["Her yerden erişim", "Telefona kurulabilir", "Anlık bildirim", "Rol bazlı yetki", "Şifreli yedek", "Kendiliğinden çalışan görevler"].map((t) => (
            <span key={t} className="text-[11px] font-semibold bg-white/15 border border-white/20 px-2.5 py-1 rounded-full">
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* ---------- TEMEL FİKİR ---------- */}
      <section className="mb-8 rounded-xl border-2 border-[#F97316]/30 bg-orange-50 p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="h-8 w-8 rounded-lg bg-[#F97316] text-white flex items-center justify-center flex-shrink-0">
            <Lightbulb size={18} />
          </span>
          <h2 className="text-lg font-bold text-[#7c2d12]">Sistemin temel fikri</h2>
        </div>
        <p className="text-[15px] text-[#7c2d12]/90 leading-relaxed mb-3">
          Bu sistem yalnız veri saklamak için kurulmadı. Asıl amacı
          <strong> aynı gerçeği iki ayrı kaynaktan görüp aralarındaki çelişkiyi yakalamak.</strong>
          {" "}Bir rakam tek yerde duruyorsa doğru olup olmadığı anlaşılmaz; iki yerde duruyorsa
          tutmadığı an kendini belli eder.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {[
            { a: "Puantaj ↔ Yakıt", b: "Araç çalıştı görünüyor ama arada hiç yakıt almamışsa ya kayıt eksiktir ya puantaj yanlıştır." },
            { a: "Site ↔ Netsim", b: "Sitedeki tamamlanan keşif ile ön muhasebedeki tutar ayrışıyorsa rapor uyarır." },
            { a: "Prim ↔ Bordro", b: "Yatması gereken prim ile yatan ve bordro tahmini tutmuyorsa geçici kabulde uyarı çıkar." },
          ].map((k) => (
            <div key={k.a} className="bg-white rounded-lg border border-orange-200 p-3">
              <div className="text-xs font-bold text-[#F97316] mb-1">{k.a}</div>
              <div className="text-[12px] text-gray-600 leading-snug">{k.b}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- BİR İŞİN AKIŞI ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Route size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Bir iş baştan sona nasıl ilerler?</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Modülleri tek tek okumak yerine, bir işin ihaleden kesin kabule kadar hangi ekranlardan
          geçtiğini izlemek sistemi anlamanın en kolay yolu.
        </p>
        <div className="relative pl-6 sm:pl-8">
          {/* Dikey akış çizgisi */}
          <span className="absolute left-[9px] sm:left-[13px] top-2 bottom-2 w-0.5 bg-gradient-to-b from-[#F97316] via-[#1E3A5F] to-emerald-500 rounded-full" />
          {[
            {
              n: "1", renk: "bg-[#F97316]", baslik: "İhaleye girilir",
              metin: "Sınır Değer Hesabı ekranında teklif sınırı hesaplanır. İş alınırsa İş Deneyim Belgeleri'nde kartı açılır: sözleşme bedeli, ihale ve sözleşme tarihi, iş süresi, yüklenici firma.",
            },
            {
              n: "2", renk: "bg-[#1E3A5F]", baslik: "Şantiye kurulur, kaynaklar atanır",
              metin: "Personel ve araçlar şantiyeye atanır. Araç Atama ekranı hangi makinenin nerede olduğunu belirler; teknik personel zorunluluğu olan işlerde atanmamış roller ana sayfada uyarı verir.",
            },
            {
              n: "3", renk: "bg-purple-600", baslik: "Her gün puantaj girilir",
              metin: "Personel ve araç puantajı günlük işlenir. Bir araç aynı gün iki şantiyede olamaz; sistem bunu engeller. Şantiye Defteri'ne de o günün saha notu yazılır.",
            },
            {
              n: "4", renk: "bg-red-500", baslik: "Yakıt, bakım ve masraflar işlenir",
              metin: "Depoya alınan yakıt araçlara dağıtılır, her dolumda sayaç değeri girilir. Bakım ve tamiratlar araç kartına işlenir. Kasa hareketleri ve kredi kartı harcamaları kaydedilir.",
            },
            {
              n: "5", renk: "bg-sky-600", baslik: "Hakediş kesilir, rakamlar kendiliğinden akar",
              metin: "Ön muhasebede hakediş faturası kesilince tamamlanan keşif ve fiyat farkı siteye kendiliğinden gelir. İşçilik Durum Raporu bu rakamlardan yatması gereken SGK primini hesaplar.",
            },
            {
              n: "6", renk: "bg-amber-500", baslik: "Veri denetlenir",
              metin: "Yakıt Denetleme aracın deposunun gidemeyeceği mesafeleri, Netsim karşılaştırması site ile muhasebe arasındaki farkı, prim kontrolü eksik yatan primi yakalar. Buradaki uyarılar düzeltilecek kayıtları gösterir.",
            },
            {
              n: "7", renk: "bg-emerald-600", baslik: "Geçici ve kesin kabul",
              metin: "İş bitince geçici kabul tarihi girilir — ama eksik prim varsa sistem uyarı verip onay ister. Kesin kabulden sonra iş deneyim belgesi tamamlanır ve sonraki ihalelerde referans olur.",
            },
          ].map((a) => (
            <div key={a.n} className="relative pb-5 last:pb-0">
              <span className={`absolute -left-6 sm:-left-8 top-0.5 h-5 w-5 sm:h-[26px] sm:w-[26px] rounded-full ${a.renk} text-white text-[11px] font-bold flex items-center justify-center ring-4 ring-gray-50`}>
                {a.n}
              </span>
              <h3 className="font-bold text-sm text-gray-800">{a.baslik}</h3>
              <p className="text-[13px] text-gray-600 leading-relaxed mt-0.5 max-w-3xl">{a.metin}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- MODÜLLER ---------- */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-[#1E3A5F] mb-1">Modüller</h2>
        <p className="text-sm text-gray-500 mb-4">
          Soldaki menü bu gruplardan oluşur. Bir kullanıcı yalnız yetkisi olan başlıkları görür —
          yetkisi olmayan menüde hiç çıkmaz. Bazı başlıklar ayrı bir sayfa değil, aynı sayfanın
          içindeki sekme ya da özelliktir.
        </p>
        <div className="space-y-3">
          {GRUPLAR.map((g) => (
            <div key={g.baslik} className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
              <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
                <span className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${g.renk}`}>
                  {g.ikon}
                </span>
                <h3 className="font-bold text-[#1E3A5F]">{g.baslik}</h3>
                <span className="ml-auto text-[11px] text-gray-400 font-medium">
                  {g.moduller.length} başlık
                </span>
              </div>
              <div className="divide-y divide-gray-100">
                {g.moduller.map((m) => (
                  <div key={m.ad} className="flex gap-3 px-4 py-3">
                    <span className={`w-1 rounded-full flex-shrink-0 ${g.seritRenk}`} />
                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-gray-800">{m.ad}</div>
                      <p className="text-[13px] text-gray-600 leading-relaxed mt-0.5">{m.aciklama}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- ENTEGRASYONLAR ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Link2 size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Dış sistemlerle bağlantılar</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Bazı veriler elle girilmez, başka sistemlerden kendiliğinden gelir.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {ENTEGRASYONLAR.map((e) => (
            <div key={e.ad} className={`rounded-xl border-2 p-4 ${e.renk}`}>
              <h3 className={`font-bold text-sm mb-1.5 ${e.baslikRenk}`}>{e.ad}</h3>
              <p className="text-[13px] text-gray-700 leading-relaxed">{e.metin}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- ROLLER ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Users size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Roller ve yetkiler</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Yetki iki kademelidir: <strong>hangi modüle girebileceği</strong> izin matrisiyle,
          <strong> hangi veriyi göreceği</strong> rolüyle belirlenir.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {ROLLER.map((r) => (
            <div key={r.ad} className={`rounded-xl border-2 p-4 ${r.renk}`}>
              <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded mb-2 ${r.rozet}`}>
                {r.ad}
              </span>
              <p className="text-[13px] text-gray-700 leading-relaxed">{r.metin}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- OTOMATİK İŞLER ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Clock size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Kendiliğinden çalışan işler</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Bunlar kimse başlatmadan kendiliğinden döner. Çoğu ofisteki bilgisayarda çalışır —
          çünkü bazı sistemler (Netsim ağdaki veritabanında, UETS yalnız tanımlı sabit IP üzerinden)
          dışarıdan erişilemiyor. Elektrik kesilip gelse bile bilgisayar kendiliğinden açılır ve
          görevler kaldığı yerden devam eder. Günlük tarama, endeks çekimi ve makine saati gibi
          dışarıya bağlı olmayanlar ise sunucuda (bulutta) çalışır; bilgisayar kapalı olsa da
          işlerler.
        </p>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          {OTOMATIK_ISLER.map((i, idx) => (
            <div key={i.ad} className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 ${idx > 0 ? "border-t border-gray-100" : ""}`}>
              <span className="font-semibold text-sm text-gray-800 min-w-[150px]">{i.ad}</span>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                {i.sure}
              </span>
              <span className="text-[13px] text-gray-600">{i.ne}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-900">
          {GOREV_NOTU}
        </p>
      </section>

      {/* ---------- KENDİLİĞİNDEN FARK EDİLENLER ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Sistem neyi kendiliğinden fark eder?</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Asıl iş burada: kimse bakmasa da hesap kendi kendine dönüyor ve bir şey ters gittiğinde
          ana ekranda karşınıza çıkıyor. Aşağıdakilerin hiçbiri için bir rapor açmanız gerekmez.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {UYARILAR.map((u) => (
            <div key={u.ad} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={`h-2 w-2 rounded-full ${u.nokta}`} />
                <h3 className="font-bold text-sm text-gray-800">{u.ad}</h3>
              </div>
              <p className="text-[13px] text-gray-600 leading-relaxed">{u.metin}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- VERİ GÜVENLİĞİ ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Veri güvenliği ve kayıt izi</h2>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 mt-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Database size={15} className="text-teal-600" />
              <h3 className="font-bold text-sm text-gray-800">Yedekleme</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Veri bulutta tutulur, ayrıca her hafta ofisteki diske tam yedek alınır — hem sunucu
              tarafında hem şirket içinde kopya vardır. Yerel yedekler <strong>şifrelidir</strong>
              {" "}(AES-256): içinde TC kimlik, ad-soyad ve belgeler olduğu için diski alan biri
              okuyamaz, açmak anahtar ister.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle size={15} className="text-amber-600" />
              <h3 className="font-bold text-sm text-gray-800">Kim, ne zaman, neyi değiştirdi</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Kritik kayıtlarda değişiklik geçmişi tutulur; bir tutarın kim tarafından ne zaman
              değiştirildiği görülebilir. Silinen kayıtlar çoğu yerde doğrudan yok olmaz,
              geri alınabilir bir alanda bekler.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Smartphone size={15} className="text-purple-600" />
              <h3 className="font-bold text-sm text-gray-800">Her cihazdan</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Bilgisayar, tablet ve telefondan aynı şekilde çalışır. Telefonda ana ekrana
              eklenip uygulama gibi kullanılabilir, bildirimler oraya düşer.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Server size={15} className="text-sky-600" />
              <h3 className="font-bold text-sm text-gray-800">Çıktı alınabilir</h3>
            </div>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              Puantaj, işçilik durumu, acente raporu gibi ekranların hemen hepsinden PDF ve
              Excel çıktısı alınır; resmî kurumlara verilecek belgeler buradan üretilir.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- KİŞİSEL VERİ ---------- */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Shield size={18} className="text-[#1E3A5F]" />
          <h2 className="text-lg font-bold text-[#1E3A5F]">Kişisel veri ve erişim</h2>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Sistemde TC kimlik numarası, ad-soyad ve telefon gibi kişisel veriler zorunlu olarak
          bulunuyor (SGK bildirgesi, bordro). Bunların kimin görebileceği sınırlandırılmıştır.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {[
            {
              ad: "TC kimlik numaraları maskeli",
              metin: "Listelerde \"129******30\" biçiminde durur. Personel yetkisi olan kullanıcı üstüne tıklayarak tek bir satırı açabilir; yetkisi olmayan hiç açamaz. Böylece ekran paylaşımında, projeksiyonda ya da ekran görüntüsünde numaralar toptan görünmez.",
            },
            {
              ad: "Şifreler kimsede görünmez",
              metin: "Şifreler geri çevrilemez biçimde (hash) saklanır; yönetici dahil kimse göremez. Şifresini unutan kullanıcı giriş kutusundaki \"Şifremi unuttum\" ile kendi e-postasına tek kullanımlık bağlantı ister ve yeni şifresini kendisi belirler.",
            },
            {
              ad: "Dosyalar bağlantıyla açılmaz",
              metin: "Kasa slipleri, evrak taramaları, poliçeler ve kabul belgeleri herkese açık adreslerde durmaz. Her dosya isteği oturumdan geçer ve kısa ömürlü, imzalı bir adrese yönlendirilir.",
            },
            {
              ad: "Konum için aydınlatma ve onay",
              metin: "Yakıt kaydında telefonun konumu alınıyor; konum kişisel veridir. Kişi ekrana ilk girdiğinde aydınlatma metnini okur ve onaylar. Onay, metnin TAMAMI, kişinin adı, cihazı, IP'si ve tarihiyle birlikte saklanır — sonradan \"ne söylendi, ne kabul edildi\" sorusunun cevabı elde olsun diye. Metin değişirse onay yeniden istenir. Kullanıcı listesinde kimin onay verdiği, kimin izni reddettiği ayrı ayrı görünür.",
            },
            {
              ad: "Giriş ve şifre",
              metin: "Giriş kullanıcı adıyla yapılır, e-posta yalnız şifre yenileme içindir ve adresin kişiye ait olduğu doğrulama bağlantısıyla teyit edilir. \"Beni hatırla\" işaretliyse oturum kalıcıdır, işaretsizse uygulama kapanınca çıkılır. Oturum sunucuya doğrulatılır: jeton düşmüşse kullanıcı boş ekranda bırakılmaz, giriş sayfasına sebebiyle alınır.",
            },
            {
              ad: "Yetki modülün altına iner",
              metin: "Yetki yalnız \"girer/giremez\" değildir: görüntüleme, ekleme, düzenleme ve silme ayrı ayrı verilir; bazı modüllerde geçmişe dönük görüntüleme gün sayısıyla, veri kapsamı da şantiye ve firma listesiyle sınırlandırılır.",
            },
          ].map((k) => (
            <div key={k.ad} className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="font-bold text-sm text-gray-800 mb-1.5">{k.ad}</h3>
              <p className="text-[13px] text-gray-600 leading-relaxed">{k.metin}</p>
            </div>
          ))}
        </div>
      </section>

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        Bu sayfa sistemin ne yaptığını anlatır, veri içermez. Bir modülün nasıl kullanıldığını
        merak ediyorsanız ilgili sayfadaki açıklama satırlarına ve alan başlıklarının üzerine
        gelince çıkan ipuçlarına bakabilirsiniz.
      </p>
    </div>
  );
}
