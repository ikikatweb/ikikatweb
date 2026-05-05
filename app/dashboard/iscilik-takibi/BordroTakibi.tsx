// Bordro Takibi — şantiye kanban + drag-drop personel transferi
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPlus, Trash2, Mail, Building2, Users, Send, Eye, ArrowRight, Lock, ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Plus } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import { getIscilikTakibi } from "@/lib/supabase/queries/iscilik-takibi";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import {
  getBordroPersoneller,
  insertBordroPersonel,
  isenCikar,
  iseGeriAl,
  transferEt,
  getAtamaGecmisiTumu,
  gunHesapla,
  gunHesaplaAyBazliOverride,
  aySonuSantiyeMap,
  updateAtama,
  deleteAtama,
  insertAtama,
  getManuelGunler,
  setManuelGun,
  deleteManuelGun,
} from "@/lib/supabase/queries/bordro";
import type { Personel, PersonelAtamaGecmisi, PersonelAtamaManuelGun } from "@/lib/supabase/types";

type SantiyeBasic = {
  id: string; is_adi: string; durum: string;
  gecici_kabul_tarihi?: string | null;
  kesin_kabul_tarihi?: string | null;
  tasfiye_tarihi?: string | null;
  devir_tarihi?: string | null;
};
type Firma = {
  id: string;
  firma_adi: string;
  smtp_host?: string | null;
  smtp_user?: string | null;
  smtp_password?: string | null;
};

// Bekleyen değişiklik kaydı (mail kuyruğu için)
type PendingChange = {
  id: string;            // benzersiz id (örn. timestamp+random)
  tip: "giris" | "cikis" | "transfer";
  personelAd: string;
  personelTc?: string;
  personelGorev?: string;
  santiyeAd?: string;     // hedef şantiye (giriş/transfer)
  onceSantiyeAd?: string; // önceki şantiye (çıkış/transfer)
  tarih: string;          // YYYY-MM-DD
};

const PASIF_KEY = "__pasif__";
const ATANMAMIS_KEY = "__atanmamis__";
const PENDING_LS_KEY = "bordro-pending-changes";

function su_an_ay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function ayDegistir(ayStr: string, delta: number): string {
  const [y, m] = ayStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
const TR_AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
function ayLabel(ayStr: string): string {
  const [y, m] = ayStr.split("-").map(Number);
  return `${TR_AYLAR[m - 1]} ${y}`;
}
// Türkçe karakterleri ASCII'ye çevir (PDF için)
function trAscii(s: string): string {
  return s.replace(/ğ/g, "g").replace(/Ğ/g, "G").replace(/ü/g, "u").replace(/Ü/g, "U")
    .replace(/ş/g, "s").replace(/Ş/g, "S").replace(/ö/g, "o").replace(/Ö/g, "O")
    .replace(/ç/g, "c").replace(/Ç/g, "C").replace(/ı/g, "i").replace(/İ/g, "I");
}

// Hızlı manuel gün girişi kartı (gün düzenle dialogunun başında)
function ManuelGunHizliKart({
  mevcutGun, aySonGun, onSave,
}: {
  mevcutGun: number;
  aySonGun: number;
  onSave: (N: number) => Promise<void> | void;
}) {
  const [val, setVal] = useState(String(mevcutGun));
  useEffect(() => { setVal(String(mevcutGun)); }, [mevcutGun]);
  const N = Math.max(0, Math.min(aySonGun, parseInt(val) || 0));
  const degisti = N !== mevcutGun;
  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-3">
      <div className="text-xs text-blue-700 font-semibold mb-1.5">
        Hızlı Manuel Gün Girişi
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={aySonGun}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className="w-24 h-10 text-2xl font-bold text-center text-blue-700 border-2 border-blue-300 rounded-lg outline-none focus:border-blue-500 bg-white"
        />
        <span className="text-sm text-gray-600">gün <span className="text-[10px] text-gray-400">/ {aySonGun}</span></span>
        <button
          type="button"
          disabled={!degisti}
          onClick={() => onSave(N)}
          className="ml-auto px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Kaydet
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
        Sadece bu ay içindeki gün sayısını günceller — atamanın **çıkış tarihi atılmaz**, personel halen aktif kalır.
        Çıkış için aşağıdaki detay editöründe "İşten Çıkış" tarihini elle girin.
      </p>
    </div>
  );
}

// Atama satır editörü (gün düzenle dialogu için)
function AtamaSatir({
  atama, gunSayisi, onSave, onDelete,
}: {
  atama: PersonelAtamaGecmisi;
  gunSayisi: number;
  onSave: (baslangic: string, bitis: string | null) => void;
  onDelete: () => void;
}) {
  const [bas, setBas] = useState(atama.baslangic_tarihi);
  const [bit, setBit] = useState(atama.bitis_tarihi ?? "");
  const [halen, setHalen] = useState(atama.bitis_tarihi == null);
  const degisti = bas !== atama.baslangic_tarihi
    || (halen ? atama.bitis_tarihi !== null : bit !== (atama.bitis_tarihi ?? ""));
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-[10px] text-gray-500">İşe Başlama</label>
          <input type="date" value={bas} onChange={(e) => setBas(e.target.value)}
            className="w-full h-8 border rounded px-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 flex items-center justify-between">
            <span>İşten Çıkış</span>
            <span className="flex items-center gap-1">
              <input type="checkbox" checked={halen} onChange={(e) => setHalen(e.target.checked)} className="cursor-pointer" />
              <span className="text-[10px]">Halen</span>
            </span>
          </label>
          <input type="date" value={halen ? "" : bit} onChange={(e) => setBit(e.target.value)}
            disabled={halen} className="w-full h-8 border rounded px-2 text-xs disabled:bg-gray-100" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-emerald-700 font-semibold">Bu ayda: {gunSayisi} gün</span>
        <div className="flex gap-1">
          <button type="button" onClick={onDelete}
            className="px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded hover:bg-red-50">
            Sil
          </button>
          <button type="button" disabled={!degisti}
            onClick={() => onSave(bas, halen ? null : (bit || null))}
            className="px-3 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
            Kaydet
          </button>
        </div>
      </div>
    </div>
  );
}

// Yeni atama ekleme satırı
function YeniAtamaSatir({
  defaultBaslangic, defaultBitis, onEkle,
}: {
  defaultBaslangic: string;
  defaultBitis: string;
  onEkle: (baslangic: string, bitis: string | null) => void;
}) {
  const [acik, setAcik] = useState(false);
  const [bas, setBas] = useState(defaultBaslangic);
  const [bit, setBit] = useState(defaultBitis);
  const [halen, setHalen] = useState(false);
  if (!acik) {
    return (
      <button type="button" onClick={() => setAcik(true)}
        className="w-full text-xs border-2 border-dashed border-gray-300 rounded-lg py-2 text-gray-500 hover:border-emerald-500 hover:text-emerald-600">
        + Yeni atama ekle
      </button>
    );
  }
  return (
    <div className="border border-emerald-200 rounded-lg p-3 bg-emerald-50">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-[10px] text-gray-500">İşe Başlama</label>
          <input type="date" value={bas} onChange={(e) => setBas(e.target.value)}
            className="w-full h-8 border rounded px-2 text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-gray-500 flex items-center justify-between">
            <span>İşten Çıkış</span>
            <span className="flex items-center gap-1">
              <input type="checkbox" checked={halen} onChange={(e) => setHalen(e.target.checked)} className="cursor-pointer" />
              <span className="text-[10px]">Halen</span>
            </span>
          </label>
          <input type="date" value={halen ? "" : bit} onChange={(e) => setBit(e.target.value)}
            disabled={halen} className="w-full h-8 border rounded px-2 text-xs disabled:bg-gray-100" />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <button type="button" onClick={() => setAcik(false)}
          className="px-2 py-1 text-[11px] text-gray-500 border border-gray-200 rounded hover:bg-gray-50">İptal</button>
        <button type="button"
          onClick={() => { onEkle(bas, halen ? null : (bit || null)); setAcik(false); }}
          className="px-3 py-1 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700">Ekle</button>
      </div>
    </div>
  );
}

export default function BordroTakibi() {
  const { kullanici } = useAuth();
  const [loading, setLoading] = useState(true);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [atamalar, setAtamalar] = useState<PersonelAtamaGecmisi[]>([]);
  const [manuelGunler, setManuelGunler] = useState<PersonelAtamaManuelGun[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [muhasebeEmail, setMuhasebeEmail] = useState<string>("");
  const [gorevSecenekleri, setGorevSecenekleri] = useState<string[]>([]);
  const [arama, setArama] = useState("");

  // Drag state
  const [dragPersonelId, setDragPersonelId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Ekle dialog (sadeleştirildi: ad soyad + TC + görev select + şantiye select + tarih)
  const [ekleAcik, setEkleAcik] = useState(false);
  const [ekleAd, setEkleAd] = useState("");
  const [ekleTc, setEkleTc] = useState("");
  const [ekleGorev, setEkleGorev] = useState("");
  const [ekleSantiye, setEkleSantiye] = useState("");
  const [ekleTarih, setEkleTarih] = useState(() => new Date().toISOString().slice(0, 10));
  const [kaydetYukleniyor, setKaydetYukleniyor] = useState(false);

  // Çıkış onayı
  const [cikisOnay, setCikisOnay] = useState<Personel | null>(null);

  // Geri alma seç dialog (pasif personeli hangi şantiyeye)
  const [geriAlPersonel, setGeriAlPersonel] = useState<Personel | null>(null);
  const [geriAlSantiye, setGeriAlSantiye] = useState("");

  // Gün düzenleme dialog: bir personelin belirli bir şantiyedeki atamaları
  const [gunEdit, setGunEdit] = useState<{ personel: Personel; santiyeId: string } | null>(null);

  // Toplu personel ekleme dialog: şantiye sütununun + butonu
  const [topluEkleSantiyeId, setTopluEkleSantiyeId] = useState<string | null>(null);
  const [topluSecilenler, setTopluSecilenler] = useState<Set<string>>(new Set());
  const [topluArama, setTopluArama] = useState("");
  const [topluTarih, setTopluTarih] = useState(() => new Date().toISOString().slice(0, 10));
  const [topluEkleniyor, setTopluEkleniyor] = useState(false);

  // Ay seçici (default: bu ay). Geçmiş aylarda kanban salt-okunur snapshot gösterir.
  const [seciliAy, setSeciliAy] = useState<string>(su_an_ay);
  const buAy = su_an_ay();
  const isReadOnly = seciliAy < buAy;

  // Bekleyen değişiklikler — mail kuyruğu (localStorage'da kalıcı)
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [mailDialogAcik, setMailDialogAcik] = useState(false);
  const [mailGonderiliyor, setMailGonderiliyor] = useState(false);
  const [ekMailNotu, setEkMailNotu] = useState("");

  // localStorage'tan kuyruk yükle
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_LS_KEY);
      if (saved) setPending(JSON.parse(saved));
    } catch { /* sessiz */ }
  }, []);
  // Kuyruğu localStorage'a yaz
  useEffect(() => {
    try {
      if (pending.length > 0) localStorage.setItem(PENDING_LS_KEY, JSON.stringify(pending));
      else localStorage.removeItem(PENDING_LS_KEY);
    } catch { /* sessiz */ }
  }, [pending]);

  function pendingEkle(p: Omit<PendingChange, "id">) {
    setPending((prev) => [
      ...prev,
      { ...p, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
    ]);
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, a, m, f, iscilik, gorevler, mGunler] = await Promise.all([
        getSantiyelerAll().catch(() => []),
        getBordroPersoneller().catch(() => []),
        getAtamaGecmisiTumu().catch(() => []),
        getDegerler("muhasebe_email").catch(() => []),
        getFirmalar().catch(() => []),
        getIscilikTakibi(false).catch(() => [] as { santiye_id: string; santiyeler?: SantiyeBasic | null }[]),
        getDegerler("personel_gorev").catch(() => []),
        getManuelGunler().catch(() => []),
      ]);
      setGorevSecenekleri(gorevler ?? []);
      setManuelGunler(mGunler);
      // İşçilik Durum Raporu'ndaki filtreyle BİREBİR AYNI:
      //   const bitmis = !!(s?.gecici_kabul_tarihi || s?.kesin_kabul_tarihi
      //                  || s?.tasfiye_tarihi || s?.devir_tarihi);
      // Yani herhangi bir tarih değeri "truthy" ise (boş string ve null hariç) bitmiş sayılır.
      const iscilikRaporSantiyeIds = new Set<string>();
      for (const r of (iscilik as { santiye_id: string; santiyeler?: SantiyeBasic | null }[]) ?? []) {
        const sant = r.santiyeler ?? null;
        const bitmis = !!(sant && (
          sant.gecici_kabul_tarihi ||
          sant.kesin_kabul_tarihi ||
          sant.tasfiye_tarihi ||
          sant.devir_tarihi
        ));
        if (!bitmis && r.santiye_id) iscilikRaporSantiyeIds.add(r.santiye_id);
      }
      const tumSantiyeler = (s as SantiyeBasic[]) ?? [];
      const aktifSantiyeler = tumSantiyeler.filter((x) => iscilikRaporSantiyeIds.has(x.id));
      setSantiyeler(aktifSantiyeler);
      setPersoneller(p);
      setAtamalar(a);
      setMuhasebeEmail(m[0] ?? "");
      setFirmalar((f as Firma[]) ?? []);
    } catch (err) {
      console.error(err);
      toast.error(`Yükleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Personel başına: seçili ayda hangi şantiyede kaç gün — override'lı
  const gunMap = useMemo(() => {
    const overrideMap = new Map<string, number>();
    for (const m of manuelGunler) {
      if (m.ay === seciliAy) {
        overrideMap.set(`${m.personel_id}:${m.santiye_id}`, m.gun);
      }
    }
    return gunHesaplaAyBazliOverride(atamalar, seciliAy, overrideMap);
  }, [atamalar, seciliAy, manuelGunler]);
  // Toplam (tüm zamanlar) — bilgi olarak gösterilebilir
  const gunMapToplam = useMemo(() => gunHesapla(atamalar), [atamalar]);
  void gunMapToplam;

  // Filtrele: arama
  const filtreli = useMemo(() => {
    const q = arama.trim().toLocaleLowerCase("tr-TR");
    if (!q) return personeller;
    return personeller.filter((p) => {
      const text = [p.ad_soyad, p.tc_kimlik_no, p.gorev, p.meslek].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
      return text.includes(q);
    });
  }, [personeller, arama]);

  // Şantiye → personel listesi haritası — TAMAMEN atama_gecmisi'nden türetilir.
  // Personel tablosundaki santiye_id ve durum bordro tarafından KULLANILMAZ
  // (bordro bağımsız → diğer sayfaları etkilemez, diğer sayfalar bordro'yu etkilemez).
  //
  // Sınıflandırma:
  //  - Seçili ayda atama varsa → o şantiye(ler)de göster
  //  - Atama yok ama geçmişte atama vardı (hepsi kapalı) → PASIF
  //  - Hiç atama yok → ATANMAMIŞ (yeni eklenen veya kadrodan henüz bordroya konmamış)
  const kanbanMap = useMemo(() => {
    const map = new Map<string, Personel[]>();
    for (const s of santiyeler) map.set(s.id, []);
    map.set(PASIF_KEY, []);
    map.set(ATANMAMIS_KEY, []);

    // Her personel için tüm atamalar
    const personelAtamalari = new Map<string, PersonelAtamaGecmisi[]>();
    for (const a of atamalar) {
      if (!personelAtamalari.has(a.personel_id)) personelAtamalari.set(a.personel_id, []);
      personelAtamalari.get(a.personel_id)!.push(a);
    }

    for (const p of filtreli) {
      const santiyeGunleri = gunMap.get(p.id);
      const calistigiSantiyeler = santiyeGunleri
        ? Array.from(santiyeGunleri.keys()).filter((sid) => map.has(sid))
        : [];

      if (calistigiSantiyeler.length > 0) {
        for (const sid of calistigiSantiyeler) {
          map.get(sid)!.push(p);
        }
      } else {
        const tumAtamalari = personelAtamalari.get(p.id) ?? [];
        if (tumAtamalari.length > 0) {
          // Geçmişte atama vardı, şu an aktif yok → PASIF (bordro bağlamında)
          map.get(PASIF_KEY)!.push(p);
        } else {
          // Hiç atama yok → ATANMAMIŞ
          map.get(ATANMAMIS_KEY)!.push(p);
        }
      }
    }
    void aySonuSantiyeMap;
    return map;
  }, [filtreli, santiyeler, gunMap, atamalar]);

  // Bekleyen değişiklik kuyruğa ekle (mail göndermez — preview + send butonu kullanır)
  function kuyrugaEkle(payload: {
    tip: "giris" | "cikis" | "transfer";
    personel: Personel;
    santiyeAd?: string;
    onceSantiyeAd?: string;
  }) {
    pendingEkle({
      tip: payload.tip,
      personelAd: payload.personel.ad_soyad,
      personelTc: payload.personel.tc_kimlik_no,
      personelGorev: payload.personel.gorev ?? undefined,
      santiyeAd: payload.santiyeAd,
      onceSantiyeAd: payload.onceSantiyeAd,
      tarih: new Date().toISOString().slice(0, 10),
    });
  }

  // Mail dialogu üzerinden bulk gönderim
  async function bulkMailGonder() {
    if (!muhasebeEmail) {
      toast.error("Muhasebe email tanımlı değil. Tanımlamalar > muhasebe_email kategorisinden ekleyin.");
      return;
    }
    if (firmalar.length === 0) {
      toast.error("Firma bulunamadı — SMTP ayarları için firma gerekli.");
      return;
    }
    // SMTP ayarları olan firmayı seç (yoksa ilk firma — API yine kontrol eder)
    const smtpFirmasi = firmalar.find((f) => f.smtp_host && f.smtp_user && f.smtp_password) ?? firmalar[0];
    if (!smtpFirmasi.smtp_host || !smtpFirmasi.smtp_user || !smtpFirmasi.smtp_password) {
      toast.error(
        `Hiçbir firmanın SMTP ayarları yok. Yönetim > Firmalar sayfasından bir firmayı seçip SMTP Host / User / Password alanlarını doldurun.`,
        { duration: 8000 },
      );
      return;
    }
    if (pending.length === 0) {
      toast("Gönderilecek değişiklik yok.", { icon: "ℹ️" });
      return;
    }
    setMailGonderiliyor(true);
    try {
      const res = await fetch("/api/bordro-mail-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaId: smtpFirmasi.id,
          muhasebeEmail,
          changes: pending,
          ekBilgi: ekMailNotu.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Mail gönderilemedi");
      toast.success(`${pending.length} değişiklik tek mailde gönderildi → ${muhasebeEmail}`);
      setPending([]);
      setEkMailNotu("");
      setMailDialogAcik(false);
    } catch (err) {
      toast.error(`Mail hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setMailGonderiliyor(false);
    }
  }

  function pendingSil(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  // Gün düzenle: bir personelin belirli şantiyedeki atamaları + ay sınırlarına çakışan günler
  async function gunEditAtamaUpdate(atamaId: string, baslangic: string, bitis: string | null) {
    try {
      await updateAtama(atamaId, { baslangic_tarihi: baslangic, bitis_tarihi: bitis });
      toast.success("Atama güncellendi");
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function gunEditAtamaSil(atamaId: string) {
    if (!confirm("Bu atamayı silmek istediğinize emin misiniz?")) return;
    try {
      await deleteAtama(atamaId);
      toast.success("Atama silindi");
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function gunEditAtamaEkle(personelId: string, santiyeId: string, baslangic: string, bitis: string | null) {
    try {
      await insertAtama(personelId, santiyeId, baslangic, bitis);
      toast.success("Atama eklendi");
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Manuel gün sayısı kaydı (override).
  //  - Atamanın çıkış tarihi DEĞİŞTİRİLMEZ (bitis_tarihi=null kalır, personel halen aktif).
  //  - Sadece o ay × o şantiye için "manuel_gun" tablosuna override yazılır.
  //  - Atama henüz yoksa açık bir atama (bitis_tarihi=null) oluşturulur.
  //  - 0 girilirse override silinir → doğal hesaplamaya döner.
  async function kaydetManuelGun(personelId: string, santiyeId: string, ayStr: string, N: number) {
    const [yil, ay] = ayStr.split("-").map(Number);
    const ayBas = `${yil}-${String(ay).padStart(2, "0")}-01`;
    const sonGun = new Date(yil, ay, 0).getDate();
    const ayBit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    const aktifSanal = today >= ayBas && today <= ayBit ? today : ayBit;

    const liste = atamalar.filter((a) => {
      if (a.personel_id !== personelId || a.santiye_id !== santiyeId) return false;
      const bH = a.bitis_tarihi ?? aktifSanal;
      if (a.baslangic_tarihi > ayBit) return false;
      if (bH < ayBas) return false;
      return true;
    });

    try {
      if (liste.length === 0 && N > 0) {
        // Atama yoksa: AÇIK atama oluştur (bitis_tarihi=null) — kullanıcı çıkış tarihi atmadıkça kapatılmaz
        await insertAtama(personelId, santiyeId, ayBas, null);
      }
      if (N <= 0) {
        // Override sil (varsa) — doğal hesaplamaya dön
        await deleteManuelGun(personelId, santiyeId, ayStr).catch(() => {});
      } else {
        // Override yaz/güncelle — atama tarihleri DOKUNULMAZ
        await setManuelGun(personelId, santiyeId, ayStr, N);
      }
      toast.success(`Gün sayısı ${N} olarak kaydedildi (atama açık kaldı)`);
      setGunEdit(null); // Pencereyi kapat
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Toplu personel ekle: dialog'dan seçili personelleri belirtilen şantiyeye atama açar
  async function topluPersonelEkle() {
    if (!topluEkleSantiyeId || topluSecilenler.size === 0) return;
    const santiyeAd = santiyeler.find((s) => s.id === topluEkleSantiyeId)?.is_adi;
    setTopluEkleniyor(true);
    try {
      let basari = 0;
      for (const personelId of topluSecilenler) {
        try {
          const personel = personeller.find((p) => p.id === personelId);
          if (!personel) continue;
          // Mevcut aktif atama var mı? (transfer gerek mi?)
          const aktifAtama = atamalar.find((a) => a.personel_id === personelId && !a.bitis_tarihi);
          const onceSantiyeAd = aktifAtama
            ? santiyeler.find((s) => s.id === aktifAtama.santiye_id)?.is_adi
            : undefined;
          // Eğer aktif atama varsa onu kapat (seçili tarihten bir gün önce);
          // sonra yeni şantiyede yeni atama aç (seçili tarihten itibaren).
          // Bu şekilde tarih sınırları doğru olur.
          if (aktifAtama && aktifAtama.santiye_id !== topluEkleSantiyeId) {
            await updateAtama(aktifAtama.id, { bitis_tarihi: topluTarih });
          }
          // Yeni atama
          await insertAtama(personelId, topluEkleSantiyeId, topluTarih, null);
          // Mail kuyruğa
          if (aktifAtama && aktifAtama.santiye_id !== topluEkleSantiyeId) {
            kuyrugaEkle({ tip: "transfer", personel, santiyeAd, onceSantiyeAd });
          } else if (!aktifAtama) {
            kuyrugaEkle({ tip: "giris", personel, santiyeAd });
          }
          basari++;
        } catch (e) {
          console.error("Toplu ekleme hatası:", e);
        }
      }
      toast.success(`${basari}/${topluSecilenler.size} personel eklendi`);
      setTopluEkleSantiyeId(null);
      setTopluSecilenler(new Set());
      setTopluArama("");
      await loadData();
    } finally {
      setTopluEkleniyor(false);
    }
  }

  // Şantiye-bazlı export verisi: her atamada bir satır.
  // İşe başlama = atama.baslangic_tarihi (gerçek giriş)
  // İşten çıkış = atama.bitis_tarihi (gerçek çıkış) veya "Halen"
  // Gün = seçili ay içindeki gün sayısı (ay sınırlarına clamp'lenir)
  function exportSantiyeBazli() {
    type Row = {
      santiyeId: string; santiyeAd: string;
      adSoyad: string; tc: string; gorev: string;
      iseBaslama: string; isenCikis: string;
      gun: number;
    };
    const rows: Row[] = [];
    const [yil, ay] = seciliAy.split("-").map(Number);
    const ayBas = `${yil}-${String(ay).padStart(2, "0")}-01`;
    const sonGun = new Date(yil, ay, 0).getDate();
    const ayBit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
    const today = new Date().toISOString().slice(0, 10);
    // Aktif atama (bitis_tarihi=null) için sanal bitiş: ay sınırı veya bugün
    const aktifSanalBitis = today >= ayBas && today <= ayBit ? today : ayBit;
    const fmt = (d: string) => {
      const dt = new Date(d + "T00:00:00");
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("tr-TR");
    };
    const gFark = (a: string, b: string) => {
      const ta = new Date(a + "T00:00:00").getTime();
      const tb = new Date(b + "T00:00:00").getTime();
      return Math.max(0, Math.round((tb - ta) / 86400000) + 1);
    };

    const filtrelenmisIds = new Set(filtreli.map((p) => p.id));
    const santiyeIds = new Set(santiyeler.map((s) => s.id));

    // Önce ham satırları topla
    const ham: (Row & { _bas: string; _bit: string | null })[] = [];
    for (const a of atamalar) {
      if (!filtrelenmisIds.has(a.personel_id)) continue;
      if (!santiyeIds.has(a.santiye_id)) continue;
      const bitisHam = a.bitis_tarihi ?? aktifSanalBitis;
      if (a.baslangic_tarihi > ayBit) continue;
      if (bitisHam < ayBas) continue;
      const personel = personeller.find((p) => p.id === a.personel_id);
      const sant = santiyeler.find((s) => s.id === a.santiye_id);
      if (!personel || !sant) continue;
      const clampBas = a.baslangic_tarihi > ayBas ? a.baslangic_tarihi : ayBas;
      const clampBit = bitisHam < ayBit ? bitisHam : ayBit;
      ham.push({
        santiyeId: sant.id,
        santiyeAd: sant.is_adi,
        adSoyad: personel.ad_soyad,
        tc: personel.tc_kimlik_no ?? "",
        gorev: personel.gorev ?? "",
        iseBaslama: fmt(a.baslangic_tarihi),
        isenCikis: a.bitis_tarihi ? fmt(a.bitis_tarihi) : "Halen",
        gun: gFark(clampBas, clampBit),
        _bas: a.baslangic_tarihi,
        _bit: a.bitis_tarihi,
      });
    }

    // (personel × şantiye) bazlı topla — aynı personel aynı şantiyede ay içinde
    // 2+ atama almışsa → tek satıra indirgenip günler toplanır.
    const gruplar = new Map<string, typeof ham>();
    for (const r of ham) {
      const key = `${r.tc || r.adSoyad}:${r.santiyeId}`;
      if (!gruplar.has(key)) gruplar.set(key, []);
      gruplar.get(key)!.push(r);
    }
    for (const [, list] of gruplar) {
      // En erken giriş, en geç çıkış (veya "Halen") — toplam gün
      list.sort((a, b) => a._bas.localeCompare(b._bas));
      const ilk = list[0];
      const sonAtama = [...list].sort((a, b) => (a._bit ?? "9999").localeCompare(b._bit ?? "9999")).pop()!;
      const isenCikis = list.some((x) => x._bit == null) ? "Halen" : (sonAtama._bit ? fmt(sonAtama._bit) : "Halen");
      const toplamGun = list.reduce((s, x) => s + x.gun, 0);
      rows.push({
        santiyeId: ilk.santiyeId,
        santiyeAd: ilk.santiyeAd,
        adSoyad: ilk.adSoyad,
        tc: ilk.tc,
        gorev: ilk.gorev,
        iseBaslama: ilk.iseBaslama,
        isenCikis,
        gun: toplamGun,
      });
    }
    // Manuel gün override varsa, dolayısıyla toplam gün'ü değiştir
    for (const m of manuelGunler) {
      if (m.ay !== seciliAy) continue;
      const personel = personeller.find((p) => p.id === m.personel_id);
      const sant = santiyeler.find((s) => s.id === m.santiye_id);
      if (!personel || !sant) continue;
      const key = `${personel.tc_kimlik_no || personel.ad_soyad}:${sant.id}`;
      const idx = rows.findIndex((r) => `${r.tc || r.adSoyad}:${r.santiyeId}` === key);
      if (idx >= 0) {
        rows[idx].gun = m.gun;
      }
    }

    // Şantiye → personel ad sırası
    rows.sort((a, b) => {
      const c = a.santiyeAd.localeCompare(b.santiyeAd, "tr");
      if (c !== 0) return c;
      return a.adSoyad.localeCompare(b.adSoyad, "tr");
    });
    return rows;
  }

  function exportExcel() {
    const rows = exportSantiyeBazli();
    if (rows.length === 0) { toast.error("İndirilecek kayıt yok."); return; }
    // Şantiye bazlı bloklar: her şantiye için başlık satırı + içerik
    const aoa: (string | number)[][] = [];
    aoa.push([`Bordro Raporu — ${ayLabel(seciliAy)}`]);
    aoa.push([]);
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!groups.has(r.santiyeAd)) groups.set(r.santiyeAd, []);
      groups.get(r.santiyeAd)!.push(r);
    }
    for (const [santiye, list] of groups) {
      aoa.push([`▼ ${santiye} (${list.length} kişi, toplam ${list.reduce((s, r) => s + r.gun, 0)} gün)`]);
      aoa.push(["Ad Soyad", "TC", "Görev", "İşe Başlama", "İşten Çıkış", `${ayLabel(seciliAy)} Gün`]);
      for (const r of list) {
        aoa.push([r.adSoyad, r.tc, r.gorev, r.iseBaslama, r.isenCikis, r.gun]);
      }
      aoa.push([]); // ara boşluk
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Bordro ${ayLabel(seciliAy)}`);
    XLSX.writeFile(wb, `bordro-${seciliAy}.xlsx`);
  }

  function exportPDF() {
    const rows = exportSantiyeBazli();
    if (rows.length === 0) { toast.error("İndirilecek kayıt yok."); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(trAscii(`Bordro Raporu - ${ayLabel(seciliAy)}`), 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Olusturma: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${rows.length} kayit`, 14, 21);

    // Şantiye bazlı: her şantiye için ayrı autoTable bloğu (üstüne başlık koyarak)
    const groups = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!groups.has(r.santiyeAd)) groups.set(r.santiyeAd, []);
      groups.get(r.santiyeAd)!.push(r);
    }
    let cursorY = 25;
    for (const [santiye, list] of groups) {
      const toplamGun = list.reduce((s, r) => s + r.gun, 0);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.text(trAscii(`${santiye}  (${list.length} kisi, toplam ${toplamGun} gun)`), 14, cursorY);
      cursorY += 2;
      autoTable(doc, {
        startY: cursorY + 2,
        head: [["Sira", "Ad Soyad", "TC", "Gorev", "Ise Baslama", "Isten Cikis", "Gun"]],
        body: list.map((r, i) => [
          String(i + 1),
          trAscii(r.adSoyad),
          r.tc,
          trAscii(r.gorev),
          r.iseBaslama,
          r.isenCikis,
          String(r.gun),
        ]),
        styles: { fontSize: 8, cellPadding: 1.8 },
        headStyles: { fillColor: [30, 58, 95] },
        alternateRowStyles: { fillColor: [241, 245, 249] },
        margin: { left: 14, right: 14 },
      });
      // bir sonraki bloğun başlangıcı
      // @ts-expect-error autoTable lastAutoTable typing
      cursorY = (doc as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
    doc.save(`bordro-${seciliAy}.pdf`);
  }

  // Personel ekle
  async function personelEkle() {
    if (!ekleAd.trim()) { toast.error("Ad soyad gerekli"); return; }
    if (!ekleTc.trim() || ekleTc.length !== 11) { toast.error("11 haneli TC gerekli"); return; }
    setKaydetYukleniyor(true);
    try {
      const yeni = await insertBordroPersonel({
        ad_soyad: ekleAd.trim(),
        tc_kimlik_no: ekleTc.trim(),
        gorev: ekleGorev || null,
        meslek: null,
        santiye_id: ekleSantiye || null,
        maas: null,
        izin_hakki: null,
        mesai_ucreti_var: false,
        ise_giris_tarihi: ekleTarih,
        ev_telefon: null,
        cep_telefon: null,
        durum: "aktif",
        pasif_tarihi: null,
      });
      toast.success("Personel eklendi (mail kuyruğa eklendi)");
      // Mail kuyruğuna ekle
      const santiyeAd = ekleSantiye ? santiyeler.find((s) => s.id === ekleSantiye)?.is_adi : undefined;
      kuyrugaEkle({ tip: "giris", personel: yeni, santiyeAd });
      // Kapat + reload
      setEkleAcik(false);
      setEkleAd(""); setEkleTc(""); setEkleGorev("");
      setEkleSantiye(""); setEkleTarih(new Date().toISOString().slice(0, 10));
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKaydetYukleniyor(false);
    }
  }

  // İşten çıkar
  async function cikisYap() {
    if (!cikisOnay) return;
    try {
      const oldSantiyeAd = cikisOnay.santiye_id
        ? santiyeler.find((s) => s.id === cikisOnay.santiye_id)?.is_adi
        : undefined;
      await isenCikar(cikisOnay.id);
      toast.success(`${cikisOnay.ad_soyad} işten çıkarıldı (mail kuyruğa)`);
      kuyrugaEkle({ tip: "cikis", personel: cikisOnay, onceSantiyeAd: oldSantiyeAd });
      setCikisOnay(null);
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // İşe geri al
  async function geriAlYap() {
    if (!geriAlPersonel || !geriAlSantiye) return;
    try {
      await iseGeriAl(geriAlPersonel.id, geriAlSantiye);
      const yeniSantiyeAd = santiyeler.find((s) => s.id === geriAlSantiye)?.is_adi;
      toast.success(`${geriAlPersonel.ad_soyad} işe geri alındı (mail kuyruğa)`);
      kuyrugaEkle({ tip: "giris", personel: geriAlPersonel, santiyeAd: yeniSantiyeAd });
      setGeriAlPersonel(null); setGeriAlSantiye("");
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Drag-drop
  function onDragStart(personelId: string) {
    if (isReadOnly) return;
    setDragPersonelId(personelId);
  }
  function onDragOver(e: React.DragEvent, key: string) {
    if (isReadOnly) return;
    e.preventDefault();
    setDragOverKey(key);
  }
  function onDragLeave() {
    setDragOverKey(null);
  }
  async function onDrop(e: React.DragEvent, hedefKey: string) {
    e.preventDefault();
    setDragOverKey(null);
    if (isReadOnly) return;
    if (!dragPersonelId) return;
    const personel = personeller.find((p) => p.id === dragPersonelId);
    if (!personel) { setDragPersonelId(null); return; }

    // Bordro durumu: SADECE atama_gecmisi'nden türetilir.
    const personelAtamalari = atamalar.filter((a) => a.personel_id === personel.id);
    const aktifAtama = personelAtamalari.find((a) => !a.bitis_tarihi);
    const aktifSantiyeId = aktifAtama?.santiye_id ?? null;
    const bordroDurum: "aktif" | "pasif" | "atanmamis" = aktifAtama
      ? "aktif"
      : (personelAtamalari.length > 0 ? "pasif" : "atanmamis");

    // Aynı sütuna düşürdüyse iptal
    if (bordroDurum === "pasif" && hedefKey === PASIF_KEY) { setDragPersonelId(null); return; }
    if (aktifSantiyeId === hedefKey) { setDragPersonelId(null); return; }
    if (bordroDurum === "atanmamis" && hedefKey === ATANMAMIS_KEY) { setDragPersonelId(null); return; }

    try {
      if (hedefKey === PASIF_KEY) {
        // İşten çıkar (drag ile)
        setCikisOnay(personel);
        setDragPersonelId(null);
        return;
      }
      if (hedefKey === ATANMAMIS_KEY) {
        // Atamayı kaldır — santiye_id null + aktif atamayı kapat
        toast("Atanmamış sütununa transfer desteklenmiyor. Çöp ikonu ile işten çıkarın.", { icon: "⚠️" });
        setDragPersonelId(null);
        return;
      }
      // Şantiye transferi / yeni atama
      const onceSantiyeAd = aktifSantiyeId
        ? santiyeler.find((s) => s.id === aktifSantiyeId)?.is_adi
        : undefined;
      const yeniSantiyeAd = santiyeler.find((s) => s.id === hedefKey)?.is_adi;
      if (bordroDurum === "pasif" || bordroDurum === "atanmamis") {
        // Pasif veya atanmamış → yeni atama aç (giriş maili)
        await iseGeriAl(personel.id, hedefKey);
        kuyrugaEkle({ tip: "giris", personel, santiyeAd: yeniSantiyeAd });
      } else {
        await transferEt(personel.id, hedefKey);
        kuyrugaEkle({ tip: "transfer", personel, santiyeAd: yeniSantiyeAd, onceSantiyeAd });
      }
      toast.success(`${personel.ad_soyad} → ${yeniSantiyeAd} (mail kuyruğa)`);
      await loadData();
    } catch (err) {
      toast.error(`Transfer hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDragPersonelId(null);
    }
  }

  // Kart bileşeni
  function PersonelKart({ p, sutunKey }: { p: Personel; sutunKey: string }) {
    const ozelGun = sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY
      ? gunMap.get(p.id)?.get(sutunKey) ?? 0
      : 0;
    // Bu sütun için en son aktif/güncel atamanın baslangic_tarihi'ni bul.
    // (Personel A→B transfer edildiyse B'deki başlangıç = transfer tarihi.)
    let iseBaslama: string | null = null;
    if (sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY) {
      const matches = atamalar
        .filter((a) => a.personel_id === p.id && a.santiye_id === sutunKey)
        .sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
      if (matches.length > 0) iseBaslama = matches[0].baslangic_tarihi;
    }
    const formatTr = (d: string) => {
      const dt = new Date(d + "T00:00:00");
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("tr-TR");
    };
    const inPasifCol = sutunKey === PASIF_KEY;
    const inAtanmamisCol = sutunKey === ATANMAMIS_KEY;
    // Bordro durumu, atama_gecmisi'ne göre — personel.durum'a bakılmaz.
    // Pasif sütununda gri görünüm uygulanır; diğer sütunlarda normal renk.
    const grileştir = inPasifCol && !isReadOnly;
    // Aktif şantiye sütununda → "Çıkar" butonu (atamayı kapat)
    // PASIF sütununda → "İşe Geri Al" butonu (yeni atama aç)
    const showCikis = !inPasifCol && !inAtanmamisCol;
    const showGeriAl = inPasifCol;
    // Sürüklenebilir: salt-okunur değilse — pasif sütundaki kart da sürüklenip
    // başka bir şantiyeye bırakılabilir (= o şantiyede yeni atama açılır).
    const sürüklenebilir = !isReadOnly;
    // Tıklayınca gün düzenle dialog (atama tarihi yok ise dialogda yeni ekleme açılır)
    const tiklanabilir = !isReadOnly && !inPasifCol && !inAtanmamisCol;
    // Mouse ile yakalanmayı engelleyen iç text seçimini bastırmak için select-none
    return (
      <div
        draggable={sürüklenebilir}
        onDragStart={(e) => {
          if (!sürüklenebilir) return;
          // Drag verisi (gerekli değil ama bazı tarayıcılarda drag tetiklemesi için)
          try { e.dataTransfer.setData("text/plain", p.id); } catch { /* sessiz */ }
          onDragStart(p.id);
        }}
        onDoubleClick={(e) => {
          // Buton üzerindeki çift tıklamaları yakala değil
          if ((e.target as HTMLElement).closest("button")) return;
          if (tiklanabilir) {
            setGunEdit({ personel: p, santiyeId: sutunKey });
          }
        }}
        title={sürüklenebilir ? "Tek tıklayıp sürükle: taşıma · Çift tıkla: gün düzenle" : ""}
        className={`bg-white border border-gray-200 rounded-md p-2 mb-2 shadow-sm hover:shadow-md hover:border-blue-300 transition-all select-none ${
          sürüklenebilir ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        } ${dragPersonelId === p.id ? "opacity-50" : ""} ${grileştir ? "opacity-70 grayscale" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-[#1E3A5F] truncate flex items-center gap-1">
              <span className="truncate">{p.ad_soyad}</span>
              {p.personel_tipi === "taseron" && (
                <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold flex-shrink-0">TŞ</span>
              )}
            </div>
            {p.gorev && <div className="text-[10px] text-gray-500 truncate">{p.gorev}</div>}
            {p.tc_kimlik_no && <div className="text-[10px] font-mono text-gray-400">{p.tc_kimlik_no}</div>}
            {iseBaslama && (
              <div className="text-[9px] text-gray-400 mt-0.5">
                İşe başlama: {formatTr(iseBaslama)}
              </div>
            )}
            {ozelGun > 0 && (
              <div className="mt-1 inline-flex items-center gap-1 text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">
                {ozelGun} gün
              </div>
            )}
          </div>
          {!isReadOnly && (showCikis || showGeriAl) && (
            <div className="flex flex-col gap-0.5">
              {showCikis && (
                <button
                  type="button"
                  onClick={() => setCikisOnay(p)}
                  title="İşten çıkar"
                  className="p-1 text-red-500 hover:bg-red-50 rounded"
                >
                  <Trash2 size={12} />
                </button>
              )}
              {showGeriAl && (
                <button
                  type="button"
                  onClick={() => { setGeriAlPersonel(p); setGeriAlSantiye(""); }}
                  title="İşe geri al"
                  className="p-1 text-emerald-500 hover:bg-emerald-50 rounded"
                >
                  <UserPlus size={12} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  function Sutun({ key_, baslik, renk, count, children, onPlus }: {
    key_: string; baslik: string; renk: string; count: number;
    children: React.ReactNode;
    onPlus?: () => void;
  }) {
    const aktifDrop = dragOverKey === key_;
    return (
      <div
        onDragOver={(e) => onDragOver(e, key_)}
        onDragLeave={onDragLeave}
        onDrop={(e) => onDrop(e, key_)}
        className={`flex-shrink-0 w-64 bg-gray-50 rounded-lg border-2 ${
          aktifDrop ? "border-blue-400 bg-blue-50" : "border-gray-200"
        } transition-colors`}
      >
        <div className="px-3 py-2 border-b border-gray-200 sticky top-0 bg-gray-50 rounded-t-lg z-10" style={{ borderTopColor: renk, borderTopWidth: 3 }}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-[#1E3A5F] truncate" title={baslik}>{baslik}</h3>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[10px] bg-white border border-gray-300 px-1.5 py-0.5 rounded-full font-semibold text-gray-600">
                {count}
              </span>
              {onPlus && !isReadOnly && (
                <button
                  type="button"
                  onClick={onPlus}
                  title="Bu şantiyeye toplu personel ekle"
                  className="h-5 w-5 flex items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600"
                >
                  <Plus size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="p-2 min-h-[200px] max-h-[65vh] overflow-y-auto">
          {children}
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Yükleniyor...</div>;
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3 items-stretch sm:items-center">
        <div className="flex-1">
          <Input
            placeholder="Personel ara (ad, TC, görev)..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSeciliAy(ayDegistir(seciliAy, -1))}
              title="Önceki ay"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-input bg-white hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="month"
              value={seciliAy}
              onChange={(e) => setSeciliAy(e.target.value || buAy)}
              className="h-9 rounded-md border border-input bg-white px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => setSeciliAy(ayDegistir(seciliAy, 1))}
              title="Sonraki ay"
              className="h-9 w-9 flex items-center justify-center rounded-md border border-input bg-white hover:bg-gray-50"
            >
              <ChevronRight size={16} />
            </button>
            <span className="text-[11px] font-semibold text-[#1E3A5F] ml-1">{ayLabel(seciliAy)}</span>
            {isReadOnly && (
              <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded ml-1">
                <Lock size={10} /> salt-okunur
              </span>
            )}
            {!isReadOnly && seciliAy !== buAy && (
              <button type="button" onClick={() => setSeciliAy(buAy)}
                className="text-[10px] text-blue-600 underline ml-1">Bu aya dön</button>
            )}
          </div>
          <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
            <Mail size={12} />
            {muhasebeEmail || <span className="italic text-amber-600">tanımsız</span>}
          </span>
          <Button variant="outline" size="sm" onClick={exportPDF} className="gap-1">
            <FileDown size={14} /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="gap-1">
            <FileSpreadsheet size={14} /> Excel
          </Button>
          <Button
            onClick={() => setMailDialogAcik(true)}
            size="sm"
            variant="outline"
            disabled={pending.length === 0}
            className="border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <Send size={14} className="mr-1" /> Mail Gönder
            {pending.length > 0 && (
              <span className="ml-1 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                {pending.length}
              </span>
            )}
          </Button>
          <Button
            onClick={() => setEkleAcik(true)}
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            disabled={isReadOnly}
          >
            <UserPlus size={14} className="mr-1" /> Taşeron İşçi Ekle
          </Button>
        </div>
      </div>

      {!muhasebeEmail && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded mb-3 text-xs">
          ⚠️ Muhasebe email adresi tanımlanmamış. Tanımlamalar &gt; <code>muhasebe_email</code> kategorisinden ekleyin
          (giriş/çıkış/transfer mailleri buraya gidecek).
        </div>
      )}

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-3">
        {santiyeler.map((s, i) => {
          // Pastel renkler — şantiye sırasına göre döngü
          const renkler = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];
          const renk = renkler[i % renkler.length];
          const liste = kanbanMap.get(s.id) ?? [];
          return (
            <Sutun key={s.id} key_={s.id} baslik={s.is_adi} renk={renk} count={liste.length}
              onPlus={() => {
                setTopluEkleSantiyeId(s.id);
                setTopluSecilenler(new Set());
                setTopluArama("");
                setTopluTarih(new Date().toISOString().slice(0, 10));
              }}>
              {liste.length === 0 ? (
                <div className="text-center py-4 text-gray-300 text-xs italic">
                  <Building2 size={20} className="mx-auto mb-1" />
                  Personel yok
                </div>
              ) : liste.map((p) => <PersonelKart key={p.id} p={p} sutunKey={s.id} />)}
            </Sutun>
          );
        })}

        {/* Atanmamış */}
        <Sutun
          key_={ATANMAMIS_KEY}
          baslik="Atanmamış"
          renk="#9ca3af"
          count={kanbanMap.get(ATANMAMIS_KEY)!.length}
        >
          {kanbanMap.get(ATANMAMIS_KEY)!.length === 0 ? (
            <div className="text-center py-4 text-gray-300 text-xs italic">
              <Users size={20} className="mx-auto mb-1" />
              Yok
            </div>
          ) : kanbanMap.get(ATANMAMIS_KEY)!.map((p) => (
            <PersonelKart key={p.id} p={p} sutunKey={ATANMAMIS_KEY} />
          ))}
        </Sutun>

        {/* Pasif/İşten çıkarılanlar */}
        <Sutun
          key_={PASIF_KEY}
          baslik="İşten Çıkarılanlar"
          renk="#ef4444"
          count={kanbanMap.get(PASIF_KEY)!.length}
        >
          {kanbanMap.get(PASIF_KEY)!.length === 0 ? (
            <div className="text-center py-4 text-gray-300 text-xs italic">
              <Trash2 size={20} className="mx-auto mb-1" />
              Yok
            </div>
          ) : kanbanMap.get(PASIF_KEY)!.map((p) => (
            <PersonelKart key={p.id} p={p} sutunKey={PASIF_KEY} />
          ))}
        </Sutun>
      </div>

      {/* Ekle Dialog */}
      <Dialog open={ekleAcik} onOpenChange={setEkleAcik}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Taşeron İşçi Ekle</DialogTitle></DialogHeader>
          <p className="text-[11px] text-gray-500 -mt-2 mb-1">
            Bu kayıt <span className="font-semibold text-amber-700">taşeron</span> olarak işaretlenir,
            Personeller sayfasında ayrı bölümde görünür.
          </p>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Ad Soyad <span className="text-red-500">*</span></Label>
              <Input value={ekleAd} onChange={(e) => setEkleAd(e.target.value)} placeholder="Ad Soyad" />
            </div>
            <div>
              <Label className="text-xs">TC Kimlik No <span className="text-red-500">*</span></Label>
              <Input value={ekleTc} onChange={(e) => setEkleTc(e.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="11 haneli TC" inputMode="numeric" />
            </div>
            <div>
              <Label className="text-xs">Görev</Label>
              <select value={ekleGorev} onChange={(e) => setEkleGorev(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm">
                <option value="">Seçiniz</option>
                {gorevSecenekleri.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              {gorevSecenekleri.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  Görev listesi boş. Tanımlamalar &gt; <code>personel_gorev</code> kategorisinden ekleyin.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Şantiye <span className="text-red-500">*</span></Label>
              <select value={ekleSantiye} onChange={(e) => setEkleSantiye(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm">
                <option value="">Şantiye seçin</option>
                {santiyeler.map((s) => <option key={s.id} value={s.id}>{s.is_adi}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">İşe Başlama Tarihi</Label>
              <Input type="date" value={ekleTarih} onChange={(e) => setEkleTarih(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEkleAcik(false)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={personelEkle} disabled={kaydetYukleniyor}>
                {kaydetYukleniyor ? "Kaydediliyor..." : "Ekle + Mail Kuyruğa"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toplu Personel Ekle Dialog */}
      <Dialog open={!!topluEkleSantiyeId} onOpenChange={(o) => !o && setTopluEkleSantiyeId(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader className="pr-8">
            <DialogTitle className="text-base">
              <span className="block text-xs text-gray-500 font-normal">Toplu Personel Ekle</span>
              <span className="block break-words leading-tight">
                {santiyeler.find((s) => s.id === topluEkleSantiyeId)?.is_adi}
              </span>
            </DialogTitle>
          </DialogHeader>
          {topluEkleSantiyeId && (() => {
            // Bu şantiyede aktif atama yapan personeller — listeden çıkar
            const buSantiyedeAktifIds = new Set(
              atamalar
                .filter((a) => a.santiye_id === topluEkleSantiyeId && !a.bitis_tarihi)
                .map((a) => a.personel_id)
            );
            const aday = personeller.filter((p) => !buSantiyedeAktifIds.has(p.id));
            const q = topluArama.trim().toLocaleLowerCase("tr-TR");
            const goruntulenen = q ? aday.filter((p) => {
              const text = [p.ad_soyad, p.tc_kimlik_no, p.gorev, p.meslek].filter(Boolean).join(" ").toLocaleLowerCase("tr-TR");
              return text.includes(q);
            }) : aday;
            const tumuSecili = goruntulenen.length > 0 && goruntulenen.every((p) => topluSecilenler.has(p.id));
            return (
              <div className="space-y-3 py-2">
                <div>
                  <Label className="text-xs">Başlangıç Tarihi</Label>
                  <Input type="date" value={topluTarih} onChange={(e) => setTopluTarih(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Personel Ara</Label>
                  <Input value={topluArama} onChange={(e) => setTopluArama(e.target.value)}
                    placeholder="Ad, TC, görev..." />
                </div>
                <div className="border rounded-lg max-h-[40vh] overflow-y-auto">
                  <div className="bg-gray-50 px-3 py-1.5 border-b sticky top-0 flex items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={tumuSecili}
                      onChange={(e) => {
                        setTopluSecilenler((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) {
                            for (const p of goruntulenen) next.add(p.id);
                          } else {
                            for (const p of goruntulenen) next.delete(p.id);
                          }
                          return next;
                        });
                      }}
                    />
                    <span>Tümünü Seç ({goruntulenen.length})</span>
                    <span className="ml-auto text-gray-500 font-normal">
                      Seçili: {topluSecilenler.size}
                    </span>
                  </div>
                  {goruntulenen.length === 0 ? (
                    <div className="text-center py-6 text-xs text-gray-400 italic">
                      Eklenebilecek personel yok.
                    </div>
                  ) : (
                    <ul>
                      {goruntulenen.map((p) => (
                        <li key={p.id} className="border-b last:border-b-0 px-3 py-2 hover:bg-gray-50 flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={topluSecilenler.has(p.id)}
                            onChange={(e) => {
                              setTopluSecilenler((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(p.id); else next.delete(p.id);
                                return next;
                              });
                            }}
                            className="flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="text-sm font-semibold text-[#1E3A5F] truncate flex items-center gap-1">
                              <span className="truncate">{p.ad_soyad}</span>
                              {p.personel_tipi === "taseron" && (
                                <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold flex-shrink-0">TŞ</span>
                              )}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate">
                              {p.gorev ?? ""}
                              {p.tc_kimlik_no && ` · ${p.tc_kimlik_no}`}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t sticky bottom-0 bg-white -mx-4 px-4 -mb-4 pb-3">
                  <Button variant="outline" size="sm" className="flex-1 min-w-0" onClick={() => setTopluEkleSantiyeId(null)}>
                    İptal
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white flex-1 min-w-0"
                    onClick={topluPersonelEkle}
                    disabled={topluSecilenler.size === 0 || topluEkleniyor}
                  >
                    {topluEkleniyor ? "Ekleniyor..." : `Ekle (${topluSecilenler.size})`}
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Gün Düzenle Dialog */}
      <Dialog open={!!gunEdit} onOpenChange={(o) => !o && setGunEdit(null)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {gunEdit?.personel.ad_soyad} · {santiyeler.find((s) => s.id === gunEdit?.santiyeId)?.is_adi}
            </DialogTitle>
          </DialogHeader>
          {gunEdit && (() => {
            const [yil, ay] = seciliAy.split("-").map(Number);
            const ayBas = `${yil}-${String(ay).padStart(2, "0")}-01`;
            const sonGun = new Date(yil, ay, 0).getDate();
            const ayBit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
            const today = new Date().toISOString().slice(0, 10);
            // Aktif atama için sanal bitiş: ay sınırı veya bugün
            const aktifSanal = today >= ayBas && today <= ayBit ? today : ayBit;
            // Bu personel × şantiye için, seçili ay ile çakışan atamalar
            const liste = atamalar
              .filter((a) => a.personel_id === gunEdit.personel.id && a.santiye_id === gunEdit.santiyeId)
              .filter((a) => {
                const bitisHam = a.bitis_tarihi ?? aktifSanal;
                if (a.baslangic_tarihi > ayBit) return false;
                if (bitisHam < ayBas) return false;
                return true;
              })
              .sort((a, b) => a.baslangic_tarihi.localeCompare(b.baslangic_tarihi));

            const gFark = (a: string, b: string) => {
              const ta = new Date(a + "T00:00:00").getTime();
              const tb = new Date(b + "T00:00:00").getTime();
              return Math.max(0, Math.round((tb - ta) / 86400000) + 1);
            };
            const ayInGun = (a: PersonelAtamaGecmisi) => {
              const bitisHam = a.bitis_tarihi ?? aktifSanal;
              const cb = a.baslangic_tarihi > ayBas ? a.baslangic_tarihi : ayBas;
              const cbt = bitisHam < ayBit ? bitisHam : ayBit;
              return gFark(cb, cbt);
            };

            const toplamAylikGun = liste.reduce((s, a) => s + ayInGun(a), 0);
            return (
              <div className="space-y-3 py-2">
                <div className="text-xs text-gray-500">
                  Ay: <span className="font-semibold">{ayLabel(seciliAy)}</span> · Toplam atama: {liste.length}
                </div>

                {/* Hızlı manuel gün girişi — atama tarihlerini DEĞİŞTİRMEZ, sadece görünüm overrideı */}
                {!isReadOnly && (
                  <ManuelGunHizliKart
                    mevcutGun={gunMap.get(gunEdit.personel.id)?.get(gunEdit.santiyeId) ?? 0}
                    aySonGun={sonGun}
                    onSave={(N) => kaydetManuelGun(gunEdit.personel.id, gunEdit.santiyeId, seciliAy, N)}
                  />
                )}

                {liste.length === 0 && (
                  <p className="text-sm text-gray-400 italic">Bu ay için atama yok. Hızlı gün gir veya aşağıdan tarih ile yeni atama ekleyebilirsiniz.</p>
                )}
                {liste.map((a) => (
                  <AtamaSatir
                    key={a.id}
                    atama={a}
                    gunSayisi={ayInGun(a)}
                    onSave={(b, e) => gunEditAtamaUpdate(a.id, b, e)}
                    onDelete={() => gunEditAtamaSil(a.id)}
                  />
                ))}
                <YeniAtamaSatir
                  defaultBaslangic={ayBas}
                  defaultBitis={ayBit}
                  onEkle={(b, e) => gunEditAtamaEkle(gunEdit.personel.id, gunEdit.santiyeId, b, e)}
                />
                <div className="flex justify-end pt-2 border-t">
                  <Button variant="outline" onClick={() => setGunEdit(null)}>Kapat</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Çıkış Onayı */}
      <Dialog open={!!cikisOnay} onOpenChange={(o) => !o && setCikisOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>İşten Çıkar</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">
            <span className="font-bold">{cikisOnay?.ad_soyad}</span> işten çıkarılacak ve muhasebeye çıkış maili gönderilecek. Onaylıyor musunuz?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setCikisOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={cikisYap}>Çıkar + Mail Gönder</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mail Önizleme + Gönder */}
      <Dialog open={mailDialogAcik} onOpenChange={setMailDialogAcik}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye size={18} /> Mail Önizleme — {pending.length} değişiklik
            </DialogTitle>
          </DialogHeader>
          {pending.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">Bekleyen değişiklik yok.</p>
          ) : (
            <div className="space-y-3 py-2">
              {(() => {
                const smtpFirma = firmalar.find((f) => f.smtp_host && f.smtp_user && f.smtp_password);
                return (
                  <>
                    <div className="text-xs text-gray-500">
                      Alıcı: <span className="font-semibold text-gray-800">{muhasebeEmail || "(tanımsız!)"}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      Gönderen SMTP:{" "}
                      {smtpFirma ? (
                        <span className="font-semibold text-emerald-700">{smtpFirma.firma_adi}</span>
                      ) : (
                        <span className="font-semibold text-red-600">Hiçbir firmada SMTP ayarı yok!</span>
                      )}
                    </div>
                    {!smtpFirma && (
                      <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded text-xs leading-relaxed">
                        Mail göndermek için Yönetim &gt; Firmalar sayfasından bir firmayı düzenleyin ve aşağıdaki SMTP alanlarını doldurun:
                        <ul className="list-disc list-inside mt-1 ml-2">
                          <li>SMTP Host (örn. <code>smtp.gmail.com</code>)</li>
                          <li>SMTP Port (genelde <code>587</code>)</li>
                          <li>SMTP User (gönderen email adresi)</li>
                          <li>SMTP Password (uygulama şifresi)</li>
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()}
              {/* Kategori bazlı listeleme */}
              {(["giris", "transfer", "cikis"] as const).map((tip) => {
                const liste = pending.filter((p) => p.tip === tip);
                if (liste.length === 0) return null;
                const baslik = tip === "giris" ? "İşe Girişler" : tip === "cikis" ? "İşten Çıkışlar" : "Şantiye Transferleri";
                const renk = tip === "giris" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                  : tip === "cikis" ? "bg-red-50 border-red-200 text-red-800"
                  : "bg-blue-50 border-blue-200 text-blue-800";
                return (
                  <div key={tip} className={`border rounded-lg p-3 ${renk}`}>
                    <div className="font-bold text-sm mb-2">{baslik} ({liste.length})</div>
                    <ul className="space-y-1.5">
                      {liste.map((c) => (
                        <li key={c.id} className="text-xs flex items-center justify-between gap-2 bg-white/70 rounded px-2 py-1">
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-gray-800 truncate">{c.personelAd}</div>
                            <div className="text-gray-500">
                              {c.personelTc && <span className="font-mono">{c.personelTc} · </span>}
                              {c.personelGorev && <span>{c.personelGorev} · </span>}
                              {c.tip === "transfer" ? (
                                <span>{c.onceSantiyeAd ?? "—"} <ArrowRight size={10} className="inline" /> {c.santiyeAd ?? "—"}</span>
                              ) : c.tip === "giris" ? (
                                <span>{c.santiyeAd ?? "—"}</span>
                              ) : (
                                <span>son: {c.onceSantiyeAd ?? "—"}</span>
                              )}
                              <span className="ml-1 text-gray-400">({c.tarih})</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => pendingSil(c.id)}
                            className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                            title="Bu satırı kuyruktan kaldır"
                          >
                            <Trash2 size={12} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <div>
                <Label className="text-xs">Ek Not (opsiyonel — mailin sonuna eklenir)</Label>
                <textarea
                  value={ekMailNotu}
                  onChange={(e) => setEkMailNotu(e.target.value)}
                  rows={2}
                  className="w-full text-xs border rounded px-2 py-1 outline-none focus:border-blue-500"
                  placeholder="Örn. Acil işlem yapılması rica olunur."
                />
              </div>
              <div className="flex justify-between gap-2 pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (confirm("Tüm bekleyen değişiklikleri kuyruktan silmek istiyor musunuz? (DB'deki değişiklikler kaldırılmaz, sadece mail kuyruğu temizlenir.)")) {
                      setPending([]);
                      setMailDialogAcik(false);
                    }
                  }}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  Kuyruğu Temizle
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setMailDialogAcik(false)}>
                    İptal
                  </Button>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={bulkMailGonder}
                    disabled={mailGonderiliyor || !muhasebeEmail || firmalar.length === 0}
                  >
                    <Send size={14} className="mr-1" />
                    {mailGonderiliyor ? "Gönderiliyor..." : "Mail Gönder"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* İşe geri alma */}
      <Dialog open={!!geriAlPersonel} onOpenChange={(o) => !o && setGeriAlPersonel(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>İşe Geri Al</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 pb-3">
            <span className="font-bold">{geriAlPersonel?.ad_soyad}</span> hangi şantiyede işe başlasın?
          </p>
          <select value={geriAlSantiye} onChange={(e) => setGeriAlSantiye(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm mb-3">
            <option value="">Şantiye seçin</option>
            {santiyeler.map((s) => <option key={s.id} value={s.id}>{s.is_adi}</option>)}
          </select>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setGeriAlPersonel(null)}>İptal</Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={geriAlYap} disabled={!geriAlSantiye}>Geri Al + Mail</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
