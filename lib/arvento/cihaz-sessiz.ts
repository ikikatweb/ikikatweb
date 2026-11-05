// SESSİZ CİHAZ TESPİTİ — "araç haritadan sessizce kayboluyor" sorunu.
//
// 05.11.2026: trencher 34-00-25-5586'nın takip cihazı 02.11 13:05'ten beri tek paket
// göndermemişti. Arvento'da da veri yok, bizde de yok; araç haritada hiç çizilmediği
// için üç gün kimse fark etmedi — "makine çalışmadı" sanıldı. Eksik veri sessiz kalmamalı.
//
// ÖLÇÜT: arvento_anlik.tarih = cihazın SON PAKETİ. Sağlıklı cihaz park hâlinde ve kontak
// kapalıyken bile heartbeat atar — 05.11.2026 ölçümünde çalışan 25 cihazın hepsi son 1 saat
// içindeydi, susanlar ise 3–8 GÜN geride. Yani eşik geniş tutulabilir, yanlış alarm olmaz.

/** Bu süredir tek paket gelmeyen cihaz "sessiz" sayılır. 24 saat: bir iş günü tamamen
 *  kaçmadan uyarı çıkar, ama hafta sonu/park eden araç yanlışlıkla işaretlenmez. */
export const SESSIZ_ESIK_SAAT = 24;

export type SessizCihaz = {
  /** Cihaz kodu (arvento_cihaz.node) — "beklemede" işaretini bu satıra yazmak için. */
  node: string | null;
  plaka: string;
  model: string | null;
  /** Son paketin zamanı (ISO) — null ise cihaz hiç konuşmamış. */
  son: string | null;
  /** Kaç saattir sessiz. */
  saat: number;
  /** Son bilinen konum (haritada o noktaya odaklanmak için). */
  lat: number | null;
  lng: number | null;
};

type Konum = { node: string | null; lat: number | null; lng: number | null; tarih: string | null };
type Cihaz = { plaka: string | null; model?: string | null; sessizOnay?: string | null };

/** Son paketi `esikSaat` saatten eski olan cihazlar — en uzun susandan başlayarak. */
export function sessizCihazlariBul(
  konumlar: Konum[] | undefined,
  cihazMap: Map<string, Cihaz> | undefined,
  esikSaat: number = SESSIZ_ESIK_SAAT,
): SessizCihaz[] {
  const simdi = Date.now();
  const out: SessizCihaz[] = [];
  for (const k of konumlar ?? []) {
    const t = k.tarih ? Date.parse(k.tarih) : NaN;
    // Zamanı okunamayan satırı SESSİZ SAYMA: bozuk bir tarih yüzünden her araç uyarıya
    // düşerse uyarı anlamını yitirir (ve gerçek sessizlik gürültüde kaybolur).
    if (!Number.isFinite(t)) continue;
    const saat = (simdi - t) / 3600000;
    if (saat < esikSaat) continue;
    const c = k.node ? cihazMap?.get(k.node.trim()) : undefined;
    // "BEKLEMEDE" İŞARETİ. Araçların çoğu arızadan değil, uzun süre ÇALIŞMADIĞI için susuyor
    // (05.11.2026: 6 sessiz araçtan 5'i park hâlindeydi). Hepsi kırmızı yanınca uyarı
    // anlamını yitiriyor. Kullanıcı "biliyorum" dediğinde o anki son paket zamanı kaydedilir
    // ve uyarı gizlenir; cihaz tekrar veri gönderip sonra YİNE susarsa son paket değişir,
    // işaret tutmaz ve uyarı kendiliğinden geri gelir.
    if (c?.sessizOnay && k.tarih && c.sessizOnay === k.tarih) continue;
    out.push({
      node: k.node?.trim() ?? null,
      plaka: c?.plaka?.trim() || k.node || "(eşlenmemiş cihaz)",
      model: c?.model?.trim() || null,
      son: k.tarih,
      saat,
      lat: k.lat,
      lng: k.lng,
    });
  }
  return out.sort((a, b) => b.saat - a.saat);
}

/** "3 gündür" / "31 saattir" — kısa, okunur süre.
 *  GÜN TAM SAYI: "3,3 gündür" kimsenin kullanmadığı bir hassasiyet, okurken de takılıyor.
 *  Aşağı yuvarlanır — 3,9 günü "4 gündür" demek henüz dolmamış bir süreyi doldu göstermek olur. */
export function sessizSure(saat: number): string {
  if (saat < 48) return `${Math.round(saat)} saattir`;
  return `${Math.floor(saat / 24)} gündür`;
}

/** "02.11 13:05" — son paket zamanı. */
export function sessizSonZaman(son: string | null): string {
  if (!son) return "—";
  const d = new Date(son);
  if (Number.isNaN(d.getTime())) return son;
  const i2 = (n: number) => String(n).padStart(2, "0");
  return `${i2(d.getDate())}.${i2(d.getMonth() + 1)} ${i2(d.getHours())}:${i2(d.getMinutes())}`;
}
