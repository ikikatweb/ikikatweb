// Ana sayfa — KAD-TEM A.Ş. herkese açık kurumsal tanıtım sayfası.
// İçerik kadtem.com.tr'den birebir doğrulanarak alındı. Projeler DEVAM EDEN / TAMAMLANAN olarak
// sitedeki resmi listeye göre ayrıldı. Fotoğraflar belirli bir projeye atfEDİLMEZ → genel "Sahadan
// Görüntüler" galerisi + hero olarak kullanılır (hangi foto hangi proje bilinmediği için).
// Sağ üstteki "Giriş" popover ile yönetim paneline girilir. Middleware yalnız /dashboard ve /login'i
// koruduğu için bu sayfa herkese açıktır.
/* eslint-disable @next/next/no-img-element */
import GirisPopover from "@/components/shared/giris-popover";
import SiteLogo from "@/components/shared/site-logo";
import ProjelerSekmeli from "@/components/shared/projeler-sekmeli";
import HaberlerBolumu from "@/components/shared/haberler-bolumu";
import { getProjelerGruplu } from "@/lib/supabase/queries/santiyeler-public";
import { getHaberlerPublic } from "@/lib/supabase/queries/haberler-public";
import {
  Waves, Layers, ShieldAlert, Sprout, Landmark, Map, Ruler, Building2,
  Phone, Printer, Mail, MapPin, ArrowRight, CheckCircle2,
} from "lucide-react";

// Haber/proje verisi DB'den geldiği için sayfa STATİK dondurulmasın; en fazla 10 sn'de bir tazelenir
// → panelden eklenen/gizlenen haber-proje canlı sitede ~10 sn içinde yansır.
export const revalidate = 10;

// lucide bu sürümde marka ikonu taşımıyor → YouTube/Facebook inline SVG.
function YoutubeIcon() {
  return (<svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20} aria-hidden="true"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>);
}
function FacebookIcon() {
  return (<svg viewBox="0 0 24 24" fill="currentColor" width={20} height={20} aria-hidden="true"><path d="M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.6 4.5-4.6 1.3 0 2.7.2 2.7.2v2.9h-1.5c-1.5 0-1.9.9-1.9 1.8V12h3.3l-.5 3.5h-2.8v8.4A12 12 0 0 0 24 12z"/></svg>);
}

const HIZMETLER = [
  { ikon: Waves, ad: "Baraj & Gölet", not: "Sulama göletleri, gölet ve sulama sistemleri inşaatı." },
  { ikon: Layers, ad: "Arazi Toplulaştırma & TİGH", not: "Arazi toplulaştırma ve tarla içi geliştirme hizmetleri." },
  { ikon: ShieldAlert, ad: "Taşkın Koruma", not: "Dere ıslahı, taş tahkimat ve taşkın koruma inşaatı." },
  { ikon: Sprout, ad: "Sera Yapımı", not: "Plastik örtülü tarımsal sera yapım işleri." },
  { ikon: Landmark, ad: "Restorasyon", not: "Cami, tarihi eser ve kamu binası restorasyon/onarımı." },
  { ikon: Map, ad: "Kadastro & Hâlihazır Harita", not: "Sayısal kadastral harita ve güncelleme işleri." },
  { ikon: Ruler, ad: "Mera Aplikasyonu & İmar", not: "Mera aplikasyonu ve imar uygulaması." },
  { ikon: Building2, ad: "Altyapı & Yapı İnşaatı", not: "Okul, kampüs altyapı ve kamu yapı inşaatları." },
];

// YEDEK listeler — İş Deneyim (santiyeler) verisi çekilemezse kullanılır. Normalde projeler
// DB'den (getProjelerGruplu) gelir. Kaynak: kadtem.com.tr resmi listesi.
const FALLBACK_DEVAM = [
  "Aydın Nazilli–Yenipazar Tarla İçi Kapalı (Borulu) Drenaj ve TİGH",
  "Eskişehir Seyitgazi 3. Kısım A.T. ve TİGH",
  "Bilecik Pazaryeri A.T. ve TİGH",
  "Samsun Vezirköprü A.T. ve TİGH",
  "Tokat Zile Ovası 1. Kısım A.T. ve TİGH",
  "Tokat Zile Ovası 2. Kısım A.T. ve TİGH",
  "Şanlıurfa 15/A Arazi Toplulaştırma",
  "Karabük Merkez Cevizlidere 2. Kısım Taşkın Koruma",
  "Tokat 2/B 1. Grup Sayısal Kadastral Harita",
  "Yozgat 2/B 1. Grup Sayısal Kadastral Harita",
  "Çorum 2/B 1. Grup Sayısal Kadastral Harita",
  "Sinop 2/B 3. Grup Sayısal Kadastral Harita",
  "Zile MYO ve Dinçerler Otelcilik YO Isı Merkezi Revizyonu",
  "Tokat Huzurevi Binası Yangın Tadilatı Onarımı",
  "Gaziosmanpaşa Üniversitesi Kampüs Altyapı İnşaatı",
  "Lot 10 Kilis İli Toprak Etüt ve Sınıflandırma",
];

const FALLBACK_TAMAM = [
  "Gümüşhane Aşağıalıçlı Göleti ve Sulama İnşaatı",
  "Tokat Zile Özyurt Göleti İnşaatı",
  "Boyunpınar Göleti Yapımı",
  "Karakuzu Göleti Yapımı",
  "Eze Köyü Göleti Yapımı",
  "Beyşehir Karaali Sulama Göleti",
  "Yeşilırmak Islahı Taş Tahkimatı",
  "Kastamonu Cide İlçesi Taşkın Koruma",
  "Bartın Hasankadı Dereleri İkmali",
  "Kemer Barajı Yan Dereleri Siltasyondan Koruma",
  "Erzurum Hınıs A.T. ve TİGH Tamamlama",
  "Zile Güzelbeyli II. Kısım Toplulaştırma",
  "Erbaa Tepekışla Toplulaştırma",
  "Ahırlı Akkise Büyük Camii Bakım ve Onarımı",
  "Maski Genel Müdürlüğü Laboratuvar Binası",
  "Muhtelif Yerlerde 130 Adet Sera Yapımı",
  "Mehmet Akif Ersoy ve Plevne Lisesi Onarımı",
  "Divriği İmam Hatip Lisesi İnşaatı",
];

const REFERANSLAR = [
  "Devlet Su İşleri (DSİ)", "Tapu ve Kadastro Genel Müdürlüğü", "Tarım ve Orman Bakanlığı",
  "İl Özel İdareleri", "Vakıflar Genel Müdürlüğü", "İller Bankası", "Gaziosmanpaşa Üniversitesi", "TOKİ",
];

export default async function AnaSayfa() {
  // Projeler İş Deneyim (santiyeler) kayıtlarından: geçici kabulü olan = Tamamlanan, olmayan = Devam Eden.
  // Veri gelmezse (bağlantı/izin) kadtem yedek listesine düşülür.
  const db = await getProjelerGruplu();
  const varMi = db.devam.length > 0 || db.tamamlanan.length > 0;
  const devamListe = varMi ? db.devam : FALLBACK_DEVAM.map((ad) => ({ ad, kategori: "Projeler", siraTarih: null }));
  const tamamListe = varMi ? db.tamamlanan : FALLBACK_TAMAM.map((ad) => ({ ad, kategori: "Projeler", siraTarih: null }));
  const grupSirasi = db.grupSirasi;
  const toplamProje = devamListe.length + tamamListe.length; // devam eden + tamamlanan = toplam proje
  const haberler = await getHaberlerPublic();
  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* ÜST BAR */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <a href="#ust" className="flex items-center">
            <SiteLogo />
          </a>
          <nav className="hidden items-center gap-7 text-[15px] font-medium text-slate-600 md:flex">
            <a href="#firmamiz" className="hover:text-[#1E3A5F]">Firmamız</a>
            <a href="#hizmetler" className="hover:text-[#1E3A5F]">Hizmetler</a>
            <a href="#projeler" className="hover:text-[#1E3A5F]">Projeler</a>
            <a href="#haberler" className="hover:text-[#1E3A5F]">Haberler</a>
            <a href="#iletisim" className="hover:text-[#1E3A5F]">İletişim</a>
          </nav>
          <GirisPopover />
        </div>
      </header>

      {/* HERO + İSTATİSTİK — birlikte ilk ekranı (header hariç) tam doldurur → "Firmamız" ancak scroll'da görünür */}
      <div className="flex flex-col" style={{ minHeight: "calc(100svh - 81px)" }}>
      {/* HERO */}
      <section id="ust" className="relative isolate flex flex-1 items-center overflow-hidden">
        <img src="/site/img1.jpg" alt="" className="absolute inset-0 -z-10 h-full w-full object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#0f2540]/90 via-[#1E3A5F]/80 to-[#1E3A5F]/40" />
        <div className="mx-auto w-full max-w-6xl px-4 py-12">
          <p className="mb-3 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white backdrop-blur">
            1999&apos;dan bugüne
          </p>
          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight text-white md:text-5xl">
            Su, toprak ve yapıda güvenilir mühendislik
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-100/90 md:text-lg">
            Baraj ve gölet, arazi toplulaştırma, taşkın koruma, sera, restorasyon ve kadastro işlerinde
            uzman teknik kadromuz ve iş tecrübemizle Türkiye genelinde hizmet veriyoruz.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="#projeler" className="inline-flex items-center gap-2 rounded-lg bg-[#F97316] px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-[#ea580c]">
              Projelerimiz <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </section>

      {/* İSTATİSTİK ŞERİDİ */}
      <section className="border-b border-slate-100 bg-[#1E3A5F]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-4 px-4 py-8 text-center text-white md:grid-cols-4">
          {[["1999", "Kuruluş"], ["27+", "Yıl tecrübe"], [String(toplamProje), "Proje"], ["Türkiye", "Genelinde hizmet"]].map(([b, k]) => (
            <div key={k}>
              <div className="text-2xl font-extrabold md:text-3xl">{b}</div>
              <div className="mt-1 text-xs text-slate-300 md:text-sm">{k}</div>
            </div>
          ))}
        </div>
      </section>
      </div>

      {/* FİRMAMIZ */}
      <section id="firmamiz" className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-[#1E3A5F] md:text-3xl">Firmamız</h2>
            <div className="mt-2 h-1 w-16 rounded bg-[#F97316]" />
            <p className="mt-5 leading-relaxed text-slate-600">
              1999 yılından bugüne; Baraj, Gölet, Arazi Toplulaştırması, Taşkın Koruma, Sera Yapımı,
              Restorasyon, Kadastral & Hâlihazır Harita Yapımı, Mera Aplikasyonu ve İmar Uygulaması gibi
              konularda uzman teknik kadromuz ve iş tecrübemizle faaliyet gösteriyoruz.
            </p>
            <p className="mt-4 leading-relaxed text-slate-600">
              Devlet Su İşleri Genel Müdürlüğü, Tapu ve Kadastro Genel Müdürlüğü, Vakıflar Genel Müdürlüğü,
              İller Bankası, Tarım Reformu Genel Müdürlüğü, il özel idareleri, üniversiteler ve belediyeler
              başta olmak üzere birçok kamu kurumuna taahhüt işleri gerçekleştirdik.
            </p>
            <ul className="mt-5 space-y-2">
              {["Uzman ve deneyimli teknik kadro", "Kamu ihalelerinde köklü referanslar", "Zamanında ve şartnameye uygun teslim"].map((m) => (
                <li key={m} className="flex items-center gap-2 text-sm text-slate-700">
                  <CheckCircle2 size={18} className="shrink-0 text-[#F97316]" /> {m}
                </li>
              ))}
            </ul>
          </div>
          <div className="overflow-hidden rounded-2xl shadow-lg">
            <img src="/site/img6.jpg" alt="KAD-TEM saha çalışması" className="h-full w-full object-cover" />
          </div>
        </div>
      </section>

      {/* HİZMETLER */}
      <section id="hizmetler" className="bg-slate-50 py-16 md:py-20">
        <div className="mx-auto max-w-6xl px-4">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-[#1E3A5F] md:text-3xl">Hizmetlerimiz</h2>
            <div className="mx-auto mt-2 h-1 w-16 rounded bg-[#F97316]" />
            <p className="mx-auto mt-3 max-w-2xl text-slate-500">Su yapıları, tarımsal altyapı, harita ve yapı işlerinde anahtar teslim çözümler.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {HIZMETLER.map((h) => (
              <div key={h.ad} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-[#F97316]/40 hover:shadow-lg">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1E3A5F]/5 text-[#1E3A5F] transition group-hover:bg-[#F97316] group-hover:text-white">
                  <h.ikon size={24} />
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-800">{h.ad}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{h.not}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PROJELER — Devam Eden / Tamamlanan (sitedeki resmi listeye göre) */}
      <section id="projeler" className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-[#1E3A5F] md:text-3xl">Projelerimiz</h2>
          <div className="mx-auto mt-2 h-1 w-16 rounded bg-[#F97316]" />
          <p className="mx-auto mt-3 max-w-2xl text-slate-500">Taahhüdümüz altında yapımı devam eden ve tamamlanan projelerimiz.</p>
        </div>

        <div className="mt-10">
          <ProjelerSekmeli devam={devamListe} tamamlanan={tamamListe} grupSirasi={grupSirasi} />
        </div>
      </section>

      {/* BİZDEN HABERLER — yayında haber varsa gösterilir (yönetim: /dashboard/yonetim/haberler) */}
      {haberler.length > 0 && (
        <section id="haberler" className="bg-slate-50 py-16 md:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-[#1E3A5F] md:text-3xl">Bizden Haberler</h2>
              <div className="mx-auto mt-2 h-1 w-16 rounded bg-[#F97316]" />
              <p className="mx-auto mt-3 max-w-2xl text-slate-500">Firmamızda yaşanan gelişmeler ve yenilikler.</p>
            </div>
            <div className="mt-10">
              <HaberlerBolumu haberler={haberler} />
            </div>
          </div>
        </section>
      )}

      {/* REFERANSLAR */}
      <section className="py-14">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-lg font-semibold text-slate-500">Çözüm ortağı olduğumuz kurumlar</h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            {REFERANSLAR.map((r) => (
              <span key={r} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">{r}</span>
            ))}
          </div>
        </div>
      </section>

      {/* İLETİŞİM */}
      <section id="iletisim" className="mx-auto max-w-6xl px-4 py-16 md:py-20">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold text-[#1E3A5F] md:text-3xl">İletişim</h2>
            <div className="mt-2 h-1 w-16 rounded bg-[#F97316]" />
            <ul className="mt-6 space-y-4 text-slate-700">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 shrink-0 text-[#F97316]" size={20} />
                <span>Karşıyaka Mah. Vali Ayhan Çevik Blv. No:36/A<br />Merkez / TOKAT</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="shrink-0 text-[#F97316]" size={20} />
                <a href="tel:+903562132277" className="hover:text-[#1E3A5F]">0 356 213 22 77</a>
              </li>
              <li className="flex items-center gap-3">
                <Printer className="shrink-0 text-[#F97316]" size={20} />
                <span>0 356 213 22 66 (Faks)</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="shrink-0 text-[#F97316]" size={20} />
                <a href="mailto:info@kadtem.com.tr" className="hover:text-[#1E3A5F]">info@kadtem.com.tr</a>
              </li>
            </ul>
            <div className="mt-6 flex gap-3">
              <a href="https://www.youtube.com/channel/UCp5bRsj_jPhTtwHTctiNDVw" target="_blank" rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-red-600 hover:text-white" aria-label="YouTube">
                <YoutubeIcon />
              </a>
              <a href="https://facebook.com/kadtemas" target="_blank" rel="noopener noreferrer"
                className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition hover:bg-blue-600 hover:text-white" aria-label="Facebook">
                <FacebookIcon />
              </a>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
            <iframe
              title="KAD-TEM konum"
              src="https://www.google.com/maps?q=Kar%C5%9F%C4%B1yaka%20Mah.%20Vali%20Ayhan%20%C3%87evik%20Blv.%20No%3A36%2FA%20Merkez%20Tokat&output=embed"
              className="h-72 w-full md:h-full" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-slate-800 bg-[#0f2540] text-slate-300">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-center text-sm md:flex-row md:text-left">
          <div>
            <div className="font-semibold text-white">KAD-TEM Müh. Müt. İnş. Oto. Turz. Tic. ve San. A.Ş.</div>
            <div className="mt-0.5 text-xs text-slate-400">Karşıyaka Mah. Vali Ayhan Çevik Blv. No:36/A Merkez / TOKAT · www.kadtem.com.tr</div>
          </div>
          <div className="text-xs text-slate-400">© 2026 KAD-TEM A.Ş. Tüm hakları saklıdır.</div>
        </div>
      </footer>
    </div>
  );
}
