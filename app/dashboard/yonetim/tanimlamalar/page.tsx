// Tanımlamalar sayfası - Dinamik kategori ekleme, sekme ilişkilendirme
"use client";

import { useEffect, useState, useCallback } from "react";
import {
  getTumTanimlamalar,
  createTanimlama,
  updateTanimlama,
  deleteTanimlama,
  packHesapKisaAd,
  unpackHesapKisaAd,
  packAcenteKisaAd,
  unpackAcenteKisaAd,
  SEKME_LISTESI,
} from "@/lib/supabase/queries/tanimlamalar";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import {
  getAracCinsiYakitLimitler,
  upsertAracCinsiYakitLimit,
  deleteAracCinsiYakitLimit,
} from "@/lib/supabase/queries/yakit";
import { formatBaslik, formatBuyukHarf, formatMuhatap, formatKisiAdi } from "@/lib/utils/isim";
import type { Tanimlama, Firma, AracCinsiYakitLimit } from "@/lib/supabase/types";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, ArrowUp, ArrowDown, Settings, Pencil, Fuel, ChevronDown, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";

const selectClass = "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

// Muhatap'ı tek satır olarak göster: çok satırlı kaydı boşluklarla birleştirir
// Örn: "T.C.\nDevlet Su İşleri\nTOKAT" -> "T.C. Devlet Su İşleri TOKAT"
function tekSatirMuhatap(deger: string): string {
  return deger
    .split("\n")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

// Kategori-bazlı değer formatlama
// muhatap/banka_muhatap için çok satırlı muhatap formatı, talimat_kisi için kişi adı,
// diğerleri için title case
function formatTanimlamaDeger(kategori: string, deger: string): string {
  const k = kategori.toLowerCase();
  if (k === "muhatap" || k === "banka_muhatap") return formatMuhatap(deger);
  if (k === "talimat_kisi") return formatKisiAdi(deger);
  return formatBaslik(deger);
}

export default function TanimlamalarPage() {
  const [tanimlamalar, setTanimlamalar] = useState<Tanimlama[]>([]);
  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [loading, setLoading] = useState(true);
  const [yeniDegerler, setYeniDegerler] = useState<Record<string, string>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  // İş grupları accordion state
  const [isGrupAcik, setIsGrupAcik] = useState<Record<string, boolean>>({});
  const [isGrupAltAcik, setIsGrupAltAcik] = useState<Record<string, boolean>>({});

  // Banka hesap tanımlama formu (hesap no + firma + banka birlikte)
  const [yeniHesapNo, setYeniHesapNo] = useState("");
  const [yeniHesapFirmaId, setYeniHesapFirmaId] = useState("");
  const [yeniHesapMuhatapId, setYeniHesapMuhatapId] = useState("");

  // Acente ekleme
  const [yeniAcenteAd, setYeniAcenteAd] = useState("");
  const [yeniAcenteEposta, setYeniAcenteEposta] = useState("");
  const [yeniAcenteTelefon, setYeniAcenteTelefon] = useState("");
  const [yeniAcenteCep, setYeniAcenteCep] = useState("");
  const [yeniAcenteIlgili, setYeniAcenteIlgili] = useState("");

  // Banka hesabı için inline yeni banka ekleme (banka_muhatap)
  const [yeniBankaDialogOpen, setYeniBankaDialogOpen] = useState(false);
  const [yeniBankaAdi, setYeniBankaAdi] = useState("");
  const [yeniBankaKisaAd, setYeniBankaKisaAd] = useState("");

  // İnline değer düzenleme state'i (id -> yeni metin)
  const [duzenleId, setDuzenleId] = useState<string | null>(null);
  const [duzenleDeger, setDuzenleDeger] = useState("");

  // Yeni kategori dialog
  const [yeniKatDialog, setYeniKatDialog] = useState(false);
  const [yeniKatAdi, setYeniKatAdi] = useState("");
  const [yeniKatSekme, setYeniKatSekme] = useState("genel");

  // Kategori düzenleme dialog
  const [duzenleKat, setDuzenleKat] = useState<string | null>(null);
  const [duzenleKatAdi, setDuzenleKatAdi] = useState("");
  const [duzenleKatSekme, setDuzenleKatSekme] = useState("genel");

  // Kategori silme dialog
  const [silKat, setSilKat] = useState<string | null>(null);

  // Yakıt Tüketim Limitleri
  const [yakitLimitler, setYakitLimitler] = useState<AracCinsiYakitLimit[]>([]);
  const [yakitLimitCins, setYakitLimitCins] = useState("");
  const [yakitLimitSayacTipi, setYakitLimitSayacTipi] = useState<"km" | "saat">("km");
  const [yakitLimitAlt, setYakitLimitAlt] = useState("");
  const [yakitLimitUst, setYakitLimitUst] = useState("");
  const [yakitLimitSilId, setYakitLimitSilId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [data, fData, lData] = await Promise.all([
        getTumTanimlamalar(),
        getFirmalar(),
        getAracCinsiYakitLimitler().catch(() => [] as AracCinsiYakitLimit[]),
      ]);
      setFirmalar(fData ?? []);
      setYakitLimitler(lData);
      const items = data ?? [];

      // Sıra numarası olmayan veya çakışan kayıtları düzelt
      const katMap = new Map<string, typeof items>();
      for (const t of items) {
        if (!katMap.has(t.kategori)) katMap.set(t.kategori, []);
        katMap.get(t.kategori)!.push(t);
      }
      for (const [, katItems] of katMap) {
        const needsFix = katItems.some((t, i) => t.sira !== i + 1);
        if (needsFix) {
          for (let i = 0; i < katItems.length; i++) {
            if (katItems[i].sira !== i + 1) {
              katItems[i].sira = i + 1;
              updateTanimlama(katItems[i].id, { sira: i + 1 }).catch(() => {});
            }
          }
        }
      }

      setTanimlamalar(items);
    } catch {
      toast.error("Tanımlamalar yüklenirken hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Benzersiz kategorileri çıkar
  const kategoriler: { key: string; sekme: string | null }[] = [];
  const katSet = new Set<string>();
  for (const t of tanimlamalar) {
    if (!katSet.has(t.kategori)) {
      katSet.add(t.kategori);
      kategoriler.push({ key: t.kategori, sekme: t.sekme });
    }
  }
  // Yazışmalar için gereken kategoriler otomatik eklensin (ilk kayıt olmasa da görünsün)
  if (!katSet.has("muhatap")) {
    kategoriler.push({ key: "muhatap", sekme: "yazismalar" });
    katSet.add("muhatap");
  }
  if (!katSet.has("banka_muhatap")) {
    kategoriler.push({ key: "banka_muhatap", sekme: "yazismalar" });
    katSet.add("banka_muhatap");
  }
  if (!katSet.has("banka_hesap")) {
    kategoriler.push({ key: "banka_hesap", sekme: "yazismalar" });
    katSet.add("banka_hesap");
  }
  // Sigorta & Muayene kategorileri otomatik eklensin
  if (!katSet.has("sigorta_firmasi")) {
    kategoriler.push({ key: "sigorta_firmasi", sekme: "sigorta-muayene" });
    katSet.add("sigorta_firmasi");
  }
  if (!katSet.has("sigorta_acente")) {
    kategoriler.push({ key: "sigorta_acente", sekme: "sigorta-muayene" });
    katSet.add("sigorta_acente");
  }
  if (!katSet.has("sigorta_yaklasir_gun")) {
    kategoriler.push({ key: "sigorta_yaklasir_gun", sekme: "sigorta-muayene" });
    katSet.add("sigorta_yaklasir_gun");
  }
  if (!katSet.has("sigorta_az_kaldi_gun")) {
    kategoriler.push({ key: "sigorta_az_kaldi_gun", sekme: "sigorta-muayene" });
    katSet.add("sigorta_az_kaldi_gun");
  }
  kategoriler.sort((a, b) => a.key.localeCompare(b.key, "tr"));

  // Banka muhatapları (banka_hesap formunda seçim için)
  const bankaMuhataplari = tanimlamalar
    .filter((t) => t.kategori === "banka_muhatap" && t.aktif && t.deger !== "(boş)")
    .sort((a, b) => a.sira - b.sira);

  function getKategoriItems(kategori: string) {
    return tanimlamalar
      .filter((t) => t.kategori === kategori)
      .sort((a, b) => a.sira - b.sira);
  }

  function getSekmeLabel(sekme: string | null): string {
    if (!sekme) return "Genel";
    return SEKME_LISTESI.find((s) => s.key === sekme)?.label ?? sekme;
  }

  async function handleYeniKategori() {
    if (!yeniKatAdi.trim()) { toast.error("Kategori adı boş olamaz."); return; }
    const key = yeniKatAdi.trim();
    if (katSet.has(key)) { toast.error("Bu kategori zaten mevcut."); return; }

    // Boş bir placeholder değer ekleyerek kategoriyi oluştur
    try {
      await createTanimlama({
        kategori: key,
        sekme: yeniKatSekme === "genel" ? null : yeniKatSekme,
        deger: "(boş)",
        sira: 0,
        aktif: false,
      });
      // Placeholder'ı hemen sil - sadece kategori görünsün diye ekledik
      await loadData();
      // Aslında placeholder'ı silmeyip görünmez yapalım - ilk gerçek değer eklenince temizlenir
      toast.success(`"${key}" kategorisi oluşturuldu.`);
      setYeniKatDialog(false);
      setYeniKatAdi("");
      setYeniKatSekme("genel");
    } catch {
      toast.error("Kategori oluşturulurken hata oluştu.");
    }
  }

  async function handleEkle(kategori: string) {
    const ham = yeniDegerler[kategori]?.trim();
    if (!ham) { toast.error("Değer boş olamaz."); return; }

    // Kategori bazlı format uygula
    const deger = formatTanimlamaDeger(kategori, ham);

    const mevcut = tanimlamalar.filter((t) => t.kategori === kategori);
    if (mevcut.some((t) => t.deger.toLowerCase() === deger.toLowerCase())) {
      toast.error("Bu değer zaten ekli.");
      return;
    }

    // Kategorinin sekme bilgisini bul
    const katInfo = kategoriler.find((k) => k.key === kategori);

    try {
      const sira = mevcut.filter((t) => t.aktif).length + 1;
      await createTanimlama({
        kategori,
        sekme: katInfo?.sekme ?? null,
        deger,
        sira,
        aktif: true,
      });

      // Placeholder (boş) kayıtları temizle
      const placeholders = mevcut.filter((t) => t.deger === "(boş)");
      for (const p of placeholders) {
        await deleteTanimlama(p.id);
      }

      setYeniDegerler((p) => ({ ...p, [kategori]: "" }));
      await loadData();
      toast.success(`"${deger}" eklendi.`);
    } catch {
      toast.error("Eklenirken hata oluştu.");
    }
  }

  // Banka hesabı ekleme (hesap no + firma + banka birlikte)
  async function handleBankaHesapEkle() {
    if (!yeniHesapNo.trim()) { toast.error("Hesap no boş olamaz."); return; }
    if (!yeniHesapFirmaId) { toast.error("Firma seçilmeli."); return; }
    if (!yeniHesapMuhatapId) { toast.error("Banka seçilmeli."); return; }

    // Hesap no için yalnız trim (sadece rakam/karakter, formatlamaya gerek yok)
    const hesapNoTemiz = yeniHesapNo.trim();

    const mevcut = tanimlamalar.filter((t) => t.kategori === "banka_hesap");
    if (mevcut.some((t) => t.deger === hesapNoTemiz)) {
      toast.error("Bu hesap no zaten ekli.");
      return;
    }

    try {
      const sira = mevcut.filter((t) => t.aktif).length + 1;
      await createTanimlama({
        kategori: "banka_hesap",
        sekme: "yazismalar",
        deger: hesapNoTemiz,
        kisa_ad: packHesapKisaAd(yeniHesapMuhatapId, yeniHesapFirmaId),
        sira,
        aktif: true,
      });

      // Placeholder'ları temizle
      const placeholders = mevcut.filter((t) => t.deger === "(boş)");
      for (const p of placeholders) {
        await deleteTanimlama(p.id);
      }

      setYeniHesapNo("");
      setYeniHesapFirmaId("");
      setYeniHesapMuhatapId("");
      await loadData();
      toast.success("Hesap eklendi.");
    } catch {
      toast.error("Eklenirken hata oluştu.");
    }
  }

  // Tanımlamalar sayfasından yeni banka (banka_muhatap) ekle
  async function handleYeniBanka() {
    if (!yeniBankaAdi.trim()) { toast.error("Banka adı boş olamaz."); return; }
    try {
      // Banka muhatap formatı (T.C., Şube Adı, ŞEHİR) ve kısa ad BÜYÜK
      const formatliAd = formatMuhatap(yeniBankaAdi);
      const formatliKisa = yeniBankaKisaAd.trim() ? formatBuyukHarf(yeniBankaKisaAd) : null;

      const mevcut = tanimlamalar.filter((t) => t.kategori === "banka_muhatap");
      const sira = mevcut.filter((t) => t.aktif).length + 1;
      const yeni = await createTanimlama({
        kategori: "banka_muhatap",
        sekme: "yazismalar",
        deger: formatliAd,
        kisa_ad: formatliKisa,
        sira,
        aktif: true,
      });
      // Placeholder'ları temizle
      const placeholders = mevcut.filter((t) => t.deger === "(boş)");
      for (const p of placeholders) {
        await deleteTanimlama(p.id);
      }
      await loadData();
      setYeniHesapMuhatapId(yeni.id);
      setYeniBankaAdi("");
      setYeniBankaKisaAd("");
      setYeniBankaDialogOpen(false);
      toast.success("Banka eklendi.");
    } catch {
      toast.error("Banka eklenemedi.");
    }
  }

  // İnline değer düzenleme — formatlayıp kaydeder
  async function handleDuzenleKaydet(t: Tanimlama) {
    const ham = duzenleDeger.trim();
    if (!ham) { toast.error("Değer boş olamaz."); setDuzenleId(null); return; }
    const yeni = formatTanimlamaDeger(t.kategori, ham);
    if (yeni === t.deger) { setDuzenleId(null); return; }
    try {
      await updateTanimlama(t.id, { deger: yeni });
      await loadData(); // tam yenileme
      toast.success("Değer güncellendi.");
    } catch { toast.error("Güncelleme hatası."); }
    finally { setDuzenleId(null); setDuzenleDeger(""); }
  }

  async function handleSil() {
    if (!deleteId) return;
    try {
      await deleteTanimlama(deleteId);
      await loadData();
      toast.success("Silindi.");
    } catch { toast.error("Silinirken hata oluştu."); }
    finally { setDeleteId(null); }
  }

  async function handleToggleAktif(t: Tanimlama) {
    try {
      await updateTanimlama(t.id, { aktif: !t.aktif });
      await loadData();
    } catch { toast.error("Güncelleme hatası."); }
  }

  function openDuzenleKat(key: string, sekme: string | null) {
    setDuzenleKat(key);
    setDuzenleKatAdi(key);
    setDuzenleKatSekme(sekme ?? "genel");
  }

  async function handleDuzenleKat() {
    if (!duzenleKat || !duzenleKatAdi.trim()) { toast.error("Kategori adı boş olamaz."); return; }
    const yeniAd = duzenleKatAdi.trim();
    const yeniSekme = duzenleKatSekme === "genel" ? null : duzenleKatSekme;

    try {
      // O kategorideki tüm kayıtların kategori adını ve sekme bilgisini güncelle
      const items = tanimlamalar.filter((t) => t.kategori === duzenleKat);
      await Promise.all(items.map((t) => updateTanimlama(t.id, { kategori: yeniAd, sekme: yeniSekme })));
      await loadData();
      toast.success("Kategori güncellendi.");
    } catch { toast.error("Güncelleme hatası."); }
    setDuzenleKat(null);
  }

  async function handleSilKat() {
    if (!silKat) return;
    try {
      const items = tanimlamalar.filter((t) => t.kategori === silKat);
      await Promise.all(items.map((t) => deleteTanimlama(t.id)));
      await loadData();
      toast.success("Kategori ve tüm değerleri silindi.");
    } catch { toast.error("Silme hatası."); }
    setSilKat(null);
  }

  async function handleSiraDegistir(kategori: string, index: number, yon: "yukari" | "asagi") {
    const items = getKategoriItems(kategori).filter((t) => t.deger !== "(boş)");
    const hedefIndex = yon === "yukari" ? index - 1 : index + 1;
    if (hedefIndex < 0 || hedefIndex >= items.length) return;

    const a = items[index];
    const b = items[hedefIndex];

    // Yeni sıra numaralarını index+1 olarak ata (swap)
    const siraA = hedefIndex + 1;
    const siraB = index + 1;

    try {
      await Promise.all([
        updateTanimlama(a.id, { sira: siraA }),
        updateTanimlama(b.id, { sira: siraB }),
      ]);
      await loadData();
      toast.success("Sıra güncellendi.");
    } catch { toast.error("Sıralama güncellenemedi."); }
  }

  // ==================== YAKIT TÜKETİM LİMİTLERİ ====================

  async function handleYakitLimitEkle() {
    if (!yakitLimitCins) { toast.error("Araç cinsi seçin."); return; }
    const alt = parseFloat(yakitLimitAlt.replace(",", "."));
    if (isNaN(alt) || alt < 0) { toast.error("Geçerli bir alt sınır girin."); return; }
    const ust = parseFloat(yakitLimitUst.replace(",", "."));
    if (isNaN(ust) || ust <= 0) { toast.error("Geçerli bir üst sınır girin."); return; }
    if (alt >= ust) { toast.error("Alt sınır üst sınırdan küçük olmalı."); return; }

    try {
      await upsertAracCinsiYakitLimit({
        arac_cinsi: yakitLimitCins,
        sayac_tipi: yakitLimitSayacTipi,
        alt_sinir: alt,
        ust_sinir: ust,
      });
      const yeni = await getAracCinsiYakitLimitler();
      setYakitLimitler(yeni);
      setYakitLimitCins("");
      setYakitLimitAlt("");
      setYakitLimitUst("");
      toast.success("Yakıt limiti kaydedildi.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(err);
      if (msg.includes("does not exist") || msg.includes("relation")) {
        toast.error("arac_cinsi_yakit_limit tablosu Supabase'de yok. SQL'i çalıştırmanız gerekiyor.", { duration: 8000 });
      } else {
        toast.error(`Kaydetme hatası: ${msg}`);
      }
    }
  }

  async function handleYakitLimitSil() {
    if (!yakitLimitSilId) return;
    try {
      await deleteAracCinsiYakitLimit(yakitLimitSilId);
      const yeni = await getAracCinsiYakitLimitler();
      setYakitLimitler(yeni);
      setYakitLimitSilId(null);
      toast.success("Yakıt limiti silindi.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Silme hatası: ${msg}`);
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[#1E3A5F] mb-6">Tanımlamalar</h1>
        <div className="space-y-4">{[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gray-200 rounded animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings size={28} className="text-[#1E3A5F]" />
          <div>
            <h1 className="text-2xl font-bold text-[#1E3A5F]">Tanımlamalar</h1>
            <p className="text-sm text-gray-500">Dropdown listelerinde görünecek değerleri buradan yönetin.</p>
          </div>
        </div>
        <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={() => setYeniKatDialog(true)}>
          <Plus size={16} className="mr-1" /> Yeni Tanımlama
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {kategoriler.filter((k) => !["is_gruplari", "is_gruplari_ana", "is_gruplari_alt", "is_gruplari_detay"].includes(k.key)).map((kat) => {
          const items = getKategoriItems(kat.key).filter((t) => t.deger !== "(boş)");
          const isMuhatap = kat.key.toLowerCase() === "muhatap" || kat.key.toLowerCase() === "banka_muhatap";
          const isBankaHesap = kat.key.toLowerCase() === "banka_hesap";
          const isAracCinsi = kat.key.toLowerCase() === "arac_cinsi";
          const isAcente = kat.key.toLowerCase() === "sigorta_acente";
          return (
            <Card key={kat.key}>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-semibold text-[#1E3A5F]">{kat.key}</h3>
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary">{items.filter((t) => t.aktif).length}</Badge>
                    <button onClick={() => openDuzenleKat(kat.key, kat.sekme)} className="p-1 text-gray-400 hover:text-[#1E3A5F]" title="Düzenle">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setSilKat(kat.key)} className="p-1 text-gray-400 hover:text-red-500" title="Kategoriyi Sil">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mb-3">
                  Sekme: {getSekmeLabel(kat.sekme)}
                </p>

                {/* Mevcut değerler */}
                <div className="space-y-1 mb-3 overflow-y-auto max-h-[300px]">
                  {items.length === 0 ? (
                    <p className="text-xs text-gray-400 py-2">Henüz değer eklenmemiş.</p>
                  ) : (
                    items.map((t, idx) => {
                      // banka_hesap: hesap no + banka + firma bilgilerini çöz
                      let hesapBanka: { deger: string; kisa_ad: string | null } | null = null;
                      let hesapFirma: Firma | null = null;
                      if (isBankaHesap) {
                        const { muhatap_id, firma_id } = unpackHesapKisaAd(t.kisa_ad);
                        if (muhatap_id) {
                          const m = tanimlamalar.find((x) => x.id === muhatap_id);
                          if (m) hesapBanka = { deger: m.deger, kisa_ad: m.kisa_ad ?? null };
                        }
                        if (firma_id) {
                          hesapFirma = firmalar.find((f) => f.id === firma_id) ?? null;
                        }
                      }
                      return (
                        <div key={t.id} className={`flex items-start justify-between px-2 py-1.5 rounded text-sm group ${t.aktif ? "hover:bg-gray-50" : "bg-gray-100 opacity-50"}`}>
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <span className="text-[10px] text-gray-400 w-4 mt-0.5 flex-shrink-0">{idx + 1}</span>
                            {isMuhatap ? (
                              <div className="flex flex-col gap-1 flex-1 min-w-0">
                                {duzenleId === t.id ? (
                                  <textarea
                                    value={duzenleDeger}
                                    onChange={(e) => setDuzenleDeger(e.target.value)}
                                    onBlur={() => handleDuzenleKaydet(t)}
                                    rows={4}
                                    autoFocus
                                    className="w-full text-[10px] border rounded px-1.5 py-1 text-center"
                                  />
                                ) : (
                                  <div
                                    className="text-xs leading-snug truncate cursor-pointer hover:text-[#F97316]"
                                    title={tekSatirMuhatap(t.deger) + " (Düzenlemek için tıklayın)"}
                                    onClick={() => { setDuzenleId(t.id); setDuzenleDeger(t.deger); }}
                                  >
                                    {tekSatirMuhatap(t.deger)}
                                  </div>
                                )}
                                <input
                                  type="text"
                                  defaultValue={t.kisa_ad ?? ""}
                                  placeholder="Kısa ad (örn: DSİ)"
                                  onBlur={async (e) => {
                                    const yeni = formatBuyukHarf(e.target.value);
                                    if (yeni !== (t.kisa_ad ?? "")) {
                                      try {
                                        await updateTanimlama(t.id, { kisa_ad: yeni || null });
                                        setTanimlamalar((p) => p.map((x) => x.id === t.id ? { ...x, kisa_ad: yeni || null } : x));
                                        toast.success("Kısa ad güncellendi.");
                                      } catch { toast.error("Güncelleme hatası."); }
                                    }
                                  }}
                                  className="w-full text-[10px] border rounded px-1.5 py-0.5 uppercase"
                                />
                              </div>
                            ) : isAcente ? (() => {
                              const ac = unpackAcenteKisaAd(t.kisa_ad);
                              return (
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                {duzenleId === t.id ? (
                                  <div className="space-y-1" data-acente-edit={t.id}>
                                    <input type="text" defaultValue={t.deger} placeholder="Acente Adı"
                                      className="w-full text-xs border rounded px-1.5 py-0.5" data-field="ad" autoFocus />
                                    <input type="email" defaultValue={ac.eposta} placeholder="E-posta"
                                      className="w-full text-[10px] border rounded px-1.5 py-0.5" data-field="eposta" />
                                    <input type="text" defaultValue={ac.telefon} placeholder="Sabit Telefon"
                                      className="w-full text-[10px] border rounded px-1.5 py-0.5" data-field="telefon" />
                                    <input type="text" defaultValue={ac.cep} placeholder="Cep Telefonu"
                                      className="w-full text-[10px] border rounded px-1.5 py-0.5" data-field="cep" />
                                    <input type="text" defaultValue={ac.ilgili_kisi} placeholder="İlgili Kişi"
                                      className="w-full text-[10px] border rounded px-1.5 py-0.5" data-field="ilgili" />
                                    <div className="flex gap-1">
                                      <Button size="sm" className="h-6 text-[10px] bg-emerald-600 text-white" onClick={async () => {
                                        const parent = document.querySelector(`[data-acente-edit="${t.id}"]`);
                                        if (!parent) return;
                                        const ad = (parent.querySelector('[data-field="ad"]') as HTMLInputElement)?.value?.trim() ?? t.deger;
                                        const eposta = (parent.querySelector('[data-field="eposta"]') as HTMLInputElement)?.value ?? "";
                                        const telefon = (parent.querySelector('[data-field="telefon"]') as HTMLInputElement)?.value ?? "";
                                        const cep = (parent.querySelector('[data-field="cep"]') as HTMLInputElement)?.value ?? "";
                                        const ilgili = (parent.querySelector('[data-field="ilgili"]') as HTMLInputElement)?.value ?? "";
                                        try {
                                          await updateTanimlama(t.id, { deger: ad, kisa_ad: packAcenteKisaAd({ eposta, telefon, cep, ilgili_kisi: ilgili }) });
                                          setTanimlamalar((p) => p.map((x) => x.id === t.id ? { ...x, deger: ad, kisa_ad: packAcenteKisaAd({ eposta, telefon, cep, ilgili_kisi: ilgili }) } : x));
                                          setDuzenleId(null);
                                          toast.success("Acente güncellendi.");
                                        } catch { toast.error("Güncelleme hatası."); }
                                      }}>Kaydet</Button>
                                      <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => setDuzenleId(null)}>İptal</Button>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="cursor-pointer hover:text-[#F97316]" onClick={() => setDuzenleId(t.id)}>
                                    <div className="text-xs font-semibold">{t.deger}</div>
                                    {ac.ilgili_kisi && <div className="text-[10px] text-gray-400">{ac.ilgili_kisi}</div>}
                                    {ac.cep && <div className="text-[10px] text-gray-400">{ac.cep}</div>}
                                    {ac.telefon && <div className="text-[10px] text-gray-400">{ac.telefon}</div>}
                                    {ac.eposta && <div className="text-[10px] text-gray-400">{ac.eposta}</div>}
                                  </div>
                                )}
                              </div>
                              );
                            })() : isBankaHesap ? (
                              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-mono font-semibold">{t.deger}</span>
                                  {hesapBanka && (
                                    <span className="text-gray-500">— {hesapBanka.kisa_ad ?? tekSatirMuhatap(hesapBanka.deger)}</span>
                                  )}
                                  {hesapFirma && (
                                    <span className="text-gray-500">— {hesapFirma.kisa_adi ?? hesapFirma.firma_adi}</span>
                                  )}
                                </div>
                                {(hesapBanka || hesapFirma) && (
                                  <div className="text-[10px] text-gray-400 truncate">
                                    {hesapBanka && <>Banka: {tekSatirMuhatap(hesapBanka.deger)}</>}
                                    {hesapBanka && hesapFirma && " · "}
                                    {hesapFirma && <>Firma: {hesapFirma.firma_adi}</>}
                                  </div>
                                )}
                                {!hesapBanka && !hesapFirma && (
                                  <div className="text-[10px] text-red-400">Banka/firma bağlantısı yok</div>
                                )}
                              </div>
                            ) : isAracCinsi ? (
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {duzenleId === t.id ? (
                                  <input
                                    type="text"
                                    value={duzenleDeger}
                                    onChange={(e) => setDuzenleDeger(e.target.value)}
                                    onBlur={() => handleDuzenleKaydet(t)}
                                    onKeyDown={(e) => { if (e.key === "Enter") handleDuzenleKaydet(t); }}
                                    autoFocus
                                    className="flex-1 text-xs border rounded px-1.5 py-0.5"
                                  />
                                ) : (
                                  <span
                                    className="truncate cursor-pointer hover:text-[#F97316]"
                                    title="Düzenlemek için tıklayın"
                                    onClick={() => { setDuzenleId(t.id); setDuzenleDeger(t.deger); }}
                                  >
                                    {t.deger}
                                  </span>
                                )}
                                <select
                                  value={t.kisa_ad ?? "km"}
                                  onChange={async (e) => {
                                    try {
                                      await updateTanimlama(t.id, { kisa_ad: e.target.value });
                                      await loadData();
                                      toast.success(`${t.deger}: ${e.target.value === "saat" ? "Saat" : "KM"} olarak ayarlandı.`);
                                    } catch { toast.error("Güncellenemedi."); }
                                  }}
                                  className="text-[10px] border rounded px-1 py-0.5 bg-white shrink-0"
                                >
                                  <option value="km">KM</option>
                                  <option value="saat">Saat</option>
                                </select>
                              </div>
                            ) : duzenleId === t.id ? (
                              <input
                                type="text"
                                value={duzenleDeger}
                                onChange={(e) => setDuzenleDeger(e.target.value)}
                                onBlur={() => handleDuzenleKaydet(t)}
                                onKeyDown={(e) => { if (e.key === "Enter") handleDuzenleKaydet(t); }}
                                autoFocus
                                className="flex-1 text-xs border rounded px-1.5 py-0.5"
                              />
                            ) : (
                              <span
                                className="truncate cursor-pointer hover:text-[#F97316]"
                                title="Düzenlemek için tıklayın"
                                onClick={() => { setDuzenleId(t.id); setDuzenleDeger(t.deger); }}
                              >
                                {t.deger}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => handleSiraDegistir(kat.key, idx, "yukari")}
                              disabled={idx === 0}
                              className="p-0.5 text-gray-400 hover:text-[#1E3A5F] disabled:opacity-20">
                              <ArrowUp size={12} />
                            </button>
                            <button onClick={() => handleSiraDegistir(kat.key, idx, "asagi")}
                              disabled={idx === items.length - 1}
                              className="p-0.5 text-gray-400 hover:text-[#1E3A5F] disabled:opacity-20">
                              <ArrowDown size={12} />
                            </button>
                            <button onClick={() => handleToggleAktif(t)}
                              className={`text-xs px-1 py-0.5 rounded ${t.aktif ? "text-yellow-600 hover:bg-yellow-50" : "text-green-600 hover:bg-green-50"}`}>
                              {t.aktif ? "Pasif" : "Aktif"}
                            </button>
                            <button onClick={() => setDeleteId(t.id)} className="text-red-400 hover:text-red-600 p-0.5">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Yeni değer ekle */}
                {isAcente ? (
                  <div className="space-y-2 border-t pt-3">
                    <Input placeholder="Acente Adı" value={yeniAcenteAd} onChange={(e) => setYeniAcenteAd(e.target.value)} className="h-8 text-xs" />
                    <Input placeholder="İlgili Kişi" value={yeniAcenteIlgili} onChange={(e) => setYeniAcenteIlgili(e.target.value)} className="h-8 text-xs" />
                    <Input placeholder="E-posta" value={yeniAcenteEposta} onChange={(e) => setYeniAcenteEposta(e.target.value)} className="h-8 text-xs" />
                    <div className="grid grid-cols-2 gap-1">
                      <Input placeholder="Sabit Telefon" value={yeniAcenteTelefon} onChange={(e) => setYeniAcenteTelefon(e.target.value)} className="h-8 text-xs" />
                      <Input placeholder="Cep Telefonu" value={yeniAcenteCep} onChange={(e) => setYeniAcenteCep(e.target.value)} className="h-8 text-xs" />
                    </div>
                    <Button size="sm" className="h-8 bg-[#F97316] hover:bg-[#ea580c] w-full" onClick={async () => {
                      if (!yeniAcenteAd.trim()) { toast.error("Acente adı girin."); return; }
                      try {
                        const mevcut = tanimlamalar.filter((t) => t.kategori === "sigorta_acente");
                        await createTanimlama({
                          kategori: "sigorta_acente", sekme: "sigorta-muayene",
                          deger: yeniAcenteAd.trim(),
                          kisa_ad: packAcenteKisaAd({ eposta: yeniAcenteEposta, telefon: yeniAcenteTelefon, cep: yeniAcenteCep, ilgili_kisi: yeniAcenteIlgili }),
                          sira: mevcut.length + 1, aktif: true,
                        });
                        setYeniAcenteAd(""); setYeniAcenteEposta(""); setYeniAcenteTelefon(""); setYeniAcenteCep(""); setYeniAcenteIlgili("");
                        await loadData();
                        toast.success("Acente eklendi.");
                      } catch (err) { toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`); }
                    }}>
                      <Plus size={14} className="mr-1" /> Acente Ekle
                    </Button>
                  </div>
                ) : isBankaHesap ? (
                  <div className="space-y-2 border-t pt-3">
                    <Input
                      placeholder="Hesap No (örn: 965330)"
                      value={yeniHesapNo}
                      onChange={(e) => setYeniHesapNo(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <div className="flex gap-1">
                      <select
                        value={yeniHesapMuhatapId}
                        onChange={(e) => setYeniHesapMuhatapId(e.target.value)}
                        className={selectClass + " h-8 text-xs flex-1"}
                      >
                        <option value="">Banka seçin</option>
                        {bankaMuhataplari.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.kisa_ad ? `${m.kisa_ad} - ${tekSatirMuhatap(m.deger)}` : tekSatirMuhatap(m.deger)}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 px-2"
                        onClick={() => { setYeniBankaAdi(""); setYeniBankaKisaAd(""); setYeniBankaDialogOpen(true); }}
                        title="Yeni banka ekle"
                      >
                        <Plus size={12} />
                      </Button>
                    </div>
                    <select
                      value={yeniHesapFirmaId}
                      onChange={(e) => setYeniHesapFirmaId(e.target.value)}
                      className={selectClass + " h-8 text-xs"}
                    >
                      <option value="">Firma seçin</option>
                      {firmalar.filter((f) => (f.durum ?? "aktif") === "aktif").map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.kisa_adi ? `${f.kisa_adi} - ${f.firma_adi}` : f.firma_adi}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="h-8 bg-[#F97316] hover:bg-[#ea580c] w-full"
                      onClick={handleBankaHesapEkle}
                    >
                      <Plus size={14} className="mr-1" /> Hesap Ekle
                    </Button>
                  </div>
                ) : (
                  <div className={isMuhatap ? "space-y-2" : "flex gap-1"}>
                    {isMuhatap ? (
                      <textarea
                        placeholder={"T.C.\nDevlet Su İşleri\nGenel Müdürlüğü\nTOKAT"}
                        value={yeniDegerler[kat.key] ?? ""}
                        onChange={(e) => setYeniDegerler((p) => ({ ...p, [kat.key]: e.target.value }))}
                        rows={4}
                        className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-center outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                      />
                    ) : (
                      <Input
                        placeholder="Yeni değer ekle..."
                        value={yeniDegerler[kat.key] ?? ""}
                        onChange={(e) => setYeniDegerler((p) => ({ ...p, [kat.key]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && handleEkle(kat.key)}
                        className="text-sm h-8"
                      />
                    )}
                    <Button size="sm" className="h-8 bg-[#F97316] hover:bg-[#ea580c]" onClick={() => handleEkle(kat.key)}>
                      <Plus size={14} />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {/* Yakıt Tüketim Limitleri - diğer card'larla aynı boyutta */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-[#1E3A5F] flex items-center gap-1.5">
                <Fuel size={14} /> yakit_tuketim_limit
              </h3>
              <Badge variant="secondary">{yakitLimitler.length}</Badge>
            </div>
            <p className="text-[10px] text-gray-400 mb-3">Araç cinsi bazlı L/km veya L/saat aralığı</p>

            {/* Mevcut limitler - compact liste */}
            <div className="space-y-1 mb-3 overflow-y-auto max-h-[300px]">
              {yakitLimitler.length === 0 ? (
                <p className="text-xs text-gray-400 py-2">Henüz limit tanımlanmamış.</p>
              ) : (
                yakitLimitler.map((l, idx) => (
                  <div key={l.id} className="flex items-start justify-between px-2 py-1.5 rounded text-sm hover:bg-gray-50 group">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-[10px] text-gray-400 w-4 mt-0.5 flex-shrink-0">{idx + 1}</span>
                      <div className="flex flex-col flex-1 min-w-0">
                        <span className="text-xs font-semibold truncate">{l.arac_cinsi}</span>
                        <span className="text-[10px] text-gray-500">
                          {l.sayac_tipi === "km" ? "L/km" : "L/saat"} · {l.alt_sinir.toLocaleString("tr-TR", { maximumFractionDigits: 3 })} - {l.ust_sinir.toLocaleString("tr-TR", { maximumFractionDigits: 3 })}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setYakitLimitSilId(l.id)}
                      className="p-1 text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Sil"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Yeni limit ekleme - compact */}
            <div className="space-y-1.5 pt-2 border-t">
              <select
                value={yakitLimitCins}
                onChange={(e) => {
                  const cins = e.target.value;
                  setYakitLimitCins(cins);
                  // Sayaç tipini araç cinsinin kisa_ad'ından otomatik al
                  if (cins) {
                    const t = tanimlamalar.find((x) => x.kategori === "arac_cinsi" && x.deger === cins);
                    if (t?.kisa_ad === "saat") setYakitLimitSayacTipi("saat");
                    else setYakitLimitSayacTipi("km");
                  }
                }}
                className={selectClass + " text-xs"}
              >
                <option value="">Araç cinsi seçiniz...</option>
                {tanimlamalar
                  .filter((t) => t.kategori === "arac_cinsi" && t.aktif)
                  .sort((a, b) => a.sira - b.sira)
                  .map((t) => (
                    <option key={t.id} value={t.deger}>{t.deger} ({t.kisa_ad === "saat" ? "Saat" : "KM"})</option>
                  ))}
              </select>
              {yakitLimitCins && (
                <div className="text-[10px] text-gray-500 px-1">
                  Sayaç: <strong>{yakitLimitSayacTipi === "saat" ? "Saat (L/saat)" : "Kilometre (L/km)"}</strong> — otomatik
                </div>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={yakitLimitAlt}
                  onChange={(e) => setYakitLimitAlt(e.target.value)}
                  placeholder="Alt (0,5)"
                  className={selectClass + " text-xs"}
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={yakitLimitUst}
                  onChange={(e) => setYakitLimitUst(e.target.value)}
                  placeholder="Üst (2)"
                  className={selectClass + " text-xs"}
                />
              </div>
              <Button
                size="sm"
                className="w-full bg-[#F97316] hover:bg-[#ea580c] text-white h-7 text-xs"
                onClick={handleYakitLimitEkle}
              >
                <Plus size={12} className="mr-1" /> Ekle / Güncelle
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* İş Grupları — Hiyerarşik Accordion */}
        {(() => {
          const anaGruplar = tanimlamalar.filter((t) => t.kategori === "is_gruplari_ana" && t.aktif).sort((a, b) => a.sira - b.sira);
          const altGruplar = tanimlamalar.filter((t) => t.kategori === "is_gruplari_alt" && t.aktif).sort((a, b) => a.sira - b.sira);
          const detaylar = tanimlamalar.filter((t) => t.kategori === "is_gruplari_detay" && t.aktif).sort((a, b) => a.sira - b.sira);
          if (anaGruplar.length === 0) return null;
          return (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-[#1E3A5F] text-base">Yapım İşlerinde Benzer İş Grupları</h3>
                  <Badge variant="secondary">{anaGruplar.length} ana grup</Badge>
                </div>
                <div className="space-y-1">
                  {anaGruplar.map((ana) => {
                    const anaKey = ana.kisa_ad ?? ana.deger;
                    const anaAcik = isGrupAcik[anaKey] ?? false;
                    const altlar = altGruplar.filter((a) => a.kisa_ad === anaKey);
                    return (
                      <div key={ana.id} className="border rounded-lg overflow-hidden">
                        {/* Ana Grup Başlığı */}
                        <button
                          type="button"
                          onClick={() => setIsGrupAcik((p) => ({ ...p, [anaKey]: !p[anaKey] }))}
                          className="w-full flex items-center gap-2 px-3 py-2 bg-[#64748B] text-white text-sm font-semibold hover:bg-[#2a4f7a] transition-colors"
                        >
                          {anaAcik ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          <span>({anaKey}) {ana.deger}</span>
                          <Badge className="ml-auto bg-white/20 text-white text-[10px]">{altlar.length}</Badge>
                        </button>
                        {/* Alt Gruplar */}
                        {anaAcik && (
                          <div className="bg-white">
                            {altlar.map((alt) => {
                              // Alt grup key: "A-I", "A-II" gibi
                              const romNum = alt.deger.match(/^([IVXLCDM]+)\./)?.[1] ?? alt.deger;
                              const altKey = `${anaKey}-${romNum}`;
                              const altAcik = isGrupAltAcik[altKey] ?? false;
                              const detayListesi = detaylar.filter((d) => d.kisa_ad === altKey);
                              return (
                                <div key={alt.id}>
                                  <button
                                    type="button"
                                    onClick={() => detayListesi.length > 0 && setIsGrupAltAcik((p) => ({ ...p, [altKey]: !p[altKey] }))}
                                    className={`w-full flex items-center gap-2 px-5 py-1.5 text-sm text-left hover:bg-gray-50 border-b ${detayListesi.length > 0 ? "cursor-pointer" : "cursor-default"}`}
                                  >
                                    {detayListesi.length > 0 ? (
                                      altAcik ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />
                                    ) : (
                                      <span className="w-3.5" />
                                    )}
                                    <span className="font-medium text-[#1E3A5F]">{alt.deger}</span>
                                    {detayListesi.length > 0 && (
                                      <span className="text-[10px] text-gray-400 ml-auto">{detayListesi.length}</span>
                                    )}
                                  </button>
                                  {/* Detaylar */}
                                  {altAcik && detayListesi.length > 0 && (
                                    <div className="bg-gray-50 border-b">
                                      {detayListesi.map((det, di) => (
                                        <div key={det.id} className="flex items-center gap-2 px-9 py-1 text-xs text-gray-600 hover:bg-gray-100">
                                          <span className="text-gray-400 w-4">{di + 1}.</span>
                                          <span>{det.deger}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {altlar.length === 0 && (
                              <p className="px-5 py-2 text-xs text-gray-400">Alt grup tanımlanmamış.</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {kategoriler.length === 0 && (
          <div className="col-span-full text-center py-16 bg-white rounded-lg border border-gray-200">
            <Settings size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500">Henüz tanımlama eklenmemiş.</p>
            <p className="text-gray-400 text-sm mt-1">&quot;Yeni Tanımlama&quot; butonuna tıklayarak başlayın.</p>
          </div>
        )}
      </div>

      {/* Yakıt Limit Silme Onay */}
      <AlertDialog open={!!yakitLimitSilId} onOpenChange={() => setYakitLimitSilId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Yakıt limitini silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu limit kalıcı olarak silinecek ve yakıt sayfasındaki uyarı kontrolü artık çalışmayacaktır.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleYakitLimitSil} className="bg-red-500 hover:bg-red-600">Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Yeni Kategori Dialog */}
      <Dialog open={yeniKatDialog} onOpenChange={setYeniKatDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Tanımlama Oluştur</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tanımlama Adı</Label>
              <Input placeholder="Örn: Araç Cinsi, Meslek, Banka" value={yeniKatAdi}
                onChange={(e) => setYeniKatAdi(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleYeniKategori()} />
            </div>
            <div className="space-y-2">
              <Label>İlişkili Sekme</Label>
              <select value={yeniKatSekme} onChange={(e) => setYeniKatSekme(e.target.value)} className={selectClass}>
                {SEKME_LISTESI.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400">Bu tanımlama hangi sekmedeki formlarda kullanılacak?</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYeniKatDialog(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniKategori}>Oluştur</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Değer Silme Onay */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu değer kalıcı olarak silinecektir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleSil} className="bg-red-500 hover:bg-red-600">Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Kategori Düzenleme Dialog */}
      <Dialog open={!!duzenleKat} onOpenChange={() => setDuzenleKat(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Tanımlama Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tanımlama Adı</Label>
              <Input value={duzenleKatAdi} onChange={(e) => setDuzenleKatAdi(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleDuzenleKat()} />
            </div>
            <div className="space-y-2">
              <Label>İlişkili Sekme</Label>
              <select value={duzenleKatSekme} onChange={(e) => setDuzenleKatSekme(e.target.value)} className={selectClass}>
                {SEKME_LISTESI.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuzenleKat(null)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleDuzenleKat}>Kaydet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kategori Silme Onay */}
      <AlertDialog open={!!silKat} onOpenChange={() => setSilKat(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>&quot;{silKat}&quot; tanımlamasını silmek istediğinize emin misiniz?</AlertDialogTitle>
            <AlertDialogDescription>Bu kategori ve içindeki tüm değerler kalıcı olarak silinecektir.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction onClick={handleSilKat} className="bg-red-500 hover:bg-red-600">Tümünü Sil</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Yeni Banka (banka_muhatap) Ekleme Dialog - banka_hesap formu içinden tetiklenir */}
      <Dialog open={yeniBankaDialogOpen} onOpenChange={setYeniBankaDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Banka Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Banka Adı (Çok Satırlı) <span className="text-red-500">*</span></Label>
              <textarea
                value={yeniBankaAdi}
                onChange={(e) => setYeniBankaAdi(e.target.value)}
                placeholder={"T.C.\nZiraat Bankası A.Ş.\nErbaa Şubesi\nTOKAT"}
                rows={5}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-center outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                autoFocus
              />
              <p className="text-[10px] text-gray-400">Her satıra bir bilgi yazın. Son satır şehir olmalı.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Kısa Ad <span className="text-red-500">*</span></Label>
              <Input
                value={yeniBankaKisaAd}
                onChange={(e) => setYeniBankaKisaAd(e.target.value)}
                placeholder="Örn: ZRT, AKB, İŞB"
              />
              <p className="text-[10px] text-gray-400">Evrak sayı numarasında kullanılacak.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setYeniBankaDialogOpen(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniBanka}>
              <Plus size={14} className="mr-1" /> Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
