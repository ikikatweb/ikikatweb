// Arvento operasyon (yol yapım katmanı) tanımları — Reglaj / Stabilize / Serme / Sıkıştırma.
// Hepsi aynı "Mesafe Bilgisi" güzergah verisini kullanır; araç sınıfına göre ayrılır,
// farklı RENK ve ÇİZGİ STİLİ ile çizilir.
//   - Reglaj/Serme → Greyder güzergahı
//   - Stabilize    → Greyder güzergahı + Kamyon damper noktaları
//   - Sıkıştırma   → Silindir güzergahı (zikzak çizgi)
// Renkler hem haritada hem lejantta ortak kullanılır.

export type OperasyonTip = "reglaj" | "stabilize" | "serme" | "sikistirma";

export type OperasyonTanim = {
  ad: string;
  renk: string;
  // arac_sinifi içinde geçen anahtar kelimeler (normalize edilmiş aranır)
  sinifAnahtar: string[];
  // Bu operasyona ait BİLİNEN plakalar — arac_sinifi boş/yanlış gelse bile (raporlarda
  // sınıf çoğu zaman boş) bu plakalar doğru operasyona dahil edilir. Yeni araç gelince eklenir.
  plakaAnahtar: string[];
  zikzak: boolean; // çizgi testere-dişi (zikzak) çizilsin mi (silindir/sıkıştırma)
  damper: boolean; // güzergah üzerine damper indirme noktaları konsun mu
};

// Bilinen araçlar (sınıf raporda boş geldiği için plaka ile sabitlenir)
const GREYDERLER = ["06-00-10-1096", "60-04-07-008"];
const SILINDIRLER = ["34-00-11-6911"];

export const OPERASYONLAR: Record<OperasyonTip, OperasyonTanim> = {
  reglaj:     { ad: "Reglaj",     renk: "#2563eb", sinifAnahtar: ["greyder", "grayder", "greider"], plakaAnahtar: GREYDERLER, zikzak: false, damper: false },
  stabilize:  { ad: "Stabilize",  renk: "#f97316", sinifAnahtar: ["greyder", "grayder", "greider"], plakaAnahtar: GREYDERLER, zikzak: false, damper: true },
  serme:      { ad: "Serme",      renk: "#059669", sinifAnahtar: ["greyder", "grayder", "greider"], plakaAnahtar: GREYDERLER, zikzak: false, damper: true },
  sikistirma: { ad: "Sıkıştırma", renk: "#7c3aed", sinifAnahtar: ["silindir", "silndir", "kompaktor", "compactor"], plakaAnahtar: SILINDIRLER, zikzak: true, damper: false },
};

// Lejant / sayfa başı renk açıklaması sırası
export const OPERASYON_SIRA: OperasyonTip[] = ["reglaj", "serme", "stabilize", "sikistirma"];

export function sinifNorm(s: string | null | undefined): string {
  return String(s ?? "").toLocaleLowerCase("tr").replace(/[^a-z0-9ğüşıöç]/g, "");
}

function plakaKodu(s: string | null | undefined): string {
  return String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Bir güzergah kaydı bu operasyona ait mi? Önce arac_sinifi, eşleşmezse plaka ile kontrol.
export function sinifEslesir(aracSinifi: string | null | undefined, op: OperasyonTip, plaka?: string | null): boolean {
  const tanim = OPERASYONLAR[op];
  const n = sinifNorm(aracSinifi);
  if (n && tanim.sinifAnahtar.some((k) => n.includes(sinifNorm(k)))) return true;
  if (plaka) {
    const pk = plakaKodu(plaka);
    if (pk && tanim.plakaAnahtar.some((p) => plakaKodu(p) === pk)) return true;
  }
  return false;
}

const METRE_DERECE = 111320;

// Bir polyline'ı dik yönde offsetM kadar kaydırılmış PARALEL kopyasına çevirir.
// İki kez çağrılıp (+d ve -d) "altlı üstlü" çift çizgi elde edilir (serme/sıkıştırma görseli).
export function paralelCizgi(latlngs: [number, number][], offsetM: number): [number, number][] {
  const n = latlngs.length;
  if (n < 2) return latlngs;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [la1, lo1] = latlngs[Math.max(0, i - 1)];
    const [la2, lo2] = latlngs[Math.min(n - 1, i + 1)];
    const lat = latlngs[i][0];
    const cosL = Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const dx = (lo2 - lo1) * METRE_DERECE * cosL;
    const dy = (la2 - la1) * METRE_DERECE;
    const uz = Math.hypot(dx, dy) || 1;
    const nx = -dy / uz, ny = dx / uz; // sol dik birim vektör
    out.push([lat + (ny * offsetM) / METRE_DERECE, latlngs[i][1] + (nx * offsetM) / (METRE_DERECE * cosL)]);
  }
  return out;
}

// Bir polyline'ı testere-dişi (zikzak) hale getirir — silindir/sıkıştırma görseli.
// genlikM: zikzak yüksekliği (m), adimM: diş aralığı (m).
export function zikzakla(latlngs: [number, number][], genlikM = 3, adimM = 6): [number, number][] {
  if (latlngs.length < 2) return latlngs;
  const out: [number, number][] = [];
  let yon = 1;
  for (let i = 0; i < latlngs.length - 1; i++) {
    const [la1, lo1] = latlngs[i];
    const [la2, lo2] = latlngs[i + 1];
    const ortLat = (la1 + la2) / 2;
    const cosL = Math.max(0.1, Math.cos((ortLat * Math.PI) / 180));
    const dx = (lo2 - lo1) * METRE_DERECE * cosL; // doğu-batı (m)
    const dy = (la2 - la1) * METRE_DERECE;        // kuzey-güney (m)
    const uzunluk = Math.hypot(dx, dy);
    out.push(latlngs[i]);
    if (uzunluk === 0) continue;
    // birim dik vektör (m)
    const nx = -dy / uzunluk, ny = dx / uzunluk;
    const adimSayi = Math.max(1, Math.floor(uzunluk / adimM));
    for (let s = 1; s < adimSayi; s++) {
      const t = s / adimSayi;
      const baseLat = la1 + (la2 - la1) * t;
      const baseLng = lo1 + (lo2 - lo1) * t;
      const off = yon * genlikM;
      out.push([baseLat + (ny * off) / METRE_DERECE, baseLng + (nx * off) / (METRE_DERECE * cosL)]);
      yon = -yon;
    }
  }
  out.push(latlngs[latlngs.length - 1]);
  return out;
}
