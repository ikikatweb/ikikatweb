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

// Tek bir damper indirme olayı (saat + nerede + Arvento harita linki + varsa GPS koordinatı)
export type ArventoDamperOlay = { saat: string | null; adres: string | null; harita?: string | null; lat?: number | null; lng?: number | null };
export type ArventoGenelSatir = { tarih: string; plaka: string; damper: number; surucu: string | null; olaylar: ArventoDamperOlay[] };

// "08:16:32" gibi saati çıkar
function parseSaat(v: unknown): string | null {
  const m = String(v ?? "").match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  return m ? m[1] : null;
}

// "Genel Rapor" dosyasını ayrıştır: damper indirme olaylarını (tarih, plaka) bazında topla.
// Her plaka-gün için olay sayısı + olay listesi (saat, adres) döner.
// Genel Rapor ÇOK GÜNLÜ olabilir; her olayın kendi "Tarih/Saat" sütunundaki günü esas alınır.
export function parseGenelRaporBuffer(buf: ArrayBuffer | Buffer): ArventoGenelSatir[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  // "Genel Rapor", "Kamyonlar Genel Rapor" veya "Damper Kalktı/İndi Alarmı" (koordinatlı) sayfaları
  const sheetAdi =
    wb.SheetNames.find((n) => norm(n).includes("genel rapor")) ??
    wb.SheetNames.find((n) => norm(n).includes("genel")) ??
    wb.SheetNames.find((n) => norm(n).includes("damper")) ??
    wb.SheetNames.find((n) => norm(n).includes("alarm"));
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
  // Tür / Alarm Türü sütunu (tarih sütunlarını yanlışlıkla seçmemek için "tarih" hariç)
  const turCol = head.findIndex((h) => (h.includes("tur") || h.includes("alarm")) && !h.includes("tarih"));
  const tarihCol = head.findIndex((h) => h.includes("tarih"));
  // Saat ayrı sütunda olabilir: "Tarih/Saat (Saat)". Yoksa tarih sütunundan çıkarılır.
  const saatCol = head.findIndex((h) => h.includes("(saat)"));
  // Adres tek sütun ("Adres") veya parçalı (Şehir/Mahalle/İlçe/Köy/Yol) gelebilir.
  const adresCol = head.findIndex((h) => h.includes("adres"));
  const surucuCol = head.findIndex((h) => h.includes("surucu"));
  // GPS koordinatı — Arvento'da açıksa: ayrı Enlem/Boylam sütunları veya tek "Koordinat" sütunu
  const enlemCol = head.findIndex((h) => h.includes("enlem") || h.includes("latitude") || h === "lat");
  const boylamCol = head.findIndex((h) => h.includes("boylam") || h.includes("longitude") || h === "lon" || h === "lng" || h === "long");
  const koordCol = head.findIndex((h) => h.includes("koordinat") || h.includes("konum") || (h.includes("enlem") && h.includes("boylam")));
  const koordKur = (r: unknown[]): { lat: number; lng: number } | null => {
    const f = (v: unknown) => parseFloat(String(v ?? "").trim().replace(",", "."));
    if (enlemCol >= 0 && boylamCol >= 0) {
      const la = f(r[enlemCol]); const lo = f(r[boylamCol]);
      if (!isNaN(la) && !isNaN(lo) && (la !== 0 || lo !== 0)) return { lat: la, lng: lo };
    }
    if (koordCol >= 0) {
      const m = String(r[koordCol] ?? "").match(/(-?\d+[.,]\d+)[,;\s]+(-?\d+[.,]\d+)/);
      if (m) return { lat: parseFloat(m[1].replace(",", ".")), lng: parseFloat(m[2].replace(",", ".")) };
    }
    return null;
  };
  // "Haritada Göster" sütunu — hücredeki KÖPRÜ (Arvento harita linki, kesin konum)
  const haritaCol = head.findIndex((h) => h.includes("harita") || h.includes("goster"));
  const r0 = XLSX.utils.decode_range(ws["!ref"] ?? "A1").s.r;
  const haritaLink = (rowIdx: number): string | null => {
    if (haritaCol < 0) return null;
    const cell = ws[XLSX.utils.encode_cell({ r: r0 + rowIdx, c: haritaCol })] as { l?: { Target?: string } } | undefined;
    return cell?.l?.Target ?? null;
  };
  const parcaCols = ["mahalle", "yol", "koy", "ilce", "sehir"].map((ad) => head.findIndex((h) => h.includes(ad)));
  const adresKur = (r: unknown[]): string | null => {
    if (adresCol >= 0) return temizMetin(r[adresCol]);
    const parts = parcaCols.map((ci) => (ci >= 0 ? temizMetin(r[ci]) : null)).filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  };
  if (plakaCol < 0 || tarihCol < 0) return [];

  // tarih -> plaka -> { olaylar, surucu }
  const m = new Map<string, Map<string, { olaylar: ArventoDamperOlay[]; surucu: string | null }>>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const plaka = temizMetin(r[plakaCol]);
    if (!plaka) continue;
    // SADECE "Damper İndi" sayılır — "Damper Kalktı" (damper kaldırma) hariç.
    if (turCol >= 0 && !norm(r[turCol]).includes("indi")) continue;
    const tarih = parseEnTarih(r[tarihCol]);
    if (!tarih) continue;
    if (!m.has(tarih)) m.set(tarih, new Map());
    const pm = m.get(tarih)!;
    if (!pm.has(plaka)) pm.set(plaka, { olaylar: [], surucu: null });
    const grup = pm.get(plaka)!;
    const koord = koordKur(r);
    grup.olaylar.push({
      saat: parseSaat(saatCol >= 0 ? r[saatCol] : r[tarihCol]),
      adres: adresKur(r),
      harita: haritaLink(i),
      lat: koord?.lat ?? null,
      lng: koord?.lng ?? null,
    });
    if (!grup.surucu && surucuCol >= 0) grup.surucu = temizMetin(r[surucuCol]);
  }
  const out: ArventoGenelSatir[] = [];
  for (const [tarih, pm] of m) {
    for (const [plaka, grup] of pm) {
      grup.olaylar.sort((a, b) => (a.saat ?? "").localeCompare(b.saat ?? ""));
      out.push({ tarih, plaka, damper: grup.olaylar.length, surucu: grup.surucu, olaylar: grup.olaylar });
    }
  }
  return out;
}

// ===== "Mesafe Bilgisi" (Konum Geçmişi) — araç güzergahı / rota =====
// Araç başına sık aralıklı GPS noktaları → haritada rota çizgisi için.
export type GuzergahNokta = { saat: string | null; lat: number; lng: number; hiz: number | null };
export type ArventoGuzergah = {
  tarih: string;       // YYYY-MM-DD
  plaka: string;
  aracSinifi: string | null; // ör. "Greyder"
  marka: string | null;
  model: string | null;
  toplamMesafe: number | null; // km
  noktalar: GuzergahNokta[];
};

// "Mesafe Bilgisi" sayfasını ayrıştır: plaka × gün bazında sıralı GPS noktaları.
export function parseMesafeBilgisiBuffer(buf: ArrayBuffer | Buffer): ArventoGuzergah[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetAdi =
    wb.SheetNames.find((n) => norm(n).includes("mesafe bilgisi")) ??
    wb.SheetNames.find((n) => norm(n).includes("mesafe")) ??
    wb.SheetNames.find((n) => norm(n).includes("konum"));
  if (!sheetAdi) return [];
  const ws = wb.Sheets[sheetAdi];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
  // Başlık satırı: "plaka" içeren ilk satır
  let hi = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i] ?? []).some((c) => norm(c) === "plaka")) { hi = i; break; }
  }
  if (hi < 0) return [];
  const head = (rows[hi] ?? []).map(norm);
  const plakaCol = head.findIndex((h) => h.includes("plaka"));
  const tarihCol = head.findIndex((h) => h.includes("tarih"));
  const enlemCol = head.findIndex((h) => h.includes("enlem") || h.includes("latitude") || h === "lat");
  const boylamCol = head.findIndex((h) => h.includes("boylam") || h.includes("longitude") || h === "lng" || h === "lon");
  const hizCol = head.findIndex((h) => h.includes("hiz") || h.includes("(km/h)") || h.includes("km h"));
  const mesafeCol = head.findIndex((h) => h.includes("mesafe (km") || h === "mesafe km");
  const sinifCol = head.findIndex((h) => h.includes("sinif"));
  const markaCol = head.findIndex((h) => h.includes("marka"));
  const modelCol = head.findIndex((h) => h.includes("model"));
  if (plakaCol < 0 || tarihCol < 0 || enlemCol < 0 || boylamCol < 0) return [];

  const m = new Map<string, ArventoGuzergah>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const plaka = temizMetin(r[plakaCol]);
    if (!plaka) continue;
    const tarih = parseEnTarih(r[tarihCol]);
    if (!tarih) continue;
    const lat = parseSayi(r[enlemCol]);
    const lng = parseSayi(r[boylamCol]);
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    const key = `${tarih}|${plaka}`;
    let g = m.get(key);
    if (!g) {
      g = {
        tarih, plaka,
        aracSinifi: sinifCol >= 0 ? temizMetin(r[sinifCol]) : null,
        marka: markaCol >= 0 ? temizMetin(r[markaCol]) : null,
        model: modelCol >= 0 ? temizMetin(r[modelCol]) : null,
        toplamMesafe: 0,
        noktalar: [],
      };
      m.set(key, g);
    }
    g.noktalar.push({ saat: parseSaat(r[tarihCol]), lat, lng, hiz: hizCol >= 0 ? parseSayi(r[hizCol]) : null });
    if (mesafeCol >= 0) { const seg = parseSayi(r[mesafeCol]); if (seg != null) g.toplamMesafe = (g.toplamMesafe ?? 0) + seg; }
  }
  const out = [...m.values()];
  // Noktaları saate göre sırala (rota doğru çizilsin)
  for (const g of out) {
    g.noktalar.sort((a, b) => (a.saat ?? "").localeCompare(b.saat ?? ""));
    if (g.toplamMesafe != null) g.toplamMesafe = Math.round(g.toplamMesafe * 10) / 10;
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

// ===== "Kontak Alarmı" raporu — araç başına o GÜNKÜ ilk "Kontak Açıldı" ve son "Kontak Kapandı" saati =====
export type KontakSure = { tarih: string; plaka: string; ilkAcik: string | null; sonKapandi: string | null };

export function parseKontakAlarmiBuffer(buf: ArrayBuffer | Buffer): KontakSure[] {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheetAdi = wb.SheetNames.find((n) => norm(n).includes("kontak"));
  if (!sheetAdi) return [];
  const ws = wb.Sheets[sheetAdi];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
  // Başlık metnindeki tarih (tek günlük rapor için yedek)
  let baslikTarih: string | null = null;
  for (let i = 0; i < Math.min(3, rows.length); i++) {
    const t = String((rows[i] ?? [])[0] ?? "");
    const dm = t.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (dm) { baslikTarih = `${dm[3]}-${dm[2]}-${dm[1]}`; break; }
  }
  let hi = -1;
  for (let i = 0; i < rows.length; i++) if ((rows[i] ?? []).some((c) => norm(c) === "plaka")) { hi = i; break; }
  if (hi < 0) return [];
  const head = (rows[hi] ?? []).map(norm);
  const plakaCol = head.findIndex((h) => h.includes("plaka"));
  const turCol = head.findIndex((h) => h.includes("alarm") && !h.includes("tarih"));
  const saatCol = head.findIndex((h) => h.includes("(saat)"));
  const tarihCol = head.findIndex((h) => h.includes("(tarih)"));
  if (plakaCol < 0 || turCol < 0 || saatCol < 0) return [];

  const m = new Map<string, { tarih: string; plaka: string; acik: string[]; kapandi: string[] }>();
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const plaka = temizMetin(r[plakaCol]);
    if (!plaka) continue;
    const saat = parseSaat(r[saatCol]);
    if (!saat) continue;
    const tarih = (tarihCol >= 0 ? parseEnTarih(r[tarihCol]) : null) ?? baslikTarih;
    if (!tarih) continue;
    const tur = norm(r[turCol]);
    const key = `${tarih}|${plaka}`;
    let g = m.get(key);
    if (!g) { g = { tarih, plaka, acik: [], kapandi: [] }; m.set(key, g); }
    if (tur.includes("acild")) g.acik.push(saat);          // "Kontak Açıldı"
    else if (tur.includes("kapand")) g.kapandi.push(saat); // "Kontak Kapandı"
  }
  const out: KontakSure[] = [];
  for (const g of m.values()) {
    g.acik.sort();
    g.kapandi.sort();
    out.push({
      tarih: g.tarih,
      plaka: g.plaka,
      ilkAcik: g.acik[0] ?? null,
      sonKapandi: g.kapandi.length ? g.kapandi[g.kapandi.length - 1] : null,
    });
  }
  return out;
}
