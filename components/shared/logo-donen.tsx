// Dönen firma logosu — grup birden çok firmadan oluşuyor, kenar çubuğunda hepsi
// sırayla gösterilsin diye. Tek bir <img> yerine hepsi üst üste durur, sırası
// gelen görünür hale gelir (yumuşak geçiş + hafif kayma).
//
// DOSYASI OLMAYAN LOGO LİSTEDEN DÜŞER: public/ içine henüz konmamış bir logo
// kırık görsel olarak görünmesin. Geriye tek logo kalırsa hiç dönmez, sayaç bile
// kurulmaz — yani dosyalar eklenene kadar ekran bugünküyle birebir aynı kalır.
"use client";

import { useEffect, useRef, useState } from "react";

export type LogoItem = { src: string; alt: string };

/** Kenar çubuğunda ve giriş ekranında gösterilecek kendi firmalarımız.
 *  Dosyalar public/ altında durur. Adi ortaklıklar ve "Şahsi" buraya girmez:
 *  ortaklığın kendi logosu yoktur, dış ortağın logosu da bizi temsil etmez. */
export const FIRMA_LOGOLARI: LogoItem[] = [
  { src: "/logo.png", alt: "KAD-TEM" },
  { src: "/logo-ikikat.png", alt: "İkikat" },
  { src: "/logo-kti.png", alt: "Kenan Tugay İkikat" },
];

type Props = {
  logolar?: LogoItem[];
  /** Bir logonun ekranda kalma süresi (saniye). */
  araSn?: number;
  /** Kutunun sınıfı — YÜKSEKLİK buradan verilmeli (ör. "h-24"), görseller mutlak konumlu. */
  className?: string;
};

export default function LogoDonen({ logolar = FIRMA_LOGOLARI, araSn = 5, className = "h-24 w-full" }: Props) {
  const [bozuk, setBozuk] = useState<Record<string, true>>({});
  const imgRef = useRef<Record<string, HTMLImageElement | null>>({});
  const [sayac, setSayac] = useState(0);
  const [azHareket, setAzHareket] = useState(false);
  const [sekmeGizli, setSekmeGizli] = useState(false);
  const [uzerinde, setUzerinde] = useState(false);

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

  // Fare üstündeyken durur — bir logoya bakmak isteyen kaçırmasın.
  useEffect(() => {
    if (sekmeGizli || uzerinde || gecerli.length < 2) return;
    const t = setInterval(() => setSayac((p) => p + 1), Math.max(2, araSn) * 1000);
    return () => clearInterval(t);
  }, [sekmeGizli, uzerinde, gecerli.length, araSn]);

  if (gecerli.length === 0) return null;

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      onMouseEnter={() => setUzerinde(true)}
      onMouseLeave={() => setUzerinde(false)}
    >
      {gecerli.map((l, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={l.src}
          ref={(el) => { imgRef.current[l.src] = el; }}
          src={l.src}
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
