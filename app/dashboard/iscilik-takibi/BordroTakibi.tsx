// Bordro Takibi — şantiye kanban + drag-drop personel transferi
"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
import { getIscilikTakibi, getTumIscilikAyliklari } from "@/lib/supabase/queries/iscilik-takibi";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { addPersonelSantiye } from "@/lib/supabase/queries/personel-santiye";
import {
  getTeknikPersonelKayitlari,
  setPersonelTeknikSantiye,
  type PersonelTeknikRow,
} from "@/lib/supabase/queries/personel-teknik";
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
import { filtreliSantiyeler as filtreliSantiyelerHelper } from "@/lib/utils/santiye-filtre";
import {
  getPendingMailler,
  insertPendingMail,
  deletePendingMail,
  deletePendingMailler,
  type BordroPendingDB,
} from "@/lib/supabase/queries/bordro-pending";
import type { Personel, PersonelAtamaGecmisi, PersonelAtamaManuelGun, PersonelBrutUcret } from "@/lib/supabase/types";
import { formatKisiAdi, trAramaNormalize } from "@/lib/utils/isim";

// Telefon formatlama: 0535 535 35 35
function formatTelefon(val: string): string {
  const digits = val.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

type SantiyeBasic = {
  id: string; is_adi: string; durum: string;
  gecici_kabul_tarihi?: string | null;
  kesin_kabul_tarihi?: string | null;
  tasfiye_tarihi?: string | null;
  devir_tarihi?: string | null;
  yuklenici_firma_id?: string | null;
  isyeri_teslim_tarihi?: string | null;
  teknik_personel_sayisi?: number | null;
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
  personelMeslek?: string;
  santiyeAd?: string;     // hedef şantiye (giriş/transfer)
  onceSantiyeAd?: string; // önceki şantiye (çıkış/transfer)
  tarih: string;          // YYYY-MM-DD
  // Mail bu firmadan gönderilir (giriş/transfer→hedef şantiyenin firması; çıkış→eski şantiyenin firması)
  firmaId?: string;
  // Mail önizlemesinde her satıra eklenebilen not (kırmızı renkte gönderilir)
  not?: string;
};

const PASIF_KEY = "__pasif__";
const ATANMAMIS_KEY = "__atanmamis__";
const PENDING_LS_KEY = "bordro-pending-changes";

function su_an_ay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// YEREL tarihi YYYY-MM-DD'ye çevir — toISOString() UTC verir, gece kayması olur.
function tarihStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function yerelBugun(): string {
  return tarihStr(new Date());
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

// Atama satır editörü (gün düzenle dialogu için)
function AtamaSatir({
  atama, gunSayisi, onSave, onDelete, isYonetici,
}: {
  atama: PersonelAtamaGecmisi;
  gunSayisi: number;
  onSave: (baslangic: string, bitis: string | null) => void;
  onDelete: () => void;
  // Yönetici → tarihte kısıtlama yok. Diğerleri (şantiye yöneticisi dahil): max bugün, min bugünden 9 gün önce.
  isYonetici: boolean;
}) {
  const [bas, setBas] = useState(atama.baslangic_tarihi);
  const [bit, setBit] = useState(atama.bitis_tarihi ?? "");
  const [halen, setHalen] = useState(atama.bitis_tarihi == null);
  const degisti = bas !== atama.baslangic_tarihi
    || (halen ? atama.bitis_tarihi !== null : bit !== (atama.bitis_tarihi ?? ""));
  // Çıkış tarihi başlangıçtan önce olamaz
  const tarihHatasi = !halen && bit && bas && bit < bas;
  const kaydedilebilir = degisti && !tarihHatasi;
  // Yönetici hariç tüm kullanıcılar için tarih kısıtlaması: bugünden max 9 gün geri, bugünden ileri yok
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = tarihStr(today);
  const minDate = new Date(today); minDate.setDate(minDate.getDate() - 9);
  const minDateStr = tarihStr(minDate);
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-[10px] text-gray-500">İşe Başlama</label>
          <input type="date" value={bas} onChange={(e) => setBas(e.target.value)}
            min={isYonetici ? undefined : minDateStr}
            max={isYonetici ? undefined : todayStr}
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
            min={isYonetici ? (bas || undefined) : (bas && bas > minDateStr ? bas : minDateStr)}
            max={isYonetici ? undefined : todayStr}
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
  defaultBaslangic, defaultBitis, onEkle, isYonetici,
}: {
  defaultBaslangic: string;
  defaultBitis: string;
  onEkle: (baslangic: string, bitis: string | null) => void;
  isYonetici: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const [bas, setBas] = useState(defaultBaslangic);
  const [bit, setBit] = useState(defaultBitis);
  const [halen, setHalen] = useState(false);
  // Çıkış tarihi başlangıçtan önce olamaz
  const tarihHatasi = !halen && bit && bas && bit < bas;
  // Yönetici hariç tarih kısıtlaması
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayStr = tarihStr(today);
  const minDate = new Date(today); minDate.setDate(minDate.getDate() - 9);
  const minDateStr = tarihStr(minDate);
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
            min={isYonetici ? undefined : minDateStr}
            max={isYonetici ? undefined : todayStr}
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
            min={isYonetici ? (bas || undefined) : (bas && bas > minDateStr ? bas : minDateStr)}
            max={isYonetici ? undefined : todayStr}
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

// Atama listesi — şantiye-bazlı atamaları gösterir.
// Varsayılan: en yeni 2 tanesini gösterir. Daha fazlası varsa "Devamını Gör" butonu çıkar.
function AtamaListesi({
  atamalar, liste, ayInGun, onSave, onDelete, isYonetici,
}: {
  atamalar: PersonelAtamaGecmisi[];
  liste: PersonelAtamaGecmisi[];
  ayInGun: (a: PersonelAtamaGecmisi) => number;
  onSave: (atamaId: string, baslangic: string, bitis: string | null) => void;
  onDelete: (atamaId: string) => void;
  isYonetici: boolean;
}) {
  const [hepsiniGoster, setHepsiniGoster] = useState(false);
  const VARSAYILAN_LIMIT = 2;
  const gosterilenler = hepsiniGoster ? atamalar : atamalar.slice(0, VARSAYILAN_LIMIT);
  const gizliSayi = Math.max(0, atamalar.length - VARSAYILAN_LIMIT);
  return (
    <div className="border-2 border-gray-200 rounded-lg p-3 bg-gray-50 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-gray-700">📅 Giriş / Çıkış Tarihleri</div>
        <span className="text-[10px] text-gray-500">{atamalar.length} atama</span>
      </div>
      {atamalar.length === 0 && (
        <p className="text-xs text-gray-400 italic">Bu şantiyede henüz atama yok. Aşağıdan yeni atama ekleyebilirsiniz.</p>
      )}
      {gosterilenler.map((a) => {
        const cakisanAyDa = liste.find((l) => l.id === a.id);
        const aylikGun = cakisanAyDa ? ayInGun(a) : 0;
        return (
          <AtamaSatir
            key={a.id}
            atama={a}
            gunSayisi={aylikGun}
            onSave={(bas, bit) => onSave(a.id, bas, bit)}
            onDelete={() => onDelete(a.id)}
            isYonetici={isYonetici}
          />
        );
      })}
      {gizliSayi > 0 && (
        <button
          type="button"
          onClick={() => setHepsiniGoster((v) => !v)}
          className="w-full text-xs py-2 rounded-lg border border-dashed border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 font-semibold"
        >
          {hepsiniGoster ? "▲ Daha Az Göster" : `▼ Devamını Gör (${gizliSayi} atama daha)`}
        </button>
      )}
    </div>
  );
}

export default function BordroTakibi() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  // Modül yetkileri (bordro-takibi modülü): ekle / duzenle / sil
  const yEkle = hasPermission("bordro-takibi", "ekle");
  const yDuzenle = hasPermission("bordro-takibi", "duzenle");
  const ySil = hasPermission("bordro-takibi", "sil");
  const [loading, setLoading] = useState(true);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [personeller, setPersoneller] = useState<Personel[]>([]);
  const [atamalar, setAtamalar] = useState<PersonelAtamaGecmisi[]>([]);
  const [manuelGunler, setManuelGunler] = useState<PersonelAtamaManuelGun[]>([]);
  const [bilgiNotlari, setBilgiNotlari] = useState<BilgiNotu[]>([]);
  // Personel × Şantiye bazlı teknik personel kayıtları (sadece bilgi amaçlı rozet için)
  const [teknikKayitlari, setTeknikKayitlari] = useState<PersonelTeknikRow[]>([]);
  const [gunlukUcretler, setGunlukUcretler] = useState<GunlukUcret[]>([]);
  const [brutUcretGecmisi, setBrutUcretGecmisi] = useState<PersonelBrutUcret[]>([]);
  // Şantiye bazlı prim bilgisi: santiye_id → { yatmasiGereken, yatan, sonAy }
  // Accordion başlığında "yatması gereken - yatan - bordro tahmini = sonuç" göstermek için.
  const [primMap, setPrimMap] = useState<Map<string, { yatmasiGereken: number; yatan: number; sonAy: string | null }>>(new Map());
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [muhasebeEmail, setMuhasebeEmail] = useState<string>("");
  const [gorevSecenekleri, setGorevSecenekleri] = useState<string[]>([]);
  const [meslekSecenekleri, setMeslekSecenekleri] = useState<string[]>([]);
  const [arama, setArama] = useState("");
  // Personel tipi filtresi: "tumu" | "teknik" — yalnız teknik personeli süzmek için
  const [tipFiltre, setTipFiltre] = useState<"tumu" | "teknik">("tumu");

  // Drag state
  const [dragPersonelId, setDragPersonelId] = useState<string | null>(null);
  // Drag başlatılan kaynak şantiye id — drag-to-PASIF işleminde sadece bu atama kapatılsın
  const [dragSourceSantiyeId, setDragSourceSantiyeId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // Ekle dialog (sadeleştirildi: ad soyad + TC + görev select + şantiye select + tarih)
  const [ekleAcik, setEkleAcik] = useState(false);
  const [ekleAd, setEkleAd] = useState("");
  const [ekleTc, setEkleTc] = useState("");
  const [ekleGorev, setEkleGorev] = useState("");
  const [ekleMeslek, setEkleMeslek] = useState("");
  const [ekleSantiye, setEkleSantiye] = useState("");
  const [ekleTarih, setEkleTarih] = useState(() => yerelBugun());
  const [ekleCepTelefon, setEkleCepTelefon] = useState("");
  // Ekleme sırasında teknik personel mi sorusu — sadece personel_teknik tablosuna kayıt için.
  // Atamalara, giriş/çıkış tarihlerine etkisi yoktur.
  const [ekleTeknik, setEkleTeknik] = useState(false);
  const [kaydetYukleniyor, setKaydetYukleniyor] = useState(false);

  // Çıkış onayı + çıkış tarihi
  // İşten çıkış onayı: ŞANTİYE BAZLI — sadece o atamayı kapatır.
  // Aynı personel başka şantiyelerde aktif kalır.
  const [cikisOnay, setCikisOnay] = useState<{ personel: Personel; santiyeId: string } | null>(null);
  const [cikisTarih, setCikisTarih] = useState<string>(() => yerelBugun());

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
  // Toplu transfer tarihi — admin: serbest, diğer: bugünden 9 gün geriye
  const [topluTransferTarih, setTopluTransferTarih] = useState(() => yerelBugun());
  const [topluCikisOnay, setTopluCikisOnay] = useState(false);
  const [topluCikisIsleniyor, setTopluCikisIsleniyor] = useState(false);
  // Toplu çıkış tarihi — admin: serbest, diğer: bugünden 9 gün geriye
  const [topluCikisTarih, setTopluCikisTarih] = useState(() => yerelBugun());

  // Toplu personel ekleme dialog: şantiye sütununun + butonu
  const [topluEkleSantiyeId, setTopluEkleSantiyeId] = useState<string | null>(null);
  const [topluSecilenler, setTopluSecilenler] = useState<Set<string>>(new Set());
  const [topluArama, setTopluArama] = useState("");
  const [topluTarih, setTopluTarih] = useState(() => yerelBugun());
  // Teknik personel onayı: yeni iş eklendiğinde, kota dolmadan eklenen kişiler için soru dialogu
  // resolve callback'i ile Promise tabanlı çalışıyor → topluPersonelEkle bekler.
  const [teknikSorusu, setTeknikSorusu] = useState<{
    santiyeAd: string;
    teslimTarihi: string;
    teknikSayisi: number;
    kalanSlot: number;
    eklenecekKisiSayisi: number;
    // Eklenecek kişilerin isim listesi (seçim sırasına göre)
    kisiAdlari: string[];
    resolve: (cevap: "evet" | "hayir" | "iptal") => void;
  } | null>(null);
  const [topluEkleniyor, setTopluEkleniyor] = useState(false);

  // Ay seçici (default: bu ay). Tüm aylar düzenlenebilir — kullanıcı geçmiş ve gelecek
  // ayların kayıtları üzerinde de işlem yapabilir.
  const [seciliAy, setSeciliAy] = useState<string>(su_an_ay);
  const buAy = su_an_ay();
  // Sadece görüntüleme yetkisi olan kullanıcılar için tüm yazma aksiyonları kapalı
  // (drag-drop, çift tıkla gün düzenle, sil/geri al butonları, plus butonları)
  const isReadOnly = !yEkle && !yDuzenle && !ySil;

  // Bekleyen değişiklikler — mail kuyruğu (DB'de paylaşımlı, tüm adminler aynı kuyruğu görür)
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [mailDialogAcik, setMailDialogAcik] = useState(false);
  const [mailGonderiliyor, setMailGonderiliyor] = useState(false);
  const [ekMailNotu, setEkMailNotu] = useState("");
  // Her pending kayıt için ek not (mailde kırmızı renkle satırın altında çıkar)
  // Kalıcı değil — mail gönderildikten sonra temizlenir.
  const [satirNotlari, setSatirNotlari] = useState<Record<string, string>>({});

  // DB row → PendingChange dönüşümü (UI tarafı kayıt yapısı koruyor)
  const dbRowToPending = (r: BordroPendingDB): PendingChange => ({
    id: r.id,
    tip: r.tip,
    personelAd: r.personel_ad,
    personelTc: r.personel_tc ?? undefined,
    personelGorev: r.personel_gorev ?? undefined,
    personelMeslek: r.personel_meslek ?? undefined,
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

  // loadData ref — daha aşağıda tanımlanan loadData'yı focus listener içinden çağırabilmek için
  const loadDataRef = useRef<(() => void) | null>(null);

  // İlk yüklemede + her 30 saniyede bir yenile (diğer adminlerin işlemleri görünsün)
  useEffect(() => {
    refreshPending();
    const intv = setInterval(refreshPending, 30_000);
    // Sekme tekrar fokuslanınca pending kuyruğunu + tüm sayfa verisini (santiye, atama, brüt vs.)
    // tazele. Kullanıcı başka sekmede şantiye düzenleyip dönerse veriler otomatik yenilenir.
    const onFocus = () => {
      refreshPending();
      loadDataRef.current?.();
    };
    window.addEventListener("focus", onFocus);
    // Mobile için: sayfa visibility değiştiğinde de yenile (focus eventi mobilde yetersiz olabilir)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshPending();
        loadDataRef.current?.();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(intv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
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
            personel_meslek: p.personelMeslek ?? null,
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
      const todayKey = tarihStr(now);
      const lastSentKey = localStorage.getItem("bordro-auto-mail-tarih");
      // Bugün zaten otomatik gönderilmişse skip
      if (lastSentKey === todayKey) return;
      // 17:00 (saat 17, dakika 0+) tetikleyici — 17:00–17:05 aralığında yakala
      if (now.getHours() === 17 && now.getMinutes() < 5) {
        if (!muhasebeEmail || firmalar.length === 0) return;
        localStorage.setItem("bordro-auto-mail-tarih", todayKey); // duplicate önle
        try {
          await bulkMailGonder();
          toast.success("⏰ 17:00 otomatik mail gönderimi tamamlandı", { duration: 5000 });
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
      personel_meslek: p.personelMeslek ?? null,
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
        { duration: 5000 },
      );
    }
  }

  // İlk yüklemeden sonra loadData spinner göstermez — kanban mevcut yerinde kalır,
  // arka planda data tazelenir, scroll sıfırlanmaz.
  const ilkYuklemeYapildi = useRef(false);
  const loadData = useCallback(async () => {
    if (!ilkYuklemeYapildi.current) {
      setLoading(true);
    }
    try {
      const [s, p, a, m, f, iscilik, gorevler, meslekler, mGunler, notlar, ucretler, brutGecmis, ayliklar, teknikRows] = await Promise.all([
        getSantiyelerAll().catch(() => []),
        getBordroPersoneller().catch(() => []),
        getAtamaGecmisiTumu().catch(() => []),
        getDegerler("muhasebe_email").catch(() => []),
        getFirmalar().catch(() => []),
        getIscilikTakibi(false).catch(() => [] as { santiye_id: string; santiyeler?: SantiyeBasic | null }[]),
        getDegerler("personel_gorev").catch(() => []),
        getDegerler("personel_meslek").catch(() => []),
        getManuelGunler().catch(() => []),
        getBilgiNotlari().catch(() => []),
        getGunlukUcretler().catch(() => []),
        getTumPersonelBrutUcretler().catch(() => [] as PersonelBrutUcret[]),
        getTumIscilikAyliklari().catch(() => [] as { iscilik_takibi_id: string; ait_oldugu_ay: string }[]),
        getTeknikPersonelKayitlari().catch(() => [] as PersonelTeknikRow[]),
      ]);
      setGorevSecenekleri(gorevler ?? []);
      setMeslekSecenekleri(meslekler ?? []);
      setManuelGunler(mGunler);
      setBilgiNotlari(notlar);
      setGunlukUcretler(ucretler);
      setTeknikKayitlari(teknikRows);
      setBrutUcretGecmisi(brutGecmis);
      // İşçilik Durum Raporu'ndaki filtreyle BİREBİR AYNI + firma_id mapleme.
      const iscilikRaporSantiyeIds = new Set<string>();
      const firmaIdMap = new Map<string, string>(); // santiye_id → firma_id
      // Prim hesabı için santiye_id → { yatmasiGereken, yatan, sonAy } map'i
      // Aynı şantiyenin birden fazla iscilik_takibi kaydı olabilir → toplam alınır.
      const primInfo = new Map<string, { yatmasiGereken: number; yatan: number; sonAyNum: number; sonAy: string | null }>();
      // ait_oldugu_ay "MM.YYYY" → numerik karşılaştırma için YYYYMM
      const ayYilNum = (s: string): number => {
        if (!s) return 0;
        const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
        if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
        const iso = s.match(/^(\d{4})-(\d{2})/);
        if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
        return 0;
      };
      // iscilik_takibi_id → en son ait_oldugu_ay
      const sonAyByTakibi = new Map<string, string>();
      for (const ay of (ayliklar as { iscilik_takibi_id: string; ait_oldugu_ay: string }[]) ?? []) {
        const mevcut = sonAyByTakibi.get(ay.iscilik_takibi_id);
        if (!mevcut || ayYilNum(ay.ait_oldugu_ay) > ayYilNum(mevcut)) {
          sonAyByTakibi.set(ay.iscilik_takibi_id, ay.ait_oldugu_ay);
        }
      }
      for (const r of (iscilik as { id: string; santiye_id: string; kesif_artisi: number | null; fiyat_farki: number | null; iscilik_orani: number | null; yatan_prim: number | null; santiyeler?: (SantiyeBasic & { sozlesme_bedeli?: number | null }) | null }[]) ?? []) {
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
          // Prim hesapla: yatması gereken = (sözleşme bedeli + keşif + ff) × oran / 100
          const bedel = sant?.sozlesme_bedeli ?? 0;
          const kesif = r.kesif_artisi ?? 0;
          const ff = r.fiyat_farki ?? 0;
          const oran = r.iscilik_orani ?? 0;
          const yatacak = (bedel + kesif + ff) * oran / 100;
          const yatan = r.yatan_prim ?? 0;
          const sonAy = sonAyByTakibi.get(r.id) ?? null;
          const sonAyN = sonAy ? ayYilNum(sonAy) : 0;
          const mevcut = primInfo.get(r.santiye_id);
          if (mevcut) {
            mevcut.yatmasiGereken += yatacak;
            mevcut.yatan += yatan;
            // Birden fazla takibi varsa max sonAyNum'u tut
            if (sonAyN > mevcut.sonAyNum) {
              mevcut.sonAyNum = sonAyN;
              mevcut.sonAy = sonAy;
            }
          } else {
            primInfo.set(r.santiye_id, { yatmasiGereken: yatacak, yatan, sonAyNum: sonAyN, sonAy });
          }
        }
      }
      // Final map: sonAyNum'u dışarı taşımadan sadece görünen alanları sakla
      const finalPrimMap = new Map<string, { yatmasiGereken: number; yatan: number; sonAy: string | null }>();
      for (const [k, v] of primInfo) {
        finalPrimMap.set(k, { yatmasiGereken: v.yatmasiGereken, yatan: v.yatan, sonAy: v.sonAy });
      }
      setPrimMap(finalPrimMap);
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
      ilkYuklemeYapildi.current = true;
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // loadData'yı ref'e bağla — focus/visibility listener'larından çağrılabilsin
  useEffect(() => { loadDataRef.current = loadData; }, [loadData]);

  // Yetki bazlı şantiye filtresi:
  // - Yönetici: tüm şantiyeler
  // - Şantiye admini / Kısıtlı: sadece atandığı şantiye(ler)
  const filtreliSantiyeler = useMemo(
    () => filtreliSantiyelerHelper(santiyeler, kullanici),
    [santiyeler, kullanici],
  );

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

  // Personel başına AYLIK TOPLAM gün (tüm şantiyelerde): 30 üzeri uyarı için kullanılır.
  // Sadece bilgi amaçlı; hiçbir işleme etkisi yok.
  const personelAylikToplamMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [pid, sMap] of gunMap) {
      let toplam = 0;
      for (const v of sMap.values()) toplam += v;
      map.set(pid, toplam);
    }
    return map;
  }, [gunMap]);

  // Teknik personel tespiti — PERSONEL × ŞANTİYE BAZLI (sadece bilgi amaçlı rozet için).
  //   teknikPersonelMap.get(personelId) → Set<santiyeId>
  // Veri kaynağı: personel_teknik tablosu (manuel toggle ile yönetilir).
  //   - is_teknik=true  satırı → AÇIKÇA teknik
  //   - is_teknik=false satırı → AÇIKÇA teknik DEĞİL (fallback'i ezer)
  //   - Satır yok       → eski atama-bazlı FALLBACK uygulanır
  // ATAMALARA, GİRİŞ/ÇIKIŞ TARİHLERİNE VEYA GÜN HESABINA HİÇBİR ETKİSİ YOKTUR.
  const teknikPersonelMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const ekle = (pId: string, sId: string) => {
      if (!map.has(pId)) map.set(pId, new Set());
      map.get(pId)!.add(sId);
    };
    // Açık satırları topla: key="pId|sId" → is_teknik
    const explicitMap = new Map<string, boolean>();
    for (const r of teknikKayitlari) {
      explicitMap.set(`${r.personel_id}|${r.santiye_id}`, r.is_teknik);
    }
    // Önce explicit pozitifleri ekle
    for (const [key, isTeknik] of explicitMap) {
      if (!isTeknik) continue;
      const [pId, sId] = key.split("|");
      ekle(pId, sId);
    }
    // Fallback: explicit satırı OLMAYAN (personel, şantiye) çiftleri için
    // eski atama-bazlı tespit uygulanır
    const santiyeMap = new Map<string, string | null>();
    for (const s of santiyeler) santiyeMap.set(s.id, s.isyeri_teslim_tarihi ?? null);
    for (const a of atamalar) {
      if (a.bitis_tarihi) continue;
      const key = `${a.personel_id}|${a.santiye_id}`;
      if (explicitMap.has(key)) continue; // açıkça işaretliyse (true ya da false), fallback atla
      if (a.is_teknik === true) { ekle(a.personel_id, a.santiye_id); continue; }
      if (a.is_teknik === undefined || a.is_teknik === null) {
        const teslim = santiyeMap.get(a.santiye_id);
        if (teslim && a.baslangic_tarihi === teslim) ekle(a.personel_id, a.santiye_id);
      }
    }
    return map;
  }, [teknikKayitlari, atamalar, santiyeler]);

  // Personel'in HERHANGİ bir şantiyede teknik olup olmadığı (arama/filtre için)
  const teknikPersonelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [pId, set] of teknikPersonelMap) {
      if (set.size > 0) ids.add(pId);
    }
    return ids;
  }, [teknikPersonelMap]);

  // Bir şantiyede şu anda kaç AKTİF teknik personel var?
  // = teknik_personel_sayisi alanına göre "kapasite" dolu mu kontrolü için.
  // Personel hem teknik işaretli OLMALI hem de o şantiyede bitiş_tarihi=null aktif atamaya sahip OLMALI.
  const aktifTeknikSayisiMap = useMemo(() => {
    const aktifAtamaSet = new Set<string>(); // "pId|sId" — aktif atamalı
    for (const a of atamalar) {
      if (!a.bitis_tarihi) aktifAtamaSet.add(`${a.personel_id}|${a.santiye_id}`);
    }
    const map = new Map<string, number>();
    for (const [pId, set] of teknikPersonelMap) {
      for (const sId of set) {
        if (!aktifAtamaSet.has(`${pId}|${sId}`)) continue;
        map.set(sId, (map.get(sId) ?? 0) + 1);
      }
    }
    return map;
  }, [teknikPersonelMap, atamalar]);

  // Bir şantiyede teknik personel kalan kontenjanı: target - mevcut.
  // Kullanım: ekle dialog'da "Teknik Personel mi?" sorusunu göstermek için.
  const teknikKalanSlot = useCallback((santiyeId: string): number => {
    const santiye = santiyeler.find((s) => s.id === santiyeId);
    if (!santiye) return 0;
    const target = santiye.teknik_personel_sayisi ?? 0;
    if (target <= 0) return 0;
    const mevcut = aktifTeknikSayisiMap.get(santiyeId) ?? 0;
    return Math.max(0, target - mevcut);
  }, [santiyeler, aktifTeknikSayisiMap]);

  // Filtrele: arama (Türkçe karakter ve büyük/küçük harf duyarlılığı YOK)
  // SADECE şu kelimelerden biri tam olarak yazıldıysa teknik filtresi aktif:
  //   "teknik" veya "teknik personel"
  // Aksi halde normal metin araması (ad, TC, görev, meslek içinde geçen kelime)
  const filtreli = useMemo(() => {
    const q = trAramaNormalize(arama);
    const teknikKelimeleri = new Set([
      trAramaNormalize("teknik"),
      trAramaNormalize("teknik personel"),
      trAramaNormalize("teknikpersonel"),
    ]);
    const qTeknikMi = q.length > 0 && teknikKelimeleri.has(q);
    return personeller.filter((p) => {
      const isTeknik = teknikPersonelIds.has(p.id);
      if (tipFiltre === "teknik" && !isTeknik) return false;
      if (!q) return true;
      // "teknik" veya "teknik personel" tam yazıldıysa → sadece teknik personelleri getir
      if (qTeknikMi) return isTeknik;
      // Normal metin araması: ad, TC, görev, meslek içinde geçer mi?
      const text = trAramaNormalize([p.ad_soyad, p.tc_kimlik_no, p.gorev, p.meslek].filter(Boolean).join(" "));
      return text.includes(q);
    });
  }, [personeller, arama, tipFiltre, teknikPersonelIds]);

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

    // Yetki bazlı: kısıtlı/şantiye admini sadece kendi şantiyelerindeki personelleri görür
    // Yönetici: tüm şantiyeler izinli
    const izinliSantiyeIds = new Set(filtreliSantiyeler.map((s) => s.id));

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
        // Geçmişte atama vardı mı? — sadece izinli şantiyelerdeki atamaları say
        // (Aksi halde kısıtlı kullanıcı, başka şantiyelerdeki personeli PASİF'te görür)
        const izinliAtamalari = tumAtamalari.filter((a) => izinliSantiyeIds.has(a.santiye_id));
        if (izinliAtamalari.length > 0) {
          // Kullanıcının izinli şantiyelerinden geçmiş, şu an aktif değil → PASIF
          map.get(PASIF_KEY)!.push(p);
        } else if (tumAtamalari.length === 0) {
          // Hiç atama yok → ATANMAMIŞ (yeni kayıt veya hiç bordroya alınmamış)
          map.get(ATANMAMIS_KEY)!.push(p);
        }
        // Aksi halde: bu personel başka şantiyelere ait, kullanıcıya gösterme
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
    // DB'ye yazılan ASIL tarih — backdated (eski tarihli) işlemlerde verilir.
    // Bu tarih revert sırasında DB satırını bulmak için kullanılır.
    // Verilmezse bugünün tarihi kullanılır.
    // Transfer için: bu giriş tarihi (yeni şantiyeye giriş).
    tarih?: string;
    // Transfer farklı firmalar arası ise, eski firmadaki ÇIKIŞ tarihi.
    // Verilmezse `tarih` kullanılır (eski davranış).
    cikisTarih?: string;
  }) {
    const tarih = payload.tarih ?? yerelBugun();
    const cikisTarih = payload.cikisTarih ?? tarih;

    // Push bildirim — diğer admin'lere/yetkililere "bu işlem yapıldı" bilgisini ver.
    // Tag: "bordro-takibi". Tıklayınca bordro takibi sayfasına götürür.
    try {
      // Async import — sayfada extra bağımlılık yaratmasın
      import("@/lib/bildirim").then(({ bildirimGonder }) => {
        const tipLabel = payload.tip === "giris" ? "🟢 İşe Giriş"
          : payload.tip === "cikis" ? "🔴 İşten Çıkış"
          : "🔄 Şantiye Transferi";
        let govde = payload.personel.ad_soyad;
        if (payload.tip === "transfer" && payload.onceSantiyeAd && payload.santiyeAd) {
          govde += ` · ${payload.onceSantiyeAd} → ${payload.santiyeAd}`;
        } else if (payload.santiyeAd) {
          govde += ` · ${payload.santiyeAd}`;
        } else if (payload.onceSantiyeAd) {
          govde += ` · ${payload.onceSantiyeAd}`;
        }
        bildirimGonder({
          baslik: `${tipLabel} — Bordro Takibi`,
          govde: govde.slice(0, 150),
          url: "/dashboard/bordro-takibi",
          tag: "bordro-takibi",
          santiye_id: payload.santiyeId ?? payload.onceSantiyeId ?? null,
        });
      }).catch(() => { /* sessiz */ });
    } catch { /* sessiz */ }

    const baseFields = {
      personelAd: payload.personel.ad_soyad,
      personelTc: payload.personel.tc_kimlik_no,
      // Görev alanı bordroda gösterilmez/iletilmez — sadece meslek kullanılır
      personelGorev: undefined,
      personelMeslek: payload.personel.meslek ?? undefined,
      tarih,
    };

    if (payload.tip === "transfer") {
      const eskiFirmaId = firmaIdFromSantiyeId(payload.onceSantiyeId)
        ?? firmaIdFromSantiyeAd(payload.onceSantiyeAd);
      const yeniFirmaId = firmaIdFromSantiyeId(payload.santiyeId)
        ?? firmaIdFromSantiyeAd(payload.santiyeAd);

      if (eskiFirmaId && yeniFirmaId && eskiFirmaId !== yeniFirmaId) {
        // FARKLI FİRMA → 2 ayrı kayıt (her birinin kendi tarihi)
        // Eski firma muhasebesine ÇIKIŞ maili — çıkış tarihi
        pendingEkle({
          ...baseFields,
          tarih: cikisTarih,
          tip: "cikis",
          onceSantiyeAd: payload.onceSantiyeAd,
          firmaId: eskiFirmaId,
        });
        // Yeni firma muhasebesine GİRİŞ maili — giriş tarihi (çıkış+1 ya da bugün)
        pendingEkle({
          ...baseFields,
          tarih, // giriş tarihi
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
      // Her satıra varsa kullanıcının yazdığı notu iliştir (mailde kırmızı çıkacak)
      const notu = (satirNotlari[p.id] ?? "").trim();
      const enriched: PendingChange = notu ? { ...p, not: notu } : p;
      const k = p.firmaId || FALLBACK_KEY;
      if (!grup.has(k)) grup.set(k, []);
      grup.get(k)!.push(enriched);
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
          { duration: 5000 },
        );
      }
      if (hataMesajlari.length > 0) {
        toast.error(hataMesajlari[0], { duration: 5000 });
      }
      // Sadece BAŞARILI gönderilenleri kuyruktan çıkar (DB + yerel)
      if (basari > 0) {
        const ids = Array.from(basariliKeys).filter((id) => !id.startsWith("temp-"));
        deletePendingMailler(ids).catch(() => { /* sessiz — bir sonraki refresh düzeltir */ });
        setPending((prev) => prev.filter((p) => !basariliKeys.has(p.id)));
        // Gönderilmiş kayıtların satır notlarını sil
        setSatirNotlari((prev) => {
          const next = { ...prev };
          for (const id of basariliKeys) delete next[id];
          return next;
        });
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
  // Şantiye bazlı bordro tahmini: işçilik takibinde yatan_prim altındaki silik gri rakamla AYNI mantık.
  // sonAy'dan sonraki ayların (manuel + doğal atama gün) × ücret toplamı.
  function bordroToplamForSantiye(santiyeId: string): number {
    const ayYilNum = (s: string): number => {
      if (!s) return 0;
      const mm = s.match(/^(\d{1,2})\.(\d{4})$/);
      if (mm) return parseInt(mm[2]) * 100 + parseInt(mm[1]);
      const iso = s.match(/^(\d{4})-(\d{2})/);
      if (iso) return parseInt(iso[1]) * 100 + parseInt(iso[2]);
      return 0;
    };
    const sonAy = primMap.get(santiyeId)?.sonAy ?? null;
    const sonAyNum = sonAy ? ayYilNum(sonAy) : 0;
    const dahilEdilen = new Set<string>();
    let toplam = 0;
    const personelUcret = (personelId: string, ayStr: string, yil: number): number => {
      const brut = brutUcretForAy(brutUcretGecmisi, personelId, ayStr);
      if (brut > 0) return brut;
      return gunlukUcretler.find((u) => u.yil === yil)?.ucret ?? 0;
    };
    // 1) Manuel girişler — sonAy sonrası
    for (const m of manuelGunler) {
      if (m.santiye_id !== santiyeId) continue;
      const mAyNum = ayYilNum(m.ay);
      if (sonAyNum > 0 && mAyNum <= sonAyNum) continue;
      const yil = parseInt(m.ay.split("-")[0], 10);
      const ucret = personelUcret(m.personel_id, m.ay, yil);
      if (ucret > 0) {
        toplam += m.gun * ucret;
        dahilEdilen.add(`${m.personel_id}|${m.ay}`);
      }
    }
    // 2) Doğal hesap — sonAy sonrası ve manuel girilmemiş aylar
    const santiyeAtamalari = atamalar.filter((a) => a.santiye_id === santiyeId);
    if (santiyeAtamalari.length === 0) return toplam;
    const bugun = new Date();
    const buYilAy = `${bugun.getFullYear()}-${String(bugun.getMonth() + 1).padStart(2, "0")}`;
    const buYilAyNum = ayYilNum(buYilAy);
    if (buYilAyNum <= sonAyNum) return toplam;
    const baslangic = sonAyNum > 0 ? sonAyNum + 1 : (() => {
      let enErken = Infinity;
      for (const a of santiyeAtamalari) {
        const aNum = ayYilNum(a.baslangic_tarihi.slice(0, 7));
        if (aNum < enErken) enErken = aNum;
      }
      return enErken === Infinity ? buYilAyNum : enErken;
    })();
    let yil = Math.floor(baslangic / 100);
    let ay = baslangic % 100;
    if (ay === 0) { yil -= 1; ay = 12; }
    while (yil * 100 + ay <= buYilAyNum) {
      const ayStr = `${yil}-${String(ay).padStart(2, "0")}`;
      // gunHesaplaAyBazli benzeri: iscilik-takibi/page.tsx'teki gibi tek tek hesap
      // Burada inline yapıyoruz — atama tarih aralığını bu ay ile clamp et.
      const [yLs, mLs] = [yil, ay];
      const ayBaslangic = `${yLs}-${String(mLs).padStart(2, "0")}-01`;
      const sonGun = new Date(yLs, mLs, 0).getDate();
      const ayBitis = `${yLs}-${String(mLs).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
      const today = yerelBugun();
      const aktifSanal = today >= ayBaslangic && today <= ayBitis ? today : ayBitis;
      // Personel × ay bazında gün topla
      const ayHesap = new Map<string, number>();
      for (const at of santiyeAtamalari) {
        const bH = at.bitis_tarihi ?? aktifSanal;
        if (at.baslangic_tarihi > ayBitis) continue;
        if (bH < ayBaslangic) continue;
        const cb = at.baslangic_tarihi > ayBaslangic ? at.baslangic_tarihi : ayBaslangic;
        const cbt = bH < ayBitis ? bH : ayBitis;
        const ta = new Date(cb + "T00:00:00").getTime();
        const tb = new Date(cbt + "T00:00:00").getTime();
        const gun = Math.max(0, Math.round((tb - ta) / 86400000) + 1);
        ayHesap.set(at.personel_id, (ayHesap.get(at.personel_id) ?? 0) + gun);
      }
      for (const [pId, gun] of ayHesap) {
        if (gun <= 0) continue;
        if (dahilEdilen.has(`${pId}|${ayStr}`)) continue;
        const ucret = personelUcret(pId, ayStr, yil);
        if (ucret > 0) toplam += gun * ucret;
      }
      ay += 1;
      if (ay > 12) { ay = 1; yil += 1; }
    }
    return toplam;
  }

  async function gunEditAtamaUpdate(atamaId: string, baslangic: string, bitis: string | null) {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (bitis && bitis < baslangic) {
      toast.error("İşten çıkış tarihi, işe başlama tarihinden önce olamaz.");
      return;
    }
    // Yönetici hariç: bugünden max 9 gün geri, gelecek tarih yok
    if (!isYonetici) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayStr = tarihStr(today);
      const minDate = new Date(today); minDate.setDate(minDate.getDate() - 9);
      const minDateStr = tarihStr(minDate);
      if (baslangic > todayStr || (bitis && bitis > todayStr)) {
        toast.error("Gelecek tarih girilemez.");
        return;
      }
      if (baslangic < minDateStr || (bitis && bitis < minDateStr)) {
        toast.error("En fazla 9 gün geriye tarih girilebilir. Daha eski tarihler için yöneticinize başvurun.");
        return;
      }
    }
    try {
      // Mail kuyruğu mantığı için ESKİ haline bak
      const eskiAtama = atamalar.find((a) => a.id === atamaId);
      const personel = eskiAtama ? personeller.find((p) => p.id === eskiAtama.personel_id) : undefined;
      const santiyeAd = eskiAtama ? santiyeler.find((s) => s.id === eskiAtama.santiye_id)?.is_adi : undefined;

      await updateAtama(atamaId, { baslangic_tarihi: baslangic, bitis_tarihi: bitis });

      // Mail kuyruğuna ekle (önceki durum → yeni durum).
      // ÖNEMLİ: kuyruğa DB'ye yazılan ASIL tarihi (revert sırasında satırı bulmak için) iletiyoruz.
      if (eskiAtama && personel) {
        const eskiAcik = !eskiAtama.bitis_tarihi;
        const yeniAcik = !bitis;
        if (eskiAcik && !yeniAcik && bitis) {
          // Açık atama kapatıldı → işten çıkış maili (revert: bitis_tarihi = bitis)
          kuyrugaEkle({ tip: "cikis", personel, onceSantiyeAd: santiyeAd, onceSantiyeId: eskiAtama.santiye_id, tarih: bitis });
          toast.success(`Atama güncellendi · ${personel.ad_soyad} işten çıkış maili kuyruğa eklendi`);
        } else if (!eskiAcik && yeniAcik) {
          // Kapalı atama yeniden açıldı → işe geri giriş maili (revert: baslangic_tarihi = baslangic)
          kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId: eskiAtama.santiye_id, tarih: baslangic });
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
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
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
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    if (bitis && bitis < baslangic) {
      toast.error("İşten çıkış tarihi, işe başlama tarihinden önce olamaz.");
      return;
    }
    // Yönetici hariç: bugünden max 9 gün geri, gelecek tarih yok
    if (!isYonetici) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todayStr = tarihStr(today);
      const minDate = new Date(today); minDate.setDate(minDate.getDate() - 9);
      const minDateStr = tarihStr(minDate);
      if (baslangic > todayStr || (bitis && bitis > todayStr)) {
        toast.error("Gelecek tarih girilemez.");
        return;
      }
      if (baslangic < minDateStr || (bitis && bitis < minDateStr)) {
        toast.error("En fazla 9 gün geriye tarih girilebilir. Daha eski tarihler için yöneticinize başvurun.");
        return;
      }
    }
    try {
      await insertAtama(personelId, santiyeId, baslangic, bitis);

      // Mail kuyruğu: yeni atama açık (bitis_tarihi yok) ise giriş maili gönder.
      // Kapalı atama (bitis dolu) eklendiyse bu geçmiş bir kayıt — mail gönderme.
      const personel = personeller.find((p) => p.id === personelId);
      const santiyeAd = santiyeler.find((s) => s.id === santiyeId)?.is_adi;
      if (personel && !bitis) {
        // Revert için DB'ye yazılan ASIL baslangic_tarihi tarihini ilet
        kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId, tarih: baslangic });
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
    if (!yDuzenle && !yEkle) { toast.error("Yetkiniz yok."); return; }
    const [yil, ay] = ayStr.split("-").map(Number);
    const ayBas = `${yil}-${String(ay).padStart(2, "0")}-01`;
    const sonGun = new Date(yil, ay, 0).getDate();
    const ayBit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
    const today = yerelBugun();
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

      // SGK 30 gün uyarısı — bildirim amaçlı (kayıt iptal edilmez)
      if (N > 30) {
        toast(
          `⚠️ Bu şantiyede ${N} gün girdiniz. SGK'da bir ay için en fazla 30 gün sayılır.`,
          { icon: "⚠️", duration: 5000, style: { background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" } },
        );
      } else {
        // Birden fazla şantiyede çalışıyorsa toplamı kontrol et
        const personel = personeller.find((p) => p.id === personelId);
        const personelAd = personel?.ad_soyad ?? "Personel";
        const mevcutGunMap = gunMap.get(personelId);
        if (mevcutGunMap) {
          // Bu şantiye dışındaki şantiyelerin gün toplamı + yeni N
          let digerToplam = 0;
          for (const [sId, gun] of mevcutGunMap) {
            if (sId !== santiyeId) digerToplam += gun;
          }
          const yeniToplam = N + digerToplam;
          if (yeniToplam > 30) {
            toast(
              `⚠️ ${personelAd} için ${ayLabel(ayStr)} toplamı ${yeniToplam} gün — SGK 30 günü aşıyor (bu şantiye: ${N}, diğerleri: ${digerToplam})`,
              { icon: "⚠️", duration: 5000, style: { background: "#FEF3C7", color: "#92400E", border: "1px solid #FCD34D" } },
            );
          }
        }
      }

      setGunEdit(null); // Pencereyi kapat
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Toplu personel ekle: dialog'dan seçili personelleri belirtilen şantiyeye atama açar
  async function topluPersonelEkle() {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    if (!topluEkleSantiyeId || topluSecilenler.size === 0) return;
    const santiye = santiyeler.find((s) => s.id === topluEkleSantiyeId);
    const santiyeAd = santiye?.is_adi;

    // Admin olmayan kullanıcılar için: Yeni iş kuralı
    //  - Şantiye boşsa (henüz atama yok) → işyeri teslim tarihi olmalı
    //  - İşyeri teslim tarihi boşsa → giriş engelli
    //  - Henüz dolmamışsa: max teknik_personel_sayisi kadar personel ekleyebilir; tarih=isyeri_teslim_tarihi
    const buGun = yerelBugun();
    let kullanilanTarih = isYonetici && topluTarih ? topluTarih : buGun;

    // Teknik personel kotası dolmadıysa "Bu kişi(ler) teknik personel mi?" sor.
    // Teknik personel sayımı: bu şantiyenin işyeri_teslim_tarihi'nde başlayan açık atamalar.
    // teknikSayisi: bu batch'te kaç kişiyi teknik personel olarak işaretleyeceğiz (split için)
    let teknikIlkN = 0; // 0 = hiçbiri teknik (hayır), N = ilk N kişi teknik
    let teknikTeslim: string | null = null;
    if (santiye) {
      const teknikPersonelSayisi = santiye.teknik_personel_sayisi ?? 0;
      const teslim = santiye.isyeri_teslim_tarihi ?? null;
      // YENİ: Mevcut teknik personel sayısı personel_teknik tablosundan (aktif atamalı) gelir.
      // Eski (atama.baslangic === teslim) heuristic'i fallback olarak teknikPersonelMap içinde uygulanmış durumda.
      const mevcutTeknikSayisi = aktifTeknikSayisiMap.get(topluEkleSantiyeId) ?? 0;
      const kalanSlot = Math.max(0, teknikPersonelSayisi - mevcutTeknikSayisi);

      if (teknikPersonelSayisi > 0 && kalanSlot > 0) {
        if (!teslim) {
          // Tıklanabilir custom toast — tıklayınca şantiye düzenleme sayfasını açar
          const santiyeId = santiye.id;
          const duzenleUrl = `/dashboard/yonetim/santiyeler/${santiyeId}/duzenle`;
          toast.custom(
            (tt) => (
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  window.open(duzenleUrl, "_blank", "noopener,noreferrer");
                  toast.dismiss(tt.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    window.open(duzenleUrl, "_blank", "noopener,noreferrer");
                    toast.dismiss(tt.id);
                  }
                }}
                className={`${tt.visible ? "animate-in slide-in-from-top-4" : "animate-out slide-out-to-top-4"} cursor-pointer bg-red-500 text-white shadow-2xl rounded-lg px-4 py-3 max-w-md flex items-start gap-2.5 hover:bg-red-600 transition-colors`}
              >
                <span className="text-xl flex-shrink-0">⚠️</span>
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm">İşyeri teslim tarihi belirtilmemiş</div>
                  <div className="text-xs mt-1 leading-relaxed">
                    <strong>{santiyeAd}</strong> işine teknik personel girişi yapılamıyor.
                  </div>
                  <div className="text-[11px] mt-1.5 underline font-semibold">
                    👉 Tıkla: Şantiye düzenleme ekranını yeni sekmede aç
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toast.dismiss(tt.id); }}
                  className="text-white/70 hover:text-white text-lg leading-none flex-shrink-0"
                  aria-label="Kapat"
                >×</button>
              </div>
            ),
            { duration: 5000 },
          );
          return;
        }
        // Seçim sırasına göre kişi adlarını çıkar — split sırasında ilk N teknik olur
        const kisiAdlari: string[] = [];
        for (const pid of topluSecilenler) {
          const p = personeller.find((x) => x.id === pid);
          if (p) kisiAdlari.push(p.ad_soyad);
        }
        const cevap = await new Promise<"evet" | "hayir" | "iptal">((resolve) => {
          setTeknikSorusu({
            santiyeAd: santiyeAd ?? "",
            teslimTarihi: teslim,
            teknikSayisi: teknikPersonelSayisi,
            kalanSlot,
            eklenecekKisiSayisi: topluSecilenler.size,
            kisiAdlari,
            resolve,
          });
        });
        setTeknikSorusu(null);
        if (cevap === "iptal") return;
        if (cevap === "evet") {
          // Evet: ilk min(kalanSlot, secilenSayisi) kişi teknik personel olur
          teknikIlkN = Math.min(kalanSlot, topluSecilenler.size);
          teknikTeslim = teslim;
          // kalan kişiler default tarih (admin: topluTarih veya bugün; non-admin: bugün) ile eklenir
        }
        // "hayir" → teknikIlkN = 0 → herkes default tarih
      }
    }

    // Admin olmayan kullanıcı için tarih kısıtlaması (eski 9-gün kuralı korunuyor)
    // ÖNEMLİ: Tüm tarihler UTC ISO slice ile karşılaştırılır (timezone tutarsızlığını önle).
    if (!isYonetici && santiye) {
      const todayStr = buGun; // UTC ile aynı kaynak
      const minDate = new Date();
      minDate.setUTCDate(minDate.getUTCDate() - 9);
      const minDateStr = tarihStr(minDate);
      // Teknik personel cevabı evet'se kullanilanTarih = teslim tarihi olabilir; bu istisna kabul.
      // Aksi tarihler 9 gün-bugün aralığında olmalı.
      if (kullanilanTarih !== santiye.isyeri_teslim_tarihi) {
        if (kullanilanTarih > todayStr) {
          toast.error("Gelecek tarih girilemez.");
          return;
        }
        if (kullanilanTarih < minDateStr) {
          toast.error("En fazla 9 gün geriye tarih girilebilir.");
          return;
        }
      }
    }

    setTopluEkleniyor(true);
    try {
      let basari = 0;
      let teknikSayilan = 0;
      let normalSayilan = 0;
      let idx = 0;
      for (const personelId of topluSecilenler) {
        try {
          const personel = personeller.find((p) => p.id === personelId);
          if (!personel) { idx++; continue; }
          // Split: ilk teknikIlkN kişi teknik personel (teslim tarihi), kalan default tarih
          const buKisininTarihi = (idx < teknikIlkN && teknikTeslim) ? teknikTeslim : kullanilanTarih;
          const buKisininTeknikMi = idx < teknikIlkN;
          await insertAtama(personelId, topluEkleSantiyeId, buKisininTarihi, null, buKisininTeknikMi);
          kuyrugaEkle({ tip: "giris", personel, santiyeAd, santiyeId: topluEkleSantiyeId, tarih: buKisininTarihi });
          basari++;
          if (idx < teknikIlkN) teknikSayilan++; else normalSayilan++;
        } catch (e) {
          console.error("Toplu ekleme hatası:", e);
        }
        idx++;
      }
      // Toast'da bölme bilgisini ver
      if (teknikSayilan > 0 && normalSayilan > 0) {
        toast.success(
          `${basari}/${topluSecilenler.size} personel eklendi (${teknikSayilan} teknik · ${normalSayilan} bugün)`,
          { duration: 5000 },
        );
      } else if (teknikSayilan > 0) {
        toast.success(`${basari}/${topluSecilenler.size} teknik personel eklendi (teslim tarihi)`);
      } else {
        toast.success(`${basari}/${topluSecilenler.size} personel eklendi`);
      }
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
      // Teknik personel mi? Export sırasında ad yanına "(Teknik Personel)" eklenir.
      isTeknik?: boolean;
    };
    const rows: Row[] = [];
    const [yil, ay] = seciliAy.split("-").map(Number);
    const ayBas = `${yil}-${String(ay).padStart(2, "0")}-01`;
    const sonGun = new Date(yil, ay, 0).getDate();
    const ayBit = `${yil}-${String(ay).padStart(2, "0")}-${String(sonGun).padStart(2, "0")}`;
    const today = yerelBugun();
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
      // Teknik personel mi? Export sırasında ad yanına "(Teknik Personel)" eklenir.
      const isTeknik = !!teknikPersonelMap.get(personel.id)?.has(sant.id);
      ham.push({
        firmaId: firma?.id ?? "",
        firmaAd: firma?.firma_adi ?? "(Firma atanmamış)",
        santiyeId: sant.id,
        santiyeAd: sant.is_adi,
        adSoyad: personel.ad_soyad,
        isTeknik,
        tc: personel.tc_kimlik_no ?? "",
        gorev: personel.meslek ?? "",
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
        isTeknik: ilk.isTeknik,
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
    // Firmalar: "Yönetim > Firmalar" sayfasındaki sıraya göre (sira_no).
    // Bu sıra `firmalar` state'inde zaten korunuyor (getFirmalar sira_no ile döner).
    const firmaSiraMap = new Map<string, number>();
    firmalar.forEach((f, i) => firmaSiraMap.set(f.firma_adi, i));
    rows.sort((a, b) => {
      const fa = firmaSiraMap.get(a.firmaAd) ?? Number.MAX_SAFE_INTEGER;
      const fb = firmaSiraMap.get(b.firmaAd) ?? Number.MAX_SAFE_INTEGER;
      if (fa !== fb) return fa - fb;
      // Aynı firmada şantiye ve personel alfabetik (Türkçe locale)
      const sc = a.santiyeAd.localeCompare(b.santiyeAd, "tr");
      if (sc !== 0) return sc;
      return a.adSoyad.localeCompare(b.adSoyad, "tr");
    });
    return rows;
  }

  // Bordro export rows'undan, ay içinde TOPLAM gün sayısı 30'u GEÇEN
  // personelleri çıkar. Her personel için tek satır (toplam gün gösterilir).
  // SGK günü 30'a sınırlıdır; manuel girişler veya birden fazla şantiyedeki
  // çakışan atamalar nedeniyle bu sınır aşılabilir → uyarı tablosunda gösterilir.
  type OtuzAsanRow = {
    adSoyad: string;
    tc: string;
    gorev: string;
    iseBaslama: string;
    isenCikis: string;
    toplamGun: number;
    not: string;
    isTeknik?: boolean;
  };
  function otuzGununAsanlar(): OtuzAsanRow[] {
    const rows = exportSantiyeBazli();
    // Personel bazında topla (TC + ad birleşimi key)
    type Acc = {
      adSoyad: string; tc: string; gorev: string;
      iseBaslama: string; isenCikis: string;
      toplamGun: number; notlar: string[];
      isTeknik: boolean;
    };
    const map = new Map<string, Acc>();
    for (const r of rows) {
      const key = r.tc || r.adSoyad;
      const mevcut = map.get(key);
      if (!mevcut) {
        map.set(key, {
          adSoyad: r.adSoyad, tc: r.tc, gorev: r.gorev,
          iseBaslama: r.iseBaslama, isenCikis: r.isenCikis,
          toplamGun: r.gun, notlar: r.not ? [r.not] : [],
          isTeknik: !!r.isTeknik,
        });
      } else {
        mevcut.toplamGun += r.gun;
        // En erken işe başlama, en geç çıkış
        if (r.iseBaslama && (!mevcut.iseBaslama || r.iseBaslama < mevcut.iseBaslama)) {
          mevcut.iseBaslama = r.iseBaslama;
        }
        if (r.isenCikis === "Halen" || mevcut.isenCikis === "Halen") {
          mevcut.isenCikis = "Halen";
        } else if (r.isenCikis > mevcut.isenCikis) {
          mevcut.isenCikis = r.isenCikis;
        }
        if (r.not) mevcut.notlar.push(r.not);
        if (r.isTeknik) mevcut.isTeknik = true;
      }
    }
    const sonuc: OtuzAsanRow[] = [];
    for (const acc of map.values()) {
      if (acc.toplamGun > 30) {
        sonuc.push({
          adSoyad: acc.adSoyad,
          tc: acc.tc,
          gorev: acc.gorev,
          iseBaslama: acc.iseBaslama,
          isenCikis: acc.isenCikis,
          toplamGun: acc.toplamGun,
          not: acc.notlar.join(" / "),
          isTeknik: acc.isTeknik,
        });
      }
    }
    sonuc.sort((a, b) => b.toplamGun - a.toplamGun);
    return sonuc;
  }

  // "MAYIS 2026" gibi büyük harfli ay başlığı (ay başlığında kullanılır)
  function ayBuyukLabel(ayStr: string): string {
    const lbl = ayLabel(ayStr);
    return lbl.toLocaleUpperCase("tr-TR");
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
    // 8 sütun: Ad Soyad, (Teknik etiket), TC, Meslek, İşe Başlama, İşten Çıkış, Gün, Not
    const NUM_COLS = 8;

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

        const headers = ["Ad Soyad", "", "TC", "Meslek", "İşe Başlama", "İşten Çıkış", "Gün", "Not"];
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
          // 8 sütun: Ad Soyad | (Teknik) | TC | Meslek | İşe Başlama | İşten Çıkış | Gün | Not
          const teknikEtiket = r.isTeknik ? "(Teknik Personel)" : "";
          const rowVals: (string | number)[] = [r.adSoyad, teknikEtiket, r.tc, r.gorev, r.iseBaslama, r.isenCikis, r.gun, r.not];
          for (let c = 0; c < rowVals.length; c++) {
            // c === 1 = Teknik etiket sütunu (sadece teknikse dolu, kalın + indigo)
            const isTeknikSutun = c === 1 && r.isTeknik;
            setCell(curRow, c, rowVals[c], {
              font: isTeknikSutun
                ? { sz: 10, bold: true, color: { rgb: "FF4338CA" } }
                : { sz: 10 },
              alignment: { horizontal: c === 6 ? "right" : "left", vertical: "center", wrapText: c === 7 },
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

    // En altta: 30 günü aşan personel uyarı tablosu (sigortalılık ihlali)
    const otuzAsanlar = otuzGununAsanlar();
    if (otuzAsanlar.length > 0) {
      curRow++; // boş satır

      // Siyah başlık
      setCell(curRow, 0,
        `${ayBuyukLabel(seciliAy)} AYINDA SİGORTALILIK SÜRESİ 30 GÜNÜ GEÇEN PERSONEL LİSTESİ`,
        {
          font: { bold: true, sz: 12, color: { rgb: "FFFFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" },
          fill: { fgColor: { rgb: "FF000000" }, patternType: "solid" },
        },
      );
      merges.push({ s: { r: curRow, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
      curRow++;

      const otHeaders = ["Ad Soyad", "", "TC", "Görev", "İşe Başlama", "İşten Çıkış", "Gün", "Not"];
      for (let c = 0; c < otHeaders.length; c++) {
        setCell(curRow, c, otHeaders[c], {
          font: { bold: true, sz: 11, color: { rgb: "FFFFFFFF" } },
          alignment: { horizontal: "center", vertical: "center" },
          fill: { fgColor: { rgb: "FF323232" }, patternType: "solid" },
          border: {
            top: { style: "thin", color: { rgb: "FF000000" } },
            bottom: { style: "thin", color: { rgb: "FF000000" } },
            left: { style: "thin", color: { rgb: "FF000000" } },
            right: { style: "thin", color: { rgb: "FF000000" } },
          },
        });
      }
      curRow++;

      for (let i = 0; i < otuzAsanlar.length; i++) {
        const r = otuzAsanlar[i];
        const bgArgb = i % 2 === 0 ? "FFFFFFFF" : "FFF5F5F5";
        const teknikEtiket = r.isTeknik ? "(Teknik Personel)" : "";
        const rowVals: (string | number)[] = [r.adSoyad, teknikEtiket, r.tc, r.gorev, r.iseBaslama, r.isenCikis, r.toplamGun, r.not];
        for (let c = 0; c < rowVals.length; c++) {
          const isTeknikSutun = c === 1 && r.isTeknik;
          setCell(curRow, c, rowVals[c], {
            font: isTeknikSutun
              ? { sz: 10, bold: true, color: { rgb: "FF4338CA" } }
              : { sz: 10 },
            alignment: { horizontal: c === 6 ? "right" : "left", vertical: "center", wrapText: c === 7 },
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
    }

    const ws: Record<string, unknown> = sheet;
    ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: curRow, c: NUM_COLS - 1 } });
    // 8 sütun: Ad Soyad | Teknik | TC | Meslek | İşe Başlama | İşten Çıkış | Gün | Not
    ws["!cols"] = [
      { wch: 28 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 30 },
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
    // İşten çıkarma = atama kaydının bitiş tarihini yazmak → DÜZENLEME yetkisi
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    const items = selectedItems();
    const aktifOlanlar = items.filter((it) => it.sutunKey !== PASIF_KEY && it.sutunKey !== ATANMAMIS_KEY);
    if (aktifOlanlar.length === 0) {
      toast.error("Çıkarılacak aktif personel seçilmedi.");
      return;
    }
    // Tarih doğrulama (admin hariç)
    const cikisTarih = topluCikisTarih;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const secilen = new Date(cikisTarih + "T00:00:00");
    if (isNaN(secilen.getTime())) { toast.error("Geçerli bir tarih girin"); return; }
    if (!isYonetici) {
      const minTarih = new Date(today); minTarih.setDate(minTarih.getDate() - 9);
      if (secilen > today) { toast.error("Çıkış tarihi gelecek olamaz"); return; }
      if (secilen < minTarih) { toast.error("Çıkış tarihi en fazla 9 gün geriye olabilir"); return; }
    }
    setTopluCikisIsleniyor(true);
    try {
      let basari = 0;
      // Şantiye bazlı çıkış: aynı personel birden fazla şantiye sütununda seçilmişse
      // her sütun için ayrı çıkış uygulanır (sadece o şantiyenin ataması kapanır).
      const supabase = (await import("@/lib/supabase/client")).createClient();
      for (const it of aktifOlanlar) {
        const personel = it.personel;
        const santiyeId = it.sutunKey;
        const onceSantiyeAd = santiyeler.find((s) => s.id === santiyeId)?.is_adi;
        try {
          const { error } = await supabase
            .from("personel_atama_gecmisi")
            .update({ bitis_tarihi: cikisTarih })
            .eq("personel_id", personel.id)
            .eq("santiye_id", santiyeId)
            .is("bitis_tarihi", null);
          if (error) throw error;
          kuyrugaEkle({ tip: "cikis", personel, onceSantiyeAd, onceSantiyeId: santiyeId, tarih: cikisTarih });
          basari++;
        } catch (e) { console.error(e); }
      }
      toast.success(`${basari} personel işten çıkarıldı (${cikisTarih}, mail kuyruğuna eklendi)`);
      setSelectedKeys(new Set());
      setTopluCikisOnay(false);
      // Tarihi bugüne sıfırla
      setTopluCikisTarih(yerelBugun());
      await loadData();
    } finally {
      setTopluCikisIsleniyor(false);
    }
  }

  async function topluTransferYap() {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (!topluTransferHedef) { toast.error("Hedef şantiye seçin"); return; }
    const items = selectedItems();
    if (items.length === 0) { toast.error("Personel seçilmedi"); return; }

    // Tarih doğrulaması: admin değilse bugünden max 9 gün geriye, gelecek yok
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = tarihStr(today);
    const minDate = new Date(today); minDate.setDate(minDate.getDate() - 9);
    const minDateStr = tarihStr(minDate);
    if (!isYonetici) {
      if (topluTransferTarih > todayStr) { toast.error("Gelecek tarih girilemez."); return; }
      if (topluTransferTarih < minDateStr) {
        toast.error("En fazla 9 gün geriye tarih girilebilir. Daha eski için yöneticinize başvurun.");
        return;
      }
    }

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
            // transferEt artık {cikis, giris} döner — mail önizlemesinde gerçek giriş tarihi
            const r = await transferEt(pid, topluTransferHedef, topluTransferTarih);
            kuyrugaEkle({ tip: "transfer", personel, santiyeAd: hedefAd, onceSantiyeAd, santiyeId: topluTransferHedef, onceSantiyeId: aktifAtama.santiye_id, tarih: r.giris, cikisTarih: r.cikis });
          } else {
            const girisTarih = await iseGeriAl(pid, topluTransferHedef, topluTransferTarih);
            kuyrugaEkle({ tip: "giris", personel, santiyeAd: hedefAd, santiyeId: topluTransferHedef, tarih: girisTarih });
          }
          basari++;
        } catch (e) { console.error(e); }
      }
      toast.success(`${basari} personel ${hedefAd} şantiyesine transfer edildi (${topluTransferTarih}, mail kuyruğuna eklendi)`);
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

    // hex (#RRGGBB) → [r,g,b] tuple. Geçersiz ise default lacivert.
    const hexToRgb = (hex: string | null | undefined): [number, number, number] => {
      if (!hex) return [30, 58, 95];
      const h = hex.replace("#", "").trim();
      if (!/^[0-9a-fA-F]{6}$/.test(h)) return [30, 58, 95];
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };
    // Renk açıksa siyah, koyuysa beyaz yazı
    const yaziRengi = (rgb: [number, number, number]): [number, number, number] => {
      const [r, g, b] = rgb;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return lum > 0.6 ? [0, 0, 0] : [255, 255, 255];
    };
    // Renk için soft alternate satır rengi (firmanın renginin %92 açık tonu)
    const altSatirRengi = (rgb: [number, number, number]): [number, number, number] => {
      const [r, g, b] = rgb;
      // Beyaza yaklaştır
      return [Math.round(r + (255 - r) * 0.88), Math.round(g + (255 - g) * 0.88), Math.round(b + (255 - b) * 0.88)];
    };

    let cursorY = 25;
    const pageHeight = doc.internal.pageSize.getHeight();
    for (const [firmaAd, santiyeMap] of firmaGruplari) {
      const firmaToplamKisi = Array.from(santiyeMap.values()).reduce((s, l) => s + l.length, 0);
      const firmaToplamGun = Array.from(santiyeMap.values()).flat().reduce((s, r) => s + r.gun, 0);

      // Firmanın özel rengini al (Yönetim > Firmalar'dan ayarlanan)
      const firma = firmalar.find((f) => f.firma_adi === firmaAd);
      const firmaRgb = hexToRgb(firma?.renk);
      const firmaYazi = yaziRengi(firmaRgb);
      const altRgb = altSatirRengi(firmaRgb);

      // Yeni sayfaya geçmek gerekirse
      if (cursorY > pageHeight - 40) {
        doc.addPage();
        cursorY = 15;
      }

      // Firma başlığı (firmanın kendi renginde)
      doc.setFillColor(firmaRgb[0], firmaRgb[1], firmaRgb[2]);
      doc.rect(14, cursorY - 4, doc.internal.pageSize.getWidth() - 28, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(11);
      doc.setTextColor(firmaYazi[0], firmaYazi[1], firmaYazi[2]);
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
            trAscii(r.isTeknik ? `${r.adSoyad} (Teknik Personel)` : r.adSoyad),
            r.tc,
            trAscii(r.gorev),
            r.iseBaslama,
            r.isenCikis,
            String(r.gun),
            trAscii(r.not),
          ]),
          styles: { fontSize: 8, cellPadding: 1.5 },
          headStyles: {
            fillColor: firmaRgb,
            textColor: firmaYazi,
          },
          alternateRowStyles: { fillColor: altRgb },
          margin: { left: 14, right: 14 },
          // "(Teknik Personel)" suffix'ini SADECE kalın + indigo yap (isim normal kalır).
          // Hücre çizildikten sonra overdraw: önce dolgu rengiyle üzerini kapat,
          // sonra metni iki parça halinde elle çiz.
          didDrawCell: (data) => {
            if (data.section !== "body" || data.column.index !== 1) return;
            const fullTxt = String(data.cell.raw ?? "");
            const marker = " (Teknik Personel)";
            const idx = fullTxt.lastIndexOf(marker);
            if (idx < 0) return;
            const namePart = fullTxt.slice(0, idx);
            const suffixPart = fullTxt.slice(idx);
            // Mevcut hücreyi dolgu rengiyle kapla (kenarlığı koru)
            let fillRgb: [number, number, number] = [255, 255, 255];
            const fc = data.cell.styles.fillColor;
            if (Array.isArray(fc) && fc.length >= 3) {
              fillRgb = [fc[0] as number, fc[1] as number, fc[2] as number];
            }
            doc.setFillColor(fillRgb[0], fillRgb[1], fillRgb[2]);
            doc.rect(
              data.cell.x + 0.15,
              data.cell.y + 0.15,
              data.cell.width - 0.3,
              data.cell.height - 0.3,
              "F",
            );
            // Metni iki parça halinde çiz
            const fontSize = (data.cell.styles.fontSize as number) ?? 8;
            const padLeft = 1.8;
            // jsPDF text baseline = "alphabetic"; merkez için baseline = y + h/2 + ~fontSize*0.35
            const textY = data.cell.y + data.cell.height / 2 + fontSize * 0.35;
            const nameX = data.cell.x + padLeft;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(fontSize);
            doc.setTextColor(0, 0, 0);
            doc.text(namePart, nameX, textY);
            const nameWidth = doc.getTextWidth(namePart);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(67, 56, 202);
            doc.text(suffixPart, nameX + nameWidth, textY);
            doc.setFont("helvetica", "normal");
            doc.setTextColor(0, 0, 0);
          },
        });
        // @ts-expect-error autoTable lastAutoTable typing
        cursorY = (doc as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
      }
      cursorY += 4;
    }

    // En altta: 30 günü aşan personel uyarı tablosu
    const otuzAsanlar = otuzGununAsanlar();
    if (otuzAsanlar.length > 0) {
      // Yeterli yer yoksa yeni sayfa
      if (cursorY > pageHeight - 40) {
        doc.addPage();
        cursorY = 15;
      } else {
        cursorY += 4;
      }
      // Siyah başlık bandı
      doc.setFillColor(0, 0, 0);
      doc.rect(14, cursorY, doc.internal.pageSize.getWidth() - 28, 7, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(
        trAscii(`${ayBuyukLabel(seciliAy)} AYINDA SIGORTALILIK SURESI 30 GUNU GECEN PERSONEL LISTESI`),
        17, cursorY + 5,
      );
      doc.setTextColor(0, 0, 0);
      cursorY += 9;
      autoTable(doc, {
        startY: cursorY,
        head: [["Ad Soyad", "TC", "Gorev", "Ise Baslama", "Isten Cikis", "Gun", "Not"]],
        body: otuzAsanlar.map((r) => [
          trAscii(r.isTeknik ? `${r.adSoyad} (Teknik Personel)` : r.adSoyad),
          r.tc,
          trAscii(r.gorev),
          r.iseBaslama,
          r.isenCikis,
          String(r.toplamGun),
          trAscii(r.not),
        ]),
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [50, 50, 50], textColor: 255 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        margin: { left: 14, right: 14 },
        // 30 günü aşanlar — ad sütunu index 0; overdraw ile iki parça çiz
        didDrawCell: (data) => {
          if (data.section !== "body" || data.column.index !== 0) return;
          const fullTxt = String(data.cell.raw ?? "");
          const marker = " (Teknik Personel)";
          const idx = fullTxt.lastIndexOf(marker);
          if (idx < 0) return;
          const namePart = fullTxt.slice(0, idx);
          const suffixPart = fullTxt.slice(idx);
          let fillRgb: [number, number, number] = [255, 255, 255];
          const fc = data.cell.styles.fillColor;
          if (Array.isArray(fc) && fc.length >= 3) {
            fillRgb = [fc[0] as number, fc[1] as number, fc[2] as number];
          }
          doc.setFillColor(fillRgb[0], fillRgb[1], fillRgb[2]);
          doc.rect(
            data.cell.x + 0.15,
            data.cell.y + 0.15,
            data.cell.width - 0.3,
            data.cell.height - 0.3,
            "F",
          );
          const fontSize = (data.cell.styles.fontSize as number) ?? 8;
          const padLeft = 1.8;
          const textY = data.cell.y + data.cell.height / 2 + fontSize * 0.35;
          const nameX = data.cell.x + padLeft;
          doc.setFont("helvetica", "normal");
          doc.setFontSize(fontSize);
          doc.setTextColor(0, 0, 0);
          doc.text(namePart, nameX, textY);
          const nameWidth = doc.getTextWidth(namePart);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(67, 56, 202);
          doc.text(suffixPart, nameX + nameWidth, textY);
          doc.setFont("helvetica", "normal");
          doc.setTextColor(0, 0, 0);
        },
      });
    }

    doc.save(`bordro-${seciliAy}.pdf`);
  }

  // Personel ekle
  async function personelEkle() {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    if (!ekleAd.trim()) { toast.error("Ad soyad gerekli"); return; }
    if (!ekleTc.trim() || ekleTc.length !== 11) { toast.error("11 haneli TC gerekli"); return; }
    if (!ekleCepTelefon.trim()) { toast.error("Cep telefonu zorunlu"); return; }
    if (!ekleMeslek.trim()) { toast.error("Meslek zorunlu"); return; }
    setKaydetYukleniyor(true);
    try {
      // Admin'se ekleTarih (eski tarih girebilir), değilse her zaman bugün
      const buGun = yerelBugun();
      const kullanilanTarih = isYonetici && ekleTarih ? ekleTarih : buGun;
      const yeni = await insertBordroPersonel({
        ad_soyad: formatKisiAdi(ekleAd),
        tc_kimlik_no: ekleTc.trim(),
        gorev: null,
        meslek: ekleMeslek || null,
        santiye_id: ekleSantiye || null,
        maas: null,
        izin_hakki: null,
        mesai_ucreti_var: false,
        ise_giris_tarihi: kullanilanTarih,
        ev_telefon: null,
        cep_telefon: ekleCepTelefon.trim() || null,
        durum: "aktif",
        pasif_tarihi: null,
      });
      // Şantiye seçildiyse personel_santiye junction tablosuna da ekle
      // (Personeller sayfasında listede görünmesi + puantaj listesi için gerekli)
      if (ekleSantiye && yeni?.id) {
        try {
          await addPersonelSantiye(yeni.id, ekleSantiye);
        } catch (atErr) {
          console.warn("Otomatik şantiye ataması başarısız:", atErr);
        }
      }
      // Teknik personel işaretliyse personel_teknik tablosuna kayıt aç (sadece bilgi amaçlı)
      // Kalan slot yoksa atla (kullanıcı dialog açıkken araya başka kayıt sıkışmış olabilir)
      if (ekleTeknik && ekleSantiye && yeni?.id) {
        const kalan = teknikKalanSlot(ekleSantiye);
        if (kalan > 0) {
          try {
            await setPersonelTeknikSantiye(yeni.id, ekleSantiye, true);
          } catch (tknErr) {
            console.warn("Teknik personel kaydı başarısız:", tknErr);
          }
        } else {
          toast(`Teknik personel kontenjanı dolu, rozet eklenmedi.`, { icon: "ℹ️" });
        }
      }
      toast.success("Personel eklendi (mail kuyruğa eklendi)");
      // Mail kuyruğuna ekle
      const santiyeAd = ekleSantiye ? santiyeler.find((s) => s.id === ekleSantiye)?.is_adi : undefined;
      kuyrugaEkle({ tip: "giris", personel: yeni, santiyeAd, santiyeId: ekleSantiye || undefined });
      // Kapat + reload
      setEkleAcik(false);
      setEkleAd(""); setEkleTc(""); setEkleGorev(""); setEkleMeslek("");
      setEkleSantiye(""); setEkleTarih(yerelBugun()); setEkleCepTelefon("");
      setEkleTeknik(false);
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKaydetYukleniyor(false);
    }
  }

  // İşten çıkar — kullanıcı tarafından seçilen tarih ile.
  // Admin (isYonetici): herhangi bir tarih girebilir.
  // Diğer kullanıcılar: bugünden max 9 gün geri.
  async function cikisYap() {
    // İşten çıkarma = atama kaydının bitiş tarihini yazmak → DÜZENLEME yetkisi
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (!cikisOnay) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const secilenTarih = new Date(cikisTarih + "T00:00:00");
    if (isNaN(secilenTarih.getTime())) { toast.error("Geçerli bir tarih girin"); return; }
    if (!isYonetici) {
      const minTarih = new Date(today); minTarih.setDate(minTarih.getDate() - 9);
      if (secilenTarih > today) { toast.error("Çıkış tarihi gelecek olamaz"); return; }
      if (secilenTarih < minTarih) { toast.error("Çıkış tarihi en fazla 9 gün geriye olabilir"); return; }
    }
    try {
      // ŞANTİYE BAZLI çıkış: SADECE bu personelin BU ŞANTİYEDEKİ açık atamasını kapat.
      // Personel başka şantiyelerde aktifse onlar etkilenmez.
      const { personel, santiyeId } = cikisOnay;
      const oldSantiyeAd = santiyeler.find((s) => s.id === santiyeId)?.is_adi;
      const supabase = (await import("@/lib/supabase/client")).createClient();
      const { error } = await supabase
        .from("personel_atama_gecmisi")
        .update({ bitis_tarihi: cikisTarih })
        .eq("personel_id", personel.id)
        .eq("santiye_id", santiyeId)
        .is("bitis_tarihi", null);
      if (error) throw error;
      toast.success(`${personel.ad_soyad} ${oldSantiyeAd ?? ""} şantiyesinden çıkarıldı (${cikisTarih}, mail kuyruğa)`);
      // ÖNEMLİ: DB'ye yazılan ASIL tarihi (cikisTarih) kuyruğa ilet — revert için gerekli.
      kuyrugaEkle({ tip: "cikis", personel, onceSantiyeAd: oldSantiyeAd, onceSantiyeId: santiyeId, tarih: cikisTarih });
      setCikisOnay(null);
      setCikisTarih(yerelBugun());
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // İşe geri al
  async function geriAlYap() {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    if (!geriAlPersonel || !geriAlSantiye) return;
    try {
      const girisTarih = await iseGeriAl(geriAlPersonel.id, geriAlSantiye);
      const yeniSantiyeAd = santiyeler.find((s) => s.id === geriAlSantiye)?.is_adi;
      toast.success(`${geriAlPersonel.ad_soyad} işe geri alındı (${girisTarih}, mail kuyruğa)`);
      kuyrugaEkle({ tip: "giris", personel: geriAlPersonel, santiyeAd: yeniSantiyeAd, santiyeId: geriAlSantiye, tarih: girisTarih });
      setGeriAlPersonel(null); setGeriAlSantiye("");
      await loadData();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Drag-drop
  function onDragStart(personelId: string, kaynakSantiyeId?: string) {
    if (isReadOnly) return;
    setDragPersonelId(personelId);
    setDragSourceSantiyeId(kaynakSantiyeId ?? null);
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
    if (!yDuzenle && !yEkle) { toast.error("Yetkiniz yok."); return; }
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
        // İşten çıkar (drag ile) — SADECE drag kaynağı şantiyedeki atamayı kapat
        const kaynakSantiyeId = dragSourceSantiyeId ?? aktifSantiyeId;
        if (kaynakSantiyeId) {
          setCikisOnay({ personel, santiyeId: kaynakSantiyeId });
        }
        setDragPersonelId(null);
        setDragSourceSantiyeId(null);
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
        const girisTarih = await iseGeriAl(personel.id, hedefKey);
        kuyrugaEkle({ tip: "giris", personel, santiyeAd: yeniSantiyeAd, santiyeId: hedefKey, tarih: girisTarih });
      } else {
        const r = await transferEt(personel.id, hedefKey);
        kuyrugaEkle({ tip: "transfer", personel, santiyeAd: yeniSantiyeAd, onceSantiyeAd, santiyeId: hedefKey, onceSantiyeId: aktifSantiyeId ?? undefined, tarih: r.giris, cikisTarih: r.cikis });
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
    // Aktif şantiye sütununda → "Çıkar" butonu (atamayı kapat) — yDuzenle ister
    //   (atama bitiş tarihi yazma → düzenleme niteliği, silme değil)
    // PASIF sütununda → "İşe Geri Al" butonu (yeni atama aç) — yEkle ister
    const showCikis = !inPasifCol && !inAtanmamisCol && yDuzenle;
    const showGeriAl = inPasifCol && yEkle;
    // Sürüklenebilir: yDuzenle veya yEkle yetkisi gerekli — drag transfer/atama yapar
    const sürüklenebilir = !isReadOnly && (yDuzenle || yEkle);
    // Tıklayınca gün düzenle dialog (atama tarihi yok ise dialogda yeni ekleme açılır)
    // yDuzenle veya yEkle gerekli (atama düzenleme/oluşturma)
    const tiklanabilir = !isReadOnly && !inPasifCol && !inAtanmamisCol && (yDuzenle || yEkle);
    // Mouse ile yakalanmayı engelleyen iç text seçimini bastırmak için select-none
    return (
      <div
        draggable={sürüklenebilir}
        onDragStart={(e) => {
          if (!sürüklenebilir) return;
          // Drag verisi (gerekli değil ama bazı tarayıcılarda drag tetiklemesi için)
          try { e.dataTransfer.setData("text/plain", p.id); } catch { /* sessiz */ }
          onDragStart(p.id, sutunKey);
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
            <div className="font-semibold text-sm text-[#1E3A5F] truncate flex items-center gap-1 flex-wrap">
              <span className="truncate">{p.ad_soyad}</span>
              {p.personel_tipi === "taseron" && (
                <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold flex-shrink-0">TŞ</span>
              )}
              {/* Şantiye-bazlı: rozet sadece bu sütundaki şantiyede teknikse görünür */}
              {teknikPersonelMap.get(p.id)?.has(sutunKey) && (
                <span className="text-[8px] bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded font-bold flex-shrink-0" title="Teknik Personel">
                  Teknik Personel
                </span>
              )}
            </div>
            {p.meslek && <div className="text-[10px] text-gray-500 truncate">{p.meslek}</div>}
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
                  onClick={() => setCikisOnay({ personel: p, santiyeId: sutunKey })}
                  title="Bu şantiyeden işten çıkar (diğer şantiyelerdeki atamaları etkilemez)"
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
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm text-[#1E3A5F] truncate" title={baslik}>{baslik}</h3>
            {(() => {
              // Prim hesabı: yatması gereken - yatan - bordroToplam = sonuç
              if (santiyeId === PASIF_KEY || santiyeId === ATANMAMIS_KEY) return null;
              const prim = primMap.get(santiyeId);
              if (!prim) return null;
              const yatmasi = prim.yatmasiGereken;
              const yatan = prim.yatan;
              const bordro = bordroToplamForSantiye(santiyeId);
              if (yatmasi === 0 && yatan === 0 && bordro === 0) return null;
              const sonuc = yatmasi - yatan - bordro;
              const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
              const sonucClass = sonuc < 0 ? "text-red-600" : sonuc > 0 ? "text-emerald-700" : "text-gray-600";
              // Title: mobilde TruncateTooltip bunu toast olarak gösterir — formülün adı yerine
              // gerçek rakamları (etiketli olarak) göster ki kullanıcı hesabı görebilsin.
              const titleMetni =
                `Yatması Gereken: ${fmt(yatmasi)} ₺\n` +
                `Yatan: ${fmt(yatan)} ₺\n` +
                `Bordro Tahmini: ${fmt(bordro)} ₺\n` +
                `Sonuç: ${fmt(sonuc)} ₺`;
              return (
                <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate" title={titleMetni}>
                  <span className="text-[#1E3A5F]">{fmt(yatmasi)}</span>
                  <span> − </span>
                  <span className="text-emerald-700">{fmt(yatan)}</span>
                  <span> − </span>
                  <span className="text-gray-400">{fmt(bordro)}</span>
                  <span> = </span>
                  <span className={`font-bold ${sonucClass}`}>{fmt(sonuc)}</span>
                </div>
              );
            })()}
          </div>
          {tumGun > 0 && (
            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded font-semibold flex-shrink-0">
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
              <th className="text-left px-2 py-1.5 font-semibold text-gray-600">Meslek</th>
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
    // İşten çıkar: atama düzenlemesi → yDuzenle. Geri al: yeni atama → yEkle.
    const showCikis = !inPasifCol && !inAtanmamisCol && yDuzenle;
    const showGeriAl = inPasifCol && yEkle;
    // Çift tık ile gün düzenle: yDuzenle veya yEkle gerekli
    const tiklanabilir = !isReadOnly && !inPasifCol && !inAtanmamisCol && (yDuzenle || yEkle);
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
          <div className="flex items-center gap-1 flex-wrap">
            <span className="truncate">{p.ad_soyad}</span>
            {(personelAylikToplamMap.get(p.id) ?? 0) > 30 && (
              <span
                className="flex-shrink-0 text-[10px] bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded font-bold cursor-help"
                title={`Bu personel ${ayLabel(seciliAy)} ayında ${personelAylikToplamMap.get(p.id)} gün çalışıyor — 30 günü aşıyor (sadece bilgi)`}
              >
                ⚠️ {personelAylikToplamMap.get(p.id)}g
              </span>
            )}
            {p.personel_tipi === "taseron" && (
              <span className="text-[8px] bg-amber-100 text-amber-700 px-1 py-0.5 rounded font-bold flex-shrink-0">TŞ</span>
            )}
            {/* Şantiye-bazlı: bu satırın şantiyesinde teknikse rozet görünür */}
            {teknikPersonelMap.get(p.id)?.has(sutunKey) && (
              <span className="text-[8px] bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded font-bold flex-shrink-0" title="Teknik Personel">
                Teknik Personel
              </span>
            )}
          </div>
        </td>
        <td className="px-2 py-1.5 text-gray-600 text-[11px]">{p.meslek ?? "—"}</td>
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
                  onClick={() => setCikisOnay({ personel: p, santiyeId: sutunKey })}
                  title="Bu şantiyeden işten çıkar (diğer şantiyelerdeki atamaları etkilemez)"
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
              {onPlus && !isReadOnly && yEkle && (
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
            placeholder="Personel ara (ad, TC, görev) — 'teknik personel' yazarak sadece teknikleri süzebilirsiniz"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
          />
        </div>
        <select
          value={tipFiltre}
          onChange={(e) => setTipFiltre(e.target.value as "tumu" | "teknik")}
          className="h-9 rounded-md border border-input bg-white px-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
          title="Personel tipi filtresi"
        >
          <option value="tumu">Tüm Çalışanlar</option>
          <option value="teknik">Teknik Personel</option>
        </select>
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

      {/* İşlem barı — fixed position. Boşluğa tıkla / ESC ile temizlenir.
           1 kişi: "Transfer / İşten Çıkar"
           Birden fazla: "Toplu Transfer / Toplu İşten Çıkar" */}
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
        {yDuzenle && (
          <Button size="sm" variant="outline"
            onClick={() => setTopluTransferAcik(true)}
            className="border-blue-400 text-blue-700 hover:bg-blue-100">
            {selectedKeys.size > 1 ? "Toplu Transfer" : "Transfer"}
          </Button>
        )}
        {yDuzenle && (
          <Button size="sm" variant="outline"
            onClick={() => setTopluCikisOnay(true)}
            className="border-red-400 text-red-700 hover:bg-red-100">
            {selectedKeys.size > 1 ? "Toplu İşten Çıkar" : "İşten Çıkar"}
          </Button>
        )}
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
          // Firma sırasını korumak için firmalar listesindeki sira_no'ya göre sırala
          // (Yönetim > Firmalar sayfasındaki sıra burada da kullanılır)
          const firmaSiraMap = new Map<string, number>();
          firmalar.forEach((f, i) => firmaSiraMap.set(f.id, i));
          const firmaIds = Array.from(firmaGrup.keys()).sort((a, b) => {
            const fa = firmaSiraMap.get(a) ?? Number.MAX_SAFE_INTEGER;
            const fb = firmaSiraMap.get(b) ?? Number.MAX_SAFE_INTEGER;
            return fa - fb;
          });

          // Arama aktifse → eşleşen personel İÇEREN şantiyeleri göster (boşlar gizli)
          // Dropdown filtre aktifse → tüm şantiyeler görünür (boşlar da görünür)
          // HİÇBİR durumda accordion'lar otomatik AÇILMAZ — kullanıcı kendi açar.
          const aramaAktif = arama.trim().length > 0;
          return firmaIds.map((fId, fIdx) => {
            const firma = firmalar.find((f) => f.id === fId);
            const firmaAd = firma?.firma_adi ?? "(Firma atanmamış)";
            const tumFirmaSantiyeler = firmaGrup.get(fId) ?? [];
            // Arama aktifken: SADECE eşleşen personel içeren şantiyeler görünür
            const firmaSantiyeler = aramaAktif
              ? tumFirmaSantiyeler.filter((s) => (kanbanMap.get(s.id) ?? []).length > 0)
              : tumFirmaSantiyeler;
            // Arama aktifken o firmanın eşleşen şantiyesi yoksa firmayı da gizle
            if (aramaAktif && firmaSantiyeler.length === 0) return null;
            // Firma accordion'u kullanıcı kontrollü — auto-expand yok
            const firmaAcik = expandedFirmalar.has(fId);
            // Firma toplam: kişi sayısı + gün + prim hesabı toplamı
            let firmaToplamKisi = 0;
            let firmaToplamGun = 0;
            // Firmanın tüm şantiyelerinin prim hesabı (her şantiyenin yanındaki rakamların toplamı)
            let firmaYatmasiGereken = 0;
            let firmaYatan = 0;
            let firmaBordro = 0;
            for (const s of firmaSantiyeler) {
              const liste = kanbanMap.get(s.id) ?? [];
              firmaToplamKisi += liste.length;
              for (const p of liste) firmaToplamGun += gunMap.get(p.id)?.get(s.id) ?? 0;
              const prim = primMap.get(s.id);
              if (prim) {
                firmaYatmasiGereken += prim.yatmasiGereken;
                firmaYatan += prim.yatan;
              }
              firmaBordro += bordroToplamForSantiye(s.id);
            }
            const firmaSonuc = firmaYatmasiGereken - firmaYatan - firmaBordro;
            const firmaPrimVar = firmaYatmasiGereken !== 0 || firmaYatan !== 0 || firmaBordro !== 0;
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
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-base text-white truncate" title={firmaAd}>{firmaAd}</h2>
                    {firmaPrimVar && (() => {
                      const fmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
                      const sonucClass = firmaSonuc < 0 ? "text-red-200" : firmaSonuc > 0 ? "text-emerald-200" : "text-white/80";
                      // Title: mobilde TruncateTooltip toast ile gösterir — formül yerine gerçek rakamlar.
                      const titleMetni =
                        `Tüm işlerin toplamı (${firmaAd}):\n` +
                        `Yatması Gereken: ${fmt(firmaYatmasiGereken)} ₺\n` +
                        `Yatan: ${fmt(firmaYatan)} ₺\n` +
                        `Bordro Tahmini: ${fmt(firmaBordro)} ₺\n` +
                        `Sonuç: ${fmt(firmaSonuc)} ₺`;
                      return (
                        <div className="text-[10px] text-white/80 font-mono mt-0.5 truncate" title={titleMetni}>
                          <span className="text-white">{fmt(firmaYatmasiGereken)}</span>
                          <span> − </span>
                          <span className="text-emerald-200">{fmt(firmaYatan)}</span>
                          <span> − </span>
                          <span className="text-white/60">{fmt(firmaBordro)}</span>
                          <span> = </span>
                          <span className={`font-bold ${sonucClass}`}>{fmt(firmaSonuc)}</span>
                        </div>
                      );
                    })()}
                  </div>
                  <span className="text-[11px] bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                    {firmaSantiyeler.length} iş
                  </span>
                  <span className="text-[11px] bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                    {firmaToplamKisi} kişi
                  </span>
                  {firmaToplamGun > 0 && (
                    <span className="text-[11px] bg-emerald-500 text-white px-2 py-0.5 rounded-full font-bold flex-shrink-0">
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
                        // Şantiye accordion'u kullanıcı kontrollü — arama/filtre auto-expand yok.
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
                            onPlus={!isReadOnly && yEkle ? () => {
                              setTopluEkleSantiyeId(s.id);
                              setTopluSecilenler(new Set());
                              setTopluArama("");
                              setTopluTarih(yerelBugun());
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

        {/* Atanmamış ve İşten Çıkarılanlar listeleri kullanıcı isteği üzerine kaldırıldı.
            Personeller hala kanban'a eklenirken sınıflandırılır (kanbanMap üzerinde),
            sadece UI'da gösterilmiyor. */}
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
              <Label className="text-xs">Cep Telefonu <span className="text-red-500">*</span></Label>
              <Input
                type="tel"
                value={ekleCepTelefon}
                onChange={(e) => setEkleCepTelefon(formatTelefon(e.target.value))}
                placeholder="0535 535 35 35"
                required
              />
            </div>
            <div>
              <Label className="text-xs">Meslek <span className="text-red-500">*</span></Label>
              <select value={ekleMeslek} onChange={(e) => setEkleMeslek(e.target.value)}
                className="w-full h-9 rounded-md border border-input bg-white px-3 text-sm">
                <option value="">Seçiniz</option>
                {meslekSecenekleri.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              {meslekSecenekleri.length === 0 && (
                <p className="text-[10px] text-amber-600 mt-1">
                  Meslek listesi boş. Tanımlamalar &gt; <code>personel_meslek</code> kategorisinden ekleyin.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Şantiye <span className="text-red-500">*</span></Label>
              <select
                value={ekleSantiye}
                onChange={(e) => { setEkleSantiye(e.target.value); setEkleTeknik(false); }}
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
            {/* Teknik Personel sorusu — şantiyenin "teknik_personel_sayisi" hedefine göre
                kalan slot varsa sorulur. Atamalara, giriş/çıkış tarihlerine ETKİSİ YOKTUR. */}
            {(() => {
              if (!ekleSantiye) return null;
              const santiye = santiyeler.find((s) => s.id === ekleSantiye);
              const target = santiye?.teknik_personel_sayisi ?? 0;
              const mevcut = aktifTeknikSayisiMap.get(ekleSantiye) ?? 0;
              const kalan = teknikKalanSlot(ekleSantiye);
              // Şantiyede teknik personel hedefi tanımlı değilse soru gösterme
              if (target <= 0) return null;
              // Kontenjan dolduysa bilgi mesajı göster
              if (kalan <= 0) {
                return (
                  <div className="text-[11px] text-gray-500 p-2 bg-gray-50 border border-gray-200 rounded">
                    Bu şantiye için teknik personel kontenjanı dolu ({mevcut}/{target}). Teknik personel olarak işaretlenemez.
                  </div>
                );
              }
              return (
                <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer ${
                  ekleTeknik ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200 hover:bg-gray-50"
                }`}>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-indigo-600"
                    checked={ekleTeknik}
                    onChange={(e) => setEkleTeknik(e.target.checked)}
                  />
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-[#1E3A5F]">
                      Teknik Personel mi?
                      {ekleTeknik && (
                        <span className="ml-2 text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">EVET</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      Bu şantiyede teknik personel kotası: <strong>{mevcut}/{target}</strong> dolu, <strong>{kalan}</strong> slot kaldı.
                      İşaretlerseniz personelin adı yanında &quot;Teknik Personel&quot; rozeti görünür.
                    </div>
                  </div>
                </label>
              );
            })()}
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
            const q = trAramaNormalize(topluArama);
            const goruntulenen = q ? aday.filter((p) => {
              const text = trAramaNormalize([p.ad_soyad, p.tc_kimlik_no, p.gorev, p.meslek].filter(Boolean).join(" "));
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
                              {p.meslek ?? ""}
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
            const today = yerelBugun();
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

            // Teknik mi: PERSONEL × ŞANTİYE BAZLI — sadece bilgi amaçlı bayrak.
            // Atamalar veya giriş/çıkış tarihleri ETKİLENMEZ.
            const teknikMi = !!teknikPersonelMap.get(gunEdit.personel.id)?.has(gunEdit.santiyeId);

            return (
              <div className="space-y-3 py-2">
                <div className="text-xs text-gray-500">
                  Ay: <span className="font-semibold">{ayLabel(seciliAy)}</span> · Toplam atama: {liste.length}
                </div>

                {/* Teknik Personel toggle — PERSONEL × ŞANTİYE BAZLI, sadece bilgi amaçlı rozet.
                    Atamalara, giriş/çıkış tarihlerine veya gün hesabına HİÇBİR ETKİSİ YOKTUR. */}
                {!isReadOnly && yDuzenle && (
                  <label className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer ${
                    teknikMi ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200 hover:bg-gray-50"
                  }`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-indigo-600"
                      checked={teknikMi}
                      onChange={async (e) => {
                        const yeniTeknik = e.target.checked;
                        try {
                          // SADECE personel_teknik tablosuna satır eklenir/silinir.
                          // Atama tablosuna, giriş/çıkış kayıtlarına dokunulmaz.
                          await setPersonelTeknikSantiye(gunEdit.personel.id, gunEdit.santiyeId, yeniTeknik);
                          await loadData();
                          toast.success(yeniTeknik
                            ? "Bu şantiyede teknik personel olarak işaretlendi."
                            : "Bu şantiyede teknik personel işareti kaldırıldı.");
                        } catch (err) {
                          // Hatayı consola da yaz, kullanıcı F12 → Console'da görebilir
                          console.error("[teknik personel toggle] Hata:", err);
                          const msg = err instanceof Error ? err.message : String(err);
                          toast.error(`Teknik personel kaydı yapılamadı: ${msg}`);
                        }
                      }}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-[#1E3A5F]">
                        Teknik Personel
                        {teknikMi && (
                          <span className="ml-2 text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded font-bold">AÇIK</span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-500">
                        Sadece bu şantiyede bilgi amaçlı bir etikettir. Giriş/çıkış kayıtlarına, gün sayısına veya bordro hesabına etkisi yoktur.
                      </div>
                    </div>
                  </label>
                )}

                {/* Hızlı manuel gün girişi — atama tarihlerini DEĞİŞTİRMEZ.
                    Admin: max sınırsız (ay'ın gün sayısı veya yüksek bir limit).
                    Diğerleri: doğal hesap × ay sonu (çıkış tarihi varsa o tarihe kadar). */}
                {!isReadOnly && (yDuzenle || yEkle) && (() => {
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
                    SADECE bu şantiyedeki atamalar gösterilir (santiye_id filtresi).
                    Tarih sırasına göre yeniden eskiye. Varsayılan: en yeni 2 atama,
                    fazlası varsa "Devamını Gör" butonuyla açılır.
                    SADECE ADMIN (yönetici) görebilir/düzenleyebilir. */}
                {!isReadOnly && isYonetici && (() => {
                  const tumAtamalar = atamalar
                    .filter((a) => a.personel_id === gunEdit.personel.id && a.santiye_id === gunEdit.santiyeId)
                    .sort((a, b) => b.baslangic_tarihi.localeCompare(a.baslangic_tarihi));
                  return (
                    <AtamaListesi
                      atamalar={tumAtamalar}
                      liste={liste}
                      ayInGun={ayInGun}
                      onSave={(id, bas, bit) => gunEditAtamaUpdate(id, bas, bit)}
                      onDelete={(id) => gunEditAtamaSil(id)}
                      isYonetici={isYonetici}
                    />
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
                    if (!yDuzenle && !yEkle) { toast.error("Yetkiniz yok."); return; }
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
          <DialogHeader><DialogTitle>{selectedKeys.size > 1 ? "Toplu Transfer" : "Transfer"} ({selectedKeys.size} kişi)</DialogTitle></DialogHeader>
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
                  // Firma sırasını korumak için sira_no'ya göre (Yönetim > Firmalar sırası)
                  const firmaSiraMap = new Map<string, number>();
                  firmalar.forEach((f, i) => firmaSiraMap.set(f.id, i));
                  const firmaIds = Array.from(grup.keys()).sort((a, b) => {
                    const fa = firmaSiraMap.get(a) ?? Number.MAX_SAFE_INTEGER;
                    const fb = firmaSiraMap.get(b) ?? Number.MAX_SAFE_INTEGER;
                    return fa - fb;
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
            <div>
              <Label className="text-xs">Transfer Tarihi <span className="text-red-500">*</span></Label>
              {(() => {
                const today = new Date();
                const min = new Date(); min.setDate(min.getDate() - 9);
                const fmtIso = (d: Date) => tarihStr(d);
                return (
                  <Input
                    type="date"
                    value={topluTransferTarih}
                    min={isYonetici ? undefined : fmtIso(min)}
                    max={isYonetici ? undefined : fmtIso(today)}
                    onChange={(e) => setTopluTransferTarih(e.target.value)}
                  />
                );
              })()}
              <p className="text-[10px] text-gray-500 mt-0.5">
                {isYonetici
                  ? "🔓 Admin: istediğiniz tarihi girebilirsiniz."
                  : "Bugünden en fazla 9 gün geriye tarih girebilirsiniz."}
              </p>
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

      {/* Toplu Çıkış Onayı + Tarih */}
      <Dialog open={topluCikisOnay} onOpenChange={(o) => !o && setTopluCikisOnay(false)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{selectedKeys.size > 1 ? "Toplu İşten Çıkar" : "İşten Çıkar"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              <span className="font-bold">{selectedKeys.size} kişi</span> işten çıkarılacak ve muhasebeye{selectedKeys.size > 1 ? " toplu" : ""} mail kuyruğuna eklenecek.
            </p>
            <div>
              <Label className="text-xs">Çıkış Tarihi <span className="text-red-500">*</span></Label>
              {(() => {
                const today = new Date();
                const min = new Date(); min.setDate(min.getDate() - 9);
                const fmtIso = (d: Date) => tarihStr(d);
                return (
                  <Input
                    type="date"
                    value={topluCikisTarih}
                    min={isYonetici ? undefined : fmtIso(min)}
                    max={isYonetici ? undefined : fmtIso(today)}
                    onChange={(e) => setTopluCikisTarih(e.target.value)}
                  />
                );
              })()}
              <p className="text-[10px] text-gray-500 mt-0.5">
                {isYonetici
                  ? "🔓 Admin: istediğiniz tarihi girebilirsiniz."
                  : "Bugünden en fazla 9 gün geriye tarih girebilirsiniz."}
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setTopluCikisOnay(false)}>İptal</Button>
              <Button variant="destructive" size="sm" disabled={topluCikisIsleniyor} onClick={topluCikarYap}>
                {topluCikisIsleniyor ? "İşleniyor..." : "Çıkar (Mail Kuyruğa)"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Çıkış Onayı + Tarih */}
      <Dialog open={!!cikisOnay} onOpenChange={(o) => !o && setCikisOnay(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>İşten Çıkar</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-700">
              <span className="font-bold">{cikisOnay?.personel.ad_soyad}</span>
              {cikisOnay && (() => {
                const sAd = santiyeler.find((s) => s.id === cikisOnay.santiyeId)?.is_adi;
                return sAd ? <span> · <span className="text-red-600 font-semibold">{sAd}</span> şantiyesinden çıkarılacak.</span> : null;
              })()}
            </p>
            <p className="text-[10px] text-gray-500">
              ℹ️ Bu işlem yalnızca seçilen şantiyedeki atamayı kapatır — personel diğer şantiyelerde aktifse orada kalır.
            </p>
            <div>
              <Label className="text-xs">Çıkış Tarihi <span className="text-red-500">*</span></Label>
              {(() => {
                const today = new Date();
                const min = new Date(); min.setDate(min.getDate() - 9);
                const fmtIso = (d: Date) => tarihStr(d);
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
                  : "Bugünden en fazla 9 gün geriye tarih girebilirsiniz."}
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setCikisOnay(null)}>İptal</Button>
              <Button variant="destructive" size="sm" onClick={cikisYap}>Çıkar + Mail Kuyruğa</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Teknik Personel Sorusu — yeni iş eklendiğinde işyeri teslim tarihi ile giriş için */}
      <Dialog
        open={!!teknikSorusu}
        onOpenChange={(o) => {
          if (!o && teknikSorusu) {
            teknikSorusu.resolve("iptal");
            setTeknikSorusu(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Teknik Personel Onayı</DialogTitle>
          </DialogHeader>
          {teknikSorusu && (() => {
            const t = teknikSorusu;
            const fmtTr = (iso: string) => {
              const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
              if (!m) return iso;
              return `${m[3]}.${m[2]}.${m[1]}`;
            };
            const overflow = t.eklenecekKisiSayisi > t.kalanSlot;
            const teknikN = Math.min(t.kalanSlot, t.eklenecekKisiSayisi);
            const normalN = Math.max(0, t.eklenecekKisiSayisi - t.kalanSlot);
            return (
              <div className="space-y-3 py-2">
                <div className="bg-amber-50 border border-amber-200 rounded p-2.5 text-sm leading-relaxed">
                  <p>
                    <span className="font-bold text-[#1E3A5F]">{t.santiyeAd}</span> işi için
                    <strong> {t.teknikSayisi} kişi teknik personel</strong> olarak işe alınmalıdır.
                  </p>
                  <p className="mt-2 text-xs text-amber-800">
                    Kalan teknik personel kontenjanı: <strong>{t.kalanSlot} kişi</strong>
                    {" · "}
                    Eklediğiniz: <strong>{t.eklenecekKisiSayisi} kişi</strong>
                  </p>
                </div>

                {overflow && (
                  <div className="bg-blue-50 border-2 border-blue-300 rounded p-2.5 text-xs leading-relaxed">
                    <p className="font-semibold text-blue-900 mb-1">⚠️ Kontenjan aşımı: kişiler bölünecek</p>
                    <p className="text-blue-800">
                      Evet derseniz <strong>ilk {teknikN} kişi</strong> teknik personel olarak (teslim tarihi: <strong>{fmtTr(t.teslimTarihi)}</strong>),
                      kalan <strong>{normalN} kişi</strong> ise <strong>bugün</strong> tarihi ile eklenecek.
                    </p>
                    <p className="text-[10px] text-blue-700 mt-1">
                      Hangi kişilerin teknik personel olacağına karar vermek istiyorsanız İptal'e basın ve daha az kişi seçerek tekrar deneyin.
                    </p>
                  </div>
                )}

                {/* Seçilen kişilerin listesi — kim teknik kim normal olacak */}
                <div className="bg-white border border-gray-200 rounded p-2.5 text-xs space-y-2">
                  {teknikN > 0 && (
                    <div>
                      <div className="font-semibold text-emerald-700 mb-1">
                        ✓ Teknik personel olacak ({teknikN} kişi · teslim tarihi {fmtTr(t.teslimTarihi)}):
                      </div>
                      <ul className="space-y-0.5 ml-3">
                        {t.kisiAdlari.slice(0, teknikN).map((ad, i) => (
                          <li key={`tek-${i}`} className="text-emerald-800">• {ad}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {normalN > 0 && (
                    <div className={teknikN > 0 ? "border-t pt-2" : ""}>
                      <div className="font-semibold text-gray-700 mb-1">
                        — Bugün tarihi ile eklenecek ({normalN} kişi):
                      </div>
                      <ul className="space-y-0.5 ml-3">
                        {t.kisiAdlari.slice(teknikN).map((ad, i) => (
                          <li key={`nor-${i}`} className="text-gray-700">• {ad}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <p className="text-sm text-gray-700">
                  Şu an eklediğiniz <strong>{t.eklenecekKisiSayisi} kişi</strong> teknik personel mi?
                </p>
                <div className="text-[11px] text-gray-500 leading-relaxed border-l-2 border-blue-300 pl-2">
                  <strong className="text-emerald-700">Evet</strong>:
                  {overflow ? (
                    <> İlk {teknikN} kişi teknik personel (teslim tarihi <strong>{fmtTr(t.teslimTarihi)}</strong>), kalan {normalN} kişi bugün</>
                  ) : (
                    <> Hepsi teknik personel — başlangıç tarihi = İşyeri teslim tarihi (<strong>{fmtTr(t.teslimTarihi)}</strong>)</>
                  )}
                  <br />
                  <strong className="text-gray-700">Hayır</strong>: Hepsi bugün tarihi (normal giriş)
                </div>
                <div className="flex gap-2 justify-end pt-2 border-t flex-wrap">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { t.resolve("iptal"); setTeknikSorusu(null); }}
                  >
                    İptal
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { t.resolve("hayir"); setTeknikSorusu(null); }}
                  >
                    Hayır (Hepsi Bugün)
                  </Button>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => { t.resolve("evet"); setTeknikSorusu(null); }}
                  >
                    {overflow ? `Evet (İlk ${teknikN} Teknik)` : "Evet (Teslim Tarihi)"}
                  </Button>
                </div>
              </div>
            );
          })()}
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
                      {liste.map((c) => {
                        const not = satirNotlari[c.id] ?? "";
                        return (
                        <li key={c.id} className="text-xs bg-white/70 rounded px-2 py-1.5 min-w-0">
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="font-semibold text-gray-800 truncate" title={c.personelAd}>{c.personelAd}</div>
                              <div className="text-gray-500 text-[10px] break-words">
                                {c.personelTc && <span className="font-mono">{c.personelTc}</span>}
                                {c.personelMeslek && <span> · {c.personelMeslek}</span>}
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
                          </div>
                          {/* Personel bazlı not — mailde kırmızı renkle satırın altında çıkar */}
                          <input
                            type="text"
                            value={not}
                            onChange={(e) => setSatirNotlari((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            placeholder="Bu personel için not (mailde kırmızı renkle gözükür)"
                            className="mt-1 w-full text-[11px] border border-red-200 bg-red-50/40 rounded px-1.5 py-1 outline-none placeholder:text-red-300 text-red-700 focus:border-red-500 focus:bg-white"
                          />
                        </li>
                        );
                      })}
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
