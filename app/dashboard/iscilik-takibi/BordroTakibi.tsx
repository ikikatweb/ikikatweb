// Bordro Takibi — şantiye kanban + drag-drop personel transferi
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UserPlus, Trash2, Mail, Building2, Users, Send, Eye, ArrowRight, Lock, ChevronLeft, ChevronRight, ChevronDown, FileDown, FileSpreadsheet, Plus } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import XLSX from "xlsx-js-style";
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
  getBilgiNotlari,
  setBilgiNotu,
  deleteBilgiNotu,
  type BilgiNotu,
  getGunlukUcretler,
  type GunlukUcret,
} from "@/lib/supabase/queries/bordro";
import { getTumPersonelBrutUcretler, brutUcretForAy } from "@/lib/supabase/queries/personel-brut-ucret";
import {
  getPendingMailler,
  insertPendingMail,
  deletePendingMail,
  deletePendingMailler,
  type BordroPendingDB,
} from "@/lib/supabase/queries/bordro-pending";
import type { Personel, PersonelAtamaGecmisi, PersonelAtamaManuelGun, PersonelBrutUcret } from "@/lib/supabase/types";
import { formatKisiAdi } from "@/lib/utils/isim";

type SantiyeBasic = {
  id: string; is_adi: string; durum: string;
  gecici_kabul_tarihi?: string | null;
  kesin_kabul_tarihi?: string | null;
  tasfiye_tarihi?: string | null;
  devir_tarihi?: string | null;
  yuklenici_firma_id?: string | null;
};
type Firma = {
  id: string;
  firma_adi: string;
  renk?: string | null;  // örn. "#3b82f6"
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
  // Mail bu firmadan gönderilir (giriş/transfer→hedef şantiyenin firması; çıkış→eski şantiyenin firması)
  firmaId?: string;
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
  // CLAMP YAPMA — kullanıcı yazdığı değeri görsün; sınır aşılırsa hata göster, kaydetmeyi engelle.
  const N = Math.max(0, parseInt(val) || 0);
  const tooHigh = N > aySonGun;
  const degisti = N !== mevcutGun;
  const canSave = degisti && !tooHigh;
  return (
    <div className={`border-2 rounded-lg p-3 ${tooHigh ? "bg-red-50 border-red-300" : "bg-blue-50 border-blue-200"}`}>
      <div className={`text-xs font-semibold mb-1.5 ${tooHigh ? "text-red-700" : "text-blue-700"}`}>
        Hızlı Manuel Gün Girişi
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          className={`w-24 h-10 text-2xl font-bold text-center bg-white border-2 rounded-lg outline-none ${
            tooHigh ? "text-red-700 border-red-400 focus:border-red-500" : "text-blue-700 border-blue-300 focus:border-blue-500"
          }`}
        />
        <span className="text-sm text-gray-600">gün <span className="text-[10px] text-gray-400">/ max {aySonGun}</span></span>
        <button
          type="button"
          disabled={!canSave}
          onClick={() => onSave(N)}
          className="ml-auto px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Kaydet
        </button>
      </div>
      {tooHigh && (
        <p className="text-xs text-red-700 font-semibold mt-2">
          ⚠️ {aySonGun} günden fazla giremezsiniz.
          {aySonGun === 0 ? " Bu personelin bu şantiyede atama günü yok." : ` Çıkış tarihine kadar olan gün sayısı: ${aySonGun}.`}
        </p>
      )}
      <p className="text-[10px] text-gray-500 mt-1.5 leading-relaxed">
        Sadece bu ay içindeki gün sayısını günceller — atamanın <strong>çıkış tarihi atılmaz</strong>, personel halen aktif kalır.
        Çıkış için aşağıdaki detay editöründe &quot;İşten Çıkış&quot; tarihini elle girin.
      </p>
    </div>
  );
}

// Bilgi Notu kartı: gün düzenle dialogu içinde kullanılır.
// Not personel × şantiye bazlı KALICIDIR — kullanıcı silmedikçe her ay görünür.
function BilgiNotuKarti({
  personelId, santiyeId, notlar, onKaydet,
}: {
  personelId: string;
  santiyeId: string;
  notlar: BilgiNotu[];
  onKaydet: (yeniNot: string) => Promise<void> | void;
}) {
  const mevcut = notlar.find((n) => n.personel_id === personelId && n.santiye_id === santiyeId);
  const mevcutNot = mevcut?.icerik ?? "";
  const [val, setVal] = useState(mevcutNot);
  useEffect(() => { setVal(mevcutNot); }, [mevcutNot]);
  const degisti = val !== mevcutNot;
  return (
    <div className="bg-amber-50 border-2 border-amber-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs text-amber-800 font-semibold">📝 Bilgi Notu</div>
        {mevcut && <span className="text-[10px] text-gray-500">Mevcut not var</span>}
      </div>
      <textarea
        value={val}
        onChange={(e) => setVal(e.target.value)}
        rows={3}
        placeholder="Bu personel için bu ay/şantiye ile ilgili not (PDF ve Excel'de yazılır)..."
        className="w-full text-sm border border-amber-200 rounded p-2 outline-none focus:border-amber-500 bg-white resize-y"
      />
      <div className="flex justify-end gap-1 mt-1.5">
        {mevcut && (
          <button
            type="button"
            onClick={() => onKaydet("")}
            className="px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded hover:bg-red-50"
          >
            Sil
          </button>
        )}
        <button
          type="button"
          disabled={!degisti}
          onClick={() => onKaydet(val)}
          className="px-3 py-1 text-[11px] bg-amber-600 text-white rounded hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
        >
          Kaydet
        </button>
      </div>
    </div>
  );
}

// Atama satır editörü (gün düzenle dialogu için) — KULLANILMIYOR ARTIK ama referans için duruyor
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
  // Çıkış tarihi başlangıçtan önce olamaz
  const tarihHatasi = !halen && bit && bas && bit < bas;
  const kaydedilebilir = degisti && !tarihHatasi;
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
            min={bas || undefined}
            disabled={halen}
            className={`w-full h-8 border rounded px-2 text-xs disabled:bg-gray-100 ${tarihHatasi ? "border-red-400 bg-red-50" : ""}`} />
        </div>
      </div>
      {tarihHatasi && (
        <p className="text-[10px] text-red-600 font-semibold mb-1.5">
          ⚠️ İşten çıkış tarihi, işe başlama tarihinden önce olamaz.
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-emerald-700 font-semibold">Bu ayda: {gunSayisi} gün</span>
        <div className="flex gap-1">
          <button type="button" onClick={onDelete}
            className="px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded hover:bg-red-50">
            Sil
          </button>
          <button type="button" disabled={!kaydedilebilir}
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
  // Çıkış tarihi başlangıçtan önce olamaz
  const tarihHatasi = !halen && bit && bas && bit < bas;
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
            min={bas || undefined}
            disabled={halen}
            className={`w-full h-8 border rounded px-2 text-xs disabled:bg-gray-100 ${tarihHatasi ? "border-red-400 bg-red-50" : ""}`} />
        </div>
      </div>
      {tarihHatasi && (
        <p className="text-[10px] text-red-600 font-semibold mb-1.5">
          ⚠️ İşten çıkış tarihi, işe başlama tarihinden önce olamaz.
        </p>
      )}
      <div className="flex justify-end gap-1">
        <button type="button" onClick={() => setAcik(false)}
          className="px-2 py-1 text-[11px] text-gray-500 border border-gray-200 rounded hover:bg-gray-50">İptal</button>
        <button type="button"
          disabled={!!tarihHatasi}
          onClick={() => { onEkle(bas, halen ? null : (bit || null)); setAcik(false); }}
          className="px-3 py-1 text-[11px] bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed">Ekle</button>
      </div>
    </div>
  );
}

export default function BordroTakibi() {
  const { kullanici, isYonetici } = useAuth();
  const [loading, setLoading] = useState(true);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [atamalar, setAtamalar] = useState<PersonelAtamaGecmisi[]>([]);
  const [manuelGunler, setManuelGunler] = useState<PersonelAtamaManuelGun[]>([]);
  const [bilgiNotlari, setBilgiNotlari] = useState<BilgiNotu[]>([]);
  const [gunlukUcretler, setGunlukUcretler] = useState<GunlukUcret[]>([]);
  const [brutUcretGecmisi, setBrutUcretGecmisi] = useState<PersonelBrutUcret[]>([]);
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

  // Çıkış onayı + çıkış tarihi
  const [cikisOnay, setCikisOnay] = useState<Personel | null>(null);
  const [cikisTarih, setCikisTarih] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Geri alma seç dialog (pasif personeli hangi şantiyeye)
  const [geriAlPersonel, setGeriAlPersonel] = useState<Personel | null>(null);
  const [geriAlSantiye, setGeriAlSantiye] = useState("");

  // Gün düzenleme dialog: bir personelin belirli bir şantiyedeki atamaları
  const [gunEdit, setGunEdit] = useState<{ personel: Personel; santiyeId: string } | null>(null);

  // Accordion: hangi firmalar / hangi şantiyeler açık
  const [expandedFirmalar, setExpandedFirmalar] = useState<Set<string>>(new Set());
  const [expandedSantiyeler, setExpandedSantiyeler] = useState<Set<string>>(new Set());
  // Çoklu seçim: hangi personeller seçili (sutunKey ile birlikte saklanır → benzersiz)
  // key formatı: `${personelId}:${sutunKey}`
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Toplu transfer dialog
  const [topluTransferAcik, setTopluTransferAcik] = useState(false);
  const [topluTransferHedef, setTopluTransferHedef] = useState("");
  const [topluTransferIsleniyor, setTopluTransferIsleniyor] = useState(false);
  const [topluCikisOnay, setTopluCikisOnay] = useState(false);
  const [topluCikisIsleniyor, setTopluCikisIsleniyor] = useState(false);

  // Toplu personel ekleme dialog: şantiye sütununun + butonu
  const [topluEkleSantiyeId, setTopluEkleSantiyeId] = useState<string | null>(null);
  const [topluSecilenler, setTopluSecilenler] = useState<Set<string>>(new Set());
  const [topluArama, setTopluArama] = useState("");
  const [topluTarih, setTopluTarih] = useState(() => new Date().toISOString().slice(0, 10));
  const [topluEkleniyor, setTopluEkleniyor] = useState(false);

  // Ay seçici (default: bu ay). Tüm aylar düzenlenebilir — kullanıcı geçmiş ve gelecek
  // ayların kayıtları üzerinde de işlem yapabilir.
  const [seciliAy, setSeciliAy] = useState<string>(su_an_ay);
  const buAy = su_an_ay();
  const isReadOnly = false;

  // Bekleyen değişiklikler — mail kuyruğu (DB'de paylaşımlı, tüm adminler aynı kuyruğu görür)
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [mailDialogAcik, setMailDialogAcik] = useState(false);
  const [mailGonderiliyor, setMailGonderiliyor] = useState(false);
  const [ekMailNotu, setEkMailNotu] = useState("");

  // DB row → PendingChange dönüşümü (UI tarafı kayıt yapısı koruyor)
  const dbRowToPending = (r: BordroPendingDB): PendingChange => ({
    id: r.id,
    tip: r.tip,
    personelAd: r.personel_ad,
    personelTc: r.personel_tc ?? undefined,
    personelGorev: r.personel_gorev ?? undefined,
    santiyeAd: r.santiye_ad ?? undefined,
    onceSantiyeAd: r.once_santiye_ad ?? undefined,
    tarih: r.tarih,
    firmaId: r.firma_id ?? undefined,
  });

  // DB'den kuyruğu çek — tüm adminler aynı liste
  const refreshPending = useCallback(async () => {
    try {
      const rows = await getPendingMailler();
      setPending(rows.map(dbRowToPending));
    } catch { /* sessiz */ }
  }, []);

  // İlk yüklemede + her 30 saniyede bir yenile (diğer adminlerin işlemleri görünsün)
  useEffect(() => {
    refreshPending();
    const intv = setInterval(refreshPending, 30_000);
    // Sekme tekrar fokuslanınca da yenile
    const onFocus = () => refreshPending();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(intv);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshPending]);

  // (Eski localStorage kuyruğu varsa migrate et — tek seferlik)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PENDING_LS_KEY);
      if (!saved) return;
      const eski = JSON.parse(saved) as PendingChange[];
      if (!Array.isArray(eski) || eski.length === 0) {
        localStorage.removeItem(PENDING_LS_KEY);
        return;
      }
      // DB'ye taşı
      (async () => {
        for (const p of eski) {
          await insertPendingMail({
            tip: p.tip,
            personel_ad: p.personelAd,
            personel_tc: p.personelTc ?? null,
            personel_gorev: p.personelGorev ?? null,
            santiye_ad: p.santiyeAd ?? null,
            once_santiye_ad: p.onceSantiyeAd ?? null,
            tarih: p.tarih,
            firma_id: p.firmaId ?? null,
            created_by: kullanici?.id ?? null,
            created_by_ad: kullanici?.ad_soyad ?? null,
          }).catch(() => {});
        }
        localStorage.removeItem(PENDING_LS_KEY);
        await refreshPending();
      })();
    } catch { /* sessiz */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 17:00'da otomatik mail gönder — kuyrukta bekleyen varsa muhasebeye iletilir.
  // localStorage'da "son otomatik gönderim tarihi" tutuluyor (gün başına 1 kez).
  useEffect(() => {
    if (pending.length === 0) return;
    let cancelled = false;
    const checkAndSend = async () => {
      if (cancelled) return;
      const now = new Date();
      const todayKey = now.toISOString().slice(0, 10);
      const lastSentKey = localStorage.getItem("bordro-auto-mail-tarih");
      // Bugün zaten otomatik gönderilmişse skip
      if (lastSentKey === todayKey) return;
      // 17:00 (saat 17, dakika 0+) tetikleyici — 17:00–17:05 aralığında yakala
      if (now.getHours() === 17 && now.getMinutes() < 5) {
        if (!muhasebeEmail || firmalar.length === 0) return;
        localStorage.setItem("bordro-auto-mail-tarih", todayKey); // duplicate önle
        try {
          await bulkMailGonder();
          toast.success("⏰ 17:00 otomatik mail gönderimi tamamlandı", { duration: 6000 });
        } catch {
          // bulkMailGonder kendi hata mesajını gösterir
        }
      }
    };
    // Her dakika kontrol et
    const intv = setInterval(checkAndSend, 60_000);
    // Sayfa açılır açılmaz da hemen kontrol et (17:00'ı geçmiş olabilir)
    checkAndSend();
    return () => { cancelled = true; clearInterval(intv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.length, muhasebeEmail, firmalar.length]);

  // Boşluğa tıkla / ESC ile seçimi temizle
  useEffect(() => {
    if (selectedKeys.size === 0) return;
    function clickHandler(e: MouseEvent) {
      const target = e.target as HTMLElement;
      // Personel satırı, toplu bar, dialog içi, tumunu seç butonu, accordion başlıkları → temizleme
      if (target.closest("[data-personel-row], [data-toplu-bar], [role=dialog], [data-tumunu-sec], [data-santiye-header], button, input, select, label")) return;
      setSelectedKeys(new Set());
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedKeys(new Set());
    }
    document.addEventListener("click", clickHandler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("click", clickHandler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [selectedKeys.size]);
  // pendingEkle: önce optimistic olarak yerel state'e ekle, sonra DB'ye yaz.
  // Diğer adminler 30sn'lik refresh ile görür.
  async function pendingEkle(p: Omit<PendingChange, "id">) {
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPending((prev) => [...prev, { ...p, id: tempId }]);
    const inserted = await insertPendingMail({
      tip: p.tip,
      personel_ad: p.personelAd,
      personel_tc: p.personelTc ?? null,
      personel_gorev: p.personelGorev ?? null,
      santiye_ad: p.santiyeAd ?? null,
      once_santiye_ad: p.onceSantiyeAd ?? null,
      tarih: p.tarih,
      firma_id: p.firmaId ?? null,
      created_by: kullanici?.id ?? null,
      created_by_ad: kullanici?.ad_soyad ?? null,
    });
    if (inserted) {
      // Temp ID yerine gerçek DB row'una geç
      setPending((prev) => prev.map((x) => (x.id === tempId ? dbRowToPending(inserted) : x)));
    } else {
      // Insert başarısız → temp kaydı geri al, kullanıcıyı uyar
      setPending((prev) => prev.filter((x) => x.id !== tempId));
      toast.error(
        "Mail kuyruğuna eklenemedi. Veritabanında 'bordro_pending_mail' tablosu yoksa Supabase SQL editöründe oluşturun.",
        { duration: 10000 },
      );
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p, a, m, f, iscilik, gorevler, mGunler, notlar, ucretler, brutGecmis] = await Promise.all([
        getSantiyelerAll().catch(() => []),
        getBordroPersoneller().catch(() => []),
        getAtamaGecmisiTumu().catch(() => []),
        getDegerler("muhasebe_email").catch(() => []),
        getFirmalar().catch(() => []),
        getIscilikTakibi(false).catch(() => [] as { santiye_id: string; santiyeler?: SantiyeBasic | null }[]),
        getDegerler("personel_gorev").catch(() => []),
        getManuelGunler().catch(() => []),
        getBilgiNotlari().catch(() => []),
        getGunlukUcretler().catch(() => []),
        getTumPersonelBrutUcretler().catch(() => [] as PersonelBrutUcret[]),
      ]);
      setGorevSecenekleri(gorevler ?? []);
      setManuelGunler(mGunler);
      setBilgiNotlari(notlar);
      setGunlukUcretler(ucretler);
      setBrutUcretGecmisi(brutGecmis);
      // İşçilik Durum Raporu'ndaki filtreyle BİREBİR AYNI + firma_id mapleme.
      const iscilikRaporSantiyeIds = new Set<string>();
      const firmaIdMap = new Map<string, string>(); // santiye_id → firma_id
      for (const r of (iscilik as { santiye_id: string; santiyeler?: SantiyeBasic | null }[]) ?? []) {
        const sant = r.santiyeler ?? null;
        const bitmis = !!(sant && (
          sant.gecici_kabul_tarihi ||
          sant.kesin_kabul_tarihi ||
          sant.tasfiye_tarihi ||
          sant.devir_tarihi
        ));
        if (!bitmis && r.santiye_id) {
          iscilikRaporSantiyeIds.add(r.santiye_id);
          if (sant?.yuklenici_firma_id) firmaIdMap.set(r.santiye_id, sant.yuklenici_firma_id);
        }
      }
      const tumSantiyeler = (s as SantiyeBasic[]) ?? [];
      const aktifSantiyeler = tumSantiyeler
        .filter((x) => iscilikRaporSantiyeIds.has(x.id))
        .map((x) => ({ ...x, yuklenici_firma_id: x.yuklenici_firma_id ?? firmaIdMap.get(x.id) ?? null }));
      setSantiyeler(aktifSantiyeler);
      setPersoneller(p);
      setAtamalar(a);
      // Birden fazla muhasebe email tanımlanmışsa hepsine gönder (virgülle ayrılmış)
      setMuhasebeEmail((m ?? []).filter(Boolean).join(", "));
      setFirmalar((f as Firma[]) ?? []);
    } catch (err) {
      console.error(err);
      toast.error(`Yükleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Tüm aktif şantiyeler (firma filtresi kaldırıldı — accordion firma hiyerarşisi yeterli)
  const filtreliSantiyeler = santiyeler;

  // Doğal hesaplanmış günler — sadece max validation için kullanılır
  const naturalGunMap = useMemo(
    () => gunHesaplaAyBazliOverride(atamalar, seciliAy, new Map()),
    [atamalar, seciliAy],
  );

  // Görüntülenen gün sayıları — KULLANICI ENTRY MODELİ:
  //  - Override (manuel gün) varsa → override değer
  //  - Yoksa → 0 (kullanıcı manuel girer)
  const gunMap = useMemo(() => {
    const display = new Map<string, Map<string, number>>();
    // Önce 0 ile başla — atama olan her (personel, şantiye) için
    for (const [pid, sMap] of naturalGunMap) {
      if (!display.has(pid)) display.set(pid, new Map());
      for (const [sid] of sMap) {
        display.get(pid)!.set(sid, 0);
      }
    }
    // Override'ları uygula
    for (const m of manuelGunler) {
      if (m.ay !== seciliAy) continue;
      if (!display.has(m.personel_id)) display.set(m.personel_id, new Map());
      display.get(m.personel_id)!.set(m.santiye_id, m.gun);
    }
    return display;
  }, [naturalGunMap, manuelGunler, seciliAy]);

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
    for (const s of filtreliSantiyeler) map.set(s.id, []);
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
  }, [filtreli, filtreliSantiyeler, gunMap, atamalar]);

  // santiye_id'den firma_id bul (yoksa undefined)
  function firmaIdFromSantiyeId(santiyeId: string | undefined | null): string | undefined {
    if (!santiyeId) return undefined;
    return santiyeler.find((s) => s.id === santiyeId)?.yuklenici_firma_id ?? undefined;
  }
  // santiye adı ile bul (fallback için)
  function firmaIdFromSantiyeAd(santiyeAd: string | undefined | null): string | undefined {
    if (!santiyeAd) return undefined;
    const s = santiyeler.find((x) => x.is_adi === santiyeAd);
    return s?.yuklenici_firma_id ?? undefined;
  }

  // Bekleyen değişiklik kuyruğa ekle (mail göndermez — preview + send butonu kullanır).
  // ÖNEMLİ: Farklı firmalar arası transferde 2 ayrı mail kuyruğa eklenir:
  //   - Eski firmaya: "çıkış" maili (eski firmanın SMTP'sinden gidecek)
  //   - Yeni firmaya: "giriş" maili (yeni firmanın SMTP'sinden gidecek)
  // Aynı firma içi transferde tek "transfer" maili.
  function kuyrugaEkle(payload: {
    tip: "giris" | "cikis" | "transfer";
    personel: Personel;
    santiyeAd?: string;
    onceSantiyeAd?: string;
    santiyeId?: string;
    onceSantiyeId?: string;
  }) {
    const tarih = new Date().toISOString().slice(0, 10);
    const baseFields = {
      personelAd: payload.personel.ad_soyad,
      personelTc: payload.personel.tc_kimlik_no,
      personelGorev: payload.personel.gorev ?? undefined,
      tarih,
    };

    if (payload.tip === "transfer") {
      const eskiFirmaId = firmaIdFromSantiyeId(payload.onceSantiyeId)
        ?? firmaIdFromSantiyeAd(payload.onceSantiyeAd);
      const yeniFirmaId = firmaIdFromSantiyeId(payload.santiyeId)
        ?? firmaIdFromSantiyeAd(payload.santiyeAd);

      if (eskiFirmaId && yeniFirmaId && eskiFirmaId !== yeniFirmaId) {
        // FARKLI FİRMA → 2 ayrı kayıt
        // Eski firma muhasebesine çıkış maili
        pendingEkle({
          ...baseFields,
          tip: "cikis",
          onceSantiyeAd: payload.onceSantiyeAd,
          firmaId: eskiFirmaId,
        });
        // Yeni firma muhasebesine giriş maili
        pendingEkle({
          ...baseFields,
          tip: "giris",
          santiyeAd: payload.santiyeAd,
          firmaId: yeniFirmaId,
        });
        return;
      }
      // Aynı firma içi transfer → tek mail (transfer tipi)
      pendingEkle({
        ...baseFields,
        tip: "transfer",
        santiyeAd: payload.santiyeAd,
        onceSantiyeAd: payload.onceSantiyeAd,
        firmaId: yeniFirmaId,
      });
      return;
    }

    // Giriş veya çıkış (transfer değil)
    let firmaId: string | undefined;
    if (payload.tip === "cikis") {
      firmaId = firmaIdFromSantiyeId(payload.onceSantiyeId)
        ?? firmaIdFromSantiyeAd(payload.onceSantiyeAd);
    } else {
      firmaId = firmaIdFromSantiyeId(payload.santiyeId)
        ?? firmaIdFromSantiyeAd(payload.santiyeAd);
    }
    pendingEkle({
      ...baseFields,
      tip: payload.tip,
      santiyeAd: payload.santiyeAd,
      onceSantiyeAd: payload.onceSantiyeAd,
      firmaId,
    });
  }

  // Mail dialogu üzerinden bulk gönderim — firma bazlı gruplandırılır,
  // her firma kendi SMTP'si ile mail atar. SMTP'si eksik firmaların kayıtları gönderilmez.
  async function bulkMailGonder() {
    if (!muhasebeEmail) {
      toast.error("Muhasebe email tanımlı değil. Tanımlamalar > muhasebe_email kategorisinden ekleyin.");
      return;
    }
    if (firmalar.length === 0) {
      toast.error("Firma bulunamadı — SMTP ayarları için firma gerekli.");
      return;
    }
    if (pending.length === 0) {
      toast("Gönderilecek değişiklik yok.", { icon: "ℹ️" });
      return;
    }

    const FALLBACK_KEY = "__fallback__";
    const grup = new Map<string, PendingChange[]>();
    for (const p of pending) {
      const k = p.firmaId || FALLBACK_KEY;
      if (!grup.has(k)) grup.set(k, []);
      grup.get(k)!.push(p);
    }

    setMailGonderiliyor(true);
    try {
      let basari = 0;
      let basarisiz = 0;
      const basariliKeys = new Set<string>();
      const hataMesajlari: string[] = [];
      const eksikSmtpFirmaAdlari: string[] = [];

      for (const [firmaKey, changes] of grup) {
        const kullanilanFirma = firmalar.find((f) => f.id === firmaKey);
        const firmaAdi = kullanilanFirma?.firma_adi ?? "(bilinmeyen firma)";
        // SMTP eksikse SADECE BU FİRMA ATLA — fallback YAPMA (kullanıcı yanlış firmadan mail gitmesin)
        if (!kullanilanFirma || !kullanilanFirma.smtp_host || !kullanilanFirma.smtp_user || !kullanilanFirma.smtp_password) {
          basarisiz += changes.length;
          eksikSmtpFirmaAdlari.push(firmaAdi);
          continue;
        }

        try {
          const res = await fetch("/api/bordro-mail-bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              firmaId: kullanilanFirma.id,
              muhasebeEmail,
              changes,
              ekBilgi: ekMailNotu.trim() || undefined,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Mail gönderilemedi");
          basari += changes.length;
          for (const c of changes) basariliKeys.add(c.id);
        } catch (err) {
          basarisiz += changes.length;
          hataMesajlari.push(`${firmaAdi}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (basari > 0) {
        toast.success(`${basari} değişiklik gönderildi → ${muhasebeEmail}`);
      }
      if (eksikSmtpFirmaAdlari.length > 0) {
        toast.error(
          `Bu firmalar için SMTP ayarları eksik (mail gönderilemedi): ${eksikSmtpFirmaAdlari.join(", ")}. ` +
          `Yönetim > Firmalar sayfasından SMTP Host/User/Password alanlarını doldurun.`,
          { duration: 12000 },
        );
      }
      if (hataMesajlari.length > 0) {
        toast.error(hataMesajlari[0], { duration: 8000 });
      }
      // Sadece BAŞARILI gönderilenleri kuyruktan çıkar (DB + yerel)
      if (basari > 0) {
        const ids = Array.from(basariliKeys).filter((id) => !id.startsWith("temp-"));
        deletePendingMailler(ids).catch(() => { /* sessiz — bir sonraki refresh düzeltir */ });
        setPending((prev) => prev.filter((p) => !basariliKeys.has(p.id)));
      }
      if (basari > 0 && basarisiz === 0) {
        setEkMailNotu("");
        setMailDialogAcik(false);
      }
    } finally {
      setMailGonderiliyor(false);
    }
  }

  // Pending'ten silmek = DB operasyonunu da geri almak (mail gönderilmediği için).
  async function pendingSil(id: string) {
    const change = pending.find((p) => p.id === id);
    if (!change) return;
    if (!confirm(`Bu işlemi kuyruktan silmek + DB'de geri almak istiyor musunuz?\n\nMail gönderilmediği için işlem tamamen iptal edilir.`)) return;
    try {
      const supabase = (await import("@/lib/supabase/client")).createClient();
      const personelId = personeller.find((p) => p.tc_kimlik_no === change.personelTc || p.ad_soyad === change.personelAd)?.id;
      if (!personelId) {
        toast.error("Personel bulunamadı, sadece kuyruktan silinecek");
        setPending((prev) => prev.filter((p) => p.id !== id));
        return;
      }

      // Tek bir change'i DB'de geri alan helper
      async function revertOne(c: PendingChange) {
        if (c.tip === "cikis" && c.onceSantiyeAd) {
          const sant = santiyeler.find((s) => s.is_adi === c.onceSantiyeAd);
          if (sant) {
            await supabase
              .from("personel_atama_gecmisi")
              .update({ bitis_tarihi: null })
              .eq("personel_id", personelId)
              .eq("santiye_id", sant.id)
              .eq("bitis_tarihi", c.tarih);
          }
        } else if (c.tip === "giris" && c.santiyeAd) {
          const sant = santiyeler.find((s) => s.is_adi === c.santiyeAd);
          if (sant) {
            await supabase
              .from("personel_atama_gecmisi")
              .delete()
              .eq("personel_id", personelId)
              .eq("santiye_id", sant.id)
              .eq("baslangic_tarihi", c.tarih)
              .is("bitis_tarihi", null);
          }
        } else if (c.tip === "transfer") {
          if (c.onceSantiyeAd) {
            const sant = santiyeler.find((s) => s.is_adi === c.onceSantiyeAd);
            if (sant) {
              await supabase
                .from("personel_atama_gecmisi")
                .update({ bitis_tarihi: null })
                .eq("personel_id", personelId)
                .eq("santiye_id", sant.id)
                .eq("bitis_tarihi", c.tarih);
            }
          }
          if (c.santiyeAd) {
            const sant = santiyeler.find((s) => s.is_adi === c.santiyeAd);
            if (sant) {
              await supabase
                .from("personel_atama_gecmisi")
                .delete()
                .eq("personel_id", personelId)
                .eq("santiye_id", sant.id)
                .eq("baslangic_tarihi", c.tarih)
                .is("bitis_tarihi", null);
            }
          }
        }
      }

      // Aynı tarih + personelTc kombinasyonundaki KARŞIT tipte pending var mı? (split transfer)
      const linked = pending.filter((p) =>
        p.id !== id
        && p.tarih === change.tarih
        && p.personelTc === change.personelTc
        && ((change.tip === "cikis" && p.tip === "giris") || (change.tip === "giris" && p.tip === "cikis"))
      );

      // Önce ana change'i, sonra bağlı kayıtları DB'de geri al
      await revertOne(change);
      for (const lk of linked) {
        await revertOne(lk);
      }

      const idsToRemove = new Set([id, ...linked.map((l) => l.id)]);
      // DB'den de sil (temp olmayanları); paylaşımlı kuyruk → diğer adminler de görür.
      const dbIds = Array.from(idsToRemove).filter((x) => !x.startsWith("temp-"));
      if (dbIds.length > 0) {
        deletePendingMailler(dbIds).catch(() => { /* sessiz */ });
      }
      setPending((prev) => prev.filter((p) => !idsToRemove.has(p.id)));
      toast.success(linked.length > 0
        ? `Transfer geri alındı (${1 + linked.length} bağlı kayıt: hem giriş hem çıkış DB'den silindi)`
        : "İşlem geri alındı, kuyruktan silindi"
      );
      await loadData();
    } catch (err) {
      toast.error(`Geri alma hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Gün düzenle: bir personelin belirli şantiyedeki atamaları + ay sınırlarına çakışan günler
  async function gunEditAtamaUpdate(atamaId: string, baslangic: string, bitis: string | null) {
    if (bitis && bitis < baslangic) {
      toast.error("İşten çıkış tarihi, işe başlama tarihinden önce olamaz.");
      return;
    }
    try {
      // Mail kuyruğu mantığı için ESKİ haline bak
      const eskiAtama = atamalar.find((a) => a.id === atamaId);
      const personel = eskiAtama ? personeller.find((p) => p.id === eskiAtama.personel_id) : undefined;
      const santiyeAd = eskiAtama ? santiyeler.find((s) => s.id === eskiAtama.santiye_id)?.is_adi : undefined;

      await updateAtama(atamaId, { baslangic_tarihi: baslangic, bitis_tarihi: bitis });

      // Mail kuyruğuna ekle (önceki durum → yeni durum)
      if (eskiAtama && personel) {
        const eskiAcik = !eskiAtama.bitis_tarihi;
        const yeniAcik = !bitis;
        if (eskiAcik && !yeniAcik) {
          // Açık atama kapatıldı → işten çıkış maili
          kuyrugaEkle({ tip: "cikis", personel, onceSantiyeAd: santiyeAd, onceSantiyeId: eskiAtama.santiye_id });
          toast.success(`Atama güncellendi · ${personel.ad_soyad} işten çıkış maili kuyruğa eklendi`);
        } else if (!eskiAcik && yeniAcik) {
          // Kapalı atama yeniden açıldı → işe geri giriş maili
          kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId: eskiAtama.santiye_id });
          toast.success(`Atama güncellendi · ${personel.ad_soyad} işe giriş maili kuyruğa eklendi`);
        } else {
          toast.success("Atama güncellendi");
        }
      } else {
        toast.success("Atama güncellendi");
      }
      setGunEdit(null); // Kaydet sonrası pencereyi kapat
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
      setGunEdit(null); // Sil sonrası pencereyi kapat
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  async function gunEditAtamaEkle(personelId: string, santiyeId: string, baslangic: string, bitis: string | null) {
    if (bitis && bitis < baslangic) {
      toast.error("İşten çıkış tarihi, işe başlama tarihinden önce olamaz.");
      return;
    }
    try {
      await insertAtama(personelId, santiyeId, baslangic, bitis);

      // Mail kuyruğu: yeni atama açık (bitis_tarihi yok) ise giriş maili gönder.
      // Kapalı atama (bitis dolu) eklendiyse bu geçmiş bir kayıt — mail gönderme.
      const personel = personeller.find((p) => p.id === personelId);
      const santiyeAd = santiyeler.find((s) => s.id === santiyeId)?.is_adi;
      if (personel && !bitis) {
        kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId });
        toast.success(`Atama eklendi · ${personel.ad_soyad} işe giriş maili kuyruğa eklendi`);
      } else {
        toast.success("Atama eklendi");
      }
      setGunEdit(null); // Ekle sonrası pencereyi kapat
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
      // Admin'se topluTarih (kullanıcının seçtiği) — değilse her zaman bugün
      const buGun = new Date().toISOString().slice(0, 10);
      const kullanilanTarih = isYonetici && topluTarih ? topluTarih : buGun;
      for (const personelId of topluSecilenler) {
        try {
          const personel = personeller.find((p) => p.id === personelId);
          if (!personel) continue;
          // Toplu Personel Ekle: yeni atama ekler, mevcut atamaları KAPATMAZ.
          // Bir personel aynı anda birden fazla şantiyede aktif olabilir — bu normaldir.
          // Transfer (eski şantiyeyi kapatma) için ayrı "Toplu Transfer" butonu veya drag-drop kullanılır.
          await insertAtama(personelId, topluEkleSantiyeId, kullanilanTarih, null);
          // Mail kuyruğa: her zaman "giriş" — yeni şantiyenin firmasına
          kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId: topluEkleSantiyeId });
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

  // Firma-Şantiye-Personel hiyerarşisinde export verisi.
  // İşe başlama = atama.baslangic_tarihi
  // İşten çıkış = atama.bitis_tarihi veya "Halen"
  // Gün = seçili ay içindeki gün sayısı
  function exportSantiyeBazli() {
    type Row = {
      firmaId: string; firmaAd: string;
      santiyeId: string; santiyeAd: string;
      adSoyad: string; tc: string; gorev: string;
      iseBaslama: string; isenCikis: string;
      gun: number;
      not: string;
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
    // Firma filtresine uygun şantiyeler (filtre boşsa hepsi)
    const santiyeIds = new Set(filtreliSantiyeler.map((s) => s.id));

    // Önce ham satırları topla
    const ham: (Row & { _bas: string; _bit: string | null })[] = [];
    for (const a of atamalar) {
      if (!filtrelenmisIds.has(a.personel_id)) continue;
      if (!santiyeIds.has(a.santiye_id)) continue;
      const bitisHam = a.bitis_tarihi ?? aktifSanalBitis;
      if (a.baslangic_tarihi > ayBit) continue;
      if (bitisHam < ayBas) continue;
      const personel = personeller.find((p) => p.id === a.personel_id);
      const sant = filtreliSantiyeler.find((s) => s.id === a.santiye_id);
      if (!personel || !sant) continue;
      const firma = sant.yuklenici_firma_id ? firmalar.find((f) => f.id === sant.yuklenici_firma_id) : null;
      const clampBas = a.baslangic_tarihi > ayBas ? a.baslangic_tarihi : ayBas;
      const clampBit = bitisHam < ayBit ? bitisHam : ayBit;
      ham.push({
        firmaId: firma?.id ?? "",
        firmaAd: firma?.firma_adi ?? "(Firma atanmamış)",
        santiyeId: sant.id,
        santiyeAd: sant.is_adi,
        adSoyad: personel.ad_soyad,
        tc: personel.tc_kimlik_no ?? "",
        gorev: personel.gorev ?? "",
        iseBaslama: fmt(a.baslangic_tarihi),
        isenCikis: a.bitis_tarihi ? fmt(a.bitis_tarihi) : "Halen",
        gun: gFark(clampBas, clampBit),
        not: "",
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
      list.sort((a, b) => a._bas.localeCompare(b._bas));
      const ilk = list[0];
      const sonAtama = [...list].sort((a, b) => (a._bit ?? "9999").localeCompare(b._bit ?? "9999")).pop()!;
      const isenCikis = list.some((x) => x._bit == null) ? "Halen" : (sonAtama._bit ? fmt(sonAtama._bit) : "Halen");
      const toplamGun = list.reduce((s, x) => s + x.gun, 0);
      rows.push({
        firmaId: ilk.firmaId,
        firmaAd: ilk.firmaAd,
        santiyeId: ilk.santiyeId,
        santiyeAd: ilk.santiyeAd,
        adSoyad: ilk.adSoyad,
        tc: ilk.tc,
        gorev: ilk.gorev,
        iseBaslama: ilk.iseBaslama,
        isenCikis,
        gun: toplamGun,
        not: "",
      });
    }
    // Manuel gün override
    for (const m of manuelGunler) {
      if (m.ay !== seciliAy) continue;
      const personel = personeller.find((p) => p.id === m.personel_id);
      const sant = filtreliSantiyeler.find((s) => s.id === m.santiye_id);
      if (!personel || !sant) continue;
      const key = `${personel.tc_kimlik_no || personel.ad_soyad}:${sant.id}`;
      const idx = rows.findIndex((r) => `${r.tc || r.adSoyad}:${r.santiyeId}` === key);
      if (idx >= 0) {
        rows[idx].gun = m.gun;
      }
    }

    // Bilgi notlarını uygula (ay-bağımsız — kalıcı not, her ay görünür)
    for (const n of bilgiNotlari) {
      const personel = personeller.find((p) => p.id === n.personel_id);
      const sant = filtreliSantiyeler.find((s) => s.id === n.santiye_id);
      if (!personel || !sant) continue;
      const key = `${personel.tc_kimlik_no || personel.ad_soyad}:${sant.id}`;
      const idx = rows.findIndex((r) => `${r.tc || r.adSoyad}:${r.santiyeId}` === key);
      if (idx >= 0 && n.icerik) {
        rows[idx].not = n.icerik;
      }
    }

    // Firma → şantiye → personel sırası
    rows.sort((a, b) => {
      const fc = a.firmaAd.localeCompare(b.firmaAd, "tr");
      if (fc !== 0) return fc;
      const sc = a.santiyeAd.localeCompare(b.santiyeAd, "tr");
      if (sc !== 0) return sc;
      return a.adSoyad.localeCompare(b.adSoyad, "tr");
    });
    return rows;
  }

  // Yeni formatlı bordro Excel'ini üreten ortak yardımcı.
  // Hem indirme (exportExcel) hem mail eki (bordroGonder) için kullanılır.
  // exportExcel "writeFile" der, bordroGonder ise base64 olarak alır.
  function buildBordroWorkbook(): XLSX.WorkBook | null {
    const rows = exportSantiyeBazli();
    if (rows.length === 0) return null;

    // hex → ARGB (xlsx-js-style 8-haneli renk bekler)
    const hexToArgb = (hex: string) => {
      const h = hex.replace("#", "").trim();
      return ("FF" + (h.length === 6 ? h : h.slice(0, 6))).toUpperCase();
    };
    const isLight = (hex: string) => {
      const h = hex.replace("#", "");
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.6;
    };

    type Cell = { v: string | number; s?: object };
    const sheet: Record<string, Cell> = {};
    let curRow = 0;
    const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
    const NUM_COLS = 7;

    const setCell = (r: number, c: number, v: string | number, s?: object) => {
      sheet[XLSX.utils.encode_cell({ r, c })] = { v, s };
    };

    setCell(curRow, 0, `Bordro Raporu — ${ayLabel(seciliAy)}`, {
      font: { bold: true, sz: 22, color: { rgb: "1E3A5F" } },
      alignment: { horizontal: "center", vertical: "center" },
      fill: { fgColor: { rgb: "F8FAFC" }, patternType: "solid" },
    });
    merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
    curRow++;
    curRow++;

    const firmaGruplari = new Map<string, Map<string, typeof rows>>();
    for (const r of rows) {
      if (!firmaGruplari.has(r.firmaAd)) firmaGruplari.set(r.firmaAd, new Map());
      const sm = firmaGruplari.get(r.firmaAd)!;
      if (!sm.has(r.santiyeAd)) sm.set(r.santiyeAd, []);
      sm.get(r.santiyeAd)!.push(r);
    }

    for (const [firmaAd, santiyeMap] of firmaGruplari) {
      const firma = firmalar.find((f) => f.firma_adi === firmaAd);
      const firmaRenk = firma?.renk ?? "#1E3A5F";
      const firmaArgb = hexToArgb(firmaRenk);
      const yaziArgb = isLight(firmaRenk) ? "FF000000" : "FFFFFFFF";
      const firmaToplamKisi = Array.from(santiyeMap.values()).reduce((s, l) => s + l.length, 0);
      const firmaToplamGun = Array.from(santiyeMap.values()).flat().reduce((s, r) => s + r.gun, 0);

      setCell(curRow, 0, `${firmaAd}  (${santiyeMap.size} iş · ${firmaToplamKisi} kişi · ${firmaToplamGun} gün)`, {
        font: { bold: true, sz: 16, color: { rgb: yaziArgb } },
        alignment: { horizontal: "left", vertical: "center" },
        fill: { fgColor: { rgb: firmaArgb }, patternType: "solid" },
      });
      merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
      curRow++;

      for (const [santiyeAd, list] of santiyeMap) {
        const sToplam = list.reduce((s, r) => s + r.gun, 0);
        setCell(curRow, 0, `▼ ${santiyeAd}  (${list.length} kişi · ${sToplam} gün)`, {
          font: { bold: true, sz: 12, color: { rgb: "1E3A5F" } },
          alignment: { horizontal: "left" },
          fill: { fgColor: { rgb: "E2E8F0" }, patternType: "solid" },
        });
        merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
        curRow++;

        const headers = ["Ad Soyad", "TC", "Görev", "İşe Başlama", "İşten Çıkış", "Gün", "Not"];
        for (let c = 0; c < headers.length; c++) {
          setCell(curRow, c, headers[c], {
            font: { bold: true, sz: 11, color: { rgb: "FFFFFFFF" } },
            alignment: { horizontal: "center", vertical: "center" },
            fill: { fgColor: { rgb: "FF64748B" }, patternType: "solid" },
            border: {
              top: { style: "thin", color: { rgb: "FF000000" } },
              bottom: { style: "thin", color: { rgb: "FF000000" } },
              left: { style: "thin", color: { rgb: "FF000000" } },
              right: { style: "thin", color: { rgb: "FF000000" } },
            },
          });
        }
        curRow++;

        for (let i = 0; i < list.length; i++) {
          const r = list[i];
          const bgArgb = i % 2 === 0 ? "FFFFFFFF" : "FFF1F5F9";
          const rowVals: (string | number)[] = [r.adSoyad, r.tc, r.gorev, r.iseBaslama, r.isenCikis, r.gun, r.not];
          for (let c = 0; c < rowVals.length; c++) {
            setCell(curRow, c, rowVals[c], {
              font: { sz: 10 },
              alignment: { horizontal: c === 5 ? "right" : "left", vertical: "center", wrapText: c === 6 },
              fill: { fgColor: { rgb: bgArgb }, patternType: "solid" },
              border: {
                top: { style: "thin", color: { rgb: "FFD1D5DB" } },
                bottom: { style: "thin", color: { rgb: "FFD1D5DB" } },
                left: { style: "thin", color: { rgb: "FFD1D5DB" } },
                right: { style: "thin", color: { rgb: "FFD1D5DB" } },
              },
            });
          }
          curRow++;
        }
        curRow++;
      }
      curRow++;
    }

    const ws: Record<string, unknown> = sheet;
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
    ws["!cols"] = [
      { wch: 28 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 30 },
    ];
    ws["!rows"] = [{ hpt: 32 }];
    ws["!merges"] = merges;
    ws["!pageSetup"] = { paperSize: 9, fitToWidth: 1, fitToHeight: 10, orientation: "portrait" };
    ws["!margins"] = { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 };
    ws["!printOptions"] = { headings: false, gridLines: false };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws as XLSX.WorkSheet, `Bordro ${ayLabel(seciliAy)}`);
    return wb;
  }

  function exportExcel() {
    const wb = buildBordroWorkbook();
    if (!wb) { toast.error("İndirilecek kayıt yok."); return; }
    XLSX.writeFile(wb, `bordro-${seciliAy}.xlsx`);
  }


  // Seçili personellerin (key formatı `personelId:sutunKey`) personel + sütun bilgilerini çıkart
  function selectedItems() {
    const items: { personel: Personel; sutunKey: string }[] = [];
    for (const key of selectedKeys) {
      const [pid, ...rest] = key.split(":");
      const sutunKey = rest.join(":");
      const personel = personeller.find((p) => p.id === pid);
      if (personel) items.push({ personel, sutunKey });
    }
    return items;
  }

  function toggleSecim(personelId: string, sutunKey: string) {
    const key = `${personelId}:${sutunKey}`;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  // Bu (personel × şantiye) kombinasyonu "geçmiş kayıt" mı? (en son atama kapanmış mı)
  function isGecmisKayit(personelId: string, sutunKey: string): boolean {
    if (sutunKey === PASIF_KEY || sutunKey === ATANMAMIS_KEY) return false;
    const matches = atamalar
      .filter((a) => a.personel_id === personelId && a.santiye_id === sutunKey)
      .sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
    return matches.length > 0 && !!matches[0].bitis_tarihi;
  }
  function tumunuSec(items: { id: string; sutunKey: string }[]) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const it of items) {
        // İşten çıkış tarihi olanları (geçmiş kayıt) atla
        if (isGecmisKayit(it.id, it.sutunKey)) continue;
        next.add(`${it.id}:${it.sutunKey}`);
      }
      return next;
    });
  }
  function tumunuKaldir(items: { id: string; sutunKey: string }[]) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const it of items) next.delete(`${it.id}:${it.sutunKey}`);
      return next;
    });
  }

  async function topluCikarYap() {
    const items = selectedItems();
    const aktifOlanlar = items.filter((it) => it.sutunKey !== PASIF_KEY && it.sutunKey !== ATANMAMIS_KEY);
    if (aktifOlanlar.length === 0) {
      toast.error("Çıkarılacak aktif personel seçilmedi.");
      return;
    }
    setTopluCikisIsleniyor(true);
    try {
      let basari = 0;
      // Aynı personel birden fazla şantiye sütununda seçilmiş olabilir — id bazlı tekilleştir
      const tekIds = new Set<string>();
      for (const it of aktifOlanlar) tekIds.add(it.personel.id);
      for (const pid of tekIds) {
        const personel = personeller.find((p) => p.id === pid);
        if (!personel) continue;
        try {
          const aktifAtama = atamalar.find((a) => a.personel_id === pid && !a.bitis_tarihi);
          const onceSantiyeAd = aktifAtama
            ? santiyeler.find((s) => s.id === aktifAtama.santiye_id)?.is_adi
            : undefined;
          await isenCikar(pid);
          kuyrugaEkle({ tip: "cikis", personel, onceSantiyeAd, onceSantiyeId: aktifAtama?.santiye_id });
          basari++;
        } catch (e) { console.error(e); }
      }
      toast.success(`${basari} personel işten çıkarıldı (mail kuyruğuna eklendi)`);
      setSelectedKeys(new Set());
      setTopluCikisOnay(false);
      await loadData();
    } finally {
      setTopluCikisIsleniyor(false);
    }
  }

  async function topluTransferYap() {
    if (!topluTransferHedef) { toast.error("Hedef şantiye seçin"); return; }
    const items = selectedItems();
    if (items.length === 0) { toast.error("Personel seçilmedi"); return; }
    const hedefAd = santiyeler.find((s) => s.id === topluTransferHedef)?.is_adi;
    setTopluTransferIsleniyor(true);
    try {
      let basari = 0;
      const tekIds = new Set<string>();
      for (const it of items) tekIds.add(it.personel.id);
      for (const pid of tekIds) {
        const personel = personeller.find((p) => p.id === pid);
        if (!personel) continue;
        try {
          const aktifAtama = atamalar.find((a) => a.personel_id === pid && !a.bitis_tarihi);
          const onceSantiyeAd = aktifAtama
            ? santiyeler.find((s) => s.id === aktifAtama.santiye_id)?.is_adi
            : undefined;
          if (aktifAtama && aktifAtama.santiye_id === topluTransferHedef) continue; // zaten orada
          if (aktifAtama) {
            await transferEt(pid, topluTransferHedef);
            kuyrugaEkle({ tip: "transfer", personel, santiyeAd: hedefAd, onceSantiyeAd, santiyeId: topluTransferHedef, onceSantiyeId: aktifAtama.santiye_id });
          } else {
            await iseGeriAl(pid, topluTransferHedef);
            kuyrugaEkle({ tip: "giris", personel, santiyeAd: hedefAd, santiyeId: topluTransferHedef });
          }
          basari++;
        } catch (e) { console.error(e); }
      }
      toast.success(`${basari} personel ${hedefAd} şantiyesine transfer edildi (mail kuyruğuna eklendi)`);
      setSelectedKeys(new Set());
      setTopluTransferAcik(false);
      setTopluTransferHedef("");
      await loadData();
    } finally {
      setTopluTransferIsleniyor(false);
    }
  }

  // Bordro raporunu Excel olarak hazırla + muhasebeye mail at
  async function bordroGonder() {
    if (!muhasebeEmail) {
      toast.error("Muhasebe email tanımlı değil. Tanımlamalar > muhasebe_email kategorisinden ekleyin.");
      return;
    }
    if (firmalar.length === 0) {
      toast.error("Firma bulunamadı — SMTP ayarları için firma gerekli.");
      return;
    }
    const smtpFirmasi = firmalar.find((f) => f.smtp_host && f.smtp_user && f.smtp_password);
    if (!smtpFirmasi) {
      toast.error("Hiçbir firmada SMTP ayarları yok. Yönetim > Firmalar'dan girin.");
      return;
    }
    if (!confirm(`${ayLabel(seciliAy)} bordro raporunu ${muhasebeEmail} adresine göndermek istiyor musunuz?`)) return;
    try {
      // Yeni formatlı Excel'i ortak helper ile üret (indirme ile aynı görünüm + renkler).
      const wb = buildBordroWorkbook();
      if (!wb) { toast.error("Gönderilecek bordro verisi yok."); return; }
      // base64 olarak çıkart
      const b64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" }) as string;
      // API'ye gönder
      const tId = toast.loading("Mail gönderiliyor...");
      const res = await fetch("/api/bordro-rapor-mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaId: smtpFirmasi.id,
          muhasebeEmail,
          ay: ayLabel(seciliAy),
          ayKey: seciliAy,
          excelBase64: b64,
        }),
      });
      const data = await res.json();
      toast.dismiss(tId);
      if (!res.ok) throw new Error(data.error || "Mail gönderilemedi");
      toast.success(data.mesaj || "Bordro raporu gönderildi");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function exportPDF() {
    const rows = exportSantiyeBazli();
    if (rows.length === 0) { toast.error("İndirilecek kayıt yok."); return; }
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(14);
    doc.text(trAscii(`Bordro Raporu - ${ayLabel(seciliAy)}`), 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Olusturma: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${rows.length} kayit`, 14, 21);

    // Firma → Şantiye → Personel hiyerarşisi
    const firmaGruplari = new Map<string, Map<string, typeof rows>>();
    for (const r of rows) {
      if (!firmaGruplari.has(r.firmaAd)) firmaGruplari.set(r.firmaAd, new Map());
      const santiyeMap = firmaGruplari.get(r.firmaAd)!;
      if (!santiyeMap.has(r.santiyeAd)) santiyeMap.set(r.santiyeAd, []);
      santiyeMap.get(r.santiyeAd)!.push(r);
    }

    let cursorY = 25;
    const pageHeight = doc.internal.pageSize.getHeight();
    for (const [firmaAd, santiyeMap] of firmaGruplari) {
      const firmaToplamKisi = Array.from(santiyeMap.values()).reduce((s, l) => s + l.length, 0);
      const firmaToplamGun = Array.from(santiyeMap.values()).flat().reduce((s, r) => s + r.gun, 0);

      // Yeni sayfaya geçmek gerekirse
      if (cursorY > pageHeight - 40) {
        doc.addPage();
        cursorY = 15;
      }

      // Firma başlığı (büyük, koyu)
      doc.setFillColor(30, 58, 95);
      doc.rect(14, cursorY - 4, doc.internal.pageSize.getWidth() - 28, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.setTextColor(255, 255, 255);
      doc.text(trAscii(`FIRMA: ${firmaAd}  (${santiyeMap.size} is, ${firmaToplamKisi} kisi, ${firmaToplamGun} gun)`), 17, cursorY + 1);
      doc.setTextColor(0, 0, 0);
      cursorY += 8;

      for (const [santiyeAd, list] of santiyeMap) {
        const sToplam = list.reduce((s, r) => s + r.gun, 0);
        // Sayfa kontrolü
        if (cursorY > pageHeight - 30) {
          doc.addPage();
          cursorY = 15;
        }
        doc.setFont("helvetica", "bold"); doc.setFontSize(9);
        doc.text(trAscii(`  ${santiyeAd}  (${list.length} kisi, ${sToplam} gun)`), 17, cursorY);
        cursorY += 2;
        autoTable(doc, {
          startY: cursorY + 1,
          head: [["Sira", "Ad Soyad", "TC", "Gorev", "Ise Baslama", "Isten Cikis", "Gun", "Not"]],
          body: list.map((r, i) => [
            String(i + 1),
            trAscii(r.adSoyad),
            r.tc,
            trAscii(r.gorev),
            r.iseBaslama,
            r.isenCikis,
            String(r.gun),
            trAscii(r.not),
          ]),
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: { fillColor: [100, 116, 139] },
          alternateRowStyles: { fillColor: [241, 245, 249] },
          margin: { left: 14, right: 14 },
        });
        // @ts-expect-error autoTable lastAutoTable typing
        cursorY = (doc as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      }
      cursorY += 4;
    }
    doc.save(`bordro-${seciliAy}.pdf`);
  }

  // Personel ekle
  async function personelEkle() {
    if (!ekleAd.trim()) { toast.error("Ad soyad gerekli"); return; }
    if (!ekleTc.trim() || ekleTc.length !== 11) { toast.error("11 haneli TC gerekli"); return; }
    setKaydetYukleniyor(true);
    try {
      // Admin'se ekleTarih (eski tarih girebilir), değilse her zaman bugün
      const buGun = new Date().toISOString().slice(0, 10);
      const kullanilanTarih = isYonetici && ekleTarih ? ekleTarih : buGun;
      const yeni = await insertBordroPersonel({
        ad_soyad: formatKisiAdi(ekleAd),
        tc_kimlik_no: ekleTc.trim(),
        gorev: ekleGorev || null,
        meslek: null,
        santiye_id: ekleSantiye || null,
        maas: null,
        izin_hakki: null,
        mesai_ucreti_var: false,
        ise_giris_tarihi: kullanilanTarih,
        ev_telefon: null,
        cep_telefon: null,
        durum: "aktif",
        pasif_tarihi: null,
      });
      toast.success("Personel eklendi (mail kuyruğa eklendi)");
      // Mail kuyruğuna ekle
      const santiyeAd = ekleSantiye ? santiyeler.find((s) => s.id === ekleSantiye)?.is_adi : undefined;
      kuyrugaEkle({ tip: "giris", personel: yeni, santiyeAd, santiyeId: ekleSantiye || undefined });
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

  // İşten çıkar — kullanıcı tarafından seçilen tarih ile.
  // Admin (isYonetici): herhangi bir tarih girebilir.
  // Diğer kullanıcılar: bugünden max 10 gün geri.
  async function cikisYap() {
    if (!cikisOnay) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const secilenTarih = new Date(cikisTarih + "T00:00:00");
    if (isNaN(secilenTarih.getTime())) { toast.error("Geçerli bir tarih girin"); return; }
    if (!isYonetici) {
      const minTarih = new Date(today); minTarih.setDate(minTarih.getDate() - 10);
      if (secilenTarih > today) { toast.error("Çıkış tarihi gelecek olamaz"); return; }
      if (secilenTarih < minTarih) { toast.error("Çıkış tarihi en fazla 10 gün geriye olabilir"); return; }
    }
    try {
      const aktifAtama = atamalar.find((a) => a.personel_id === cikisOnay.id && !a.bitis_tarihi);
      const oldSantiyeId = aktifAtama?.santiye_id ?? cikisOnay.santiye_id ?? undefined;
      const oldSantiyeAd = oldSantiyeId
        ? santiyeler.find((s) => s.id === oldSantiyeId)?.is_adi
        : undefined;
      await isenCikar(cikisOnay.id, cikisTarih);
      toast.success(`${cikisOnay.ad_soyad} işten çıkarıldı (${cikisTarih}, mail kuyruğa)`);
      kuyrugaEkle({ tip: "cikis", personel: cikisOnay, onceSantiyeAd: oldSantiyeAd, onceSantiyeId: oldSantiyeId });
      setCikisOnay(null);
      setCikisTarih(new Date().toISOString().slice(0, 10));
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
      kuyrugaEkle({ tip: "giris", personel: geriAlPersonel, santiyeAd: yeniSantiyeAd, santiyeId: geriAlSantiye });
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
        kuyrugaEkle({ tip: "giris", personel, santiyeAd: yeniSantiyeAd, santiyeId: hedefKey });
      } else {
        await transferEt(personel.id, hedefKey);
        kuyrugaEkle({ tip: "transfer", personel, santiyeAd: yeniSantiyeAd, onceSantiyeAd, santiyeId: hedefKey, onceSantiyeId: aktifSantiyeId ?? undefined });
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

  // Accordion satırı: işin adı + sayım + chevron, tıklayınca açılıp altta personel listesi
  function SantiyeAccordion({
    santiyeId, baslik, renk, count, tumGun, acik, tumSecili,
    onToggle, onTumunuSecToggle, onPlus, children,
  }: {
    santiyeId: string;
    baslik: string;
    renk: string;
    count: number;
    tumGun: number;
    acik: boolean;
    tumSecili: boolean;
    onToggle: () => void;
    onTumunuSecToggle: () => void;
    onPlus?: () => void;
    children: React.ReactNode;
  }) {
    void santiyeId;
    return (
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <div
          className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors border-l-4"
          style={{ borderLeftColor: renk }}
          onClick={onToggle}
        >
          {acik ? <ChevronDown size={16} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />}
          <h3 className="font-bold text-sm text-[#1E3A5F] flex-1 truncate" title={baslik}>{baslik}</h3>
          {tumGun > 0 && (
            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">
              {tumGun} gün
            </span>
          )}
          <span className="text-xs bg-gray-100 border border-gray-300 px-2 py-0.5 rounded-full font-semibold text-gray-700">
            {count} kişi
          </span>
          {count > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTumunuSecToggle(); }}
              title={tumSecili ? "Seçimi kaldır" : "Tümünü seç"}
              className={`text-[10px] px-2 py-0.5 rounded border ${tumSecili ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
            >
              {tumSecili ? "✓ Hepsi" : "Tümünü Seç"}
            </button>
          )}
          {onPlus && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onPlus(); }}
              title="Bu işe toplu personel ekle"
              className="h-6 w-6 flex items-center justify-center rounded-full bg-emerald-500 text-white hover:bg-emerald-600 flex-shrink-0"
            >
              <Plus size={12} />
            </button>
          )}
        </div>
        {acik && (
          <div className="bg-gray-50 border-t">
            {children}
          </div>
        )}
      </div>
    );
  }

  // Personeller için tablo wrapper'ı
  function PersonelTablo({ liste, sutunKey }: { liste: Personel[]; sutunKey: string }) {
    const yil = parseInt(seciliAy.split("-")[0], 10);
    // Yıllık varsayılan günlük ücret (Bordro Takibi > Günlük Ücret sekmesinden)
    const defaultUcret = gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0;
    // Tutar sütununu göster: varsayılan ücret >0 veya listedeki herhangi bir personelin brüt ücreti tarihçesi varsa
    const tutarSutunuGoster = defaultUcret > 0 || liste.some((p) => brutUcretForAy(brutUcretGecmisi, p.id, seciliAy) > 0);
    const isAtanmamis = sutunKey === ATANMAMIS_KEY;
    const isPasif = sutunKey === PASIF_KEY;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-gray-100 border-y border-gray-200">
              <th className="w-8 px-2 py-1.5"></th>
              <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Ad Soyad</th>
              <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Görev</th>
              <th className="text-left px-2 py-1.5 font-semibold text-gray-600 hidden md:table-cell">TC</th>
              {!isAtanmamis && !isPasif && (
                <>
                  <th className="text-left px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap">İşe Başlama</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap">Çıkış</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap">Gün</th>
                  {tutarSutunuGoster && (
                    <th className="text-right px-2 py-1.5 font-semibold text-gray-600 whitespace-nowrap">Tutar</th>
                  )}
                </>
              )}
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {liste.map((p) => <PersonelSatir key={p.id} p={p} sutunKey={sutunKey} ucret={defaultUcret} tutarGoster={tutarSutunuGoster} />)}
          </tbody>
        </table>
      </div>
    );
  }

  // Tek satır personel: <tr> formatında, checkbox + sütunlar + butonlar
  function PersonelSatir({ p, sutunKey, ucret, tutarGoster }: { p: Personel; sutunKey: string; ucret: number; tutarGoster: boolean }) {
    // Personelin seçili ay için brüt ücreti varsa onu günlük ücret olarak kullan,
    // yoksa yıl bazlı varsayılan ücret. Brüt ücret tarihsel: değişiklikten sonra yeni değer baz alınır.
    const personelBrut = brutUcretForAy(brutUcretGecmisi, p.id, seciliAy);
    const kullanilanUcret = personelBrut > 0 ? personelBrut : ucret;
    const brutKullanildi = personelBrut > 0;
    const ozelGun = sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY
      ? gunMap.get(p.id)?.get(sutunKey) ?? 0
      : 0;
    // Manuel gün girildi mi?
    const manuelEntry = manuelGunler.find(
      (m) => m.personel_id === p.id && m.santiye_id === sutunKey && m.ay === seciliAy,
    );
    const hasManuel = !!manuelEntry;
    // Doğal hesap (atama tarihlerinden) — manuel girilmediğinde tutar bunun üzerinden silik gri gösterilir
    const naturalGun = sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY
      ? naturalGunMap.get(p.id)?.get(sutunKey) ?? 0
      : 0;
    // Tutar hesabı: manuel varsa manuel gün × ücret, yoksa doğal gün × ücret
    // Ücret: personelin brüt ücreti varsa o, yoksa yıl bazlı varsayılan
    const tutarGun = hasManuel ? ozelGun : naturalGun;
    const tutarHesap = tutarGun * kullanilanUcret;
    const inPasifCol = sutunKey === PASIF_KEY;
    const inAtanmamisCol = sutunKey === ATANMAMIS_KEY;
    const showCikis = !inPasifCol && !inAtanmamisCol;
    const showGeriAl = inPasifCol;
    const tiklanabilir = !isReadOnly && !inPasifCol && !inAtanmamisCol;
    const key = `${p.id}:${sutunKey}`;
    const secili = selectedKeys.has(key);

    let iseBaslama: string | null = null;
    let isenCikis: string | null = null;
    if (sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY) {
      const matches = atamalar
        .filter((a) => a.personel_id === p.id && a.santiye_id === sutunKey)
        .sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
      if (matches.length > 0) {
        iseBaslama = matches[0].baslangic_tarihi;
        // Eğer en son atama kapandıysa (transfer edildi → bu şantiyeden çıktı) çıkış tarihi göster
        isenCikis = matches[0].bitis_tarihi;
      }
    }
    // İşten çıkış tarihi varsa bu personel "geçmiş" — butonlar ve seçim devre dışı
    const gecmisKayit = !!isenCikis;
    const formatTr = (d: string) => {
      const dt = new Date(d + "T00:00:00");
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString("tr-TR");
    };

    const isAktifKolon = sutunKey !== PASIF_KEY && sutunKey !== ATANMAMIS_KEY;
    return (
      <tr
        data-personel-row
        className={`border-b border-gray-100 hover:bg-blue-50/50 transition-colors ${secili ? "bg-blue-50" : "bg-white"} ${gecmisKayit ? "opacity-60" : ""}`}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest("button, input")) return;
          if (tiklanabilir) setGunEdit({ personel: p, santiyeId: sutunKey });
        }}
        title={tiklanabilir ? "Çift tıkla: giriş/çıkış tarihleri ve gün düzenle" : ""}
      >
        <td className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={secili}
            disabled={gecmisKayit}
            onChange={() => !gecmisKayit && toggleSecim(p.id, sutunKey)}
            className="cursor-pointer disabled:cursor-not-allowed"
            onClick={(e) => e.stopPropagation()}
            title={gecmisKayit ? "Bu personel bu şantiyeden çıkış yapmış — işlem yapılamaz" : ""}
          />
        </td>
        <td className="px-2 py-1.5 font-semibold text-[#1E3A5F]">
          <div className="flex items-center gap-1">
            <span className="truncate">{p.ad_soyad}</span>
            {p.personel_tipi === "taseron" && (
              <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold flex-shrink-0">TŞ</span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 text-gray-600 text-[11px]">{p.gorev ?? "—"}</td>
        <td className="px-2 py-1.5 text-gray-500 font-mono text-[11px] hidden md:table-cell">{p.tc_kimlik_no ?? "—"}</td>
        {isAktifKolon && (
          <>
            <td className="px-2 py-1.5 whitespace-nowrap text-emerald-700 font-semibold text-[11px]">
              {iseBaslama ? formatTr(iseBaslama) : "—"}
            </td>
            <td className="px-2 py-1.5 whitespace-nowrap text-red-600 font-semibold text-[11px]">
              {isenCikis ? formatTr(isenCikis) : "—"}
            </td>
            <td className="px-2 py-1.5 text-right whitespace-nowrap">
              {ozelGun > 0 ? (
                <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold">
                  {ozelGun}
                </span>
              ) : <span className="text-gray-300">—</span>}
            </td>
            {tutarGoster && (
              <td
                className={`px-2 py-1.5 text-right font-mono text-[11px] ${hasManuel ? "text-gray-900 font-semibold" : "text-gray-400"}`}
                title={`${tutarGun} gün × ${kullanilanUcret.toLocaleString("tr-TR")} TL ${hasManuel ? "(manuel)" : "(otomatik hesap)"}${brutKullanildi ? " · brüt ücret" : " · yıl bazlı ücret"}`}
              >
                {tutarHesap > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    {brutKullanildi && <span className="text-[8px] bg-amber-100 text-amber-700 px-1 rounded font-bold" title="Brüt ücretten">B</span>}
                    {tutarHesap.toLocaleString("tr-TR", { maximumFractionDigits: 0 })} TL
                  </span>
                ) : "—"}
              </td>
            )}
          </>
        )}
        <td className="px-1 py-1.5 text-center">
          {!isReadOnly && !gecmisKayit && (showCikis || showGeriAl) && (
            <div className="flex gap-0.5 justify-center">
              {showCikis && (
                <button
                  type="button"
                  onClick={() => setCikisOnay(p)}
                  title="İşten çıkar"
                  className="p-1 text-red-500 hover:bg-red-50 rounded"
                >
                  <Trash2 size={14} />
                </button>
              )}
              {showGeriAl && (
                <button
                  type="button"
                  onClick={() => { setGeriAlPersonel(p); setGeriAlSantiye(""); }}
                  title="İşe geri al"
                  className="p-1 text-emerald-500 hover:bg-emerald-50 rounded"
                >
                  <UserPlus size={14} />
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
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
          {/* Ay seçici — sabit genişlik (135px input + 36px×2 oklar + 90px etiket) */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => setSeciliAy(ayDegistir(seciliAy, -1))}
              title="Önceki ay"
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border border-input bg-white hover:bg-gray-50"
            >
              <ChevronLeft size={16} />
            </button>
            <input
              type="month"
              value={seciliAy}
              onChange={(e) => setSeciliAy(e.target.value || buAy)}
              className="h-9 w-[140px] flex-shrink-0 rounded-md border border-input bg-white px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => setSeciliAy(ayDegistir(seciliAy, 1))}
              title="Sonraki ay"
              className="h-9 w-9 flex-shrink-0 flex items-center justify-center rounded-md border border-input bg-white hover:bg-gray-50"
            >
              <ChevronRight size={16} />
            </button>
            <span className="text-[11px] font-semibold text-[#1E3A5F] ml-1 w-[100px] flex-shrink-0 truncate">{ayLabel(seciliAy)}</span>
            {isReadOnly && (
              <span className="inline-flex items-center gap-1 text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-1.5 py-0.5 rounded ml-1 flex-shrink-0">
                <Lock size={10} /> salt-okunur
              </span>
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
            onClick={bordroGonder}
            size="sm"
            variant="outline"
            className="border-purple-300 text-purple-700 hover:bg-purple-50"
            title={`${ayLabel(seciliAy)} bordrosunu Excel olarak muhasebeye mail at`}
          >
            <FileSpreadsheet size={14} className="mr-1" /> Bordro Gönder
          </Button>
        </div>
      </div>

      {!muhasebeEmail && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded mb-3 text-xs">
          ⚠️ Muhasebe email adresi tanımlanmamış. Tanımlamalar &gt; <code>muhasebe_email</code> kategorisinden ekleyin
          (giriş/çıkış/transfer mailleri buraya gidecek).
        </div>
      )}

      {/* Toplu işlem barı — fixed position. Boşluğa tıkla / ESC ile temizlenir. */}
      <div
        data-toplu-bar
        className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-blue-50 border border-blue-300 rounded-lg p-2 flex items-center gap-2 shadow-lg transition-opacity ${
          selectedKeys.size > 0 ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <div className="text-sm text-blue-900 font-semibold pl-2">
          {selectedKeys.size} kişi seçildi
          <span className="ml-2 text-[10px] text-blue-600 font-normal">(ESC veya boşluğa tıkla → temizle)</span>
        </div>
        <Button size="sm" variant="outline"
          onClick={() => setTopluTransferAcik(true)}
          className="border-blue-400 text-blue-700 hover:bg-blue-100">
          Toplu Transfer
        </Button>
        <Button size="sm" variant="outline"
          onClick={() => setTopluCikisOnay(true)}
          className="border-red-400 text-red-700 hover:bg-red-100">
          Toplu İşten Çıkar
        </Button>
      </div>

      {/* Accordion görünüm: Firma → İş (Şantiye) → Personel */}
      <div className="space-y-2">
        {(() => {
          // Şantiyeleri firma_id'ye göre grupla
          const firmaGrup = new Map<string, typeof filtreliSantiyeler>();
          for (const s of filtreliSantiyeler) {
            const fId = s.yuklenici_firma_id || "__firmasiz__";
            if (!firmaGrup.has(fId)) firmaGrup.set(fId, []);
            firmaGrup.get(fId)!.push(s);
          }
          // Firma sırasını korumak için firmalar listesindeki sırayı kullan
          const firmaIds = Array.from(firmaGrup.keys()).sort((a, b) => {
            const fa = firmalar.find((f) => f.id === a)?.firma_adi ?? "Z";
            const fb = firmalar.find((f) => f.id === b)?.firma_adi ?? "Z";
            return fa.localeCompare(fb, "tr");
          });

          return firmaIds.map((fId, fIdx) => {
            const firma = firmalar.find((f) => f.id === fId);
            const firmaAd = firma?.firma_adi ?? "(Firma atanmamış)";
            const firmaSantiyeler = firmaGrup.get(fId) ?? [];
            const firmaAcik = expandedFirmalar.has(fId);
            // Firma toplam: kişi sayısı + gün
            let firmaToplamKisi = 0;
            let firmaToplamGun = 0;
            for (const s of firmaSantiyeler) {
              const liste = kanbanMap.get(s.id) ?? [];
              firmaToplamKisi += liste.length;
              for (const p of liste) firmaToplamGun += gunMap.get(p.id)?.get(s.id) ?? 0;
            }
            // Firmanın kayıtlı rengi varsa onu kullan, yoksa fallback paleti
            const fallbackRenkler = ["#1E3A5F", "#7c3aed", "#dc2626", "#059669", "#d97706", "#0891b2"];
            const firmaRenk = firma?.renk || fallbackRenkler[fIdx % fallbackRenkler.length];

            return (
              <div key={fId} className="rounded-lg overflow-hidden shadow-md ring-1 ring-gray-200">
                {/* Firma başlığı — belirgin koyu mavi-beyaz tema */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
                  style={{
                    background: `linear-gradient(135deg, ${firmaRenk} 0%, ${firmaRenk}dd 100%)`,
                  }}
                  onClick={() => {
                    setExpandedFirmalar((prev) => {
                      const next = new Set(prev);
                      if (next.has(fId)) next.delete(fId);
                      else next.add(fId);
                      return next;
                    });
                  }}
                >
                  {firmaAcik
                    ? <ChevronDown size={20} className="text-white flex-shrink-0" />
                    : <ChevronRight size={20} className="text-white flex-shrink-0" />}
                  <Building2 size={18} className="text-white flex-shrink-0" />
                  <span className="text-[10px] font-bold text-white/70 uppercase tracking-widest">FİRMA</span>
                  <h2 className="font-bold text-base text-white flex-1 truncate" title={firmaAd}>{firmaAd}</h2>
                  <span className="text-[11px] bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full font-semibold">
                    {firmaSantiyeler.length} iş
                  </span>
                  <span className="text-[11px] bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full font-semibold">
                    {firmaToplamKisi} kişi
                  </span>
                  {firmaToplamGun > 0 && (
                    <span className="text-[11px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold">
                      {firmaToplamGun} gün
                    </span>
                  )}
                </div>

                {/* Firma içerik: işler — soluk gri/yeşil tema, indented sol margin ile hiyerarşi belli */}
                {firmaAcik && (
                  <div className="bg-slate-50 border-t border-slate-200 p-3 space-y-2 pl-6">
                    {firmaSantiyeler.length === 0 ? (
                      <div className="text-center py-3 text-gray-400 text-xs italic">Bu firmada iş yok</div>
                    ) : (
                      firmaSantiyeler.map((s, i) => {
                        const isRenkler = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];
                        const renk = isRenkler[i % isRenkler.length];
                        const liste = kanbanMap.get(s.id) ?? [];
                        const acik = expandedSantiyeler.has(s.id);
                        const tumGun = liste.reduce((acc, p) => acc + (gunMap.get(p.id)?.get(s.id) ?? 0), 0);
                        const tumSecili = liste.length > 0 && liste.every((p) => selectedKeys.has(`${p.id}:${s.id}`));
                        return (
                          <SantiyeAccordion
                            key={s.id}
                            santiyeId={s.id}
                            baslik={s.is_adi}
                            renk={renk}
                            count={liste.length}
                            tumGun={tumGun}
                            acik={acik}
                            tumSecili={tumSecili}
                            onToggle={() => {
                              setExpandedSantiyeler((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.id)) next.delete(s.id);
                                else next.add(s.id);
                                return next;
                              });
                            }}
                            onTumunuSecToggle={() => {
                              if (tumSecili) tumunuKaldir(liste.map((p) => ({ id: p.id, sutunKey: s.id })));
                              else tumunuSec(liste.map((p) => ({ id: p.id, sutunKey: s.id })));
                            }}
                            onPlus={!isReadOnly ? () => {
                              setTopluEkleSantiyeId(s.id);
                              setTopluSecilenler(new Set());
                              setTopluArama("");
                              setTopluTarih(new Date().toISOString().slice(0, 10));
                            } : undefined}
                          >
                            {liste.length === 0 ? (
                              <div className="text-center py-3 text-gray-400 text-xs italic">
                                <Building2 size={18} className="mx-auto mb-1" />
                                Bu işe atanmış personel yok
                              </div>
                            ) : (
                              <PersonelTablo liste={liste} sutunKey={s.id} />
                            )}
                          </SantiyeAccordion>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          });
        })()}

        {/* Atanmamış */}
        {(() => {
          const liste = kanbanMap.get(ATANMAMIS_KEY) ?? [];
          if (liste.length === 0) return null;
          const acik = expandedSantiyeler.has(ATANMAMIS_KEY);
          const tumSecili = liste.every((p) => selectedKeys.has(`${p.id}:${ATANMAMIS_KEY}`));
          return (
            <SantiyeAccordion
              santiyeId={ATANMAMIS_KEY}
              baslik="Atanmamış"
              renk="#9ca3af"
              count={liste.length}
              tumGun={0}
              acik={acik}
              tumSecili={tumSecili}
              onToggle={() => {
                setExpandedSantiyeler((prev) => {
                  const next = new Set(prev);
                  if (next.has(ATANMAMIS_KEY)) next.delete(ATANMAMIS_KEY);
                  else next.add(ATANMAMIS_KEY);
                  return next;
                });
              }}
              onTumunuSecToggle={() => {
                if (tumSecili) tumunuKaldir(liste.map((p) => ({ id: p.id, sutunKey: ATANMAMIS_KEY })));
                else tumunuSec(liste.map((p) => ({ id: p.id, sutunKey: ATANMAMIS_KEY })));
              }}
            >
              <PersonelTablo liste={liste} sutunKey={ATANMAMIS_KEY} />
            </SantiyeAccordion>
          );
        })()}

        {/* Pasif */}
        {(() => {
          const liste = kanbanMap.get(PASIF_KEY) ?? [];
          if (liste.length === 0) return null;
          const acik = expandedSantiyeler.has(PASIF_KEY);
          const tumSecili = liste.every((p) => selectedKeys.has(`${p.id}:${PASIF_KEY}`));
          return (
            <SantiyeAccordion
              santiyeId={PASIF_KEY}
              baslik="İşten Çıkarılanlar"
              renk="#ef4444"
              count={liste.length}
              tumGun={0}
              acik={acik}
              tumSecili={tumSecili}
              onToggle={() => {
                setExpandedSantiyeler((prev) => {
                  const next = new Set(prev);
                  if (next.has(PASIF_KEY)) next.delete(PASIF_KEY);
                  else next.add(PASIF_KEY);
                  return next;
                });
              }}
              onTumunuSecToggle={() => {
                if (tumSecili) tumunuKaldir(liste.map((p) => ({ id: p.id, sutunKey: PASIF_KEY })));
                else tumunuSec(liste.map((p) => ({ id: p.id, sutunKey: PASIF_KEY })));
              }}
            >
              <PersonelTablo liste={liste} sutunKey={PASIF_KEY} />
            </SantiyeAccordion>
          );
        })()}
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
              <Input
                value={ekleAd}
                onChange={(e) => setEkleAd(e.target.value)}
                onBlur={() => setEkleAd(formatKisiAdi(ekleAd))}
                placeholder="Ahmet ÇELİK"
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                Adın baş harfi büyük, soyadı tamamı büyük olarak otomatik düzeltilir.
              </p>
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
            {/* Admin için eskiye dönük işe başlama tarihi */}
            {isYonetici && (
              <div>
                <Label className="text-xs">İşe Başlama Tarihi <span className="text-gray-400">(admin)</span></Label>
                <Input type="date" value={ekleTarih} onChange={(e) => setEkleTarih(e.target.value)} />
                <p className="text-[10px] text-gray-400 mt-0.5">Boş bırakılırsa bugün kullanılır.</p>
              </div>
            )}
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
                {/* Yeni taşeron işçi ekle butonu (üstte) — bu şantiyeye direkt ekler */}
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-amber-800">
                    Listede olmayan yeni biri mi var?
                  </div>
                  <Button
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => {
                      // Bu şantiyeyi pre-select et + ekle dialogu aç + toplu kapansın
                      setEkleSantiye(topluEkleSantiyeId || "");
                      setTopluEkleSantiyeId(null);
                      setEkleAcik(true);
                    }}
                  >
                    <UserPlus size={14} className="mr-1" /> Yeni Taşeron İşçi Ekle
                  </Button>
                </div>
                {/* Admin için eskiye dönük tarih girişi */}
                {isYonetici && (
                  <div>
                    <Label className="text-xs">Başlangıç Tarihi <span className="text-gray-400">(admin)</span></Label>
                    <Input type="date" value={topluTarih} onChange={(e) => setTopluTarih(e.target.value)} />
                  </div>
                )}
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

                {/* Hızlı manuel gün girişi — atama tarihlerini DEĞİŞTİRMEZ.
                    Admin: max sınırsız (ay'ın gün sayısı veya yüksek bir limit).
                    Diğerleri: doğal hesap × ay sonu (çıkış tarihi varsa o tarihe kadar). */}
                {!isReadOnly && (() => {
                  const naturalMax = naturalGunMap.get(gunEdit.personel.id)?.get(gunEdit.santiyeId) ?? sonGun;
                  const max = isYonetici ? sonGun : Math.min(sonGun, naturalMax);
                  return (
                    <ManuelGunHizliKart
                      mevcutGun={gunMap.get(gunEdit.personel.id)?.get(gunEdit.santiyeId) ?? 0}
                      aySonGun={max}
                      onSave={(N) => kaydetManuelGun(gunEdit.personel.id, gunEdit.santiyeId, seciliAy, N)}
                    />
                  );
                })()}

                {/* Giriş / Çıkış Tarihleri — atama editörü.
                    Tüm atamalar gösterilir (sadece bu ay değil), tarih sırasına göre yenidan eskiye. */}
                {!isReadOnly && (() => {
                  const tumAtamalar = atamalar
                    .filter((a) => a.personel_id === gunEdit.personel.id && a.santiye_id === gunEdit.santiyeId)
                    .sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
                  return (
                    <div className="border-2 border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-700">📅 Giriş / Çıkış Tarihleri</div>
                        <span className="text-[10px] text-gray-500">{tumAtamalar.length} atama</span>
                      </div>
                      {tumAtamalar.length === 0 && (
                        <p className="text-xs text-gray-400 italic">Henüz atama yok. Aşağıdan yeni atama ekleyebilirsiniz.</p>
                      )}
                      {tumAtamalar.map((a) => {
                        const cakisanAyDa = liste.find((l) => l.id === a.id);
                        const aylikGun = cakisanAyDa ? ayInGun(a) : 0;
                        return (
                          <AtamaSatir
                            key={a.id}
                            atama={a}
                            gunSayisi={aylikGun}
                            onSave={(bas, bit) => gunEditAtamaUpdate(a.id, bas, bit)}
                            onDelete={() => gunEditAtamaSil(a.id)}
                          />
                        );
                      })}
                      <YeniAtamaSatir
                        defaultBaslangic={ayBas}
                        defaultBitis={ayBit}
                        onEkle={(bas, bit) => gunEditAtamaEkle(gunEdit.personel.id, gunEdit.santiyeId, bas, bit)}
                      />
                    </div>
                  );
                })()}

                {liste.length === 0 && (
                  <p className="text-sm text-gray-400 italic">Bu ay için atama yok.</p>
                )}

                {/* Bilgi Notu — kalıcı, ay-bağımsız. Kullanıcı silmedikçe her ay görünür */}
                <BilgiNotuKarti
                  personelId={gunEdit.personel.id}
                  santiyeId={gunEdit.santiyeId}
                  notlar={bilgiNotlari}
                  onKaydet={async (yeniNot) => {
                    try {
                      if (yeniNot.trim()) {
                        await setBilgiNotu(gunEdit.personel.id, gunEdit.santiyeId, yeniNot);
                        toast.success("Not kaydedildi");
                      } else {
                        await deleteBilgiNotu(gunEdit.personel.id, gunEdit.santiyeId);
                        toast.success("Not silindi");
                      }
                      setGunEdit(null); // Kaydet sonrası dialog'u kapat
                      await loadData();
                    } catch (err) {
                      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
                    }
                  }}
                />

                <div className="flex justify-end pt-2 border-t">
                  <Button variant="outline" onClick={() => setGunEdit(null)}>Kapat</Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Toplu Transfer Dialog */}
      <Dialog open={topluTransferAcik} onOpenChange={(o) => !o && setTopluTransferAcik(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Toplu Transfer ({selectedKeys.size} kişi)</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              Seçili personeller hangi şantiyeye transfer edilsin?
            </p>
            <div>
              <Label className="text-xs">Hedef Şantiye <span className="text-red-500">*</span></Label>
              <select
                value={topluTransferHedef}
                onChange={(e) => setTopluTransferHedef(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm"
              >
                <option value="">Şantiye seçin</option>
                {(() => {
                  // Şantiyeleri firma firma grupla → optgroup
                  const grup = new Map<string, typeof filtreliSantiyeler>();
                  for (const s of filtreliSantiyeler) {
                    const fId = s.yuklenici_firma_id || "__firmasiz__";
                    if (!grup.has(fId)) grup.set(fId, []);
                    grup.get(fId)!.push(s);
                  }
                  // Firma adına göre sıralı
                  const firmaIds = Array.from(grup.keys()).sort((a, b) => {
                    const fa = firmalar.find((f) => f.id === a)?.firma_adi ?? "Z";
                    const fb = firmalar.find((f) => f.id === b)?.firma_adi ?? "Z";
                    return fa.localeCompare(fb, "tr");
                  });
                  return firmaIds.map((fId) => {
                    const firma = firmalar.find((f) => f.id === fId);
                    const firmaAd = firma?.firma_adi ?? "(Firma atanmamış)";
                    return (
                      <optgroup key={fId} label={firmaAd}>
                        {grup.get(fId)!.map((s) => (
                          <option key={s.id} value={s.id}>{s.is_adi}</option>
                        ))}
                      </optgroup>
                    );
                  });
                })()}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setTopluTransferAcik(false)}>İptal</Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white"
                disabled={!topluTransferHedef || topluTransferIsleniyor}
                onClick={topluTransferYap}
              >
                {topluTransferIsleniyor ? "Transfer ediliyor..." : `Transfer Et (${selectedKeys.size})`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Toplu Çıkış Onayı */}
      <Dialog open={topluCikisOnay} onOpenChange={(o) => !o && setTopluCikisOnay(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Toplu İşten Çıkar</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">
            <span className="font-bold">{selectedKeys.size} kişi</span> işten çıkarılacak ve muhasebeye toplu mail kuyruğuna eklenecek. Onaylıyor musunuz?
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setTopluCikisOnay(false)}>İptal</Button>
            <Button variant="destructive" size="sm" disabled={topluCikisIsleniyor} onClick={topluCikarYap}>
              {topluCikisIsleniyor ? "İşleniyor..." : "Çıkar (Mail Kuyruğa)"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Çıkış Onayı + Tarih */}
      <Dialog open={!!cikisOnay} onOpenChange={(o) => !o && setCikisOnay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>İşten Çıkar</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              <span className="font-bold">{cikisOnay?.ad_soyad}</span> işten çıkarılacak.
            </p>
            <div>
              <Label className="text-xs">Çıkış Tarihi <span className="text-red-500">*</span></Label>
              {(() => {
                const today = new Date();
                const min = new Date(); min.setDate(min.getDate() - 10);
                const fmtIso = (d: Date) => d.toISOString().slice(0, 10);
                return (
                  <Input
                    type="date"
                    value={cikisTarih}
                    min={isYonetici ? undefined : fmtIso(min)}
                    max={isYonetici ? undefined : fmtIso(today)}
                    onChange={(e) => setCikisTarih(e.target.value)}
                  />
                );
              })()}
              <p className="text-[10px] text-gray-500 mt-0.5">
                {isYonetici
                  ? "🔓 Admin: istediğiniz tarihi girebilirsiniz."
                  : "Bugünden en fazla 10 gün geriye tarih girebilirsiniz."}
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setCikisOnay(null)}>İptal</Button>
              <Button variant="destructive" size="sm" onClick={cikisYap}>Çıkar + Mail Kuyruğa</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mail Önizleme + Gönder */}
      <Dialog open={mailDialogAcik} onOpenChange={setMailDialogAcik}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
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
                // Firma bazlı SMTP durumu — her firmanın kendi SMTP'si ile gönderim yapılır
                const firmaIdGruplari = new Map<string, number>();
                for (const p of pending) {
                  const k = p.firmaId || "__fallback__";
                  firmaIdGruplari.set(k, (firmaIdGruplari.get(k) ?? 0) + 1);
                }
                return (
                  <>
                    <div className="text-xs text-gray-500">
                      Alıcı: <span className="font-semibold text-gray-800">{muhasebeEmail || "(tanımsız!)"}</span>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 min-w-0">
                      <div className="text-[11px] font-semibold text-slate-700 mb-1.5">Gönderici Firmalar (her biri kendi SMTP'si ile gönderir):</div>
                      <ul className="space-y-1">
                        {Array.from(firmaIdGruplari).map(([fId, sayi]) => {
                          const firma = firmalar.find((f) => f.id === fId);
                          const firmaAd = firma?.firma_adi ?? (fId === "__fallback__" ? "(Firma atanmamış)" : "(silinmiş firma)");
                          const smtpOK = !!firma && !!firma.smtp_host && !!firma.smtp_user && !!firma.smtp_password;
                          return (
                            <li key={fId} className={`text-[11px] flex items-center gap-2 px-2 py-1 rounded ${smtpOK ? "bg-emerald-50" : "bg-red-50 border border-red-200"}`}>
                              <span className="font-semibold truncate min-w-0 flex-1" title={firmaAd}>
                                {smtpOK ? "✓" : "⚠️"} {firmaAd}
                              </span>
                              <span className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                                <span className={smtpOK ? "text-emerald-700" : "text-red-700"}>
                                  {smtpOK ? "SMTP hazır" : "SMTP eksik"}
                                </span>
                                <span className="text-gray-500">{sayi} kayıt</span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      {Array.from(firmaIdGruplari).some(([fId]) => {
                        const firma = firmalar.find((f) => f.id === fId);
                        return !firma || !firma.smtp_host || !firma.smtp_user || !firma.smtp_password;
                      }) && (
                        <p className="text-[10px] text-red-700 mt-2 leading-relaxed">
                          ⚠️ SMTP eksik firmalar için mail GÖNDERİLMEZ. Yönetim &gt; Firmalar sayfasından firmaların SMTP Host/User/Password/Port alanlarını doldurun ve tekrar deneyin.
                        </p>
                      )}
                    </div>
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
                        <li key={c.id} className="text-xs flex items-start gap-2 bg-white/70 rounded px-2 py-1.5 min-w-0">
                          <div className="flex-1 min-w-0 overflow-hidden">
                            <div className="font-semibold text-gray-800 truncate" title={c.personelAd}>{c.personelAd}</div>
                            <div className="text-gray-500 text-[10px] break-words">
                              {c.personelTc && <span className="font-mono">{c.personelTc}</span>}
                              {c.personelGorev && <span> · {c.personelGorev}</span>}
                              <br />
                              {c.tip === "transfer" ? (
                                <span><span className="text-red-600">{c.onceSantiyeAd ?? "—"}</span> <ArrowRight size={10} className="inline" /> <span className="text-emerald-700">{c.santiyeAd ?? "—"}</span></span>
                              ) : c.tip === "giris" ? (
                                <span className="text-emerald-700">{c.santiyeAd ?? "—"}</span>
                              ) : (
                                <span className="text-red-600">son: {c.onceSantiyeAd ?? "—"}</span>
                              )}
                              <span className="ml-1 text-gray-400">({c.tarih})</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => pendingSil(c.id)}
                            className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                            title="Bu satırı kuyruktan kaldır + DB geri al"
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
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t sticky bottom-0 bg-white">
                <Button variant="outline" size="sm" onClick={() => setMailDialogAcik(false)} className="flex-shrink-0">
                  İptal
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700 text-white flex-shrink-0 whitespace-nowrap"
                  onClick={bulkMailGonder}
                  disabled={mailGonderiliyor || !muhasebeEmail || firmalar.length === 0}
                >
                  <Send size={14} className="mr-1" />
                  {mailGonderiliyor ? "Gönderiliyor..." : "Mail Gönder"}
                </Button>
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
