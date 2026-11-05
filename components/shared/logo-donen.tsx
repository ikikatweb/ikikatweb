// Dönen firma logosu — grup birden çok firmadan oluşuyor, kenar çubuğunda hepsi
// sırayla gösterilsin diye. Tek bir <img> yerine hepsi üst üste durur, sırası
// gelen görünür hale gelir (yumuşak geçiş + hafif kayma).
//
// DOSYASI OLMAYAN LOGO LİSTEDEN DÜŞER: public/ içine henüz konmamış bir logo
// kırık görsel olarak görünmesin. Geriye tek logo kalırsa hiç dönmez, sayaç bile
// kurulmaz — yani dosyalar eklenene kadar ekran bugünküyle birebir aynı kalır.
"use client";

import { useEffect, useRef, useState } from "react";
import { getFirmaLogolari, LOGO_DEGISTI_OLAYI } from "@/lib/supabase/queries/firma-logolari";
import { dosyaUrl } from "@/lib/utils/dosya-url";

export type LogoItem = { src: string; alt: string };

/** VARSAYILAN liste — yalnız YEDEK. Asıl liste firmalardan gelir: Firma düzenleme
 *  ekranındaki "Logo Yükle" ile logosu yüklenmiş her firma kendiliğinden döner
 *  (lib/supabase/queries/firma-logolari.ts, sql/firmalar_logo.sql).
 *
 *  Bu liste yalnız veritabanından logo okunamadığında kullanılır: giriş ekranında
 *  (oturum yok) ve migrasyon çalıştırılmadan önce. Dosyalar public/logolar/ altında
 *  ve HEPSİ AYNI TUVALDE (700x300, logo ortada, görsel ağırlıkları eşitlenmiş) —
 *  oranları farklı olduğu için ham hâlleriyle biri dar biri geniş görünüyordu.
 *  Yüklenen yeni logolar da aynı tuvale yerleştirilmeli. */
export const FIRMA_LOGOLARI: LogoItem[] = [
  { src: "/logolar/kad-tem.png", alt: "KAD-TEM" },
  { src: "/logolar/ikikat.png", alt: "İkikat" },
  { src: "/logolar/kenan-tugay-ikikat.png", alt: "Kenan Tugay İkikat" },
];

type Props = {
  /** Verilirse veritabanı okunmaz, bu liste döner. Verilmezse firmalardan gelir. */
  logolar?: LogoItem[];
  /** Bir logonun ekranda kalma süresi (saniye). */
  araSn?: number;
  /** Kutunun sınıfı — YÜKSEKLİK buradan verilmeli (ör. "h-24"), görseller mutlak konumlu. */
  className?: string;
};

export default function LogoDonen({ logolar: disListe, araSn = 5, className = "h-24 w-full" }: Props) {
  // Firmalardan gelen logolar. Okunana kadar (ve okunamazsa) koddaki yedek liste görünür —
  // böylece giriş ekranı ve migrasyon öncesi davranış bugünküyle aynı kalır.
  const [dbListe, setDbListe] = useState<LogoItem[] | null>(null);
  useEffect(() => {
    if (disListe) return;
    let iptal = false;
    const yukle = () => {
      getFirmaLogolari()
        .then((l) => { if (!iptal) setDbListe(l.length > 0 ? l : null); })
        .catch(() => { /* yedek liste kalsın */ });
    };
    yukle();
    // Logo yüklenince/silinince anında tazele — kenar çubuğu açık kaldığı için
    // yeniden kurulmuyor, haber verilmezse silinen logo dönmeye devam ederdi.
    window.addEventListener(LOGO_DEGISTI_OLAYI, yukle);
    return () => { iptal = true; window.removeEventListener(LOGO_DEGISTI_OLAYI, yukle); };
  }, [disListe]);
  const logolar = disListe ?? dbListe ?? FIRMA_LOGOLARI;

  const [bozuk, setBozuk] = useState<Record<string, true>>({});
  const imgRef = useRef<Record<string, HTMLImageElement | null>>({});
  const [sayac, setSayac] = useState(0);
  const [azHareket, setAzHareket] = useState(false);
  const [sekmeGizli, setSekmeGizli] = useState(false);

  const gecerli = logolar.filter((l) => !bozuk[l.src]);
  const n = gecerli.length;
  const aktif = n > 0 ? sayac % n : 0;
  // Çıkan logo sola süzülür, SIRA BEKLEYEN sağda durur: geçiş tek yöne akar,
  // yoksa hepsi aynı yerden belirip kayma hissi kaybolur.
  const cikan = n > 0 ? (sayac - 1 + n) % n : -1;

  // SSR ile gelen HTML'deki görsel, React olay dinleyicileri bağlanmadan ÖNCE 404
  // alırsa onError HİÇ çalışmıyor; kırık görsel ekranda kalıyordu. Bağlanır bağlanmaz
  // bir de elle tara: yüklemesi bitmiş ama eni sıfırsa o dosya yok demektir.
  useEffect(() => {
    const dusenler: Record<string, true> = {};
    for (const [src, el] of Object.entries(imgRef.current)) {
      if (el && el.complete && el.naturalWidth === 0) dusenler[src] = true;
    }
    if (Object.keys(dusenler).length > 0) setBozuk((p) => ({ ...p, ...dusenler }));
  }, [logolar]);

  // İşletim sisteminde "hareketi azalt" seçiliyse kaydırma yok, yalnız solma.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const uygula = () => setAzHareket(mq.matches);
    uygula();
    mq.addEventListener("change", uygula);
    return () => mq.removeEventListener("change", uygula);
  }, []);

  // Sekme arkadayken sayaç dönmesin: görünmeyen animasyon boşuna işlemci yakar.
  useEffect(() => {
    const uygula = () => setSekmeGizli(document.hidden);
    uygula();
    document.addEventListener("visibilitychange", uygula);
    return () => document.removeEventListener("visibilitychange", uygula);
  }, []);

  // Fare üstüne gelince DURDURMUYORUZ: sayaç her durdurup başlatmada sıfırlandığı
  // için logonun üstünden geçmek süreyi uzatıyordu; dokunmatikte ise tıklama sahte
  // bir mouseenter doğurup dönmeyi büsbütün durdurabiliyordu.
  useEffect(() => {
    if (sekmeGizli || gecerli.length < 2) return;
    const t = setInterval(() => setSayac((p) => p + 1), Math.max(2, araSn) * 1000);
    return () => clearInterval(t);
  }, [sekmeGizli, gecerli.length, araSn]);

  if (gecerli.length === 0) return null;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
    >
      {gecerli.map((l, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={l.src}
          ref={(el) => { imgRef.current[l.src] = el; }}
          // public/ altındaki yollar olduğu gibi; Storage adresleri imzalı geçitten geçer
          src={l.src.startsWith("/") ? l.src : dosyaUrl(l.src)}
          alt={l.alt}
          // Hepsi yüklenir (ön belleğe girsin, geçişte boşluk olmasın); sırası gelmeyen şeffaf.
          // SIRALI GEÇİŞ: eski logo 300 ms'de çıkar, yeni logo 300 ms GECİKMEYLE girer.
          // İkisi aynı anda yarı saydam olunca iç içe geçip bulanık bir karışım oluyordu.
          className={`absolute inset-0 w-full h-full object-contain transition-all ease-out ${
            i === aktif
              ? "opacity-100 duration-500 delay-300"
              : "opacity-0 duration-300 pointer-events-none"
          } ${
            // "Hareketi azalt" açıksa yalnız sol/opaklık — kayma ve ölçek yok.
            azHareket
              ? ""
              : i === aktif
                ? "translate-x-0 scale-100"
                : i === cikan
                  ? "-translate-x-4 scale-95"
                  : "translate-x-4 scale-95"
          }`}
          onError={() => setBozuk((p) => ({ ...p, [l.src]: true }))}
        />
      ))}
    </div>
  );
}
