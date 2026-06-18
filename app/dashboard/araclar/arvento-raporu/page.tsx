// Arvento Araç Çalışma Raporu — günlük rapor (Plaka, Mesafe, Süre, Hız)
"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useAuth } from "@/hooks";
import { getArventoRaporByRange, getArventoHamKayitlar, hesaplaOrtalamalar, getPlakaSantiyeMap, plakaNorm, type ArventoOrtalama, type ArventoHamKayit, type PlakaSantiye } from "@/lib/supabase/queries/arvento";
import type { AracArventoRapor } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Satellite, Search, Upload, FileSpreadsheet, RefreshCw, Gauge, Route, Clock, ChevronLeft, ChevronRight, Layers, Trash2, Eye, EyeOff } from "lucide-react";
import * as XLSX from "xlsx";
import ArventoGuzergah from "@/components/shared/arvento-guzergah";
import ArventoStabilize from "@/components/shared/arvento-stabilize";
import ArventoOperasyon from "@/components/shared/arvento-operasyon";
import ArventoTumu from "@/components/shared/arvento-tumu";
import { OPERASYONLAR, OPERASYON_SIRA } from "@/lib/arvento/operasyonlar";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { trAramaNormalize } from "@/lib/utils/isim";
import { createClient } from "@/lib/supabase/client";
import { getHaritaKatmanlari, ekleHaritaKatman, silHaritaKatman, guncelleHaritaKatman, type HaritaKatman } from "@/lib/supabase/queries/arvento-katman";
import { dosyadanGeometriler } from "@/lib/arvento/kml-parse";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

// Cevabı güvenle JSON'a çevir. Sunucu JSON yerine düz metin/HTML dönerse
// (örn. Vercel'in "Request Entity Too Large" 413 sayfası), "Unexpected token" yerine
// anlaşılır bir hata fırlat.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function guvenliJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    if (res.status === 413) {
      throw new Error("Dosya sunucu boyut sınırını aşıyor. Daha küçük bir dosya deneyin.");
    }
    const ozet = text.trim().replace(/\s+/g, " ").slice(0, 120) || `HTTP ${res.status}`;
    throw new Error(`Sunucu beklenmeyen bir cevap döndü (${res.status}): ${ozet}`);
  }
}

// Hata metnini güvenle çıkar. Supabase hataları Error değil düz nesnedir (message/details/hint/code)
// → String(err) "[object Object]" verir. Bu yardımcı gerçek mesajı döndürür.
function hataMetni(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return e.message || e.details || e.hint || (e.code ? `Hata kodu: ${e.code}` : JSON.stringify(err));
  }
  return String(err);
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

// Bugün (TR saati) — YYYY-MM-DD
function trBugun(): string {
  const now = new Date();
  const tr = new Date(now.getTime() + (3 * 60 - now.getTimezoneOffset()) * 60000);
  return tr.toISOString().slice(0, 10);
}

// Bir YYYY-MM-DD tarihine gün ekler/çıkarır
function gunEkle(tarih: string, delta: number): string {
  const d = new Date((tarih || trBugun()) + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Tarih aralığındaki kayıtları PLAKAYA göre topla (çok günlük km/damper toplamı).
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
  // Tarih aralığı — başlangıç & bitiş; varsayılan ikisi de bugün (tek gün). Manuel değiştirilebilir.
  const [baslangic, setBaslangic] = useState<string>(trBugun());
  const [bitis, setBitis] = useState<string>(trBugun());
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  // Ham günlük kayıtlar (tüm geçmiş) — ortalama hesabı için. Bir kez çekilir.
  const [hamKayitlar, setHamKayitlar] = useState<ArventoHamKayit[]>([]);
  // Km eşiği: bu değeri AŞAN günlük km'ler ortalamaya KATILMAZ (0 = filtre yok).
  const [kmEsik, setKmEsik] = useState<number>(0);
  // Plaka başına ortalama — ham kayıtlardan kmEsik filtresiyle client-side hesaplanır.
  const ortalamalar = useMemo<Map<string, ArventoOrtalama>>(
    () => hesaplaOrtalamalar(hamKayitlar, kmEsik),
    [hamKayitlar, kmEsik],
  );
  const [plakaSantiye, setPlakaSantiye] = useState<Map<string, PlakaSantiye>>(new Map());
  const [arama, setArama] = useState("");
  // İş Makineleri sekmesi — cins filtresi ("" = tüm iş makineleri = sayaç tipi "saat")
  const [ismakineCins, setIsmakineCins] = useState<string>("");
  // Sekme anahtarları:
  //  calisma=Araç Çalışma Raporu, guzergah=Reglaj, genel=Stabilize,
  //  serme=Serme, sikistirma=Sıkıştırma, tanimlamalar=Tanımlamalar
  const [aktifSekme, setAktifSekme] = useState<
    "calisma" | "ismakine" | "guzergah" | "genel" | "serme" | "sikistirma" | "tumu" | "tanimlamalar"
  >("calisma");
  // Güzergah (Reglaj) yüklemeden sonra yeniden yüklensin diye tetikleyici
  const [guzergahRefresh, setGuzergahRefresh] = useState(0);
  // Yanlış (art arda) damper kaldırma eşiği (dk) — localStorage'da kalıcı
  const [mukerrerDk, setMukerrerDk] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("arvento_mukerrer_dk");
    return v != null ? (parseInt(v, 10) || 0) : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("arvento_mukerrer_dk", String(mukerrerDk));
  }, [mukerrerDk]);
  // Güzergah tekrar eşiği — Reglaj/Stabilize'de bir yol parçasından en az kaç kez
  // geçilince TEK çizgi gösterileceği (0 = sadeleştirme yok, ham rota). localStorage'da kalıcı.
  const [guzergahTekrar, setGuzergahTekrar] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("arvento_guzergah_tekrar");
    return v != null ? (parseInt(v, 10) || 0) : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("arvento_guzergah_tekrar", String(guzergahTekrar));
  }, [guzergahTekrar]);
  // Silindir (Sıkıştırma) tekrar eşiği — bir yol parçasından bu sayı ve üzeri silindir
  // geçişi varsa zikzak çizilir, altındakiler çizilmez. localStorage'da kalıcı.
  const [silindirTekrar, setSilindirTekrar] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    const v = window.localStorage.getItem("arvento_silindir_tekrar");
    return v != null ? (parseInt(v, 10) || 0) : 0;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("arvento_silindir_tekrar", String(silindirTekrar));
  }, [silindirTekrar]);
  // Yan yana çizgi mesafesi (m) — sadeleştirme ızgara toleransı. İki geçiş bu mesafeden
  // uzaksa "aynı güzergah" sayılmaz (tekrara katılmaz). localStorage'da kalıcı, varsayılan 12.
  const [gridMesafe, setGridMesafe] = useState<number>(() => {
    if (typeof window === "undefined") return 12;
    const v = window.localStorage.getItem("arvento_grid_mesafe");
    return v != null ? (parseInt(v, 10) || 12) : 12;
  });
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("arvento_grid_mesafe", String(gridMesafe));
  }, [gridMesafe]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [maildenCekiliyor, setMaildenCekiliyor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Harita katmanları (NetCAD/KML) — Tanımlamalar'dan yüklenir, tüm haritalarda gösterilir
  const [haritaKatmanlari, setHaritaKatmanlari] = useState<HaritaKatman[]>([]);
  const [katmanYukleniyor, setKatmanYukleniyor] = useState(false);
  const [katmanRenk, setKatmanRenk] = useState<string>("#ff3b30");
  const katmanFileRef = useRef<HTMLInputElement>(null);

  const loadKayitlar = useCallback(async () => {
    if (!baslangic || !bitis) { setKayitlar([]); setLoading(false); return; }
    try {
      const [k, ps] = await Promise.all([
        getArventoRaporByRange(baslangic, bitis),
        getPlakaSantiyeMap(bitis),
      ]);
      // Aralıktaki günleri plaka bazında topla (tek gün ise zaten tek satır)
      setKayitlar(aralikTopla(k));
      setPlakaSantiye(ps);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("arac_arvento_rapor")) {
        toast.error("arac_arvento_rapor tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
      }
    } finally { setLoading(false); }
  }, [baslangic, bitis]);

  useEffect(() => { loadKayitlar(); }, [loadKayitlar]);

  // Ham günlük kayıtları bir kez çek (ortalama hesabı için). Tarih değişse de yeniden çekmeye gerek yok.
  useEffect(() => {
    getArventoHamKayitlar().then(setHamKayitlar).catch(() => { /* sessiz */ });
  }, []);

  // Mailden çek — inbox'taki Arvento rapor mailini anında işle (cron'u beklemeden)
  async function maildenCek() {
    setMaildenCekiliyor(true);
    try {
      const res = await fetch("/api/arvento/mailden-cek", { method: "POST" });
      const data = await guvenliJson(res);
      if (!res.ok) throw new Error(data.error ?? "Mailden çekilemedi");
      if (data.ok) {
        toast.success(`Mailden çekildi — ${data.mesaj}`, { duration: toastSuresi() });
        const yeniTarih: string | undefined = data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih;
        if (yeniTarih) { setBaslangic(yeniTarih); setBitis(yeniTarih); } // effect loadKayitlar'ı tetikler
        else await loadKayitlar();
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
      // Büyük .xlsx dosyaları Vercel'in ~4.5MB istek limitine takılmasın diye:
      // dosyayı imzalı URL ile DOĞRUDAN Supabase Storage'a yükle, sonra sunucuya
      // sadece { bucket, path } referansını gönder (sunucu Storage'dan okuyup işler).
      const imzaRes = await fetch("/api/arvento/yukle-imza", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dosyaAdi: file.name }),
      });
      const imza = await guvenliJson(imzaRes);
      if (!imzaRes.ok) throw new Error(imza.error ?? "Yükleme hazırlanamadı");

      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(imza.bucket)
        .uploadToSignedUrl(imza.path, imza.token, file, {
          contentType: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
      if (upErr) throw new Error(`Dosya yüklenemedi: ${upErr.message}`);

      const res = await fetch("/api/arvento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bucket: imza.bucket, path: imza.path }),
      });
      const data = await guvenliJson(res);
      if (!res.ok) throw new Error(data.error ?? "İçe aktarılamadı");
      toast.success(data.mesaj ?? "İçe aktarıldı.", { duration: toastSuresi() });
      // İçe aktarılan ilk çalışma/damper günü (güzergah varsa onun günü) aralık olarak seçilsin
      const yeniTarih: string | undefined =
        data.guzergahGunler?.[0]?.tarih ?? data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih;
      if (yeniTarih) { setBaslangic(yeniTarih); setBitis(yeniTarih); } // effect loadKayitlar'ı tetikler
      else await loadKayitlar();
      // Güzergah (Mesafe Bilgisi) yüklendiyse Reglaj'a geç + yenile
      if (data.guzergahGunler && data.guzergahGunler.length > 0) {
        setGuzergahRefresh((x) => x + 1);
        setAktifSekme("guzergah");
      }
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally {
      setYukleniyor(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Oklarla tek gün ileri-geri: başlangıç & bitiş aynı güne ayarlanır (referans = bitiş)
  function gunGez(delta: number) {
    const yeni = gunEkle(bitis || baslangic, delta);
    setBaslangic(yeni);
    setBitis(yeni);
  }

  // ----- Harita katmanları (NetCAD/KML) -----
  const loadKatmanlar = useCallback(async () => {
    try { setHaritaKatmanlari(await getHaritaKatmanlari()); } catch { /* sessiz */ }
  }, []);
  useEffect(() => { loadKatmanlar(); }, [loadKatmanlar]);

  async function katmanYukle(file: File) {
    setKatmanYukleniyor(true);
    try {
      const geometriler = await dosyadanGeometriler(file);
      const ad = file.name.replace(/\.(kml|kmz)$/i, "");
      await ekleHaritaKatman({ ad, renk: katmanRenk, geometriler });
      const sayilar = geometriler.reduce((a, g) => { a[g.tip] = (a[g.tip] ?? 0) + 1; return a; }, {} as Record<string, number>);
      toast.success(`"${ad}" eklendi — ${sayilar.cizgi ?? 0} çizgi, ${sayilar.alan ?? 0} alan, ${sayilar.nokta ?? 0} nokta.`, { duration: toastSuresi() });
      await loadKatmanlar();
      setGuzergahRefresh((x) => x + 1); // açık haritalar yenilensin
    } catch (err) {
      toast.error(`Katman eklenemedi: ${hataMetni(err)}`, { duration: toastSuresi() });
    } finally {
      setKatmanYukleniyor(false);
      if (katmanFileRef.current) katmanFileRef.current.value = "";
    }
  }

  async function katmanSil(id: string, ad: string) {
    if (!window.confirm(`"${ad}" katmanı silinsin mi?`)) return;
    try {
      await silHaritaKatman(id);
      await loadKatmanlar();
      setGuzergahRefresh((x) => x + 1);
      toast.success("Katman silindi.", { duration: toastSuresi() });
    } catch (err) {
      toast.error(`Silinemedi: ${hataMetni(err)}`, { duration: toastSuresi() });
    }
  }

  async function katmanDegis(id: string, alanlar: Partial<Pick<HaritaKatman, "ad" | "renk" | "gorunur">>) {
    // İyimser güncelle (anında yansısın), sonra DB
    setHaritaKatmanlari((list) => list.map((k) => (k.id === id ? { ...k, ...alanlar } : k)));
    try {
      await guncelleHaritaKatman(id, alanlar);
      setGuzergahRefresh((x) => x + 1);
    } catch (err) {
      toast.error(`Güncellenemedi: ${hataMetni(err)}`, { duration: toastSuresi() });
      await loadKatmanlar();
    }
  }

  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return kayitlar;
    return kayitlar.filter((k) =>
      trAramaNormalize([k.plaka, k.surucu, k.marka, k.model].filter(Boolean).join(" ")).includes(q),
    );
  }, [kayitlar, arama]);

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

  // İş Makineleri: araç cinsleri (filtre seçeneği) + cinse göre süzülmüş kayıtlar.
  // Cins seçilmemişse varsayılan: sayaç tipi "saat" olanlar (iş makineleri saat çalışır).
  const ismakineCinsler = useMemo(() => {
    const set = new Set<string>();
    for (const k of kayitlar) { const c = plakaSantiye.get(plakaNorm(k.plaka))?.cinsi; if (c) set.add(c); }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [kayitlar, plakaSantiye]);
  const ismakineKayitlar = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    return kayitlar.filter((k) => {
      const ps = plakaSantiye.get(plakaNorm(k.plaka));
      const cinsOk = ismakineCins ? ps?.cinsi === ismakineCins : ps?.sayacTipi === "saat";
      if (!cinsOk) return false;
      if (q && !trAramaNormalize([k.plaka, k.surucu, k.marka, k.model, ps?.cinsi].filter(Boolean).join(" ")).includes(q)) return false;
      return true;
    });
  }, [kayitlar, plakaSantiye, ismakineCins, arama]);

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
    XLSX.writeFile(wb, `arvento-${baslangic === bitis ? baslangic : `${baslangic}_${bitis}`}.xlsx`);
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

      {/* Operasyon renk lejantı — hangi renk hangi katman (harita sekmeleri için) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-[11px] text-gray-600">
        <span className="font-semibold text-gray-500">Harita renkleri:</span>
        {OPERASYON_SIRA.map((op) => (
          <span key={op} className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-1.5 rounded" style={{ background: OPERASYONLAR[op].renk }} />
            {OPERASYONLAR[op].ad}
            {op === "stabilize" && <span className="text-gray-400">(damper ●)</span>}
            {op === "sikistirma" && <span className="text-gray-400">(zikzak)</span>}
          </span>
        ))}
      </div>

      {/* Filtreler + özet */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <button type="button" onClick={() => gunGez(-1)}
          title="Önceki gün (başlangıç = bitiş)" className="h-9 w-8 mb-px flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100">
          <ChevronLeft size={16} />
        </button>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={baslangic} max={bitis || undefined}
            onChange={(e) => setBaslangic(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={bitis} min={baslangic || undefined}
            onChange={(e) => setBitis(e.target.value)} className={selectClass} />
        </div>
        <button type="button" onClick={() => gunGez(1)}
          title="Sonraki gün (başlangıç = bitiş)" className="h-9 w-8 mb-px flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100">
          <ChevronRight size={16} />
        </button>
        {(baslangic !== trBugun() || bitis !== trBugun()) && (
          <button type="button" onClick={() => { const b = trBugun(); setBaslangic(b); setBitis(b); }}
            title="Bugüne dön" className="h-9 px-2 text-[11px] rounded-lg border bg-white hover:bg-gray-100 mb-px">Bugün</button>
        )}
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Ara</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
              placeholder="Plaka, sürücü, marka..." className={selectClass + " pl-8 w-52"} />
          </div>
        </div>
        <div className="ml-auto flex items-end gap-4">
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs" disabled={filtrelenmis.length === 0}>
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {/* Sekmeler — satır kaydırmalı (wrap): yatay scroll olmadan tek ekranda görünür */}
      <div className="flex flex-wrap gap-x-1 gap-y-0.5 mb-3 border-b">
        {([["calisma", "Araç Çalışma Raporu"], ["ismakine", "İş Makineleri"], ["guzergah", "Reglaj"], ["genel", "Stabilize"], ["serme", "Serme"], ["sikistirma", "Sıkıştırma"], ["tumu", "Tümü"], ["tanimlamalar", "Tanımlamalar"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setAktifSekme(key)}
            className={`whitespace-nowrap px-2.5 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors ${
              aktifSekme === key ? "border-[#1E3A5F] text-[#1E3A5F]" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Tablo */}
      {aktifSekme === "ismakine" ? (
        // ---- SEKME: İŞ MAKİNELERİ — cinse göre, Arvento'nun tüm sütunlarıyla detaylı tablo ----
        <div className="space-y-3">
          <div className="bg-white rounded-lg border p-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Cins</Label>
              <select value={ismakineCins} onChange={(e) => setIsmakineCins(e.target.value)} className={selectClass + " min-w-[180px]"}>
                <option value="">Tüm iş makineleri (saat sayaçlı)</option>
                {ismakineCinsler.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="ml-auto text-xs text-gray-600">
              <strong className="text-[#1E3A5F]">{ismakineKayitlar.length}</strong> makine ·{" "}
              <strong>{formatSure(ismakineKayitlar.reduce((s, k) => s + (k.hareket_sn ?? 0), 0))}</strong> toplam çalışma
            </div>
          </div>
          {ismakineKayitlar.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-lg border">
              <Satellite size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Bu aralıkta iş makinesi kaydı yok. (Araçlar tablosunda sayaç tipi &quot;saat&quot; veya cins atanmış olmalı.)</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg border overflow-auto max-h-[75vh]">
              <Table noWrapper>
                <TableHeader className="sticky top-0 z-10">
                  <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                    <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                    <TableHead className="text-white text-[11px] px-2">Cins</TableHead>
                    <TableHead className="text-white text-[11px] px-2">Marka/Model</TableHead>
                    <TableHead className="text-white text-[11px] px-2">Sürücü</TableHead>
                    <TableHead className="text-white text-[11px] px-2">Cihaz No</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right"><Route size={12} className="inline" /> Mesafe (km)</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right"><Clock size={12} className="inline" /> Hareket</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Kontak Açık</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Rölanti</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right"><Gauge size={12} className="inline" /> Maks Hız</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Damper</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ismakineKayitlar.map((k) => {
                    const ps = plakaSantiye.get(plakaNorm(k.plaka));
                    return (
                      <TableRow key={k.id} className="text-xs hover:bg-gray-50">
                        <TableCell className="px-2 font-bold text-[#1E3A5F] whitespace-nowrap">{k.plaka}</TableCell>
                        <TableCell className="px-2 text-gray-600 whitespace-nowrap">{ps?.cinsi ?? "—"}</TableCell>
                        <TableCell className="px-2 text-gray-600 max-w-[150px] truncate">{[k.marka ?? ps?.marka, k.model ?? ps?.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="px-2 max-w-[130px] truncate">{k.surucu ?? "—"}</TableCell>
                        <TableCell className="px-2 text-gray-500 whitespace-nowrap">{k.cihaz_no ?? "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold">{formatKm(k.mesafe_km)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold">{formatSure(k.hareket_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.kontak_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums text-gray-500">{formatSure(k.rolanti_sn)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums">{k.maks_hiz != null ? `${k.maks_hiz} km/s` : "—"}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold text-orange-600">{k.damper_sayisi ?? 0}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : aktifSekme === "guzergah" ? (
        // ---- SEKME 2: REGLAJ — araç güzergahı/rotası (tarih üstteki ana seçiciden) ----
        <ArventoGuzergah bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} gridMesafe={gridMesafe} refreshKey={guzergahRefresh} />
      ) : aktifSekme === "genel" ? (
        // ---- SEKME 3: STABILIZE — güzergah çizgisi + üzerine damper indirme noktaları ----
        <ArventoStabilize bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} gridMesafe={gridMesafe} mukerrerDk={mukerrerDk} refreshKey={guzergahRefresh} />
      ) : aktifSekme === "serme" ? (
        // ---- SEKME 4: SERME — greyder altlı üstlü çizgi (yeşil) + ortada damper ----
        <ArventoOperasyon bas={baslangic} bitis={bitis} operasyon="serme" tekrarEsigi={guzergahTekrar} silindirEsik={silindirTekrar} gridMesafe={gridMesafe} refreshKey={guzergahRefresh} />
      ) : aktifSekme === "sikistirma" ? (
        // ---- SEKME 5: SIKIŞTIRMA — greyder altlı üstlü çizgi + ortada silindir zikzak (mor) ----
        <ArventoOperasyon bas={baslangic} bitis={bitis} operasyon="sikistirma" tekrarEsigi={guzergahTekrar} silindirEsik={silindirTekrar} gridMesafe={gridMesafe} refreshKey={guzergahRefresh} />
      ) : aktifSekme === "tumu" ? (
        // ---- SEKME 6: TÜMÜ — o günün tüm operasyonları tek haritada + lejant ----
        <ArventoTumu bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} silindirEsik={silindirTekrar} gridMesafe={gridMesafe} refreshKey={guzergahRefresh} />
      ) : aktifSekme === "tanimlamalar" ? (
        // ---- SEKME: TANIMLAMALAR — eşik ayarları + harita katmanları (NetCAD/KML) ----
        <div className="space-y-4">
        <div className="bg-white rounded-lg border p-4 space-y-4">
          <div>
            <h3 className="font-bold text-sm text-[#1E3A5F] mb-1">Tanımlamalar</h3>
            <p className="text-xs text-gray-400">
              Araç/makine bazlı eşik ve norm değerleri burada tanımlanacak (damper indirme sayısı,
              araç km, makine çalışma saati). Veri modeli netleşince doldurulacak — şimdilik taslak.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Araç Km — yanlış/anomali kaldırma eşiği (filtre çubuğundan buraya taşındı).
                Bu km'yi AŞAN günler 'Gen. Ort Km' hesabına katılmaz (outlier eleme). */}
            <div className="border rounded-lg p-3 bg-blue-50/40 border-blue-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Araç Km — Ortalama Üst Sınır</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Bu km/gün değerini aşan günler &quot;Gen. Ort Km&quot; hesabına katılmaz (anomali eleme). 0/boş = filtre yok.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={kmEsik || ""}
                  onChange={(e) => setKmEsik(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 500"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">km/gün</span>
                {kmEsik > 0 && (
                  <button type="button" onClick={() => setKmEsik(0)}
                    className="text-gray-400 hover:text-red-500 text-xs px-1" title="Filtreyi temizle">
                    ✕
                  </button>
                )}
              </div>
            </div>
            {/* Yanlış kaldırma eşiği — Stabilize'dan buraya taşındı. Damper sayısından
                FARKLI: bu, art arda gelen yanlış damperleri temizler (zaman bazlı). */}
            <div className="border rounded-lg p-3 bg-amber-50/40 border-amber-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Yanlış Kaldırma Eşiği (dk)</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Stabilize&apos;de bu süre içinde art arda gelen damper indirmeleri tek sayılır (yanlış/mükerrer
                tetikleme temizliği). &quot;Damper İndirme Sayısı&quot;ndan farklıdır. 0 = temizleme yok.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={mukerrerDk || ""}
                  onChange={(e) => setMukerrerDk(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 2"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">dk</span>
                {mukerrerDk > 0 && (
                  <button type="button" onClick={() => setMukerrerDk(0)}
                    className="text-gray-400 hover:text-red-500 text-xs px-1" title="Temizle">✕</button>
                )}
              </div>
            </div>
            {/* Güzergah Tekrar Eşiği — Reglaj & Stabilize haritasında tek çizgi sadeleştirme.
                Greyder gibi aynı hattı defalarca tarayan araçların üst üste binen çizgilerini birleştirir. */}
            <div className="border rounded-lg p-3 bg-emerald-50/40 border-emerald-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Güzergah Tekrar Eşiği — ANA AYAR</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Sadeleştirmeyi açan ana ayar. Bir yoldan <strong>bu sayı ve üzeri</strong> kez geçilmişse
                (greyder gidip-gelmiş) <strong>tek çizgi</strong> gösterilir; <strong>daha az</strong> geçilen
                (örn. 1 kez) parçalar <strong>silinir</strong>. Örn. <strong>3</strong> → 3+ kez gidilen yol tek hat,
                1-2 kezlik sapmalar gizli. <strong>0 = ham rota</strong> (sadeleştirme kapalı).
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={guzergahTekrar || ""}
                  onChange={(e) => setGuzergahTekrar(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 2"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">geçiş</span>
                {guzergahTekrar > 0 && (
                  <button type="button" onClick={() => setGuzergahTekrar(0)}
                    className="text-gray-400 hover:text-red-500 text-xs px-1" title="Sadeleştirmeyi kapat">✕</button>
                )}
              </div>
            </div>
            {/* Silindir Tekrar Eşiği — Sıkıştırma sekmesindeki silindir zikzakı için.
                Bir yol parçasından bu sayı ve üzeri silindir geçişi varsa zikzak çizilir, altı boş kalır. */}
            <div className="border rounded-lg p-3 bg-purple-50/40 border-purple-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Silindir Tekrar Eşiği</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Sıkıştırma&apos;da bir yol parçasından bu sayı <strong>ve üzeri</strong> silindir geçişi varsa
                <strong> zikzak</strong> çizilir; <strong>altındaki</strong> yerler çizilmez (boş kalır). 0 = sadeleştirme yok.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={silindirTekrar || ""}
                  onChange={(e) => setSilindirTekrar(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 2"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">geçiş</span>
                {silindirTekrar > 0 && (
                  <button type="button" onClick={() => setSilindirTekrar(0)}
                    className="text-gray-400 hover:text-red-500 text-xs px-1" title="Sadeleştirmeyi kapat">✕</button>
                )}
              </div>
            </div>
            {/* Yan Yana Çizgi Mesafesi — sadeleştirme ızgara toleransı (m).
                İki geçiş bu mesafeden uzaksa "aynı güzergah" sayılmaz, tekrara katılmaz. */}
            <div className="border rounded-lg p-3 bg-slate-50 border-slate-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Yan Yana Çizgi Mesafesi (m) — yardımcı</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Yan yana şeritleri tek orta hatta toplama yarıçapı (orta hattan ±m). Tekrar Eşiği ≥ 1 iken
                etkilidir. Aynı yolda yan yana sapan şeritler bu bant içindeyse ortalanıp tek hat olur.
                Geniş yol için büyüt (ör. 10-15). Varsayılan 12.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={gridMesafe || ""}
                  onChange={(e) => setGridMesafe(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="12"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">metre</span>
              </div>
            </div>
          </div>
        </div>

        {/* Harita Katmanları (NetCAD/KML) — yüklenen çizgiler tüm haritalara biner */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-sm text-[#1E3A5F] mb-1 flex items-center gap-1.5"><Layers size={16} /> Harita Katmanları</h3>
              <p className="text-xs text-gray-400 max-w-2xl">
                NetCAD vb. çiziminizi <strong>KML/KMZ</strong> olarak yükleyin; tüm Arvento haritalarına
                (Reglaj, Stabilize, Serme, Sıkıştırma, Tümü) referans olarak biner. NetCAD&apos;de: çizimi
                seçip &quot;Google Earth&apos;e Aktar / KML kaydet&quot; ile dosyayı üretin.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-gray-600">
                Renk
                <input type="color" value={katmanRenk} onChange={(e) => setKatmanRenk(e.target.value)}
                  className="h-8 w-10 rounded border cursor-pointer" title="Yeni katman rengi" />
              </label>
              <input ref={katmanFileRef} type="file" accept=".kml,.kmz" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) katmanYukle(f); }} />
              <Button variant="outline" size="sm" onClick={() => katmanFileRef.current?.click()}
                disabled={katmanYukleniyor} className="h-9 gap-1 text-xs">
                <Upload size={14} /> {katmanYukleniyor ? "Yükleniyor..." : "KML/KMZ Yükle"}
              </Button>
            </div>
          </div>

          {haritaKatmanlari.length === 0 ? (
            <p className="text-xs text-gray-400">Henüz katman yok. Yukarıdan bir KML/KMZ yükleyin.</p>
          ) : (
            <ul className="divide-y border rounded-lg overflow-hidden">
              {haritaKatmanlari.map((k) => (
                <li key={k.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <input type="color" value={k.renk} onChange={(e) => katmanDegis(k.id, { renk: e.target.value })}
                    className="h-6 w-7 rounded border cursor-pointer shrink-0" title="Renk" />
                  <span className="font-medium text-gray-800 truncate flex-1">{k.ad}</span>
                  <span className="text-[11px] text-gray-400 shrink-0">{(k.geometriler ?? []).length} geometri</span>
                  <button type="button" onClick={() => katmanDegis(k.id, { gorunur: !k.gorunur })}
                    title={k.gorunur ? "Haritada gizle" : "Haritada göster"}
                    className={`p-1 rounded ${k.gorunur ? "text-emerald-600 hover:bg-emerald-50" : "text-gray-300 hover:bg-gray-100"}`}>
                    {k.gorunur ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                  <button type="button" onClick={() => katmanSil(k.id, k.ad)} title="Sil"
                    className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50">
                    <Trash2 size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        </div>
      ) : filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Satellite size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{baslangic ? "Bu tarih aralığında kayıt yok." : "Henüz rapor yok. Excel yükleyin veya gece otomatik gelmesini bekleyin."}</p>
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
      ) : null}
    </div>
  );
}
