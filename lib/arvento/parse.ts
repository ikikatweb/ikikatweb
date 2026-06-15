// Arvento "Araç Çalışma Raporu" Excel ayrıştırıcı.
// Arvento'nun günlük gönderdiği .xlsx dosyasında 2 sayfa bulunur:
//   1) "Genel Rapor" — olay (ör. Damper İndi) kayıtları
//   2) "Araç Çalışma Raporu" — araç bazlı günlük çalışma özeti (bizim kullandığımız)
// Bu modül 2. sayfayı okuyup araç başına mesafe/süre/hız bilgisini döndürür.
import * as XLSX from "xlsx";

export type ArventoAracSatir = {
  plaka: string;
  surucu: string | null;
  cihaz_no: string | null;
  mesafe_km: number | null;
  kontak_sn: number | null;   // Kontak açık süresi (saniye)
  rolanti_sn: number | null;  // Rölanti süresi (saniye)
  hareket_sn: number | null;  // Hareket (çalışma) süresi (saniye)
  maks_hiz: number | null;    // varsa maksimum hız (km/s)
  damper_sayisi: number | null; // o gün damper indirme sayısı ("Genel Rapor" sayfasından)
  marka: string | null;
  model: string | null;
};

export type ArventoRaporParse = {
  raporTarihi: string | null; // YYYY-MM-DD
  araclar: ArventoAracSatir[];
};

// Türkçe karakter duyarsız normalize (başlık eşleştirme için)
function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/ı/g, "i").replace(/i̇/g, "i")
    .replace(/[şs]/g, "s").replace(/[çc]/g, "c").replace(/[ğg]/g, "g")
    .replace(/[üu]/g, "u").replace(/[öo]/g, "o")
    .replace(/\s+/g, " ").trim();
}

// "2sa 15dk 38sn" / "36dk 38sn" / "   " → toplam saniye (boşsa 0, ayrıştırılamazsa null)
export function parseSure(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v);
  let toplam = 0;
  let bulundu = false;
  const re = /(\d+)\s*(sa|saat|dk|dakika|sn|saniye)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    bulundu = true;
    const n = parseInt(m[1], 10);
    const u = m[2].toLowerCase();
    if (u.startsWith("sa")) toplam += n * 3600;
    else if (u.startsWith("dk") || u.startsWith("da")) toplam += n * 60;
    else toplam += n;
  }
  if (bulundu) return toplam;
  return s.trim() === "" ? 0 : null;
}

function parseSayi(v: unknown): number | null {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(",", ".").replace(/[^\d.\-]/g, ""));
  return isNaN(n) ? null : n;
}

function temizMetin(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

// İngilizce tarih metnini ("2 June 2026 Tuesday 08:55:42") YYYY-MM-DD'ye çevir
const AY_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
function parseEnTarih(v: unknown): string | null {
  if (v == null) return null;
  const m = String(v).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const ay = AY_EN[m[2].toLowerCase()];
  if (!ay) return null;
  return `${m[3]}-${String(ay).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
}

export type ArventoGenelSatir = { tarih: string; plaka: string; damper: number };

// "Genel Rapor" dosyasını ayrıştır: damper indirme olaylarını (tarih, plaka) bazında say.
// Genel Rapor ÇOK GÜNLÜ olabilir; her olayın kendi "Tarih/Saat" sütunundaki günü esas alınır.
export function parseGenelRaporBuffer(buf: ArrayBuffer | Buffer): ArventoGenelSatir[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetAdi =
    wb.SheetNames.find((n) => norm(n).includes("genel rapor")) ??
    wb.SheetNames.find((n) => norm(n).includes("genel"));
  if (!sheetAdi) return [];
  const ws = wb.Sheets[sheetAdi];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] ?? []).some((c) => norm(c) === "plaka")) { hi = i; break; }
  }
  if (hi < 0) return [];
  const head = (rows[hi] ?? []).map(norm);
  const plakaCol = head.findIndex((h) => h.includes("plaka"));
  const turCol = head.findIndex((h) => h.includes("tur"));
  const tarihCol = head.findIndex((h) => h.includes("tarih"));
  if (plakaCol < 0 || tarihCol < 0) return [];

  // tarih -> plaka -> sayı
  const m = new Map<string, Map<string, number>>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const plaka = temizMetin(r[plakaCol]);
    if (!plaka) continue;
    if (turCol >= 0 && !norm(r[turCol]).includes("damper")) continue;
    const tarih = parseEnTarih(r[tarihCol]);
    if (!tarih) continue;
    if (!m.has(tarih)) m.set(tarih, new Map());
    const pm = m.get(tarih)!;
    pm.set(plaka, (pm.get(plaka) ?? 0) + 1);
  }
  const out: ArventoGenelSatir[] = [];
  for (const [tarih, pm] of m) {
    for (const [plaka, damper] of pm) out.push({ tarih, plaka, damper });
  }
  return out;
}

// Buffer/ArrayBuffer'dan Arvento raporunu ayrıştır.
export function parseArventoBuffer(buf: ArrayBuffer | Buffer): ArventoRaporParse {
  const wb = XLSX.read(buf, { type: "buffer" });
  // "Araç Çalışma Raporu" sayfasını bul (yoksa adında "calisma" geçen ilk sayfa)
  // Yalnızca "Araç Çalışma Raporu" sayfası işlenir (Genel Rapor ayrı dosya/fonksiyon)
  const sheetAdi =
    wb.SheetNames.find((n) => norm(n).includes("arac calisma")) ??
    wb.SheetNames.find((n) => norm(n).includes("calisma"));
  if (!sheetAdi) return { raporTarihi: null, araclar: [] };
  const ws = wb.Sheets[sheetAdi];
  if (!ws) return { raporTarihi: null, araclar: [] };

  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });

  // Rapor tarihi — başlık metnindeki "(14.06.2026 ..." ifadesinden
  let raporTarihi: string | null = null;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const t = String((rows[i] ?? [])[0] ?? "");
    const dm = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) { raporTarihi = `${dm[3]}-${dm[2]}-${dm[1]}`; break; }
  }

  // Başlık satırını bul ("Plaka" içeren satır)
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] ?? []).some((c) => norm(c) === "plaka")) { hi = i; break; }
  }
  if (hi < 0) return { raporTarihi, araclar: [] };

  const head = (rows[hi] ?? []).map(norm);
  const col = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)));
  const ci = {
    plaka: col("plaka"),
    surucu: col("surucu"),
    cihaz: col("cihaz"),
    mesafe: col("mesafe"),
    kontak: col("kontak"),
    rolanti: col("rolanti"),
    hareket: col("hareket"),
    marka: col("marka"),
    model: col("model"),
    hiz: head.findIndex((h) => h.includes("hiz")),
  };
  if (ci.plaka < 0) return { raporTarihi, araclar: [] };

  const araclar: ArventoAracSatir[] = [];
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((c) => c == null || String(c).trim() === "")) continue;
    const plaka = temizMetin(r[ci.plaka]);
    if (!plaka) continue;
    araclar.push({
      plaka,
      surucu: ci.surucu >= 0 ? temizMetin(r[ci.surucu]) : null,
      cihaz_no: ci.cihaz >= 0 ? temizMetin(r[ci.cihaz]) : null,
      mesafe_km: ci.mesafe >= 0 ? parseSayi(r[ci.mesafe]) : null,
      kontak_sn: ci.kontak >= 0 ? parseSure(r[ci.kontak]) : null,
      rolanti_sn: ci.rolanti >= 0 ? parseSure(r[ci.rolanti]) : null,
      hareket_sn: ci.hareket >= 0 ? parseSure(r[ci.hareket]) : null,
      maks_hiz: ci.hiz >= 0 ? parseSayi(r[ci.hiz]) : null,
      damper_sayisi: null, // damper ayrı "Genel Rapor" dosyasından gelir
      marka: ci.marka >= 0 ? temizMetin(r[ci.marka]) : null,
      model: ci.model >= 0 ? temizMetin(r[ci.model]) : null,
    });
  }
  return { raporTarihi, araclar };
}
