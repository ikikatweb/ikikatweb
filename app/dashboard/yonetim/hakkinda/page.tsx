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
      { ad: "Bordro Takibi", aciklama: "Personelin hangi ay hangi şantiyede olduğu, günlük/brüt ücretleri ve aylık bordro tahmini. İşçilik primi hesabının bordro ayağı buradan gelir." },
      { ad: "Ödeme Planı", aciklama: "Vadesi gelen ödemelerin takvimi." },
      { ad: "Kredi Kartları", aciklama: "Şirket kartlarının limit, ekstre ve harcama takibi." },
      { ad: "İcra Takibi", aciklama: "Açılmış icra dosyalarının durumu." },
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
      { ad: "Yakıt Hareketleri", aciklama: "Depoya alınan yakıt, araçlara dağıtımı ve şantiyeler arası virman. Her dolumda sayaç değeri girilir; sistem bundan tüketim ortalamasını (L/100km veya L/saat) hesaplar ve araç cinsine tanımlı limitlerin dışına çıkanı işaretler." },
    ],
  },
  {
    baslik: "Kasa",
    ikon: <Wallet size={18} />,
    renk: "bg-teal-50 text-teal-700",
    seritRenk: "bg-teal-500",
    moduller: [
      { ad: "Kasa Hareketleri", aciklama: "Günlük nakit giriş çıkışı ve kasa defteri." },
    ],
  },
  {
    baslik: "Şantiye Defteri",
    ikon: <NotebookPen size={18} />,
    renk: "bg-indigo-50 text-indigo-700",
    seritRenk: "bg-indigo-500",
    moduller: [
      { ad: "Günlük Kayıtlar", aciklama: "Sahadan günlük not, hava durumu ve yapılan iş kayıtları." },
    ],
  },
  {
    baslik: "Ayarlar",
    ikon: <Settings size={18} />,
    renk: "bg-[#1E3A5F]/10 text-[#1E3A5F]",
    seritRenk: "bg-[#1E3A5F]",
    moduller: [
      { ad: "Kullanıcılar", aciklama: "Kullanıcı açma ve modül bazında yetkilendirme. Yalnız yönetici erişir." },
      { ad: "Firmalar", aciklama: "Grup firmaları ve ortaklıklar; her firmanın kendi rengi vardır, listelerde bu renkle ayrışır." },
      { ad: "İş Deneyim Belgeleri", aciklama: "İşlerin (şantiyelerin) kartı: sözleşme bedeli, ihale ve sözleşme tarihleri, iş süresi, süre uzatımları, geçici ve kesin kabul tarihleri." },
      { ad: "Personeller", aciklama: "Personel kartları, öğrenim bilgileri, teknik personel atamaları." },
      { ad: "Araçlar", aciklama: "Araç kartları: plaka, cins, sayaç tipi (km/saat), 1 depo menzili, sahiplik (özmal/kiralık)." },
      { ad: "Yi-ÜFE", aciklama: "Fiyat farkı hesabında kullanılan Yurt İçi Üretici Fiyat Endeksi tablosu." },
      { ad: "Tanımlamalar", aciklama: "Açılır listelerin içeriği: görevler, meslekler, araç cinsleri, yakıt limitleri." },
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
    ad: "E-posta (IMAP)",
    renk: "border-emerald-300 bg-emerald-50",
    baslikRenk: "text-emerald-800",
    metin: "SGK bildirgeleri ve Arvento raporları e-posta kutusundan otomatik okunur, ilgili personel ve araçlarla eşleştirilir.",
  },
  {
    ad: "Push Bildirim",
    renk: "border-amber-300 bg-amber-50",
    baslikRenk: "text-amber-800",
    metin: "Sigorta ve muayene bitişi, eksik bilgi, yaklaşan bakım gibi durumlar telefona anlık bildirim olarak düşer. Uygulama telefona kurulabilir (PWA); ayrı bir mağaza kurulumu gerekmez.",
  },
];

const OTOMATIK_ISLER = [
  { ad: "Netsim senkronu", sure: "15 dakikada bir", ne: "Hakediş tutarları ve yeni açılan işlerin eşleştirmesi" },
  { ad: "Bildirge okuma", sure: "2 dakikada bir", ne: "E-posta kutusundan SGK bildirgelerinin alınması" },
  { ad: "Arvento senkronu", sure: "Gün içinde düzenli", ne: "Araç güzergâh ve çalışma verileri" },
  { ad: "Veri yedeği", sure: "Her cumartesi 12:00", ne: "Tüm verinin yerel diske yedeklenmesi" },
  { ad: "Bildirim budama", sure: "Her ayın 1'i 03:20", ne: "60 günden eski bildirimlerin temizlenmesi" },
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
          {["Her yerden erişim", "Telefona kurulabilir", "Anlık bildirim", "Rol bazlı yetki", "Otomatik yedek"].map((t) => (
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
          Soldaki menü bu başlıklardan oluşur. Bir kullanıcı yalnız yetkisi olan başlıkları görür —
          yetkisi olmayan menüde hiç çıkmaz.
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
                  {g.moduller.length} sayfa
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
          Bunlar kimse başlatmadan, ofisteki bilgisayarda arka planda döner. Elektrik kesilip
          gelse bile bilgisayar kendiliğinden açılır ve görevler kaldığı yerden devam eder.
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
              Veri bulutta tutulur, ayrıca her hafta ofisteki diske tam yedek alınır. Yani hem
              sunucu tarafında hem şirket içinde kopya vardır.
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

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        Bu sayfa sistemin ne yaptığını anlatır, veri içermez. Bir modülün nasıl kullanıldığını
        merak ediyorsanız ilgili sayfadaki açıklama satırlarına ve alan başlıklarının üzerine
        gelince çıkan ipuçlarına bakabilirsiniz.
      </p>
    </div>
  );
}
