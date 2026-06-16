// Arvento Araç Çalışma Raporu — günlük rapor (Plaka, Mesafe, Süre, Hız)
"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useAuth } from "@/hooks";
import { getArventoTarihler, getArventoRaporByTarih, getArventoRaporByRange, getArventoOrtalamalar, getPlakaSantiyeMap, plakaNorm, type ArventoOrtalama, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import type { AracArventoRapor } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Satellite, Search, Upload, FileSpreadsheet, RefreshCw, Gauge, Route, Clock, ChevronLeft, ChevronRight, MapPin, X, Download } from "lucide-react";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { trAramaNormalize } from "@/lib/utils/isim";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

// saniye → "2sa 15dk" / "—"
function formatSure(sn: number | null): string {
  if (sn == null) return "—";
  if (sn === 0) return "0";
  const sa = Math.floor(sn / 3600);
  const dk = Math.floor((sn % 3600) / 60);
  if (sa > 0) return `${sa}sa ${dk}dk`;
  return `${dk}dk`;
}

function formatKm(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

// "08:37:29" → gün içindeki dakika (saniye dahil kesirli). Yoksa null.
function saatToDk(saat: string | null | undefined): number | null {
  if (!saat) return null;
  const m = String(saat).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
}

// ---- Nominatim geocoding (OpenStreetMap) — tüm damperleri tek haritada göstermek için ----
const geoCache = new Map<string, { lat: number; lng: number } | null>();
async function geocodeAdres(adres: string): Promise<{ lat: number; lng: number } | null> {
  if (geoCache.has(adres)) return geoCache.get(adres) ?? null;
  try {
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(adres)}`);
    const d = await r.json();
    const c = (d?.konum ?? null) as { lat: number; lng: number } | null;
    geoCache.set(adres, c); return c;
  } catch { geoCache.set(adres, null); return null; }
}
const HARITA_RENKLER = ["#e11d48", "#2563eb", "#059669", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

// Tarih aralığındaki kayıtları PLAKAYA göre topla (çok günlük damper toplamı için).
// Damper olaylarına gün etiketi eklenir (saat "DD.MM HH:MM:SS").
function aralikTopla(rows: AracArventoRapor[]): AracArventoRapor[] {
  const m = new Map<string, AracArventoRapor>();
  for (const r of rows) {
    const gunEk = `${r.rapor_tarihi.slice(8, 10)}.${r.rapor_tarihi.slice(5, 7)}`;
    const olaylar = (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []).map((o) => ({
      ...o, saat: o.saat ? `${gunEk} ${o.saat}` : o.saat,
    }));
    const ex = m.get(r.plaka);
    if (!ex) {
      m.set(r.plaka, { ...r, mesafe_km: r.mesafe_km ?? 0, damper_sayisi: r.damper_sayisi ?? 0, damper_olaylar: olaylar });
    } else {
      ex.mesafe_km = (ex.mesafe_km ?? 0) + (r.mesafe_km ?? 0);
      ex.damper_sayisi = (ex.damper_sayisi ?? 0) + (r.damper_sayisi ?? 0);
      ex.damper_olaylar = [...(ex.damper_olaylar ?? []), ...olaylar];
      if (!ex.surucu && r.surucu) ex.surucu = r.surucu;
      if (!ex.marka && r.marka) ex.marka = r.marka;
      if (!ex.model && r.model) ex.model = r.model;
    }
  }
  return Array.from(m.values());
}

export default function ArventoRaporPage() {
  const { hasPermission } = useAuth();
  const yGor = hasPermission("araclar-arvento-raporu", "goruntule");
  const yEkle = hasPermission("araclar-arvento-raporu", "ekle");

  const [loading, setLoading] = useState(true);
  const [tarihler, setTarihler] = useState<string[]>([]);
  const [seciliTarih, setSeciliTarih] = useState<string>("");
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [ortalamalar, setOrtalamalar] = useState<Map<string, ArventoOrtalama>>(new Map());
  const [plakaSantiye, setPlakaSantiye] = useState<Map<string, PlakaSantiye>>(new Map());
  const [arama, setArama] = useState("");
  const [aktifSekme, setAktifSekme] = useState<"calisma" | "genel">("calisma");
  // Damper detayları VARSAYILAN AÇIK; kullanıcı kapattıkça KAPALI plakalar tutulur (plakaya göre → gün değişince korunur)
  const [kapaliPlakalar, setKapaliPlakalar] = useState<Set<string>>(new Set());
  const toggleOlay = (plaka: string) => setKapaliPlakalar((s) => {
    const n = new Set(s); if (n.has(plaka)) n.delete(plaka); else n.add(plaka); return n;
  });
  // Yanlış (art arda) damper kaldırma eşiği (dk) — localStorage'da kalıcı
  const [mukerrerDk, setMukerrerDk] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("arvento_mukerrer_dk");
    return v != null ? (parseInt(v, 10) || 0) : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("arvento_mukerrer_dk", String(mukerrerDk));
  }, [mukerrerDk]);
  // Haritada göster modalı: adres (Google embed) + opsiyonel Arvento kesin-konum linki
  const [harita, setHarita] = useState<{ baslik: string; adres: string; arvento: string | null; koord: { lat: number; lng: number } | null } | null>(null);
  // Tüm damperleri tek haritada gösterme (Leaflet + geocoding)
  const [tumHaritaAcik, setTumHaritaAcik] = useState(false);
  const [haritaYukleniyor, setHaritaYukleniyor] = useState(false);
  // Harita çizilirken çözülen (gerçek koordinatlı) noktalar — KML export için saklanır.
  const [cozulenNoktalar, setCozulenNoktalar] = useState<
    { plaka: string; saat: string | null; adres: string | null; lat: number; lng: number }[]
  >([]);
  const mapRef = useRef<HTMLDivElement>(null);
  // Damper sekmesi tarih aralığı — ana rapor tarihinden BAĞIMSIZ, başta ikisi de boş.
  // İkisi de seçilince çok günlük damper toplamı; boşsa tek gün (seçili rapor tarihi).
  const [rangeBas, setRangeBas] = useState<string>("");
  const [bitisTarih, setBitisTarih] = useState<string>("");
  const [rangeKayitlar, setRangeKayitlar] = useState<AracArventoRapor[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [maildenCekiliyor, setMaildenCekiliyor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadTarihler = useCallback(async () => {
    try {
      const t = await getArventoTarihler();
      setTarihler(t);
      setSeciliTarih((prev) => prev || t[0] || "");
    } catch { /* sessiz */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTarihler(); }, [loadTarihler]);

  const loadKayitlar = useCallback(async () => {
    if (!seciliTarih) { setKayitlar([]); return; }
    try {
      const [k, ort, ps] = await Promise.all([
        getArventoRaporByTarih(seciliTarih),
        getArventoOrtalamalar(),
        getPlakaSantiyeMap(seciliTarih),
      ]);
      setKayitlar(k);
      setOrtalamalar(ort);
      setPlakaSantiye(ps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("arac_arvento_rapor")) {
        toast.error("arac_arvento_rapor tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
      }
    }
  }, [seciliTarih]);

  useEffect(() => { loadKayitlar(); }, [loadKayitlar]);

  // Mailden çek — inbox'taki Arvento rapor mailini anında işle (cron'u beklemeden)
  async function maildenCek() {
    setMaildenCekiliyor(true);
    try {
      const res = await fetch("/api/arvento/mailden-cek", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Mailden çekilemedi");
      if (data.ok) {
        toast.success(`Mailden çekildi — ${data.mesaj}`, { duration: toastSuresi() });
        await loadTarihler();
        const yeniTarih: string | undefined = data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih;
        if (yeniTarih) setSeciliTarih(yeniTarih);
        await loadKayitlar();
      } else {
        // ok:false → mail bulunamadı / işlenemedi gibi bilgilendirici durum
        toast(data.mesaj ?? "Çekilecek yeni rapor bulunamadı.", { icon: "ℹ️", duration: toastSuresi() });
      }
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally {
      setMaildenCekiliyor(false);
    }
  }

  // Manuel Excel yükleme
  async function dosyaYukle(file: File) {
    setYukleniyor(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/arvento", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "İçe aktarılamadı");
      toast.success(data.mesaj ?? "İçe aktarıldı.", { duration: toastSuresi() });
      await loadTarihler();
      // İçe aktarılan ilk çalışma günü (yoksa ilk damper günü) seçili olsun
      const yeniTarih: string | undefined = data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih;
      if (yeniTarih) setSeciliTarih(yeniTarih);
      await loadKayitlar();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally {
      setYukleniyor(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Mevcut tarihler arasında gün gün gezinme (sola = eski, sağa = yeni)
  const tarihlerAsc = useMemo(() => [...tarihler].sort(), [tarihler]);
  const tarihIdx = tarihlerAsc.indexOf(seciliTarih);
  function gunGez(delta: number) {
    const j = tarihIdx + delta;
    if (j >= 0 && j < tarihlerAsc.length) setSeciliTarih(tarihlerAsc[j]);
  }

  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return kayitlar;
    return kayitlar.filter((k) =>
      trAramaNormalize([k.plaka, k.surucu, k.marka, k.model].filter(Boolean).join(" ")).includes(q),
    );
  }, [kayitlar, arama]);

  const ozet = useMemo(() => {
    const toplamKm = filtrelenmis.reduce((s, k) => s + (k.mesafe_km ?? 0), 0);
    const calisan = filtrelenmis.filter((k) => (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0).length;
    const toplamHareket = filtrelenmis.reduce((s, k) => s + (k.hareket_sn ?? 0), 0);
    const toplamDamper = filtrelenmis.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0);
    return { sayi: filtrelenmis.length, calisan, toplamKm, toplamHareket, toplamDamper };
  }, [filtrelenmis]);

  // Aralık seçiliyse (başlangıç+bitiş dolu ve bitiş >= başlangıç) o aralığı çek + plakaya göre topla
  const aralikModu = !!rangeBas && !!bitisTarih && bitisTarih >= rangeBas;
  useEffect(() => {
    if (!(rangeBas && bitisTarih && bitisTarih >= rangeBas)) { setRangeKayitlar([]); return; }
    (async () => {
      try { setRangeKayitlar(aralikTopla(await getArventoRaporByRange(rangeBas, bitisTarih))); }
      catch { setRangeKayitlar([]); }
    })();
  }, [rangeBas, bitisTarih]);

  // Şantiye bazlı gruplama (plaka → araç puantaj şantiyesi)
  const gruplaSantiye = useCallback((list: AracArventoRapor[]) => {
    const m = new Map<string, AracArventoRapor[]>();
    for (const k of list) {
      const ad = plakaSantiye.get(plakaNorm(k.plaka))?.santiyeAdi ?? "Eşleşmedi";
      if (!m.has(ad)) m.set(ad, []);
      m.get(ad)!.push(k);
    }
    const arr = Array.from(m.entries()).map(([ad, l]) => ({
      ad,
      kayitlar: [...l].sort((a, b) => (b.mesafe_km ?? 0) - (a.mesafe_km ?? 0)),
      toplamKm: l.reduce((s, k) => s + (k.mesafe_km ?? 0), 0),
      toplamDamper: l.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0),
      calisan: l.filter((k) => (k.mesafe_km ?? 0) > 0 || (k.hareket_sn ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0).length,
    }));
    const sona = (x: string) => (x === "Atanmamış" || x === "Eşleşmedi" ? 1 : 0);
    arr.sort((a, b) => sona(a.ad) - sona(b.ad) || b.toplamKm - a.toplamKm || a.ad.localeCompare(b.ad, "tr"));
    return arr;
  }, [plakaSantiye]);

  const gruplar = useMemo(() => gruplaSantiye(filtrelenmis), [gruplaSantiye, filtrelenmis]);
  // Damper sekmesi kaynağı: aralık seçiliyse toplanmış aralık verisi, değilse tek gün
  const damperKaynak = useMemo(() => {
    const liste = aralikModu ? rangeKayitlar : kayitlar;
    const q = trAramaNormalize(arama.trim());
    if (!q) return liste;
    return liste.filter((k) => trAramaNormalize([k.plaka, k.surucu, k.marka, k.model].filter(Boolean).join(" ")).includes(q));
  }, [aralikModu, rangeKayitlar, kayitlar, arama]);
  const damperGruplar = useMemo(() => gruplaSantiye(damperKaynak), [gruplaSantiye, damperKaynak]);

  // Tüm damper olay noktaları (koordinat veya adresli) — tek haritada göstermek için
  const tumNoktalar = useMemo(() => {
    const pts: { plaka: string; saat: string | null; adres: string | null; lat: number | null; lng: number | null }[] = [];
    for (const k of damperKaynak) {
      for (const o of (Array.isArray(k.damper_olaylar) ? k.damper_olaylar : [])) {
        const lat = o.lat ?? null; const lng = o.lng ?? null;
        if ((lat != null && lng != null) || o.adres) pts.push({ plaka: k.plaka, saat: o.saat ?? null, adres: o.adres ?? null, lat, lng });
      }
    }
    return pts;
  }, [damperKaynak]);

  // Tüm damperleri haritada göster — Leaflet yükle, adresleri geocode et, işaretle
  useEffect(() => {
    if (!tumHaritaAcik) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      setHaritaYukleniyor(true);
      try {
        const L = (await import("leaflet")).default;
        if (iptal || !mapRef.current) return;
        map = L.map(mapRef.current).setView([39, 35], 6);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(map);
        setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 200); // modal içi boyut düzeltme
        const plakaRenk = new Map<string, string>();
        // GERÇEK koordinatı olmayan (yalnız adresli) noktalar için geocode et
        const benzersizAdres = [...new Set(tumNoktalar.filter((p) => !(p.lat != null && p.lng != null) && p.adres).map((p) => p.adres as string))];
        const koord = new Map<string, { lat: number; lng: number }>();
        for (const adr of benzersizAdres) {
          if (iptal) return;
          const c = await geocodeAdres(adr);
          if (c) koord.set(adr, c);
          await new Promise((r) => setTimeout(r, 200)); // sunucu route nezaketi hallediyor
        }
        if (iptal || !map) return;
        const bounds: [number, number][] = [];
        // KML export için çözülen GERÇEK koordinatlı noktalar (spiral offset'siz)
        const cozulen: { plaka: string; saat: string | null; adres: string | null; lat: number; lng: number }[] = [];
        // Aynı koordinata düşen noktaları üst üste bindirmemek için altın-açı spiraliyle hafifçe yelpazele
        const kullanim = new Map<string, number>();
        for (const p of tumNoktalar) {
          const c = (p.lat != null && p.lng != null) ? { lat: p.lat, lng: p.lng } : (p.adres ? koord.get(p.adres) : null);
          if (!c) continue;
          // KML'e gerçek (offset'siz) koordinatı yaz
          cozulen.push({ plaka: p.plaka, saat: p.saat, adres: p.adres, lat: c.lat, lng: c.lng });
          let renk = plakaRenk.get(p.plaka);
          if (!renk) { renk = HARITA_RENKLER[plakaRenk.size % HARITA_RENKLER.length]; plakaRenk.set(p.plaka, renk); }
          const key = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;
          const n = kullanim.get(key) ?? 0; kullanim.set(key, n + 1);
          const aci = n * 2.39996; // altın açı
          const yari = n === 0 ? 0 : 0.0006 * Math.sqrt(n); // ~60m adım
          const lat = c.lat + yari * Math.cos(aci);
          const lng = c.lng + yari * Math.sin(aci);
          L.circleMarker([lat, lng], { radius: 7, color: renk, fillColor: renk, fillOpacity: 0.85, weight: 2 })
            .addTo(map).bindPopup(`<b>${p.plaka}</b><br>${p.saat ?? ""}<br>${p.adres ?? ""}`);
          bounds.push([lat, lng]);
        }
        if (!iptal) setCozulenNoktalar(cozulen);
        if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 100);
      } catch { /* leaflet/geocode hata — sessiz */ } finally {
        if (!iptal) setHaritaYukleniyor(false);
      }
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [tumHaritaAcik, tumNoktalar]);

  // Tüm damper noktalarını KML olarak indir (Google Earth / GIS).
  // cozulenNoktalar harita render edilirken doldurulur (gerçek koordinatlar).
  function exportKML() {
    const noktalar = cozulenNoktalar;
    if (noktalar.length === 0) {
      toast.error("Konum çözümlenmedi — harita yüklenmesini bekleyin.", { duration: toastSuresi() });
      return;
    }
    // XML özel karakterlerini kaçır
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    // #rrggbb → KML aabbggrr (alpha,blue,green,red)
    const kmlRenk = (hex: string): string => {
      const h = hex.replace("#", "");
      const rr = h.slice(0, 2), gg = h.slice(2, 4), bb = h.slice(4, 6);
      return `ff${bb}${gg}${rr}`;
    };
    // Plaka → renk (haritadaki ile aynı sıra)
    const plakaRenk = new Map<string, string>();
    for (const p of noktalar) {
      if (!plakaRenk.has(p.plaka)) {
        plakaRenk.set(p.plaka, HARITA_RENKLER[plakaRenk.size % HARITA_RENKLER.length]);
      }
    }
    // Stil tanımları (plaka başına renkli pin)
    const stiller = Array.from(plakaRenk.entries()).map(([plaka, renk], i) => `
    <Style id="plaka${i}">
      <IconStyle>
        <color>${kmlRenk(renk)}</color>
        <scale>1.1</scale>
        <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      </IconStyle>
      <LabelStyle><scale>0.8</scale></LabelStyle>
    </Style>`).join("");
    const plakaStilIdx = new Map(Array.from(plakaRenk.keys()).map((p, i) => [p, i]));
    // Placemark'lar — KML koordinat sırası: LNG,LAT,YÜKSEKLİK
    const placemarks = noktalar.map((p) => {
      const idx = plakaStilIdx.get(p.plaka) ?? 0;
      const aciklama = [p.saat ?? "", p.adres ?? ""].filter(Boolean).join(" · ");
      return `
    <Placemark>
      <name>${esc(p.plaka)}</name>
      <description>${esc(aciklama)}</description>
      <styleUrl>#plaka${idx}</styleUrl>
      <Point><coordinates>${p.lng.toFixed(6)},${p.lat.toFixed(6)},0</coordinates></Point>
    </Placemark>`;
    }).join("");
    const baslik = bitisTarih && rangeBas
      ? `Damper ${rangeBas} - ${bitisTarih}`
      : `Damper ${seciliTarih}`;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(baslik)}</name>${stiller}${placemarks}
  </Document>
</kml>`;
    const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baslik.replace(/[^\w-]+/g, "_")}.kml`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${noktalar.length} damper noktası KML olarak indirildi.`, { duration: toastSuresi() });
  }

  function exportExcel() {
    const headers = ["Şantiye", "Plaka", "Sürücü", "Marka", "Model", "Mesafe (km)", "Gen. Ort Km", "Damper", "Gen. Ort Damper", "Hareket Süresi", "Kontak Açık", "Rölanti", "Maks Hız (km/s)"];
    // Şantiye gruplarına göre sıralı dök
    const data = gruplar.flatMap((g) => g.kayitlar.map((k) => {
      const ort = ortalamalar.get(k.plaka);
      return [
        g.ad, k.plaka, k.surucu ?? "", k.marka ?? "", k.model ?? "",
        k.mesafe_km ?? "", ort ? Number(ort.ortKm.toFixed(1)) : "", k.damper_sayisi ?? 0, ort ? Number(ort.ortDamper.toFixed(1)) : "",
        formatSure(k.hareket_sn), formatSure(k.kontak_sn), formatSure(k.rolanti_sn), k.maks_hiz ?? "",
      ];
    }));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Arvento");
    XLSX.writeFile(wb, `arvento-${seciliTarih}.xlsx`);
  }

  if (!yGor) {
    return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }
  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Satellite size={24} /> Arvento Araç Çalışma Raporu
          </h1>
          <p className="text-xs text-gray-500 mt-1">Her gece otomatik gelen rapordan araç bazlı mesafe ve çalışma süreleri.</p>
        </div>
        {yEkle && (
          <div className="flex gap-2">
            {/* Mailden Çek — inbox'taki raporu cron'u beklemeden anında işler */}
            <Button size="sm" variant="outline" className="gap-1" disabled={maildenCekiliyor || yukleniyor}
              onClick={maildenCek}
              title="Arvento mailini şimdi kontrol et ve içe aktar">
              {maildenCekiliyor ? <RefreshCw size={14} className="animate-spin" /> : <Satellite size={14} />}
              Mailden Çek
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) dosyaYukle(f); }} />
            <Button size="sm" variant="outline" className="gap-1" disabled={yukleniyor || maildenCekiliyor}
              onClick={() => fileRef.current?.click()}>
              {yukleniyor ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
              Excel Yükle
            </Button>
          </div>
        )}
      </div>

      {/* Filtreler + özet */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Rapor Tarihi</Label>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => gunGez(-1)} disabled={tarihIdx <= 0}
              title="Önceki gün" className="h-9 w-8 flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronLeft size={16} />
            </button>
            <select value={seciliTarih} onChange={(e) => setSeciliTarih(e.target.value)} className={selectClass + " min-w-[160px]"}>
              {tarihler.length === 0 && <option value="">Kayıt yok</option>}
              {tarihler.map((t) => <option key={t} value={t}>{formatTarih(t)}</option>)}
            </select>
            <button type="button" onClick={() => gunGez(1)} disabled={tarihIdx < 0 || tarihIdx >= tarihlerAsc.length - 1}
              title="Sonraki gün" className="h-9 w-8 flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Ara</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
              placeholder="Plaka, sürücü, marka..." className={selectClass + " pl-8 w-52"} />
          </div>
        </div>
        <div className="ml-auto flex items-end gap-4">
          <div className="text-xs text-gray-600 text-right leading-relaxed">
            <div>Araç: <strong>{ozet.sayi}</strong> · Çalışan: <strong className="text-emerald-700">{ozet.calisan}</strong></div>
            <div>Toplam: <strong className="text-[#1E3A5F]">{formatKm(ozet.toplamKm)} km</strong> · Damper: <strong className="text-orange-600">{ozet.toplamDamper}</strong> · Hareket: <strong>{formatSure(ozet.toplamHareket)}</strong></div>
          </div>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs" disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {/* Sekmeler */}
      <div className="flex gap-1 mb-3 border-b">
        {([["calisma", "Araç Çalışma Raporu"], ["genel", "Damper Detay"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setAktifSekme(key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              aktifSekme === key ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tablo */}
      {filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Satellite size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{seciliTarih ? "Bu tarihte kayıt yok." : "Henüz rapor yok. Excel yükleyin veya gece otomatik gelmesini bekleyin."}</p>
        </div>
      ) : aktifSekme === "calisma" ? (
        // ---- SEKME 1: ARAÇ ÇALIŞMA RAPORU (km / süre) ----
        <div className="bg-white rounded-lg border overflow-auto max-h-[75vh]">
          <Table noWrapper>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Araç</TableHead>
                <TableHead className="text-white text-[11px] px-2">Sürücü</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Damper</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Route size={12} className="inline" /> Mesafe (km)</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Gen. Ort Km</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Clock size={12} className="inline" /> Hareket</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Kontak Açık</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Rölanti</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right"><Gauge size={12} className="inline" /> Maks Hız</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gruplar.map((g) => (
                <Fragment key={g.ad}>
                  <TableRow className="bg-blue-50 hover:bg-blue-50">
                    <TableCell colSpan={10} className="px-2 py-1.5 text-[12px] font-bold text-[#1E3A5F]">
                      📍 {g.ad}
                      <span className="ml-2 text-[10px] font-normal text-gray-500">{g.kayitlar.length} araç · çalışan {g.calisan} · {formatKm(g.toplamKm)} km · {g.toplamDamper} damper</span>
                    </TableCell>
                  </TableRow>
                  {g.kayitlar.map((k) => {
                    const calisti = (k.hareket_sn ?? 0) > 0 || (k.mesafe_km ?? 0) > 0;
                    const ort = ortalamalar.get(k.plaka);
                    const kmFark = (k.mesafe_km ?? 0) - (ort?.ortKm ?? 0);
                    const farkClass = (f: number) => f > 0.05 ? "text-emerald-600" : f < -0.05 ? "text-red-500" : "text-gray-400";
                    return (
                      <TableRow key={k.id} className={`text-xs hover:bg-gray-50 ${calisti ? "" : "opacity-50"}`}>
                        <TableCell className="px-2 pl-4 font-bold text-[#1E3A5F] whitespace-nowrap">{k.plaka}</TableCell>
                        <TableCell className="px-2 text-gray-600 max-w-[150px] truncate">{[k.marka, k.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="px-2 max-w-[130px] truncate">{k.surucu ?? "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold text-orange-600">{k.damper_sayisi ?? 0}</TableCell>
                        <TableCell className={`px-2 text-right tabular-nums font-semibold ${farkClass(kmFark)}`}>{formatKm(k.mesafe_km)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-400">{ort ? formatKm(ort.ortKm) : "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums">{formatSure(k.hareket_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.kontak_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.rolanti_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums">{k.maks_hiz != null ? `${k.maks_hiz} km/s` : "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        // ---- SEKME 2: GENEL RAPOR (Damper İndirme) — 2 sütunlu kart düzeni ----
        <div className="overflow-auto max-h-[75vh] space-y-4">
          {/* Tarih aralığı — takvimli başlangıç/bitiş, çok günlük damper toplamı */}
          <div className="flex flex-wrap items-end gap-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Başlangıç</Label>
              <input type="date" value={rangeBas} onChange={(e) => setRangeBas(e.target.value)} className={selectClass} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Bitiş</Label>
              <input type="date" value={bitisTarih} min={rangeBas || undefined} onChange={(e) => setBitisTarih(e.target.value)} className={selectClass} />
            </div>
            {(rangeBas || bitisTarih) && (
              <button type="button" onClick={() => { setRangeBas(""); setBitisTarih(""); }}
                className="h-9 px-2 text-[11px] rounded-lg border bg-white hover:bg-gray-100 mb-px">Temizle</button>
            )}
            <div className="text-xs pb-2">
              {aralikModu
                ? <span className="text-[#1E3A5F] font-semibold">{Math.round((new Date(bitisTarih).getTime() - new Date(rangeBas).getTime()) / 86400000) + 1} gün · {rangeKayitlar.reduce((s, k) => s + (k.damper_sayisi ?? 0), 0)} toplam damper</span>
                : <span className="text-gray-500">Başlangıç ve bitiş seçince aralığın toplam damperi gösterilir. Boşsa seçili gün ({formatTarih(seciliTarih)}).</span>}
            </div>
          </div>
          {/* Yanlış (art arda) damper kaldırma eşiği — yalnız tek gün */}
          {!aralikModu && (
            <div className="flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span className="font-semibold text-amber-800">Yanlış kaldırma eşiği:</span>
              <input type="number" min={0} value={mukerrerDk}
                onChange={(e) => setMukerrerDk(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-16 h-7 rounded border border-amber-300 px-2 text-center" /> dk
              <span className="text-gray-500">Bu süre içinde art arda gelen damper indirmeleri sayılmaz (gri görünür).</span>
            </div>
          )}
          <div>
            <Button size="sm" variant="outline" className="gap-1" disabled={tumNoktalar.length === 0}
              onClick={() => setTumHaritaAcik(true)}>
              <MapPin size={14} /> Tüm Damperleri Haritada Gör ({tumNoktalar.length})
            </Button>
          </div>
          {damperGruplar.map((g) => {
            // Sadece damperle alakalı araçlar: damper geçmişi olan veya o gün damper yapanlar
            const damperKayitlar = g.kayitlar.filter((k) => (ortalamalar.get(k.plaka)?.ortDamper ?? 0) > 0 || (k.damper_sayisi ?? 0) > 0);
            if (damperKayitlar.length === 0) return null;
            return (
              <div key={g.ad}>
                <div className="text-[12px] font-bold text-[#1E3A5F] mb-2">
                  📍 {g.ad}
                  <span className="ml-2 text-[10px] font-normal text-gray-500">{damperKayitlar.length} araç</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {damperKayitlar.map((k) => {
                    const ort = ortalamalar.get(k.plaka);
                    const olaylar = Array.isArray(k.damper_olaylar) ? k.damper_olaylar : [];
                    // Eşik içinde art arda gelen damper indirmelerini "haric" işaretle (sayılmaz).
                    // Aralık modunda eşik uygulanmaz (gün-içi kavramı), tüm olaylar sayılır.
                    const esik = aralikModu ? 0 : mukerrerDk;
                    let sonDk = -Infinity;
                    const isaretli = olaylar.map((o) => {
                      const dk = saatToDk(o.saat);
                      const haric = esik > 0 && dk != null && (dk - sonDk) < esik;
                      if (!haric && dk != null) sonDk = dk;
                      return { o, haric };
                    });
                    const sayilan = isaretli.filter((x) => !x.haric).length;
                    const haricSayi = olaylar.length - sayilan;
                    const dmpFark = sayilan - (ort?.ortDamper ?? 0);
                    // Aralık modunda sayı çok günlük toplam → nötr; tek günde ortalamaya göre renk
                    const farkClass = aralikModu ? "text-[#1E3A5F]" : dmpFark > 0.05 ? "text-emerald-600" : dmpFark < -0.05 ? "text-red-500" : "text-gray-700";
                    const acilabilir = olaylar.length > 0;
                    const acik = acilabilir && !kapaliPlakalar.has(k.plaka); // varsayılan açık
                    const ps = plakaSantiye.get(plakaNorm(k.plaka));
                    const markaModel = [k.marka ?? ps?.marka, k.model ?? ps?.model].filter(Boolean).join(" ");
                    const soforAd = k.surucu ?? ort?.surucu ?? null; // gün boşsa temsilî şoför
                    return (
                      <div key={k.id} className={`border rounded-lg bg-white ${sayilan > 0 ? "" : "opacity-50"}`}>
                        <button
                          type="button"
                          onClick={() => acilabilir && toggleOlay(k.plaka)}
                          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 ${acilabilir ? "cursor-pointer hover:bg-gray-50" : "cursor-default"}`}
                        >
                          <div className="min-w-0">
                            <div className="font-bold text-[#1E3A5F] flex items-center gap-1 whitespace-nowrap">
                              {acilabilir && <ChevronRight size={12} className={`transition-transform ${acik ? "rotate-90" : ""}`} />}
                              {k.plaka}
                            </div>
                            <div className="text-[11px] text-gray-700 truncate">{markaModel || "—"}</div>
                            <div className="text-[10px] text-gray-500 truncate">Şoför: {soforAd ?? "—"}</div>
                            <div className="text-[10px] text-gray-600 flex items-center gap-1">
                              <Route size={10} className="text-gray-400" /> Mesafe: <strong>{k.mesafe_km != null ? `${formatKm(k.mesafe_km)} km` : "—"}</strong>
                            </div>
                          </div>
                          <div className="text-right whitespace-nowrap">
                            <div className={`text-lg font-bold tabular-nums ${farkClass}`}>
                              {sayilan}{haricSayi > 0 && <span className="text-[10px] font-normal text-gray-400"> /{olaylar.length}</span>}
                            </div>
                            <div className="text-[9px] text-gray-400">damper · ort {ort ? ort.ortDamper.toLocaleString("tr-TR", { maximumFractionDigits: 1 }) : "—"}</div>
                          </div>
                        </button>
                        {acik && (
                          <div className="border-t bg-amber-50/40 px-3 py-2">
                            <div className="text-[10px] font-semibold text-gray-500 mb-1">
                              {sayilan} damper indirme{haricSayi > 0 ? ` · ${haricSayi} sayılmadı` : ""}
                            </div>
                            <ol className="space-y-0.5">
                              {isaretli.map(({ o, haric }, i) => (
                                <li key={i} className={`text-xs flex items-center gap-2 ${haric ? "opacity-60" : ""}`}>
                                  <span className="text-gray-400 w-5 text-right">{i + 1}.</span>
                                  <span className={`font-mono whitespace-nowrap ${haric ? "text-gray-400 line-through" : "font-semibold text-orange-700"}`}>🔻 {o.saat ?? "—"}</span>
                                  <span className={`flex-1 truncate ${haric ? "text-gray-400" : "text-gray-600"}`}>{o.adres ?? "—"}</span>
                                  {(o.harita || o.adres) && (
                                    <button type="button"
                                      onClick={() => setHarita({ baslik: o.adres ?? "Konum", adres: o.adres ?? "", arvento: o.harita ?? null, koord: (o.lat != null && o.lng != null) ? { lat: o.lat, lng: o.lng } : null })}
                                      className="flex-shrink-0 text-[10px] text-blue-600 hover:underline flex items-center gap-0.5"
                                      title="Haritada göster">
                                      <MapPin size={10} /> Harita
                                    </button>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Haritada göster — sayfa içi PENCERE: Google embed (görünür) + Arvento kesin konum */}
      {harita && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex flex-col" onClick={() => setHarita(null)}>
          <div className="bg-[#1E3A5F] text-white px-4 py-2 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <MapPin size={18} className="flex-shrink-0" />
              <span className="text-sm truncate">{harita.baslik}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {harita.arvento && (
                <a href={harita.arvento} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 rounded text-xs font-semibold" title="Arvento'da kesin konum (yeni sekme, giriş gerekir)">Arvento (kesin) ↗</a>
              )}
              <a href={`https://www.google.com/maps/search/?api=1&query=${harita.koord ? `${harita.koord.lat},${harita.koord.lng}` : encodeURIComponent(harita.adres)}`}
                target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded text-xs">Google ↗</a>
              <button type="button" onClick={() => setHarita(null)} className="p-1.5 hover:bg-white/10 rounded" title="Kapat">
                <X size={18} />
              </button>
            </div>
          </div>
          {!harita.koord && (
            <div className="bg-amber-100 text-amber-900 text-[11px] px-4 py-1 text-center" onClick={(e) => e.stopPropagation()}>
              Bu olayda GPS koordinatı yok; harita adres (yaklaşık) gösterir. <strong>Kesin konum</strong> için “Arvento (kesin)”.
            </div>
          )}
          <div className="flex-1 bg-white" onClick={(e) => e.stopPropagation()}>
            <iframe title="Harita" className="w-full h-full border-0"
              src={harita.koord
                ? `https://www.google.com/maps?q=${harita.koord.lat},${harita.koord.lng}&z=17&output=embed`
                : `https://www.google.com/maps?q=${encodeURIComponent(harita.adres)}&z=15&output=embed`} />
          </div>
        </div>
      )}

      {/* Tüm damperler tek haritada (Leaflet + OpenStreetMap) */}
      {tumHaritaAcik && (
        <div className="fixed inset-0 z-[100] bg-black/70 flex flex-col" onClick={() => setTumHaritaAcik(false)}>
          <div className="bg-[#1E3A5F] text-white px-4 py-2 flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <MapPin size={18} className="flex-shrink-0" />
              <span className="text-sm truncate">Tüm Damper İndirmeleri — {tumNoktalar.length} nokta {haritaYukleniyor ? "· yükleniyor…" : ""}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* KML olarak indir — Google Earth / GIS uygulamalarında açılır */}
              <button
                type="button"
                onClick={exportKML}
                disabled={haritaYukleniyor || cozulenNoktalar.length === 0}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:bg-white/20 disabled:cursor-not-allowed rounded"
                title="Tüm damper noktalarını KML olarak indir (Google Earth)"
              >
                <Download size={14} /> KML İndir
              </button>
              <button type="button" onClick={() => setTumHaritaAcik(false)} className="p-1.5 hover:bg-white/10 rounded" title="Kapat">
                <X size={18} />
              </button>
            </div>
          </div>
          <div className="bg-amber-100 text-amber-900 text-[11px] px-4 py-1 text-center" onClick={(e) => e.stopPropagation()}>
            Konumlar adres (mahalle) bazlı yaklaşıktır; renkler aracı, baloncuk plaka/saat/adresi gösterir. İlk açılış geocoding nedeniyle birkaç saniye sürebilir.
          </div>
          <div ref={mapRef} className="flex-1 bg-gray-100" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
