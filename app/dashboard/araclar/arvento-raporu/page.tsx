// Arvento Araç Çalışma Raporu — günlük rapor (Plaka, Mesafe, Süre, Hız)
"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Fragment } from "react";
import { useAuth } from "@/hooks";
import { getArventoRaporByRange, getArventoRaporSonGuncelleme, getArventoHamKayitlar, hesaplaOrtalamalar, getPlakaSantiyeMap, getAraclarAtama, getGuzergahByRange, getMakineCalismaNoktalari, getAnlikKonumlarDirect, getCihazlarDirect, plakaNorm, type ArventoOrtalama, type ArventoHamKayit, type PlakaSantiye, type AracAtama, type MakineNokta } from "@/lib/supabase/queries/arvento";
import { illeriYukle, noktaIzinli, herhangiIzinli, adtanIl, type IlPoligon } from "@/lib/arvento/il-sinir";
import type { KatmanIzin } from "@/lib/arvento/harita-katman";
import { updateArac } from "@/lib/supabase/queries/araclar";
import { ATAMA_SEKMELERI, type ArventoSekme, type SekmeAtamaMap } from "@/lib/arvento/operasyonlar";
import type { AracArventoRapor, AracArventoGuzergah } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Satellite, Upload, RefreshCw, Gauge, Route, Clock, ChevronLeft, ChevronRight, Layers, Trash2, Eye, EyeOff, MapPin } from "lucide-react";
import ArventoGuzergah from "@/components/shared/arvento-guzergah";
import ArventoStabilize from "@/components/shared/arvento-stabilize";
import ArventoOperasyon from "@/components/shared/arvento-operasyon";
import ArventoTumu from "@/components/shared/arvento-tumu";
import type { CanliKonum, CihazMap, HaritaGorunum } from "@/lib/arvento/canli-katman";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { trAramaNormalize } from "@/lib/utils/isim";
import { createClient } from "@/lib/supabase/client";
import { getHaritaKatmanlari, ekleHaritaKatman, silHaritaKatman, guncelleHaritaKatman, getSantiyeSecenekleri, setSantiyeIl, type HaritaKatman, type SantiyeSecenek } from "@/lib/supabase/queries/arvento-katman";
import { dosyadanGeometriler } from "@/lib/arvento/kml-parse";
import { getArventoAyarlar, setArventoAyarlar, getOcakForTarih, getDamperSiniflar, type DamperSinif } from "@/lib/supabase/queries/arvento-ayarlar";
import { ocakMakineDurumu, ocakTespit, rotaTemizle, type LatLng } from "@/lib/arvento/ocak";
import { ocakMakineDetayCek, type OcakMakineDetay } from "@/lib/arvento/gunluk-metrik-client";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 disabled:bg-gray-100 disabled:opacity-60 disabled:cursor-not-allowed";

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
  const tr = new Date(now.getTime() + 3 * 3600000); // TR = UTC+3: mutlak epoch'a +3 saat (tarayıcı saat dilimine bağımlı DEĞİL → 21:00'de güne atlamaz, gece 00:00'da atlar)
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
  const { hasPermission, kullanici, isYonetici, loading: authYukleniyor } = useAuth();
  const yGor = hasPermission("araclar-arvento-raporu", "goruntule");
  const yEkle = hasPermission("araclar-arvento-raporu", "ekle");
  const yDuzenle = hasPermission("araclar-arvento-raporu", "duzenle");
  const ySil = hasPermission("araclar-arvento-raporu", "sil");
  // KML İndir = salt görüntülemenin ÜSTÜ (ekle veya düzenle). Görüntüle-only kullanıcı indiremez (buton gizli).
  const kmlIndirYetki = yEkle || yDuzenle;

  const [loading, setLoading] = useState(true);
  // Tarih aralığı — başlangıç & bitiş; varsayılan ikisi de bugün (tek gün). Manuel değiştirilebilir.
  // INPUT = anlık (kullanıcı yazarken responsive); baslangic/bitis = DEBOUNCE'lu (yükleme bunları kullanır).
  // Native date input her tuşta onChange tetikler ("20" yazarken "2"de tarih oluşuyordu) → debounce ile
  // yazma bitene kadar yükleme TETİKLENMEZ. Tüm yükleme/effect'ler eskisi gibi baslangic/bitis'e bağlı.
  const [baslangicInput, setBaslangicInput] = useState<string>(trBugun());
  const [bitisInput, setBitisInput] = useState<string>(trBugun());
  const [baslangic, setBaslangic] = useState<string>(trBugun());
  const [bitis, setBitis] = useState<string>(trBugun());
  useEffect(() => {
    const id = setTimeout(() => { setBaslangic(baslangicInput); setBitis(bitisInput); }, 500);
    return () => clearTimeout(id);
  }, [baslangicInput, bitisInput]);
  const [kayitlar, setKayitlar] = useState<AracArventoRapor[]>([]);
  const [kayitlarHam, setKayitlarHam] = useState<AracArventoRapor[]>([]); // aralıktaki HAM günlük satırlar (aralikTopla ÖNCESİ) — gün-gün çalışma toplamı için
  const [guzergahlar, setGuzergahlar] = useState<AracArventoGuzergah[]>([]); // YAKINLIK izin filtresi için rota noktaları
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
  // Canlı overlay — "Canlı" butonu: açıkken bulunulan haritaya anlık araçlar biner
  const [canliAcik, setCanliAcik] = useState(false);
  const [canliKonumlar, setCanliKonumlar] = useState<CanliKonum[]>([]);
  const [canliCihazMap, setCanliCihazMap] = useState<CihazMap>(new Map());
  const [canliYukleniyor, setCanliYukleniyor] = useState(false);
  // Sekmeler arası PAYLAŞILAN harita görünümü (merkez+zoom) — Reglaj/Serme/Sıkıştırma/Stabilize/Tümü/İş Makineleri
  // geçişlerinde harita aynı konum ve yakınlıkta kalsın diye tek ortak ref tüm haritalara verilir.
  const haritaGorunumRef = useRef<HaritaGorunum | null>(null);
  // Araç → Sekme atamaları (Tanımlamalar'da düzenlenir; haritalarda hangi araç hangi sekmede)
  const [atamalar, setAtamalar] = useState<AracAtama[]>([]);
  const [atamaKaydet, setAtamaKaydet] = useState(false); // kayıt sürüyor mu
  const [atamaArama, setAtamaArama] = useState("");       // atama tablosu plaka araması
  const [atanmamisGoster, setAtanmamisGoster] = useState(false); // false: yalnız atanmış araçlar; true: atanmamışlar da
  const [arama] = useState("");
  // Sekme anahtarları:
  //  calisma=Araç Çalışma Raporu, guzergah=Reglaj, genel=Stabilize,
  //  serme=Serme, sikistirma=Sıkıştırma, tanimlamalar=Tanımlamalar
  const [aktifSekme, setAktifSekme] = useState<
    "calisma" | "ismakine" | "guzergah" | "genel" | "serme" | "sikistirma" | "tumu" | "tanimlamalar"
  >("calisma");
  // Güzergah (Reglaj) yüklemeden sonra yeniden yüklensin diye tetikleyici
  const [guzergahRefresh, setGuzergahRefresh] = useState(0);
  // Ekrandaki verilerin en son tazelendiği an (haritalarda "Son güncelleme" olarak gösterilir)
  const [veriGuncelleme, setVeriGuncelleme] = useState<Date | null>(null);

  // Aktif sekmeyi F5/yenileme arası KORU: mount'ta localStorage'dan oku, her değişimde yaz.
  // Böylece Stabilize'dayken yenileyince yine Stabilize'da kalır (varsayılana atmaz).
  useEffect(() => {
    try {
      const k = localStorage.getItem("arventoAktifSekme");
      const gecerli = ["calisma", "ismakine", "guzergah", "genel", "serme", "sikistirma", "tumu", "tanimlamalar"];
      if (k && gecerli.includes(k)) setAktifSekme(k as typeof aktifSekme);
    } catch { /* localStorage yoksa yoksay */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("arventoAktifSekme", aktifSekme); } catch { /* yoksay */ }
  }, [aktifSekme]);
  // Tanımlamalar eşikleri — ORTAK (kullanıcı bazlı DEĞİL): DB'den yüklenir, herkes aynı değeri görür.
  // Sadece "düzenle" yetkisi olan değiştirebilir (aşağıdaki kaydetme effect'i yetkiyle korunur).
  const [mukerrerDk, setMukerrerDk] = useState<number>(0);     // yanlış (art arda) damper eşiği (dk)
  const [mukerrerYaricap, setMukerrerYaricap] = useState<number>(0); // mükerrer damper yarıçapı (m) — dk ile BİRLİKTE şart
  const [canliYenilemeSn, setCanliYenilemeSn] = useState<number>(45); // Canlı sekmesi yenileme aralığı (sn)
  const [canliBirim, setCanliBirim] = useState<"sn" | "dk">("sn");    // UI birimi (gösterim) — kayıt hep sn
  const [raporCekmeDk, setRaporCekmeDk] = useState<number>(5);        // Gerçek rapor çekme aralığı (dk)
  const [damperSyncBas, setDamperSyncBas] = useState<number>(6);      // Damper API senkronu başlangıç saati (0-23)
  const [damperSyncBit, setDamperSyncBit] = useState<number>(21);     // ...bitiş saati (dahil)
  const [damperSyncPeriyot, setDamperSyncPeriyot] = useState<number>(60); // ...periyot (dakika): bu kadar süre geçmeden tekrar çekmez
  const [ekskavatorNoktaDk, setEkskavatorNoktaDk] = useState<number>(10); // Ekskavatör çalışma noktası kayıt sıklığı (dakika)
  const [ekskavatorBas, setEkskavatorBas] = useState<number>(7);  // Ekskavatör çalışma noktası kaydı başlangıç saati (0-23)
  const [ekskavatorBit, setEkskavatorBit] = useState<number>(19); // ...bitiş saati (dahil)
  const [guzergahTekrar, setGuzergahTekrar] = useState<number>(0); // tek çizgi sadeleştirme eşiği
  const [tekrarPencereSaat, setTekrarPencereSaat] = useState<number>(0); // eşik kadar geçiş bu süre (saat) içinde olmalı; 0 = kapalı
  const [silindirTekrar, setSilindirTekrar] = useState<number>(0); // silindir zikzak eşiği
  const [gridMesafe, setGridMesafe] = useState<number>(12);    // yan yana çizgi toleransı (m)
  const [transitHiz, setTransitHiz] = useState<number>(20);    // reglaj transit hız eşiği (km/s); üstü = asfalt git-gel, sayılmaz; 0=kapalı
  // SERME'ye AYRI ince ayarlar (greyder sermede farklı davranır)
  const [sermeGuzergahTekrar, setSermeGuzergahTekrar] = useState<number>(0);
  const [sermeTekrarPencere, setSermeTekrarPencere] = useState<number>(0);
  const [sermeGridMesafe, setSermeGridMesafe] = useState<number>(12);
  const [sermeTransitHiz, setSermeTransitHiz] = useState<number>(20);
  // Çizgi kalınlıkları (haritada) — Reglaj / Serme / Silindir ayrı ayrı, ortak (global).
  const [reglajKalinlik, setReglajKalinlik] = useState<number>(4);
  const [sermeKalinlik, setSermeKalinlik] = useState<number>(3);
  const [silindirKalinlik, setSilindirKalinlik] = useState<number>(3);
  const [kamyonIziKalinlik, setKamyonIziKalinlik] = useState<number>(3); // Stabilize kamyon izi — reglajdan ayrı
  // Çizgi renkleri (haritada) — ortak (global)
  const [reglajRenk, setReglajRenk] = useState<string>("#2563eb");
  const [sermeRenk, setSermeRenk] = useState<string>("#059669");
  const [silindirRenk, setSilindirRenk] = useState<string>("#7c3aed");
  const [kamyonIziRenk, setKamyonIziRenk] = useState<string>("#dc2626");
  // Stabilize ocağı (yükleme noktası) — elle ayarlanmışsa DB'den; yoksa null → bileşen otomatik tespit eder.
  const [ocakLat, setOcakLat] = useState<number | null>(null);
  const [ocakLng, setOcakLng] = useState<number | null>(null);
  const [ocakYaricap, setOcakYaricap] = useState<number>(150);
  const [ayarYuklendi, setAyarYuklendi] = useState(false);     // ilk DB yüklemesi tamamlandı mı
  const sonAyarRef = useRef<string>("");                       // son kaydedilen/yüklenen snapshot (gereksiz yazmayı önler)

  // İlk açılışta ortak ayarları DB'den çek
  useEffect(() => {
    getArventoAyarlar()
      .then((a) => {
        setKmEsik(a.kmEsik);
        setMukerrerDk(a.mukerrerDk);
        setMukerrerYaricap(a.mukerrerYaricap);
        setCanliYenilemeSn(a.canliYenilemeSn);
        setRaporCekmeDk(a.raporCekmeDk);
        setDamperSyncBas(a.damperSyncBasSaat);
        setDamperSyncBit(a.damperSyncBitSaat);
        setDamperSyncPeriyot(a.damperSyncPeriyotDk);
        setEkskavatorNoktaDk(a.ekskavatorNoktaDk);
        setEkskavatorBas(a.ekskavatorBasSaat);
        setEkskavatorBit(a.ekskavatorBitSaat);
        setGuzergahTekrar(a.guzergahTekrar);
        setTekrarPencereSaat(a.tekrarPencereSaat);
        setGridMesafe(a.gridMesafe);
        setTransitHiz(a.transitHiz);
        setSermeGuzergahTekrar(a.sermeGuzergahTekrar);
        setSermeTekrarPencere(a.sermeTekrarPencereSaat);
        setSermeGridMesafe(a.sermeGridMesafe);
        setSermeTransitHiz(a.sermeTransitHiz);
        setSilindirTekrar(a.silindirTekrar);
        setReglajKalinlik(a.reglajKalinlik);
        setSermeKalinlik(a.sermeKalinlik);
        setSilindirKalinlik(a.silindirKalinlik);
        setKamyonIziKalinlik(a.kamyonIziKalinlik);
        setReglajRenk(a.reglajRenk);
        setSermeRenk(a.sermeRenk);
        setSilindirRenk(a.silindirRenk);
        setKamyonIziRenk(a.kamyonIziRenk);
        setOcakLat(a.ocakLat);
        setOcakLng(a.ocakLng);
        setOcakYaricap(a.ocakYaricap);
        sonAyarRef.current = JSON.stringify(a); // yüklenen değeri "kaydedilmiş" say → geri yazma olmaz
      })
      .catch(() => { /* tablo yoksa varsayılanlarla devam */ })
      .finally(() => setAyarYuklendi(true));
  }, []);

  // Kullanıcı bir eşiği/kalınlığı DEĞİŞTİRİNCE DB'ye yaz — sadece düzenleme yetkisi olan + ilk yükleme bitmişken.
  // Yüklenen değerle aynıysa yazma (mount'ta gereksiz istek/hata olmasın).
  useEffect(() => {
    if (!ayarYuklendi || !yDuzenle) return;
    // ocak alanları snapshot bütünlüğü için dahil; setArventoAyarlar bunları YAZMAZ (ocak ayrı kaydedilir).
    const guncel = { kmEsik, mukerrerDk, mukerrerYaricap, canliYenilemeSn, raporCekmeDk, damperSyncBasSaat: damperSyncBas, damperSyncBitSaat: damperSyncBit, damperSyncPeriyotDk: damperSyncPeriyot, ekskavatorNoktaDk, ekskavatorBasSaat: ekskavatorBas, ekskavatorBitSaat: ekskavatorBit, guzergahTekrar, tekrarPencereSaat, gridMesafe, transitHiz, sermeGuzergahTekrar, sermeTekrarPencereSaat: sermeTekrarPencere, sermeGridMesafe, sermeTransitHiz, silindirTekrar, reglajKalinlik, sermeKalinlik, silindirKalinlik, kamyonIziKalinlik, reglajRenk, sermeRenk, silindirRenk, kamyonIziRenk, ocakLat, ocakLng, ocakYaricap };
    const snapshot = JSON.stringify(guncel);
    if (snapshot === sonAyarRef.current) return;
    setArventoAyarlar(guncel)
      .then(() => { sonAyarRef.current = snapshot; })
      .catch((err) => { toast.error(`Ayar kaydedilemedi: ${hataMetni(err)}`, { duration: toastSuresi() }); });
  }, [kmEsik, mukerrerDk, mukerrerYaricap, canliYenilemeSn, raporCekmeDk, damperSyncBas, damperSyncBit, damperSyncPeriyot, ekskavatorNoktaDk, ekskavatorBas, ekskavatorBit, guzergahTekrar, tekrarPencereSaat, gridMesafe, transitHiz, sermeGuzergahTekrar, sermeTekrarPencere, sermeGridMesafe, sermeTransitHiz, silindirTekrar, reglajKalinlik, sermeKalinlik, silindirKalinlik, kamyonIziKalinlik, reglajRenk, sermeRenk, silindirRenk, kamyonIziRenk, ocakLat, ocakLng, ocakYaricap, ayarYuklendi, yDuzenle]);

  // Haritalara geçilecek çizgi kalınlıkları + renkleri (sabit referans — gereksiz re-render olmasın)
  const kalinliklar = useMemo(
    () => ({ reglaj: reglajKalinlik, serme: sermeKalinlik, silindir: silindirKalinlik }),
    [reglajKalinlik, sermeKalinlik, silindirKalinlik],
  );
  const renkler = useMemo(
    () => ({ reglaj: reglajRenk, serme: sermeRenk, silindir: silindirRenk }),
    [reglajRenk, sermeRenk, silindirRenk],
  );
  const [yukleniyor, setYukleniyor] = useState(false);
  const [maildenCekiliyor, setMaildenCekiliyor] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Harita katmanları (NetCAD/KML) — Tanımlamalar'dan yüklenir, tüm haritalarda gösterilir
  const [haritaKatmanlari, setHaritaKatmanlari] = useState<HaritaKatman[]>([]);
  const [katmanYukleniyor, setKatmanYukleniyor] = useState(false);
  const [katmanRenk, setKatmanRenk] = useState<string>("#ff3b30");
  const [santiyeSecenekleri, setSantiyeSecenekleri] = useState<SantiyeSecenek[]>([]);
  const [katmanSantiyeId, setKatmanSantiyeId] = useState<string>(""); // KML yüklemeden ÖNCE seçilecek şantiye
  const katmanFileRef = useRef<HTMLInputElement>(null);
  // Cihaz listesi (Canlı takip node→plaka eşlemesi) yükleme
  const [cihazSayisi, setCihazSayisi] = useState<number | null>(null);
  const [cihazYukleniyor, setCihazYukleniyor] = useState(false);
  const cihazFileRef = useRef<HTMLInputElement>(null);

  // yükleme sıra no + son yapı — ESKİ (geçersiz kılınmış) isteğin yanıtı yeni veriyi EZMESİN; tarih
  // değişiminde eski veri temizlenir (refresh çağrısında — aynı tarih — flaş olmasın diye temizlenmez).
  const kayitYukRef = useRef({ no: 0, yapi: "" });
  const loadKayitlar = useCallback(async () => {
    if (!baslangic || !bitis) { kayitYukRef.current.no++; setKayitlar([]); setLoading(false); return; }
    const yapi = `${baslangic}|${bitis}`;
    const yapisal = kayitYukRef.current.yapi !== yapi; // tarih değişti mi? (refresh ise hayır)
    kayitYukRef.current.yapi = yapi;
    const benimNo = ++kayitYukRef.current.no;
    if (yapisal) { setLoading(true); setKayitlar([]); } // tarih değişti → eski veriyi HEMEN temizle
    try {
      const [k, ps] = await Promise.all([
        getArventoRaporByRange(baslangic, bitis),
        getPlakaSantiyeMap(bitis),
      ]);
      if (benimNo !== kayitYukRef.current.no) return; // eski istek → yok say
      // Aralıktaki günleri plaka bazında topla (tek gün ise zaten tek satır)
      setKayitlar(aralikTopla(k));
      setKayitlarHam(k); // HAM günlük satırlar (birleştirilmemiş) — İş Makineleri çalışma toplamı gün-gün hesaplanır
      setPlakaSantiye(ps);
    } catch (err) {
      if (benimNo !== kayitYukRef.current.no) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("does not exist") || msg.includes("arac_arvento_rapor")) {
        toast.error("arac_arvento_rapor tablosu yok. SQL'i çalıştırın.", { duration: toastSuresi() });
      }
    } finally { if (benimNo === kayitYukRef.current.no) setLoading(false); }
  }, [baslangic, bitis]);

  useEffect(() => { loadKayitlar(); }, [loadKayitlar]);

  // NOT: Rapor verisini (rota/damper/çalışma) periyodik olarak yeniden çeken otomatik
  // tazeleme KALDIRILDI — bu veri gerçek zamanlı değişmediği için haritayı boş yere
  // sürekli yeniden kuruyordu. Veri; tarih değişince, sekme değişince veya Mailden Çek/
  // Excel Yükle sonrası yenilenir. Anlık araç konumları ise ayrı "Canlı" katmanında
  // (haritayı yeniden kurmadan) tazelenir.

  // Araç → Sekme atamalarını yükle (tarihten bağımsız; bir kez + kayıt sonrası yenilenir)
  const loadAtamalar = useCallback(async () => {
    try { setAtamalar(await getAraclarAtama()); } catch { /* sessiz */ }
  }, []);
  useEffect(() => { loadAtamalar(); }, [loadAtamalar]);

  // Haritalara verilecek atama haritası: plakaNorm → atanmış sekmeler (yalnız atanmışlar).
  const sekmeMap = useMemo<SekmeAtamaMap>(() => {
    const m: SekmeAtamaMap = new Map();
    for (const a of atamalar) {
      if (Array.isArray(a.sekmeler)) m.set(plakaNorm(a.plaka), a.sekmeler as ArventoSekme[]);
    }
    return m;
  }, [atamalar]);
  // En az bir araç atanmış olan sekmeler (katı mod: bir sekmeye atama varsa yalnız atananlar görünür).
  const atananSekmeler = useMemo(() => {
    const s = new Set<ArventoSekme>();
    for (const arr of sekmeMap.values()) for (const k of arr) s.add(k);
    return s;
  }, [sekmeMap]);

  // Bir aracın atamasını değiştir (checkbox) — yerel state'i günceller, kaydet butonu DB'ye yazar.
  const atamaToggle = useCallback((id: string, sekme: ArventoSekme) => {
    setAtamalar((prev) => prev.map((a) => {
      if (a.id !== id) return a;
      const mevcut = new Set<string>(a.sekmeler ?? []);
      if (mevcut.has(sekme)) mevcut.delete(sekme); else mevcut.add(sekme);
      return { ...a, sekmeler: Array.from(mevcut) };
    }));
  }, []);

  // Bir aracı otomatik moda döndür (atama = null → sınıf/plaka tespitine düşer)
  const atamaSifirla = useCallback((id: string) => {
    setAtamalar((prev) => prev.map((a) => (a.id === id ? { ...a, sekmeler: null } : a)));
  }, []);

  // Tüm atamaları DB'ye yaz (araclar.arvento_sekmeler)
  const atamalariKaydet = useCallback(async () => {
    setAtamaKaydet(true);
    try {
      for (const a of atamalar) {
        await updateArac(a.id, { arvento_sekmeler: a.sekmeler ?? null });
      }
      toast.success("Sekme atamaları kaydedildi.", { duration: toastSuresi() });
      await loadAtamalar();
    } catch (err) {
      toast.error(`Kayıt hatası: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally { setAtamaKaydet(false); }
  }, [atamalar, loadAtamalar]);

  // Cihaz listesi (Canlı node→plaka) — kayıtlı sayıyı yükle + Excel içe aktar
  const cihazSayisiYukle = useCallback(async () => {
    try {
      const r = await fetch("/api/arvento/cihaz", { cache: "no-store" });
      const d = await r.json();
      if (r.ok && Array.isArray(d.cihazlar)) setCihazSayisi(d.cihazlar.length);
    } catch { /* sessiz */ }
  }, []);
  useEffect(() => { cihazSayisiYukle(); }, [cihazSayisiYukle]);
  const cihazYukle = useCallback(async (file: File) => {
    setCihazYukleniyor(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/arvento/cihaz", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`);
      toast.success(`${d.sayi} cihaz işlendi (${d.surucuSayi} şoför).`, { duration: toastSuresi() });
      await cihazSayisiYukle();
    } catch (err) {
      toast.error(`Yükleme hatası: ${err instanceof Error ? err.message : String(err)}`, { duration: toastSuresi() });
    } finally {
      setCihazYukleniyor(false);
      if (cihazFileRef.current) cihazFileRef.current.value = "";
    }
  }, [cihazSayisiYukle]);

  // Anlık konumları HER ZAMAN çek (Canlı kapalıyken de) — "çalışıyor" rozeti + kontak durumu sürekli güncel olsun.
  // İşaretlerin haritaya ÇİZİLMESİ yine "Canlı" butonuna bağlı (canliKonumlarIzinli). Kapalıyken seyrek (60 sn)
  // çekilir → Vercel az yorulur; açıkken ayar aralığında sık. Cihaz (node→plaka) eşlemesi de bir kez yüklenir.
  useEffect(() => {
    let iptal = false;
    // Cihaz eşlemesini yükle (bir kez) — ÖNCE doğrudan Supabase (Vercel'e istek yok); RLS politikası
    // henüz yoksa boş döner → API rotasına düş (eski davranış, çalışır). Bkz. sql/arvento_anlik_rls.sql.
    (async () => {
      try {
        let cihazlar: { node: string; plaka: string | null; surucu: string | null; model: string | null }[] =
          await getCihazlarDirect();
        if (cihazlar.length === 0) {
          const r = await fetch("/api/arvento/cihaz", { cache: "no-store" });
          const d = await r.json();
          if (Array.isArray(d.cihazlar)) cihazlar = d.cihazlar;
        }
        if (iptal) return;
        const m: CihazMap = new Map();
        for (const c of cihazlar) {
          if (c.node) m.set(c.node.trim(), { plaka: c.plaka, surucu: c.surucu, model: c.model });
        }
        setCanliCihazMap(m);
      } catch { /* sessiz */ }
    })();
    const cek = async () => {
      if (document.hidden) return; // GİZLİ sekme: boşa sorgu/fonksiyon çalıştırma — açık unutulan sekmeler CPU yakmasın
      setCanliYukleniyor(true);
      try {
        // ÖNCE doğrudan Supabase (Vercel fonksiyonu HİÇ çalışmaz); RLS yoksa boş → API fallback.
        const direkt = await getAnlikKonumlarDirect();
        if (direkt.length > 0) {
          if (!iptal) setCanliKonumlar(direkt.map((r) => ({ ...r, plaka: null })) as CanliKonum[]);
        } else {
          const r = await fetch("/api/arvento/anlik", { cache: "no-store" });
          const d = await r.json();
          if (!iptal && r.ok) setCanliKonumlar((d.araclar ?? []) as CanliKonum[]);
          else if (!iptal && !r.ok && canliAcik) toast.error(`Canlı: ${d?.error ?? r.status}`, { duration: toastSuresi() });
        }
      } catch { /* sessiz */ } finally { if (!iptal) setCanliYukleniyor(false); }
    };
    cek();
    // Canlı AÇIKKEN sık (ayar aralığı), KAPALIYKEN seyrek (180 sn) — rozet ("çalışıyor") için 3 dk tazelik
    // yeterli; Vercel Fluid CPU'yu asıl yoran bu yoklamanın HACMİ olduğundan kapalıyken seyreltildi.
    const sn = canliAcik ? Math.max(15, canliYenilemeSn || 45) : 180;
    const id = setInterval(cek, sn * 1000);
    // Sekmeye GERİ dönüldüğünde hemen tazele (gizliyken atlanan yoklamaları bekletmeden telafi et).
    const gorunum = () => { if (!document.hidden) cek(); };
    document.addEventListener("visibilitychange", gorunum);
    return () => { iptal = true; clearInterval(id); document.removeEventListener("visibilitychange", gorunum); };
  }, [canliAcik, canliYenilemeSn]);

  // Ekrandaki RAKAMLARI periyodik tazele: sayfa yenilemeden km/çalışma/damper güncellensin.
  // guzergahRefresh bump'ı → harita bileşenleri veriyi sessizce yeniden çeker (harita YERİNDE
  // kalır, yalnız veri katmanı/rakamlar güncellenir — tile reload/flicker YOK). Canlı butonundan
  // BAĞIMSIZ çalışır. Aralık "Canlı Yenileme Süresi" ayarını izler (en az 20 sn).
  // "Son güncelleme" = RAPOR verisinin (km/çalışma/damper) DB'ye en son yazıldığı an (canlı konum DEĞİL).
  useEffect(() => {
    let iptal = false;
    const tazeleGuncelleme = async () => {
      try { const t = await getArventoRaporSonGuncelleme(baslangic, bitis); if (!iptal) setVeriGuncelleme(t); }
      catch { /* sessiz — eski değeri koru */ }
    };
    tazeleGuncelleme(); // ilk gösterim
    const sn = Math.max(20, canliYenilemeSn || 45);
    const id = setInterval(() => {
      if (document.hidden) return; // gizli sekmede rakam tazeleme boşa Supabase sorgusu — atlansın
      setGuzergahRefresh((v) => v + 1);
      tazeleGuncelleme();
    }, sn * 1000);
    // Sekmeye geri dönüldüğünde rakamları hemen tazele.
    const gorunum = () => { if (!document.hidden) { setGuzergahRefresh((v) => v + 1); tazeleGuncelleme(); } };
    document.addEventListener("visibilitychange", gorunum);
    return () => { iptal = true; clearInterval(id); document.removeEventListener("visibilitychange", gorunum); };
  }, [canliYenilemeSn, baslangic, bitis]);

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
        const yeniTarih: string | undefined = data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih ?? data.kontakGunler?.[0]?.tarih;
        if (yeniTarih) { setBaslangicInput(yeniTarih); setBitisInput(yeniTarih); } // debounce → baslangic/bitis → loadKayitlar
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
        data.guzergahGunler?.[0]?.tarih ?? data.calismaGunler?.[0]?.tarih ?? data.damperGunler?.[0]?.tarih ?? data.kontakGunler?.[0]?.tarih;
      if (yeniTarih) { setBaslangicInput(yeniTarih); setBitisInput(yeniTarih); } // debounce → baslangic/bitis → loadKayitlar
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
    const yeni = gunEkle(bitisInput || baslangicInput, delta);
    setBaslangicInput(yeni);
    setBitisInput(yeni);
  }

  // ----- Harita katmanları (NetCAD/KML) -----
  const loadKatmanlar = useCallback(async () => {
    try { setHaritaKatmanlari(await getHaritaKatmanlari()); } catch { /* sessiz */ }
  }, []);
  useEffect(() => { loadKatmanlar(); }, [loadKatmanlar]);
  useEffect(() => { getSantiyeSecenekleri().then(setSantiyeSecenekleri).catch(() => {}); }, []);
  // KML katmanlarını ŞANTİYE bazında grupla (Tanımlamalar listesi): şantiye adı başlık, KML'ler altında.
  const katmanGruplari = useMemo(() => {
    const ad = new Map(santiyeSecenekleri.map((s) => [s.id, s.is_adi]));
    const grup = new Map<string, HaritaKatman[]>();
    for (const k of haritaKatmanlari) {
      const anahtar = k.santiye_id ?? "";
      if (!grup.has(anahtar)) grup.set(anahtar, []);
      grup.get(anahtar)!.push(k);
    }
    const arr = Array.from(grup.entries()).map(([sid, layers]) => ({
      santiyeId: sid || null,
      ad: sid ? (ad.get(sid) ?? "Bilinmeyen şantiye") : "Atanmamış",
      layers,
    }));
    arr.sort((a, b) => (a.santiyeId ? 0 : 1) - (b.santiyeId ? 0 : 1) || a.ad.localeCompare(b.ad, "tr"));
    return arr;
  }, [haritaKatmanlari, santiyeSecenekleri]);

  // ----- İL SINIRI İZNİ -----
  // Kullanıcının şantiyeleri → o şantiyelerin İLLERİ → kullanıcı O İLLERİN sınırı içindeki her şeyi
  // görür: CANLI araç (anlık konum), GEÇMİŞ araç (rota), KML, damper. Yönetici hepsini görür.
  const guzYapiRef = useRef(""); // tarih değişiminde eski rotayı temizle (refresh'te flaş olmasın diye değil)
  useEffect(() => {
    if (!baslangic || !bitis) { guzYapiRef.current = ""; setGuzergahlar([]); return; }
    const yapi = `${baslangic}|${bitis}`;
    // Tarih değişti → eski güzergahı HEMEN temizle (yoksa türetilmiş ~ilk/son kontak + çalışma ~10 sn eski kalır).
    if (guzYapiRef.current !== yapi) { guzYapiRef.current = yapi; setGuzergahlar([]); }
    let iptal = false; // deps değişince eski .then yok sayılır (stale-overwrite koruması)
    getGuzergahByRange(baslangic, bitis).then((g) => { if (!iptal) setGuzergahlar(g); }).catch(() => { if (!iptal) setGuzergahlar([]); });
    return () => { iptal = true; };
  }, [baslangic, bitis, guzergahRefresh]);
  // Gün bazlı ocak (haritada görünen çember) — ocaktaki iş makinelerini saptamak için.
  const [gunOcak, setGunOcak] = useState<{ lat: number; lng: number; yaricap: number } | null>(null);
  useEffect(() => {
    // OCAK BİTİŞ gününe göre: geniş aralıkta başlangıç (ör. 01.06) ocak kaydından önce olabilir →
    // getOcakForTarih null → yanlış ocak → ocaktaki damperler elenmiyordu. Bitişte gerçek ocak hep var.
    if (!bitis) { setGunOcak(null); return; }
    let iptal = false;
    getOcakForTarih(bitis).then((o) => { if (!iptal) setGunOcak(o); }).catch(() => { if (!iptal) setGunOcak(null); });
    return () => { iptal = true; };
  }, [bitis, guzergahRefresh]);
  // KALICI ocak makineleri + SON bilinen GPS konumu (aralık-birleşik/sezon). Ocak makinesi ocakta GPS'siz
  // çalıştığı gün rota vermez → o gün ocak sayılamayıp İş Makineleri'ne düşerdi. Bununla: makine geçmişten
  // ocak makinesiyse o gün rotası olmasa da İş Makineleri'nden dışlanır ve Stabilize'de SON GPS konumunda görünür.
  const [kaliciOcak, setKaliciOcak] = useState<Map<string, OcakMakineDetay>>(new Map());
  useEffect(() => {
    if (!bitis) { setKaliciOcak(new Map()); return; }
    let iptal = false;
    ocakMakineDetayCek(bitis).then((m) => { if (!iptal) setKaliciOcak(m); }).catch(() => { if (!iptal) setKaliciOcak(new Map()); });
    return () => { iptal = true; };
  }, [bitis, guzergahRefresh]);
  // Damper MANUEL sınıf (override) — plakaNorm|tarih|saat → gerçek/mükerrer/arıza. Serme/Sıkıştırma'da
  // gerçek damper süzmek için (Stabilize ile aynı sınıflama).
  const [damperSinifMap, setDamperSinifMap] = useState<Map<string, DamperSinif>>(new Map());
  useEffect(() => {
    if (!baslangic || !bitis) { setDamperSinifMap(new Map()); return; }
    let iptal = false;
    getDamperSiniflar(baslangic, bitis).then((rows) => {
      if (iptal) return;
      const m = new Map<string, DamperSinif>();
      for (const r of rows) m.set(`${plakaNorm(r.plaka)}|${r.tarih}|${r.saat}`, r.sinif);
      setDamperSinifMap(m);
    }).catch(() => { if (!iptal) setDamperSinifMap(new Map()); });
    return () => { iptal = true; };
    // aktifSekme: Stabilize'de elle işaretlenen override'lar, Serme/Sıkıştırma'ya geçince TAZE yüklensin.
  }, [baslangic, bitis, guzergahRefresh, aktifSekme]);
  // İl sınırları (81 il poligonu) — /tr-iller.json'dan bir kez yüklenir.
  const [iller, setIller] = useState<IlPoligon[]>([]);
  useEffect(() => { fetch("/tr-iller.json").then((r) => r.json()).then((g) => setIller(illeriYukle(g))).catch(() => {}); }, []);
  // Kullanıcının İZİNLİ İLLERİ: atandığı şantiyelerin adından çıkarılan iller. Yönetici → null (sınırsız).
  const izinliIller = useMemo<IlPoligon[] | null>(() => {
    if (isYonetici || !kullanici) return null;
    if (!iller.length) return []; // iller henüz yüklenmedi → geçici hiçbir şey (sızıntı olmasın)
    const ilAdlari = iller.map((i) => i.ad);
    const sMap = new Map(santiyeSecenekleri.map((s) => [s.id, s]));
    const izinliAdlar = new Set<string>();
    for (const sid of kullanici.santiye_ids ?? []) {
      const s = sMap.get(sid);
      const il = s ? (s.il ?? adtanIl(s.is_adi, ilAdlari)) : null; // önce elle girilen il, yoksa addan otomatik
      if (il) izinliAdlar.add(il);
    }
    return iller.filter((i) => izinliAdlar.has(i.ad));
  }, [isYonetici, kullanici, iller, santiyeSecenekleri]);
  // GEÇMİŞ: plaka, rotası VEYA damperi izinli illerden birindeyse görünür. Yönetici → null (kısıt yok).
  const izinliPlakalar = useMemo<string[] | null>(() => {
    if (!izinliIller) return null;
    const s = new Set<string>();
    for (const g of guzergahlar) if (herhangiIzinli(g.noktalar, izinliIller)) s.add(g.plaka);
    for (const k of kayitlar) {
      if (s.has(k.plaka)) continue;
      const dpts = (k.damper_olaylar ?? []).filter((o) => o.lat != null && o.lng != null).map((o) => ({ lat: o.lat as number, lng: o.lng as number }));
      if (dpts.length && herhangiIzinli(dpts, izinliIller)) s.add(k.plaka);
    }
    return Array.from(s);
  }, [izinliIller, guzergahlar, kayitlar]);
  const izinliPlakaSet = useMemo(() => (izinliPlakalar ? new Set(izinliPlakalar.map(plakaNorm)) : null), [izinliPlakalar]);
  // KML izin filtresi: katmanın geometrisi izinli illerden birinde mi (yönetici → hep true).
  const katmanIzinli = useCallback<KatmanIzin>((k) => {
    if (!izinliIller) return true;
    const pts = (k.geometriler ?? []).flatMap((g) => (g.noktalar ?? []).map(([la, ln]) => ({ lat: la, lng: ln })));
    return herhangiIzinli(pts, izinliIller);
  }, [izinliIller]);
  // CANLI: aracın ANLIK konumu izinli ilde mi (araç il dışına çıkınca anında kaybolur). Yönetici → hepsi.
  const canliKonumlarIlIzinli = useMemo<CanliKonum[]>(() => {
    if (!izinliIller) return canliKonumlar;
    return canliKonumlar.filter((k) => k.lat != null && k.lng != null && noktaIzinli(k.lat, k.lng, izinliIller));
  }, [canliKonumlar, izinliIller]);
  // İŞARETLER yalnız "Canlı" AÇIKKEN çizilir; kapalıyken boş → harita marker/nabız halkası çizilmez.
  const canliKonumlarIzinli = useMemo<CanliKonum[]>(() => (canliAcik ? canliKonumlarIlIzinli : []), [canliAcik, canliKonumlarIlIzinli]);

  // Şantiyenin il'ini elle ayarla (il izni için — addan otomatik bulunamayan/yanlış olanlar).
  async function santiyeIlDegistir(id: string, il: string) {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok.", { duration: toastSuresi() }); return; }
    setSantiyeSecenekleri((list) => list.map((s) => (s.id === id ? { ...s, il: il || null } : s)));
    try { await setSantiyeIl(id, il); } catch (err) { toast.error(`İl kaydedilemedi: ${hataMetni(err)}`, { duration: toastSuresi() }); }
  }

  async function katmanYukle(file: File) {
    if (!yEkle) { toast.error("KML eklemek için 'ekleme' yetkiniz yok.", { duration: toastSuresi() }); return; }
    if (!katmanSantiyeId) { toast.error("Önce bir şantiye seçin, sonra KML yükleyin.", { duration: toastSuresi() }); return; }
    setKatmanYukleniyor(true);
    try {
      const geometriler = await dosyadanGeometriler(file);
      const ad = file.name.replace(/\.(kml|kmz)$/i, "");
      await ekleHaritaKatman({ ad, renk: katmanRenk, geometriler, santiyeId: katmanSantiyeId });
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
    if (!ySil) { toast.error("Katman silmek için 'silme' yetkiniz yok.", { duration: toastSuresi() }); return; }
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

  async function katmanDegis(id: string, alanlar: Partial<Pick<HaritaKatman, "ad" | "renk" | "kalinlik" | "gorunur" | "santiye_id">>) {
    if (!yDuzenle) { toast.error("Katmanı düzenlemek için 'düzenleme' yetkiniz yok.", { duration: toastSuresi() }); return; }
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
    let liste = kayitlar;
    if (izinliPlakaSet) liste = liste.filter((k) => izinliPlakaSet.has(plakaNorm(k.plaka))); // şantiye izni
    if (!q) return liste;
    return liste.filter((k) =>
      trAramaNormalize([k.plaka, k.surucu, k.marka, k.model].filter(Boolean).join(" ")).includes(q),
    );
  }, [kayitlar, arama, izinliPlakaSet]);

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

  // İş Makineleri (HAM): atama/sayaç tipine göre tüm iş makineleri (ocak içi/dışı ayrılmadan).
  const tumIsMakineKayitlar = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    return kayitlar.filter((k) => {
      if (izinliPlakaSet && !izinliPlakaSet.has(plakaNorm(k.plaka))) return false; // şantiye izni
      const ps = plakaSantiye.get(plakaNorm(k.plaka));
      // Atama VARSA: yalnız "ismakine" atanmışlar; atama YOKSA: "ismakine"e başka araç
      // atanmışsa gizle, değilse sayaç tipi "saat" (otomatik).
      const atama = sekmeMap.get(plakaNorm(k.plaka));
      const ismakineMi = atama ? atama.includes("ismakine") : (atananSekmeler.has("ismakine") ? false : ps?.sayacTipi === "saat");
      if (!ismakineMi) return false;
      if (q && !trAramaNormalize([k.plaka, k.surucu, k.marka, k.model, ps?.cinsi].filter(Boolean).join(" ")).includes(q)) return false;
      return true;
    });
  }, [kayitlar, plakaSantiye, arama, sekmeMap, atananSekmeler, izinliPlakaSet]);

  // Rota noktalarını plaka bazında birleştir — ocak içi makine tespiti için.
  const rotaByPlakaTumu = useMemo(() => {
    const m = new Map<string, { lat: number | null; lng: number | null; saat: string | null }[]>();
    for (const g of guzergahlar) {
      const key = plakaNorm(g.plaka);
      const arr = m.get(key) ?? [];
      if (Array.isArray(g.noktalar)) for (const p of g.noktalar) arr.push({ lat: p.lat ?? null, lng: p.lng ?? null, saat: p.saat ?? null });
      m.set(key, arr);
    }
    return m;
  }, [guzergahlar]);
  // Etkin ocak (gün bazlı > ayar > otomatik) + yarıçap — Stabilize haritasındaki çemberle aynı.
  const etkinOcak = useMemo<LatLng | null>(() => {
    if (gunOcak) return { lat: gunOcak.lat, lng: gunOcak.lng };
    if (ocakLat != null && ocakLng != null) return { lat: ocakLat, lng: ocakLng };
    return ocakTespit(Array.from(rotaByPlakaTumu.values()).map((r) => rotaTemizle(r)));
  }, [gunOcak, ocakLat, ocakLng, rotaByPlakaTumu]);
  const etkinOcakR = gunOcak?.yaricap ?? ocakYaricap;
  // Damper olayı OLAN plakalar = kamyon (ocak makinesi DEĞİL) — ocak içi tespitinde dışlanır.
  const damperliSet = useMemo(() => {
    const s = new Set<string>();
    for (const k of kayitlar) if (Array.isArray(k.damper_olaylar) && k.damper_olaylar.length > 0) s.add(plakaNorm(k.plaka));
    return s;
  }, [kayitlar]);
  // OCAK MAKİNELERİ (plakaNorm → ocak içi konum): rotası ocak çemberinin ÇOĞUNLUĞUNDA + damper YOK
  // (kamyon değil) + izinli. "İş makinesi" sınıfına bağlı DEĞİL → araç kaydı eşleşmese de (node-id'li
  // makineler) yakalanır.
  const ocakMakineMap = useMemo(() => {
    const m = new Map<string, { konum: LatLng | null }>();
    for (const [key, rota] of rotaByPlakaTumu) {
      if (damperliSet.has(key)) continue;
      if (izinliPlakaSet && !izinliPlakaSet.has(key)) continue;
      const d = ocakMakineDurumu(rota, etkinOcak, etkinOcakR);
      if (d.icinde) m.set(key, { konum: d.konum });
    }
    return m;
  }, [rotaByPlakaTumu, damperliSet, etkinOcak, etkinOcakR, izinliPlakaSet]);

  // İŞ MAKİNELERİ sekmesi: ocak DIŞINDAKİ makineler. Aralıkta ocak sayılanlar (ocakMakineMap) VE geçmişten
  // kalıcı ocak makineleri (kaliciOcak — o gün GPS'siz olsa da) hariç → hepsi Stabilize'de gösterilir.
  const ismakineKayitlar = useMemo(
    () => tumIsMakineKayitlar.filter((k) => !ocakMakineMap.has(plakaNorm(k.plaka)) && !kaliciOcak.has(plakaNorm(k.plaka))),
    [tumIsMakineKayitlar, ocakMakineMap, kaliciOcak],
  );
  // STABILIZE'de gösterilecek OCAK makineleri: model/cins + çalışma saati (rapordan) + konum. Konum: aralıkta
  // rota varsa ocak-içi ortalama (ocakMakineMap.konum), YOKSA son bilinen GPS konumu (kaliciOcak) → makine
  // ocakta GPS'siz çalışsa da son yerinde görünür (yeni GPS gelince güncellenir). Yalnız aralıkta çalışmış (rapor) olanlar.
  const ocakMakineleri = useMemo(() => {
    const sn = (t: string) => { const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); };
    const raporBy = new Map(kayitlar.map((k) => [plakaNorm(k.plaka), k]));
    const cikti = new Map<string, { plaka: string; model: string | null; cins: string | null; calismaSn: number; lat: number | null; lng: number | null }>();
    const ekle = (key: string, lat: number | null, lng: number | null) => {
      const k = raporBy.get(key);
      const ps = plakaSantiye.get(key);
      let calisma = 0;
      if (k) { calisma = Math.max(k.kontak_sn ?? 0, k.rolanti_sn ?? 0); if (k.ilk_kontak && k.son_kontak) { const span = sn(k.son_kontak) - sn(k.ilk_kontak); if (span > 0) calisma = Math.min(calisma, span); } }
      cikti.set(key, { plaka: k?.plaka ?? key, model: ps?.model ?? null, cins: ps?.cinsi ?? null, calismaSn: calisma, lat, lng });
    };
    for (const [key, v] of ocakMakineMap) ekle(key, v.konum?.lat ?? null, v.konum?.lng ?? null); // aralıkta rota var
    for (const [key, pos] of kaliciOcak) {
      if (cikti.has(key)) continue;      // zaten rota konumuyla eklendi
      if (!raporBy.has(key)) continue;   // bu aralıkta çalışmamış → gösterme
      ekle(key, pos.lat, pos.lng);       // rota yok → SON bilinen GPS konumu
    }
    return Array.from(cikti.values());
  }, [ocakMakineMap, kaliciOcak, kayitlar, plakaSantiye]);
  // İş makinelerinin plakaları — harita (güzergah) filtresi için
  const ismakinePlakalari = useMemo(() => ismakineKayitlar.map((k) => k.plaka), [ismakineKayitlar]);
  // Ekskavatör çalışma noktaları (İş Makineleri haritasında nokta olarak) — yalnız ismakine sekmesi açıkken çek.
  const [ismakineNoktalar, setIsmakineNoktalar] = useState<MakineNokta[]>([]);
  useEffect(() => {
    let iptal = false;
    if (aktifSekme !== "ismakine" || ismakinePlakalari.length === 0) { setIsmakineNoktalar([]); return; }
    getMakineCalismaNoktalari(baslangic, bitis, ismakinePlakalari)
      .then((n) => { if (!iptal) setIsmakineNoktalar(n); })
      .catch(() => { if (!iptal) setIsmakineNoktalar([]); });
    return () => { iptal = true; };
  }, [aktifSekme, baslangic, bitis, ismakinePlakalari, guzergahRefresh]);
  // Tüm iş makineleri (km + cins) — haritada güzergahı olmayanlar da chip olarak görünsün
  const ismakineEkstra = useMemo(
    () => ismakineKayitlar.map((k) => ({
      plaka: k.plaka,
      arac_sinifi: plakaSantiye.get(plakaNorm(k.plaka))?.cinsi ?? null,
      toplam_mesafe: k.mesafe_km ?? 0,
      model: plakaSantiye.get(plakaNorm(k.plaka))?.model ?? null,
    })),
    [ismakineKayitlar, plakaSantiye],
  );
  // İş makineleri "çalışma saati" = MOTOR AÇIK süresi. kontak_sn ve rolanti_sn örtüşebildiği için
  // TOPLAMAZ (çift sayım olur), EN BÜYÜĞÜNÜ alır; ayrıca ilk→son kontak PENCERESİNİ aşamaz
  // (rapor birikiminden şişen değerler kırpılır). Ekskavatör yerinde çalışsa da (rölanti) doğru sayılır.
  // İş makinesi plakaları (birleştirilmiş kayıttan) — HAM satırları bunlara göre süzeceğiz.
  const ismakinePlakaSet = useMemo(() => new Set(ismakineKayitlar.map((k) => plakaNorm(k.plaka))), [ismakineKayitlar]);
  const ismakineCalismaMap = useMemo(() => {
    const sn = (t: string) => { const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); };
    // GÜN GÜN TOPLA — HAM günlük satırlardan (aralikTopla kontak_sn/ilk-son'u BİRLEŞTİRMEZ, ilk günü tutar).
    // Her günün çalışmasını (max kontak/rölanti, o günün ilk→son penceresiyle kırpılı) TOPLA → seçili aralık toplamı.
    const m = new Map<string, number>();
    for (const k of kayitlarHam) {
      const key = plakaNorm(k.plaka);
      if (!ismakinePlakaSet.has(key)) continue;
      let calisma = Math.max(k.kontak_sn ?? 0, k.rolanti_sn ?? 0);
      if (k.ilk_kontak && k.son_kontak) { const span = sn(k.son_kontak) - sn(k.ilk_kontak); if (span > 0) calisma = Math.min(calisma, span); }
      m.set(key, (m.get(key) ?? 0) + calisma);
    }
    return m;
  }, [kayitlarHam, ismakinePlakaSet]);
  // Tüm araçlar için kontak açık + rölanti süresi (plaka bazında, aralık toplamı) — Reglaj/Serme/Sıkıştırma chip'leri için
  const kontakRolantiMap = useMemo(() => {
    const m = new Map<string, { kontak: number; rolanti: number }>();
    for (const k of kayitlar) {
      const key = plakaNorm(k.plaka);
      const ex = m.get(key) ?? { kontak: 0, rolanti: 0 };
      ex.kontak += k.kontak_sn ?? 0;
      ex.rolanti += k.rolanti_sn ?? 0;
      m.set(key, ex);
    }
    return m;
  }, [kayitlar]);
  // İlk kontak (en erken açılış) + son kontak (en geç kapanış) — TÜM araçlarda chip'te gösterilir.
  const ilkSonKontakMap = useMemo(() => {
    // ilkT/sonT = değer rapordan değil GÜZERGAH'tan TÜRETİLDİ (gerçek kontak yok) → arayüzde italik gösterilir.
    const m = new Map<string, { ilk: string | null; son: string | null; ilkT: boolean; sonT: boolean }>();
    const acikSnMap = new Map<string, number>(); // plaka → motor AÇIK süresi (max kontak/rolanti) — tutarlılık kontrolü için
    for (const k of kayitlar) {
      const key = plakaNorm(k.plaka);
      const ex = m.get(key) ?? { ilk: null, son: null, ilkT: false, sonT: false };
      if (k.ilk_kontak && (!ex.ilk || k.ilk_kontak < ex.ilk)) { ex.ilk = k.ilk_kontak; ex.ilkT = false; }
      if (k.son_kontak && (!ex.son || k.son_kontak > ex.son)) { ex.son = k.son_kontak; ex.sonT = false; }
      m.set(key, ex);
      acikSnMap.set(key, Math.max(acikSnMap.get(key) ?? 0, k.kontak_sn ?? 0, k.rolanti_sn ?? 0));
    }
    // YEDEK (TÜRETİLMİŞ): Arvento ilk/son kontak DÖNMEYEN araçlar (kontağı gün boyu açık kalan greyder vb.)
    // için güzergah GPS saatlerinden türet. Gün sonu/başı izole park sinyalleri (>2 s boşlukla ayrı) kırpılır.
    const sn = (t: string) => { const p = t.split(":").map(Number); return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0); };
    const BOSLUK = 120 * 60;
    // GELECEK SAAT KORUMASI: bugünün raporunda, ŞU ANDAN sonraki saatler bozuk zaman damgasıdır
    // (cihaz saati ileri/bayat) → türetmeye katma. (TR = UTC+3.)
    const trNow = new Date(Date.now() + 3 * 3600000);
    const bugun = trNow.toISOString().slice(0, 10), simdi = trNow.toISOString().slice(11, 19);
    const guzSaat = new Map<string, { saat: string; hiz: number }[]>();
    for (const g of guzergahlar) {
      const key = plakaNorm(g.plaka);
      const arr = guzSaat.get(key) ?? [];
      const bugunMu = g.rapor_tarihi === bugun;
      for (const p of (g.noktalar ?? [])) {
        if (!p.saat) continue;
        if (bugunMu && p.saat > simdi) continue; // bugünün gelecek saatleri (bozuk) → atla
        arr.push({ saat: p.saat as string, hiz: p.hiz ?? 0 });
      }
      guzSaat.set(key, arr);
    }
    for (const [key, hepsi] of guzSaat) {
      const ex = m.get(key) ?? { ilk: null, son: null, ilkT: false, sonT: false };
      if (!hepsi.length) continue;
      const s = hepsi.map((p) => p.saat).sort();
      let i = 0, j = s.length - 1;
      while (j > i && sn(s[j]) - sn(s[j - 1]) > BOSLUK) j--; // sondaki izole park sinyali
      while (i < j && sn(s[i + 1]) - sn(s[i]) > BOSLUK) i++; // baştaki izole sinyal
      const gpsSon = s[j];
      // son_kontak GÜVENİLMEZ mi: araç, raporlanan KAPANIŞTAN SONRA HAREKET etmişse (>5 km/s, ≥3 nokta) kapanış
      // erken/eksiktir (kapsama dışı kapatma → Arvento kapanış olayını geç verir). "GPS var mı" DEĞİL "HAREKET var
      // mı": park halinde ping atan makine (ekskavatör: tüm hızlar ≤4, hareket yok) BOZULMAZ; 843 (kamyon) kapanış
      // sonrası sefer yapıyor → yüzlerce hızlı nokta → yakalanır.
      const hareketSonrasi = ex.son ? hepsi.filter((p) => p.saat > ex.son! && (p.hiz ?? 0) > 5).length : 0;
      const sonGuvenilmez = hareketSonrasi >= 3;
      if (ex.ilk && ex.son && !sonGuvenilmez) continue; // ikisi de gerçek + tutarlı → GPS'e gerek yok
      if (!ex.ilk) { ex.ilk = s[i]; ex.ilkT = true; }
      // Tahmini son = EN GEÇ: (a) son GPS noktası, (b) ilk + motor açık süresi (kontak_sn taze güncellenince uzar).
      const acik = acikSnMap.get(key) ?? 0;
      const ilkSnv = ex.ilk ? sn(ex.ilk) : sn(s[i]);
      const tahminSn = acik > 0 ? Math.max(sn(gpsSon), ilkSnv + acik) : sn(gpsSon);
      const tahminStr = `${String(Math.floor(tahminSn / 3600)).padStart(2, "0")}:${String(Math.floor((tahminSn % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(tahminSn % 60)).padStart(2, "0")}`;
      // Güvenilmez son_kontak → bu tahmin (daha geç ise), ~ işaretiyle. Gerçek (geç) kapanış verisi geldiğinde
      // araç o kapanıştan SONRA hareket etmeyeceği için güvenilmez sayılmaz → gerçek değer yazılır.
      if (!ex.son) { ex.son = tahminStr; ex.sonT = true; }
      else if (sonGuvenilmez && tahminSn > sn(ex.son)) { ex.son = tahminStr; ex.sonT = true; }
      m.set(key, ex);
    }
    return m;
  }, [kayitlar, guzergahlar]);
  // KONTAK durumu (plaka → şu an çalışıyor mu) — HER ZAMAN güncel (Canlı kapalı olsa da) → chip "çalışıyor" rozeti.
  // "çalışıyor" = HAREKET ediyor (>5 km/s) VEYA canlı kontak proxy'si açık (son paket taze). Mola, KONTAK_TAZE_DK
  // (sync=3 dk) sayesinde ayıklanır: molada heartbeat paketi çabuk bayatlar → kontak=kapalı. (Rapor son_kontak'a
  // BAKMIYORUZ — makine öğleden sonra tekrar çalışınca "çalışmıyor" gösteriyordu.)
  const canliKontakMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const k of canliKonumlarIlIzinli) {
      const p = k.node ? canliCihazMap?.get(k.node.trim())?.plaka : null;
      if (p && (k.kontak === true || (k.hiz ?? 0) > 5)) m.set(plakaNorm(p), true);
    }
    return m;
  }, [canliKonumlarIlIzinli, canliCihazMap]);
  // Plaka(norm) → araç modeli (chip'lerde "İş Makinesi/cins" yerine model göstermek için).
  const modelMap = useMemo(() => new Map(Array.from(plakaSantiye.entries()).map(([p, ps]) => [p, ps.model ?? null])), [plakaSantiye]);

  // Auth HENÜZ yüklenirken hasPermission false döner → "yetkiniz yok" yanlış görünmesin; önce yüklemeyi bekle.
  if (authYukleniyor) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!yGor) {
    return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;
  }
  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  // Canlı (anlık konum) butonu — sekme panelindeki KML İndir'in ALTINA yerleştirilir (canliButton prop'u).
  const canliButton = (
    <button type="button" onClick={() => setCanliAcik((v) => !v)}
      title="Anlık araç konumlarını bu haritaya bindir/kaldır"
      className={`h-9 px-2.5 w-full flex items-center justify-center gap-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${canliAcik ? "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"}`}>
      <span className={`inline-block w-2 h-2 rounded-full ${canliAcik ? "bg-white animate-pulse" : "bg-emerald-500"}`} />
      {canliAcik ? `Canlı açık${canliKonumlar.length ? ` · ${canliKonumlar.length}` : ""}${canliYukleniyor ? " ⟳" : ""}` : "Canlı"}
    </button>
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <Satellite size={24} /> Araç Takip
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
        <button type="button" onClick={() => gunGez(-1)}
          title="Önceki gün (başlangıç = bitiş)" className="h-9 w-8 mb-px flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100">
          <ChevronLeft size={16} />
        </button>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={baslangicInput} max={bitisInput || undefined}
            onChange={(e) => setBaslangicInput(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={bitisInput} min={baslangicInput || undefined}
            onChange={(e) => setBitisInput(e.target.value)} className={selectClass} />
        </div>
        <button type="button" onClick={() => gunGez(1)}
          title="Sonraki gün (başlangıç = bitiş)" className="h-9 w-8 mb-px flex items-center justify-center rounded-lg border bg-white hover:bg-gray-100">
          <ChevronRight size={16} />
        </button>
        {(baslangic !== trBugun() || bitis !== trBugun()) && (
          <button type="button" onClick={() => { const b = trBugun(); setBaslangicInput(b); setBitisInput(b); }}
            title="Bugüne dön" className="h-9 px-2 text-[11px] rounded-lg border bg-white hover:bg-gray-100 mb-px">Bugün</button>
        )}
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
          {/* Harita — iş makinelerinin gün içinde nerede çalıştığı (güzergah) — ÜSTTE */}
          {ismakineKayitlar.length > 0 && (
            <div className="space-y-1">
              <ArventoGuzergah secimKey="ismakine" bas={baslangic} bitis={bitis} tekrarEsigi={0} gridMesafe={gridMesafe} transitHiz={transitHiz}
                kalinliklar={kalinliklar} renkler={renkler} plakaFiltre={ismakinePlakalari} ekstraAraclar={ismakineEkstra}
                calismaSnMap={ismakineCalismaMap} ilkSonKontakMap={ilkSonKontakMap} baslik="İş Makineleri" modelGoster
                calismaNoktalari={ismakineNoktalar} canliKontakByPlaka={canliKontakMap}
                canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef}
                izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} canliButton={canliButton} kmlIndir={kmlIndirYetki} />
            </div>
          )}
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
                    <TableHead className="text-white text-[11px] px-2 text-right"><Route size={12} className="inline" /> Mesafe (km)</TableHead>
                    <TableHead className="text-white text-[11px] px-2 text-right">Çalışma</TableHead>
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
                        <TableCell className="px-2 text-right tabular-nums font-semibold">{formatKm(k.mesafe_km)}</TableCell>
                        <TableCell className="px-2 text-right tabular-nums font-semibold text-emerald-700">{formatSure(ismakineCalismaMap.get(plakaNorm(k.plaka)) ?? 0)}</TableCell>
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
        <ArventoGuzergah secimKey="reglaj" bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} tekrarPencereSaat={tekrarPencereSaat} gridMesafe={gridMesafe} transitHiz={transitHiz} kalinliklar={kalinliklar} renkler={renkler} kontakRolantiMap={kontakRolantiMap} ilkSonKontakMap={ilkSonKontakMap} canliKontakByPlaka={canliKontakMap} sekmeMap={sekmeMap} canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef} modelGoster modelMap={modelMap} izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} canliButton={canliButton} kmlIndir={kmlIndirYetki} />
      ) : aktifSekme === "genel" ? (
        // ---- SEKME 3: STABILIZE — güzergah çizgisi + üzerine damper indirme noktaları ----
        <ArventoStabilize bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} gridMesafe={gridMesafe} transitHiz={transitHiz} mukerrerDk={mukerrerDk} mukerrerYaricap={mukerrerYaricap} kalinliklar={kalinliklar} renkler={renkler} kamyonIziRenk={kamyonIziRenk} kamyonIziKalinlik={kamyonIziKalinlik} sekmeMap={sekmeMap} canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} ocakLat={ocakLat} ocakLng={ocakLng} ocakYaricap={ocakYaricap} yDuzenle={yDuzenle} izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} canliButton={canliButton} kmlIndir={kmlIndirYetki} ocakMakineleri={ocakMakineleri} ilkSonKontakMap={ilkSonKontakMap} />
      ) : aktifSekme === "serme" ? (
        // ---- SEKME 4: SERME — greyder altlı üstlü çizgi (yeşil) + ortada damper ----
        <ArventoOperasyon bas={baslangic} bitis={bitis} operasyon="serme" mukerrerDk={mukerrerDk} mukerrerYaricap={mukerrerYaricap} ocakLat={etkinOcak?.lat ?? null} ocakLng={etkinOcak?.lng ?? null} ocakYaricap={etkinOcakR} damperSinif={damperSinifMap} tekrarEsigi={sermeGuzergahTekrar} tekrarPencereSaat={sermeTekrarPencere} silindirEsik={silindirTekrar} gridMesafe={sermeGridMesafe} transitHiz={sermeTransitHiz} kalinliklar={kalinliklar} renkler={renkler} kontakRolantiMap={kontakRolantiMap} ilkSonKontakMap={ilkSonKontakMap} sekmeMap={sekmeMap} canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef} modelGoster modelMap={modelMap} izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} canliButton={canliButton} kmlIndir={kmlIndirYetki} />
      ) : aktifSekme === "sikistirma" ? (
        // ---- SEKME 5: SIKIŞTIRMA — greyder altlı üstlü çizgi + ortada silindir zikzak (mor) ----
        <ArventoOperasyon bas={baslangic} bitis={bitis} operasyon="sikistirma" mukerrerDk={mukerrerDk} mukerrerYaricap={mukerrerYaricap} ocakLat={etkinOcak?.lat ?? null} ocakLng={etkinOcak?.lng ?? null} ocakYaricap={etkinOcakR} damperSinif={damperSinifMap} tekrarEsigi={guzergahTekrar} silindirEsik={silindirTekrar} gridMesafe={gridMesafe} transitHiz={transitHiz} kalinliklar={kalinliklar} renkler={renkler} kontakRolantiMap={kontakRolantiMap} ilkSonKontakMap={ilkSonKontakMap} sekmeMap={sekmeMap} canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef} modelGoster modelMap={modelMap} izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} canliButton={canliButton} kmlIndir={kmlIndirYetki} />
      ) : aktifSekme === "tumu" ? (
        // ---- SEKME 6: TÜMÜ — o günün tüm operasyonları tek haritada + lejant ----
        <ArventoTumu bas={baslangic} bitis={bitis} tekrarEsigi={guzergahTekrar} silindirEsik={silindirTekrar} gridMesafe={gridMesafe} transitHiz={transitHiz} mukerrerDk={mukerrerDk} mukerrerYaricap={mukerrerYaricap} ocakLat={etkinOcak?.lat ?? null} ocakLng={etkinOcak?.lng ?? null} ocakYaricap={etkinOcakR} damperSinif={damperSinifMap} kalinliklar={kalinliklar} renkler={renkler} sekmeMap={sekmeMap} canliKonumlar={canliKonumlarIzinli} canliCihazMap={canliCihazMap} gorunumRef={haritaGorunumRef} izinliPlakalar={izinliPlakalar} katmanIzinli={katmanIzinli} refreshKey={guzergahRefresh} sonGuncelleme={veriGuncelleme} canliButton={canliButton} kmlIndir={kmlIndirYetki} />
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
          {!yDuzenle && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              🔒 Görüntüleme modundasınız — bu ayarları yalnızca <strong>düzenleme yetkisi</strong> olan kullanıcılar değiştirebilir.
            </div>
          )}
          <fieldset disabled={!yDuzenle} className="min-w-0 border-0 p-0 m-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* ═══ GRUP 1: Araç & İş Makinesi Verisi (tüm araçlar/makineler için genel veri) ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-1">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🚛 Araç &amp; İş Makinesi Verisi</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            {/* Canlı Yenileme Süresi — Canlı sekmesi haritasının otomatik yenileme aralığı */}
            <div className="border rounded-lg p-3 bg-teal-50/40 border-teal-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Canlı Yenileme Süresi</div>
              <p className="text-[11px] text-gray-400 mb-2">
                🟢 <strong>Canlı</strong> butonu açıkken haritadaki araçlar bu aralıkta otomatik yenilenir. Birimi
                <strong> saniye</strong> veya <strong>dakika</strong> seçebilirsiniz. Arvento servisi çok sık çağrıyı
                boş döndürdüğü için <strong>en az 15 sn</strong> uygulanır.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={canliBirim === "dk" ? Math.round((canliYenilemeSn / 60) * 100) / 100 || "" : canliYenilemeSn || ""}
                  onChange={(e) => {
                    const v = Math.max(0, parseFloat(e.target.value) || 0);
                    setCanliYenilemeSn(canliBirim === "dk" ? Math.round(v * 60) : Math.round(v));
                  }}
                  placeholder={canliBirim === "dk" ? "örn. 1" : "örn. 45"}
                  className={selectClass + " w-24"}
                />
                <select value={canliBirim} onChange={(e) => setCanliBirim(e.target.value as "sn" | "dk")}
                  className={selectClass + " w-24"}>
                  <option value="sn">saniye</option>
                  <option value="dk">dakika</option>
                </select>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Etkin: her <strong>{Math.max(15, canliYenilemeSn || 45)} sn</strong> yenilenir.</div>
            </div>
            {/* Rapor Çekme Süresi — Arvento'dan gerçek çalışma raporunun (km/kontak/çalışma) çekilme aralığı */}
            <div className="border rounded-lg p-3 bg-sky-50/40 border-sky-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Rapor Çekme Süresi</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Araçların <strong>gerçek çalışma raporu</strong> (günlük km, kontak açık, çalışma, ilk/son kontak)
                Arvento&apos;dan bu aralıkta çekilir. Birimi <strong>dakika</strong>. Senkron makinesindeki görev bu değere
                göre çalışır. <strong>En az 6 dk yazılabilir</strong> — bir çekim döngüsü zaten ~6 dk sürüyor
                (tüm araçlar × bugün+dün, Arvento&apos;ya sıralı sorgu), daha küçük değer çekimi hızlandırmaz.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={6}
                  value={raporCekmeDk || ""}
                  onChange={(e) => setRaporCekmeDk(Math.max(0, parseInt(e.target.value) || 0))}
                  onBlur={() => setRaporCekmeDk((v) => Math.max(6, v || 6))}
                  placeholder="örn. 6"
                  className={selectClass + " w-24"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">dakika (en az 6)</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">Etkin: her <strong>{Math.max(6, raporCekmeDk || 6)} dk</strong> çekilir.</div>
            </div>
            {/* Ekskavatör Çalışma Noktası Sıklığı — paletli/yerinde çalışan makineler iz bırakmadığı için,
                kontak açıkken bu aralıkta bir konum noktası kaydedilir → haritada nerede çalıştığı görünür. */}
            <div className="border rounded-lg p-3 bg-lime-50/50 border-lime-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Ekskavatör Çalışma Noktası Sıklığı</div>
              <p className="text-[11px] text-gray-400 mb-2">
                <strong>Ekskavatörler</strong> yerinde çalıştığı için iz bırakmaz. Kontak açıkken, bu aralıkta
                (dakika) bir kez o anki konumu <strong>çalışma noktası</strong> olarak kaydedilir; İş Makineleri
                haritasında nokta olarak görünür → gün sonunda nerelerde çalıştığı belli olur. Yalnız <strong>Ekskavatör</strong>
                cinsi için geçerlidir. En az 1 dk.
              </p>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={120} value={ekskavatorNoktaDk}
                  onChange={(e) => setEkskavatorNoktaDk(Math.min(120, Math.max(1, parseInt(e.target.value) || 1)))}
                  className={selectClass + " w-24"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">dakikada bir</span>
                <div className="flex gap-1">
                  {[5, 10, 15, 30].map((dk) => (
                    <button key={dk} type="button" onClick={() => setEkskavatorNoktaDk(dk)}
                      className={`px-2 h-7 text-[10px] rounded border ${ekskavatorNoktaDk === dk ? "bg-lime-600 text-white border-lime-600" : "border-gray-300 text-gray-500 hover:bg-lime-50"}`}>
                      {dk} dk
                    </button>
                  ))}
                </div>
              </div>
              {/* Çalışma saatleri — nokta kaydı yalnız bu saatler arası (gece boşuna sorgu yok) */}
              <div className="text-[11px] font-semibold text-gray-600 mt-3 mb-1">Çalışma Saatleri</div>
              <p className="text-[10px] text-gray-400 mb-1.5">Nokta kaydı yalnız bu saatler arasında yapılır; dışında Arvento&apos;yu boşuna yormaz.</p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={23} value={ekskavatorBas}
                  onChange={(e) => setEkskavatorBas(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className={selectClass + " w-20"} />
                <span className="text-[11px] text-gray-500">ile</span>
                <input type="number" min={0} max={23} value={ekskavatorBit}
                  onChange={(e) => setEkskavatorBit(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className={selectClass + " w-20"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">arası (0–23)</span>
              </div>
              <div className="text-[10px] text-gray-400 mt-2">Etkin: her gün <strong>{ekskavatorBas}:00–{ekskavatorBit}:00</strong> arası, <strong>{ekskavatorNoktaDk} dk</strong>'da bir.</div>
            </div>
            {/* ═══ GRUP 2: Stabilize — Damper ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-3">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🏗️ Stabilize (Damper)</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            {/* Yanlış kaldırma eşiği — Stabilize damper mükerrer (yanlış tetik) temizleme. Damper sayısından
                FARKLI: bu, art arda gelen yanlış damperleri temizler (zaman bazlı). */}
            <div className="border rounded-lg p-3 bg-amber-50/40 border-amber-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Yanlış Kaldırma Eşiği (dk + yarıçap)</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Stabilize&apos;de bir damper, önceki dampere <strong>hem süre (dk) hem yarıçap (m) içinde</strong> ise
                mükerrer (yanlış tetik) sayılır — <strong>ikisi birlikte</strong> gerçekleşmeli. &quot;Damper İndirme
                Sayısı&quot;ndan farklıdır. Süre <strong>veya</strong> yarıçap 0 = temizleme yok.
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                <input
                  type="number"
                  min={0}
                  value={mukerrerDk || ""}
                  onChange={(e) => setMukerrerDk(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 2"
                  className={selectClass + " w-20"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap mr-2">dk</span>
                <input
                  type="number"
                  min={0}
                  value={mukerrerYaricap || ""}
                  onChange={(e) => setMukerrerYaricap(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 15"
                  className={selectClass + " w-20"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">m yarıçap</span>
                {(mukerrerDk > 0 || mukerrerYaricap > 0) && (
                  <button type="button" onClick={() => { setMukerrerDk(0); setMukerrerYaricap(0); }}
                    className="text-gray-400 hover:text-red-500 text-xs px-1" title="Temizle">✕</button>
                )}
              </div>
            </div>
            {/* Damper Senkron Saatleri — damper API senkronu yalnız bu saat aralığında çalışır (gece çalışılmıyorsa). */}
            <div className="border rounded-lg p-3 bg-orange-50/40 border-orange-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Damper Senkron Saatleri</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Damper verisi Arvento&apos;dan <strong>saat başı</strong> otomatik çekilir; ama yalnız bu
                <strong> başlangıç–bitiş</strong> saat aralığında (gece çalışılmıyorsa boşuna çalışmasın).
                Örn. <strong>6–21</strong> = sabah 06:00 ile akşam 21:00 arası. Gece de çalışacaksanız 0–23 yapın.
              </p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} max={23} value={damperSyncBas}
                  onChange={(e) => setDamperSyncBas(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className={selectClass + " w-20"} />
                <span className="text-[11px] text-gray-500">ile</span>
                <input type="number" min={0} max={23} value={damperSyncBit}
                  onChange={(e) => setDamperSyncBit(Math.min(23, Math.max(0, parseInt(e.target.value) || 0)))}
                  className={selectClass + " w-20"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">arası (0–23)</span>
              </div>
              {/* Senkron periyodu (dakika) — kaç dakikada bir çekileceği */}
              <div className="text-[11px] font-semibold text-gray-600 mt-3 mb-1">Güncelleme Sıklığı</div>
              <p className="text-[10px] text-gray-400 mb-1.5">Damper verisini kaç <strong>dakikada bir</strong> güncellesin? (en az 5 dk)</p>
              <div className="flex items-center gap-2">
                <input type="number" min={5} max={720} step={5} value={damperSyncPeriyot}
                  onChange={(e) => setDamperSyncPeriyot(Math.min(720, Math.max(5, parseInt(e.target.value) || 5)))}
                  className={selectClass + " w-24"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">dakikada bir</span>
                <div className="flex gap-1">
                  {[30, 60, 120, 180].map((dk) => (
                    <button key={dk} type="button" onClick={() => setDamperSyncPeriyot(dk)}
                      className={`px-2 h-7 text-[10px] rounded border ${damperSyncPeriyot === dk ? "bg-orange-500 text-white border-orange-500" : "border-gray-300 text-gray-500 hover:bg-orange-50"}`}>
                      {dk < 60 ? `${dk} dk` : `${dk / 60} saat`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] text-gray-400 mt-2">
                Etkin: her gün <strong>{damperSyncBas}:00–{damperSyncBit}:00</strong> arası, <strong>{damperSyncPeriyot < 60 ? `${damperSyncPeriyot} dakikada` : damperSyncPeriyot % 60 === 0 ? `${damperSyncPeriyot / 60} saatte` : `${damperSyncPeriyot} dakikada`} bir</strong>.
              </div>
            </div>
            {/* ═══ GRUP 3: Reglaj ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-3">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🛣️ Reglaj</span>
              <div className="flex-1 h-px bg-gray-200" />
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
              {/* Tekrar SÜRESİ — eşik kadar geçiş bu süre İÇİNDE olmalı (greyder aynı yolu bütün güne yayarak
                  geçse de sayılmaz; ancak süre içinde yeterli tekrar varsa çizilir). 0 = süre şartı yok. */}
              <div className="mt-2 pt-2 border-t border-emerald-200/70">
                <div className="text-[11px] font-semibold text-gray-600 mb-1">Tekrar Süresi (opsiyonel)</div>
                <p className="text-[11px] text-gray-400 mb-2">
                  Eşik kadar geçiş <strong>bu süre içinde</strong> olursa yol çizilir. Örn. eşik <strong>3</strong> + süre
                  <strong> 2</strong> → aynı yolu <strong>2 saat içinde</strong> 3 kez geçerse çizilir; güne yayılmış
                  seyrek geçişler <strong>çizilmez</strong>. Ondalık olur (1.5 = 90 dk). <strong>0 = süre şartı yok</strong> (sadece toplam sayıya bakar).
                </p>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={tekrarPencereSaat || ""}
                    onChange={(e) => setTekrarPencereSaat(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="örn. 2"
                    className={selectClass + " w-32"}
                  />
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">saat</span>
                  {tekrarPencereSaat > 0 && (
                    <button type="button" onClick={() => setTekrarPencereSaat(0)}
                      className="text-gray-400 hover:text-red-500 text-xs px-1" title="Süre şartını kapat">✕</button>
                  )}
                </div>
              </div>
            </div>
            {/* Yan Yana Çizgi Mesafesi — sadeleştirme ızgara toleransı (m).
                İki geçiş bu mesafeden uzaksa "aynı güzergah" sayılmaz, tekrara katılmaz. */}
            <div className="border rounded-lg p-3 bg-slate-50 border-slate-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Yan Yana Çizgi Mesafesi (m) — yardımcı</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Yan yana şeritleri tek orta hatta toplama yarıçapı (orta hattan ±m). Tekrar Eşiği ≥ 1 iken
                etkilidir. Aynı yolda yan yana sapan şeritler bu bant içindeyse ortalanıp tek hat olur.
                <strong> Greyder için 18-25 önerilir</strong> — çok küçük değer (ör. 2-5) çapraz yolda çizgiyi
                kopuk kopuk gösterir (şerit hücreleri ayrışır). Varsayılan 25.
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
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1">Reglaj Transit Hız Eşiği (km/s)</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Greyder bu hızın ÜSTÜnde geçtiği yer &quot;transit&quot; (asfalta gidiş-geliş) sayılır ve
                <strong> Reglaj/Serme&apos;de</strong> SAYILMAZ. <strong>Sıkıştırma bu filtreyi kullanmaz</strong> —
                silindir yalnız kendi tekrar eşiğiyle çizilir. Asfalttaki git-gel reglaj gibi görünüyorsa bu değeri
                DÜŞÜR (ör. 15-12). 0 = kapalı (her geçiş sayılır). Varsayılan 20.
              </p>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  value={transitHiz}
                  onChange={(e) => setTransitHiz(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="20"
                  className={selectClass + " w-32"}
                />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">km/s (0 = kapalı)</span>
              </div>
            </div>
            {/* ═══ GRUP 3.5: SERME (reglajdan AYRI ince ayar) ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-3">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🌫️ Serme</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="md:col-span-3 text-[11px] text-gray-400 -mt-1">
              Greyder <strong>sermede</strong> reglajdan farklı davranabilir (farklı hız/tekrar). Aşağıdakiler <strong>yalnız Serme sekmesi</strong> için; boş/varsayılan bırakırsan Reglaj ayarlarıyla aynı davranır.
            </div>
            {/* Serme Tekrar Eşiği */}
            <div className="border rounded-lg p-3 bg-emerald-50/40 border-emerald-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Serme Tekrar Eşiği</div>
              <p className="text-[11px] text-gray-400 mb-2">Serme haritasında bir yolun <strong>bu sayı ve üzeri</strong> geçilmesi gerekir. 0 = ham. (Serme genelde reglajdan <strong>az</strong> geçişle olur → daha düşük tutabilirsin.)</p>
              <div className="flex items-center gap-1">
                <input type="number" min={0} value={sermeGuzergahTekrar || ""}
                  onChange={(e) => setSermeGuzergahTekrar(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="örn. 1" className={selectClass + " w-32"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">geçiş</span>
              </div>
              {/* Serme Tekrar Süresi */}
              <div className="mt-2 pt-2 border-t border-emerald-200/70">
                <div className="text-[11px] font-semibold text-gray-600 mb-1">Serme Tekrar Süresi (opsiyonel)</div>
                <div className="flex items-center gap-1">
                  <input type="number" min={0} step={0.5} value={sermeTekrarPencere || ""}
                    onChange={(e) => setSermeTekrarPencere(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0" className={selectClass + " w-32"} />
                  <span className="text-[10px] text-gray-400 whitespace-nowrap">saat (0 = kapalı)</span>
                </div>
              </div>
            </div>
            {/* Serme Yan Yana Mesafe */}
            <div className="border rounded-lg p-3 bg-emerald-50/40 border-emerald-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Serme Yan Yana Çizgi Mesafesi (m)</div>
              <p className="text-[11px] text-gray-400 mb-2">Serme sadeleştirme ızgara toleransı. Sermede şeritler daha geniş yayılıyorsa büyüt.</p>
              <div className="flex items-center gap-1">
                <input type="number" min={0} value={sermeGridMesafe || ""}
                  onChange={(e) => setSermeGridMesafe(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="12" className={selectClass + " w-32"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">metre</span>
              </div>
            </div>
            {/* Serme Transit Hız */}
            <div className="border rounded-lg p-3 bg-emerald-50/40 border-emerald-200">
              <div className="text-xs font-semibold text-gray-700 mb-1">Serme Transit Hız Eşiği (km/s)</div>
              <p className="text-[11px] text-gray-400 mb-2">Bu hızın ÜSTÜndeki geçiş serme sayımına katılmaz (transit). Serme hızı reglajdan farklıysa ayrı ayarla. 0 = kapalı.</p>
              <div className="flex items-center gap-1">
                <input type="number" min={0} value={sermeTransitHiz}
                  onChange={(e) => setSermeTransitHiz(Math.max(0, parseInt(e.target.value) || 0))}
                  placeholder="20" className={selectClass + " w-32"} />
                <span className="text-[10px] text-gray-400 whitespace-nowrap">km/s (0 = kapalı)</span>
              </div>
            </div>
            {/* ═══ GRUP 4: Sıkıştırma (Silindir) ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-3">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🧱 Sıkıştırma</span>
              <div className="flex-1 h-px bg-gray-200" />
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
            {/* ═══ GRUP 5: Harita Çizgileri — Kalınlık & Renk (tüm operasyonlar) ═══ */}
            <div className="md:col-span-3 flex items-center gap-2 pt-3">
              <span className="text-[13px] font-bold text-[#1E3A5F] whitespace-nowrap">🎨 Harita Çizgileri — Kalınlık &amp; Renk</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            {/* Çizgi Kalınlıkları & Renkleri — Reglaj / Serme / Silindir (haritadaki çizgi) */}
            <div className="border rounded-lg p-3 bg-indigo-50/40 border-indigo-200 md:col-span-3">
              <div className="text-xs font-semibold text-gray-700 mb-1">Çizgi Kalınlıkları & Renkleri</div>
              <p className="text-[11px] text-gray-400 mb-2">
                Haritadaki çizgilerin kalınlığı (1–12 px) ve rengi — her operasyon için ayrı.
              </p>
              <div className="flex flex-wrap items-end gap-5">
                <div className="flex items-end gap-2">
                  <input type="color" value={reglajRenk} onChange={(e) => setReglajRenk(e.target.value)}
                    className="h-8 w-9 rounded border cursor-pointer" title="Reglaj rengi" />
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">Reglaj (px)
                    <input type="number" min={1} max={12} value={reglajKalinlik || ""}
                      onChange={(e) => setReglajKalinlik(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                      className={selectClass + " w-20"} />
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <input type="color" value={sermeRenk} onChange={(e) => setSermeRenk(e.target.value)}
                    className="h-8 w-9 rounded border cursor-pointer" title="Serme rengi" />
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">Serme (px)
                    <input type="number" min={1} max={12} value={sermeKalinlik || ""}
                      onChange={(e) => setSermeKalinlik(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                      className={selectClass + " w-20"} />
                  </label>
                </div>
                <div className="flex items-end gap-2">
                  <input type="color" value={silindirRenk} onChange={(e) => setSilindirRenk(e.target.value)}
                    className="h-8 w-9 rounded border cursor-pointer" title="Silindir rengi" />
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">Silindir (px)
                    <input type="number" min={1} max={12} value={silindirKalinlik || ""}
                      onChange={(e) => setSilindirKalinlik(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                      className={selectClass + " w-20"} />
                  </label>
                </div>
                <div className="flex items-end gap-2 border-l pl-5">
                  <input type="color" value={kamyonIziRenk} onChange={(e) => setKamyonIziRenk(e.target.value)}
                    className="h-8 w-9 rounded border cursor-pointer" title="Kamyon izi rengi" />
                  <label className="flex flex-col gap-1 text-[11px] text-gray-600">Kamyon İzi (px)
                    <input type="number" min={1} max={12} value={kamyonIziKalinlik || ""}
                      onChange={(e) => setKamyonIziKalinlik(Math.min(12, Math.max(1, parseInt(e.target.value) || 1)))}
                      className={selectClass + " w-20"} />
                  </label>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                <strong>Kamyon İzi</strong> = Stabilize&apos;de kamyonun kendi güzergahı (reglaj çizgisinden farklı, kesik çizgi).
              </p>
            </div>
          </div>
          </fieldset>
        </div>

        {/* Araç → Sekme Atamaları — hangi araç hangi sekmede (Reglaj/Stabilize/Serme/Sıkıştırma/İş Makineleri) görünür */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-sm text-[#1E3A5F] mb-1">Araç Sekme Atamaları</h3>
              <p className="text-xs text-gray-400 max-w-2xl">
                Her aracın hangi sekme(ler)de görüneceğini buradan seçin. <strong>Hiçbir kutu işaretli değilse</strong> araç
                otomatik tespite (sınıf/plaka) göre davranır. Bir kutu işaretlenirse araç <strong>yalnız seçilen sekmelerde</strong> görünür.
                &quot;Sıfırla&quot; aracı otomatik moda döndürür.
              </p>
            </div>
            {yDuzenle && (
              <Button variant="outline" size="sm" onClick={atamalariKaydet} disabled={atamaKaydet} className="h-9 gap-1 text-xs">
                {atamaKaydet ? "Kaydediliyor..." : "Atamaları Kaydet"}
              </Button>
            )}
          </div>
          {!yDuzenle && (
            <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              🔒 Görüntüleme modundasınız — atamaları yalnızca <strong>düzenleme yetkisi</strong> olanlar değiştirebilir.
            </div>
          )}
          <input type="text" value={atamaArama} onChange={(e) => setAtamaArama(e.target.value)}
            placeholder="Plaka / cins ara..." className={selectClass + " w-full max-w-xs"} />
          <fieldset disabled={!yDuzenle} className="min-w-0 border-0 p-0 m-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b bg-gray-50 text-gray-500">
                    <th className="text-left font-semibold px-2 py-2">Plaka</th>
                    <th className="text-left font-semibold px-2 py-2">Cins</th>
                    {ATAMA_SEKMELERI.map((s) => (
                      <th key={s.key} className="font-semibold px-2 py-2 text-center whitespace-nowrap">{s.ad}</th>
                    ))}
                    <th className="font-semibold px-2 py-2 text-center">Durum</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {atamalar
                    .filter((a) => {
                      const q = trAramaNormalize(atamaArama.trim());
                      if (q) return trAramaNormalize([a.plaka, a.cinsi, a.marka, a.model].filter(Boolean).join(" ")).includes(q);
                      // Arama yoksa: atama yapılmamış (otomatik) araçları gizle — toggle ile açılır.
                      if (!atanmamisGoster && !Array.isArray(a.sekmeler)) return false;
                      return true;
                    })
                    .map((a) => {
                      const atanmis = Array.isArray(a.sekmeler);
                      return (
                        <tr key={a.id} className="border-b hover:bg-gray-50">
                          <td className="px-2 py-1.5 font-medium text-gray-700 whitespace-nowrap">{a.plaka}</td>
                          <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{a.cinsi ?? "—"}</td>
                          {ATAMA_SEKMELERI.map((s) => (
                            <td key={s.key} className="px-2 py-1.5 text-center">
                              <input type="checkbox" className="h-4 w-4 cursor-pointer accent-[#1E3A5F]"
                                checked={(a.sekmeler ?? []).includes(s.key)}
                                onChange={() => atamaToggle(a.id, s.key)} />
                            </td>
                          ))}
                          <td className="px-2 py-1.5 text-center whitespace-nowrap">
                            {atanmis
                              ? <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5">Atanmış</span>
                              : <span className="text-[10px] text-gray-400 bg-gray-50 border rounded px-1.5 py-0.5">Otomatik</span>}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {atanmis && (
                              <button type="button" onClick={() => atamaSifirla(a.id)}
                                className="text-gray-400 hover:text-red-500 text-[11px]" title="Otomatik moda döndür">Sıfırla</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  {atamalar.length === 0 && (
                    <tr><td colSpan={ATAMA_SEKMELERI.length + 4} className="px-2 py-4 text-center text-gray-400">Araç bulunamadı.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </fieldset>
          {/* Atama yapılmamış (otomatik) araçları göster/gizle — arama yokken geçerli */}
          {!atamaArama.trim() && (() => {
            const atanmamisSayi = atamalar.filter((a) => !Array.isArray(a.sekmeler)).length;
            if (atanmamisSayi === 0) return null;
            return (
              <button type="button" onClick={() => setAtanmamisGoster((v) => !v)}
                className="text-xs font-medium text-[#1E3A5F] hover:underline flex items-center gap-1">
                {atanmamisGoster ? `▲ Atama yapılmamış araçları gizle` : `▼ Atama yapılmamış araçları göster (${atanmamisSayi})`}
              </button>
            );
          })()}
        </div>

        {/* Cihaz Listesi (Canlı Takip) — node→plaka/şoför eşlemesi için Arvento cihaz Excel'i */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-bold text-sm text-[#1E3A5F] mb-1">Cihaz Listesi (Canlı Takip)</h3>
              <p className="text-xs text-gray-400 max-w-2xl">
                Canlı konum web servisi araçları <strong>cihaz no (node)</strong> ile döndürür, plaka ile değil.
                Plaka/şoför gösterimi için Arvento&apos;dan indirdiğiniz <strong>Cihazlar_*.xlsx</strong> dosyasını
                yükleyin. Cihaz değişince tekrar yükleyip güncelleyebilirsiniz.
                {cihazSayisi != null && <span className="block mt-1 text-emerald-700">Kayıtlı cihaz: <strong>{cihazSayisi}</strong></span>}
              </p>
            </div>
            {yEkle && (
              <>
                <input ref={cihazFileRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) cihazYukle(f); }} />
                <Button variant="outline" size="sm" onClick={() => cihazFileRef.current?.click()}
                  disabled={cihazYukleniyor} className="h-9 gap-1 text-xs">
                  <Upload size={14} /> {cihazYukleniyor ? "Yükleniyor..." : "Cihaz Excel Yükle"}
                </Button>
              </>
            )}
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
            {yEkle ? (
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Şantiye
                  <select value={katmanSantiyeId} onChange={(e) => setKatmanSantiyeId(e.target.value)}
                    className={`h-8 rounded border px-2 text-xs bg-white max-w-[200px] ${katmanSantiyeId ? "" : "border-amber-400 text-amber-700"}`}
                    title="Önce şantiye seçin, sonra KML yükleyin">
                    <option value="">— Önce şantiye seçin —</option>
                    {santiyeSecenekleri.map((s) => <option key={s.id} value={s.id}>{s.is_adi}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-1 text-xs text-gray-600">
                  Renk
                  <input type="color" value={katmanRenk} onChange={(e) => setKatmanRenk(e.target.value)}
                    className="h-8 w-10 rounded border cursor-pointer" title="Yeni katman rengi" />
                </label>
                <input ref={katmanFileRef} type="file" accept=".kml,.kmz" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) katmanYukle(f); }} />
                <Button variant="outline" size="sm" onClick={() => katmanFileRef.current?.click()}
                  disabled={katmanYukleniyor || !katmanSantiyeId} title={!katmanSantiyeId ? "Önce şantiye seçin" : "KML/KMZ yükle"}
                  className="h-9 gap-1 text-xs">
                  <Upload size={14} /> {katmanYukleniyor ? "Yükleniyor..." : "KML/KMZ Yükle"}
                </Button>
              </div>
            ) : (
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                🔒 KML eklemek için <strong>ekleme yetkisi</strong> gerekir
              </span>
            )}
          </div>

          {haritaKatmanlari.length === 0 ? (
            <p className="text-xs text-gray-400">Henüz katman yok. Yukarıdan bir KML/KMZ yükleyin.</p>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-auto pr-1">
              {katmanGruplari.map((grp) => (
                <div key={grp.santiyeId ?? "yok"}>
                  <div className="flex items-center gap-2 mb-1.5 sticky top-0 bg-white py-1 z-10">
                    <span className={`text-xs font-bold truncate ${grp.santiyeId ? "text-[#1E3A5F]" : "text-amber-700"}`} title={grp.ad}>{grp.ad}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{grp.layers.length} katman</span>
                    <div className="flex-1 border-t border-gray-100" />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-1.5">
                    {grp.layers.map((k) => (
                  <div key={k.id} className="border rounded-md p-1.5 flex flex-col gap-1 text-xs">
                    {/* Üst: renk + ad + göster/gizle + sil */}
                    <div className="flex items-center gap-1.5">
                      <input type="color" value={k.renk} disabled={!yDuzenle}
                        onChange={(e) => katmanDegis(k.id, { renk: e.target.value })}
                        className="h-5 w-6 rounded border cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-50" title="Renk" />
                      <span className="font-medium text-gray-800 truncate flex-1 text-[11px]" title={k.ad}>{k.ad}</span>
                      <button type="button" onClick={() => katmanDegis(k.id, { gorunur: !k.gorunur })} disabled={!yDuzenle}
                        title={!yDuzenle ? "Düzenleme yetkiniz yok" : k.gorunur ? "Haritada gizle" : "Haritada göster"}
                        className={`p-0.5 rounded shrink-0 disabled:cursor-not-allowed disabled:opacity-40 ${k.gorunur ? "text-emerald-600 hover:bg-emerald-50" : "text-gray-300 hover:bg-gray-100"}`}>
                        {k.gorunur ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      {ySil && (
                        <button type="button" onClick={() => katmanSil(k.id, k.ad)} title="Sil"
                          className="p-0.5 rounded shrink-0 text-gray-400 hover:text-red-500 hover:bg-red-50">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                    {/* Şantiye ataması — yüklerken seçilir, buradan değiştirilebilir */}
                    <select value={k.santiye_id ?? ""} disabled={!yDuzenle}
                      onChange={(e) => katmanDegis(k.id, { santiye_id: e.target.value || null })}
                      title="Bu katmanın şantiyesi"
                      className={`h-6 rounded border px-1 text-[10px] w-full bg-white disabled:opacity-70 disabled:cursor-not-allowed ${k.santiye_id ? "text-gray-700" : "text-amber-700 border-amber-300"}`}>
                      <option value="">— Atanmamış —</option>
                      {santiyeSecenekleri.map((s) => <option key={s.id} value={s.id}>{s.is_adi}</option>)}
                    </select>
                    {/* Alt: geometri sayısı + kalınlık stepper */}
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] text-gray-400">{(k.geometriler ?? []).length} geo.</span>
                      <div className="flex items-center gap-0.5" title="Çizgi kalınlığı (px)">
                        <button type="button" disabled={!yDuzenle || (k.kalinlik ?? 3) <= 1}
                          onClick={() => katmanDegis(k.id, { kalinlik: Math.max(1, (k.kalinlik ?? 3) - 1) })}
                          className="w-5 h-5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed leading-none text-xs">−</button>
                        <span className="w-8 text-center text-[10px] text-gray-600 tabular-nums">{k.kalinlik ?? 3}px</span>
                        <button type="button" disabled={!yDuzenle || (k.kalinlik ?? 3) >= 12}
                          onClick={() => katmanDegis(k.id, { kalinlik: Math.min(12, (k.kalinlik ?? 3) + 1) })}
                          className="w-5 h-5 rounded border text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed leading-none text-xs">+</button>
                      </div>
                    </div>
                  </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Şantiye → İl (görme izni): kısıtlı kullanıcı, atandığı şantiyenin İL SINIRI içindeki her şeyi görür */}
        <div className="bg-white rounded-lg border p-4 space-y-3">
          <div>
            <h3 className="font-bold text-sm text-[#1E3A5F] mb-1 flex items-center gap-1.5"><MapPin size={16} /> Şantiye İlleri (görme izni)</h3>
            <p className="text-xs text-gray-400 max-w-2xl">
              Kısıtlı kullanıcı, atandığı şantiyelerin <strong>il sınırı</strong> içindeki tüm canlı araç, KML ve damperleri görür
              (araç il dışına çıkınca canlıda anında kaybolur; geçmişte o il içindeki veriler her zaman görünür). İl, şantiye
              adından <strong>otomatik</strong> bulunur; yanlışsa aşağıdan düzeltin. <strong>Yöneticiler her şeyi görür.</strong>
            </p>
          </div>
          {santiyeSecenekleri.length === 0 ? (
            <p className="text-xs text-gray-400">Şantiye yok.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-1.5 max-h-[40vh] overflow-auto pr-1">
              {santiyeSecenekleri.map((s) => {
                const oto = adtanIl(s.is_adi, iller.map((i) => i.ad));
                return (
                  <div key={s.id} className="border rounded-md p-1.5 flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate text-gray-700" title={s.is_adi}>{s.is_adi}</span>
                    <select value={s.il ?? ""} disabled={!yDuzenle || iller.length === 0}
                      onChange={(e) => santiyeIlDegistir(s.id, e.target.value)}
                      title={s.il ? "Elle ayarlı" : oto ? `Otomatik: ${oto}` : "İl bulunamadı — elle seçin"}
                      className={`h-6 rounded border px-1 text-[10px] bg-white shrink-0 w-28 disabled:opacity-60 disabled:cursor-not-allowed ${s.il ? "text-gray-800 font-medium" : oto ? "text-emerald-700" : "text-amber-700 border-amber-300"}`}>
                      <option value="">{oto ? `Otomatik: ${oto}` : "— İl seçin —"}</option>
                      {iller.map((i) => <option key={i.ad} value={i.ad}>{i.ad}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
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
