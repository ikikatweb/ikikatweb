// Giden evrak form - Otomatik sayı no, çoklu ilgi/ek, kaşe toggle, ön izleme
"use client";

import { useState, useEffect } from "react";
import RichTextEditor from "@/components/shared/rich-text-editor";
import {
  createGidenEvrak,
  updateGidenEvrak,
  getGidenEvrakSayiNo,
} from "@/lib/supabase/queries/giden-evrak";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import { useAuth } from "@/hooks";
import { filtreliSantiyeler } from "@/lib/utils/santiye-filtre";
import TarihInput from "@/components/shared/tarih-input";
import { getMuhataplarFull, createTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import type { GidenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Save, Eye, Upload, Plus, ArrowLeft, Trash2, Printer } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import { formatMuhatap, formatBaslik, trAramaNormalize } from "@/lib/utils/isim";
import GidenEvrakOnIzleme from "@/components/shared/giden-evrak-onizleme";
import toast from "react-hot-toast";

// Kısmi gösterim stringinden ISO tarihi üretir (sıralama/filtre için fallback).
// "/" veya "." ayırıcılarını destekler (TarihInput artık "/" kullanıyor)
function tarihGosterimdenIso(gs: string): string {
  // "...." marker'ı kaldır, sonra / veya . ile böl
  const temizlenmis = gs.replace(/\.{4,}/g, "");
  const parcalar = temizlenmis.split(/[\/.]/);
  const g = /^\d{1,2}$/.test(parcalar[0]) ? parcalar[0].padStart(2, "0") : "01";
  const a = /^\d{1,2}$/.test(parcalar[1]) ? parcalar[1].padStart(2, "0") : "01";
  const y = /^\d{4}$/.test(parcalar[2] ?? "") ? parcalar[2] : new Date().getFullYear().toString();
  return `${y}-${a}-${g}`;
}

type Props = {
  evrak?: GidenEvrakWithRelations;
  onSuccess: () => void;
  onCancel: () => void;
};

type SantiyeBasic = { id: string; is_adi: string; durum: string; yuklenici_firma_id?: string | null };
type MuhatapItem = { id: string; deger: string; kisa_ad: string | null };

const selectClass = "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function GidenEvrakForm({ evrak, onSuccess, onCancel }: Props) {
  const isEdit = !!evrak?.id;
  const { kullanici } = useAuth();
  const [loading, setLoading] = useState(false);
  const [onIzleme, setOnIzleme] = useState(false);

  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [muhataplar, setMuhataplar] = useState<MuhatapItem[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [yeniMuhatap, setYeniMuhatap] = useState("");
  const [yeniMuhatapKisa, setYeniMuhatapKisa] = useState("");
  const [muhatapDialogOpen, setMuhatapDialogOpen] = useState(false);
  const [muhatapArama, setMuhatapArama] = useState("");
  const [muhatapDropdownAcik, setMuhatapDropdownAcik] = useState(false);

  const [evrakTarihi, setEvrakTarihi] = useState<string | null>(evrak?.evrak_tarihi ?? new Date().toISOString().split("T")[0]);
  const [tarihGosterim, setTarihGosterim] = useState<string | null>(evrak?.tarih_gosterim ?? null);
  const [firmaId, setFirmaId] = useState(evrak?.firma_id ?? "");
  const [santiyeId, setSantiyeId] = useState(evrak?.santiye_id ?? "");
  const [evrakSayiNo, setEvrakSayiNo] = useState(evrak?.evrak_sayi_no ?? "");
  const [konu, setKonu] = useState(evrak?.konu ?? "");
  const [muhatap, setMuhatap] = useState(evrak?.muhatap ?? "");
  const [muhatapId, setMuhatapId] = useState(evrak?.muhatap_id ?? "");
  const [ilgiListesi, setIlgiListesi] = useState<string[]>(evrak?.ilgi_listesi ?? []);
  const [metin, setMetin] = useState(evrak?.metin ?? "");
  const [ekler, setEkler] = useState<string[]>(evrak?.ekler ?? []);
  const [ekUploading, setEkUploading] = useState(false);
  const [ekUploadingIdx, setEkUploadingIdx] = useState<number>(-1);
  const [kaseDahil, setKaseDahil] = useState(evrak?.kase_dahil ?? false);

  useEffect(() => {
    async function load() {
      try {
        const [fData, sData, mData] = await Promise.all([
          getFirmalar(), getSantiyelerAll(), getMuhataplarFull(),
        ]);
        // Firma kapsamı: kullanıcının firma_ids tanımlıysa sadece o firmalar görünür.
        // (Rol fark etmez — yönetici de kendine firma_ids tanımlayabilir.
        // firma_ids boş/null ise tümüne erişir.)
        const izinliFirmaIds = (kullanici?.firma_ids && kullanici.firma_ids.length > 0)
          ? new Set(kullanici.firma_ids) : null;
        const filtreliFirmalar = izinliFirmaIds
          ? (fData ?? []).filter((f) => izinliFirmaIds.has(f.id))
          : (fData ?? []);
        setFirmalar(filtreliFirmalar);

        // Şantiye filtre — kısıtlı/şantiye_admin sadece atandığı şantiyeleri görür
        const tumSantiyeler = (sData as SantiyeBasic[]) ?? [];
        const filtreliSants = filtreliSantiyeler(tumSantiyeler, kullanici);
        setSantiyeler(filtreliSants);
        setMuhataplar(mData);

        // Otomatik default seçim — sadece yeni kayıt için, kullanıcının tek izinli
        // firması/şantiyesi varsa onu seç (form daha hızlı doldurulur).
        if (!isEdit) {
          if (filtreliFirmalar.length === 1) {
            setFirmaId((prev) => prev || filtreliFirmalar[0].id);
          }
          if (filtreliSants.length === 1) {
            setSantiyeId((prev) => prev || filtreliSants[0].id);
          }
        }
      } catch { /* sessiz */ }
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici?.id, kullanici?.rol, kullanici?.firma_ids, kullanici?.santiye_ids]);

  // Firma veya muhatap değişince sayı no'yu yeniden üret
  useEffect(() => {
    // Düzenleme modunda: firma veya muhatap değişmediyse mevcut sayı no'yu koru
    if (isEdit && firmaId === evrak?.firma_id && muhatapId === (evrak?.muhatap_id ?? "") && muhatap === (evrak?.muhatap ?? "")) return;
    if (!firmaId) { setEvrakSayiNo(""); return; }
    let cancelled = false;
    (async () => {
      try {
        // muhatap metni de gönderilir — id yoksa metin ile tanımlamayı bulup kısa adı kullansın
        const no = await getGidenEvrakSayiNo(firmaId, muhatapId || null, muhatap || null);
        if (!cancelled) setEvrakSayiNo(no);
      } catch { /* sessiz */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaId, muhatapId, muhatap]);

  function selectMuhatapById(id: string) {
    if (!id) {
      setMuhatap("");
      setMuhatapId("");
      return;
    }
    const m = muhataplar.find((x) => x.id === id);
    if (m) {
      setMuhatap(m.deger);
      setMuhatapId(m.id);
    }
  }

  async function handleYeniMuhatap() {
    if (!yeniMuhatap.trim()) { toast.error("Muhatap adı zorunludur."); return; }
    const ad = yeniMuhatap.trim();
    const kisaAd = yeniMuhatapKisa.trim() || null;
    try {
      const yeni = await createTanimlama({
        kategori: "muhatap",
        sekme: "yazismalar",
        deger: ad,
        kisa_ad: kisaAd,
        sira: muhataplar.length + 1,
        aktif: true,
      });
      setMuhataplar((p) => [...p, { id: yeni.id, deger: ad, kisa_ad: kisaAd }]);
      setMuhatap(ad);
      setMuhatapId(yeni.id);
      setYeniMuhatap("");
      setYeniMuhatapKisa("");
      setMuhatapDialogOpen(false);
      toast.success("Muhatap eklendi.");
    } catch { toast.error("Muhatap eklenemedi."); }
  }

  function basHarfBuyuk(v: string) { return v.length === 1 ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1); }
  function addIlgi() { setIlgiListesi((p) => [...p, ""]); }
  function removeIlgi(i: number) { setIlgiListesi((p) => p.filter((_, idx) => idx !== i)); }
  function updateIlgi(i: number, v: string) { setIlgiListesi((p) => p.map((x, idx) => idx === i ? basHarfBuyuk(v) : x)); }

  function addEk() { setEkler((p) => [...p, ""]); }
  function removeEk(i: number) { setEkler((p) => p.filter((_, idx) => idx !== i)); }
  function updateEk(i: number, v: string) { setEkler((p) => p.map((x, idx) => idx === i ? basHarfBuyuk(v) : x)); }

  // Metin değişince ilk harf büyük (tab otomatik eklenmez)
  function handleMetinChange(val: string) {
    if (val.length === 1) {
      setMetin(val.toUpperCase());
    } else {
      setMetin(val);
    }
  }

  async function handleSubmit() {
    // Tam tarih yoksa ama gösterim varsa (kısmi tarih) yıl kısmı dolu olmalı — aksi halde sıralama bozulur
    if (!evrakTarihi && !tarihGosterim) { toast.error("Evrak tarihi zorunludur."); return; }
    if (!firmaId) { toast.error("Firma seçimi zorunludur."); return; }
    if (!konu.trim()) { toast.error("Konu zorunludur."); return; }

    setLoading(true);
    try {
      let pdfUrl = evrak?.pdf_url ?? null;
      if (pdfFile) {
        const formData = new FormData();
        formData.append("file", pdfFile);
        formData.append("bucket", "yazismalar");
        formData.append("path", `giden/${firmaId}/${Date.now()}.pdf`);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) pdfUrl = data.url;
      }

      // Tam tarih yoksa yıldan kurtarma (sıralama için ocak 1)
      const tarihIso = evrakTarihi ?? (tarihGosterim ? tarihGosterimdenIso(tarihGosterim) : new Date().toISOString().slice(0, 10));
      const payload = {
        evrak_tarihi: tarihIso,
        tarih_gosterim: tarihGosterim,
        firma_id: firmaId,
        santiye_id: santiyeId || null,
        evrak_sayi_no: evrakSayiNo,
        evrak_kayit_no: evrak?.evrak_kayit_no ?? null,
        konu: formatBaslik(konu),
        // Sadece trim — kullanıcı nasıl yazdıysa öyle kaydedilir
        muhatap: muhatap?.trim() || null,
        muhatap_id: muhatapId || null,
        ilgi_listesi: ilgiListesi.filter((i) => i.trim()),
        metin: metin || null,
        ekler: ekler.filter((e) => e.trim()),
        kase_dahil: kaseDahil,
        pdf_url: pdfUrl,
      };

      if (isEdit) {
        await updateGidenEvrak(evrak.id, payload);
        toast.success("Evrak güncellendi.");
      } else {
        await createGidenEvrak({
          ...payload,
          olusturan_id: kullanici?.id ?? "",
          olusturma_tarihi: new Date().toISOString(),
          silindi: false,
          silme_nedeni: null,
        });
        toast.success("Evrak kaydedildi.");
      }
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(`Kaydetme hatası: ${msg}`);
    } finally {
      setLoading(false);
    }
  }

  const seciliFirma = firmalar.find((f) => f.id === firmaId);
  const ilgiHarfler = ["A", "B", "C", "D", "E", "F", "G", "H"];

  // ==================== ÖN İZLEME ====================
  if (onIzleme) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" size="sm" onClick={() => setOnIzleme(false)} className="text-gray-500">
            <ArrowLeft size={16} className="mr-1" /> Düzenlemeye Dön
          </Button>
        </div>

        {/* Print alanı - yazdırıldığında sadece bu görünür */}
        <div className="evrak-print-area">
          <div className="evrak-preview-page border rounded-lg shadow-sm overflow-hidden mx-auto" style={{ width: "210mm", maxWidth: "100%" }}>
            <GidenEvrakOnIzleme
              firma={seciliFirma}
              evrakTarihi={evrakTarihi}
              tarihGosterim={tarihGosterim}
              evrakSayiNo={evrakSayiNo}
              konu={konu}
              muhatap={muhatap}
              ilgiListesi={ilgiListesi}
              metin={metin}
              ekler={ekler}
              kaseDahil={kaseDahil}
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end print:hidden">
          <Button variant="outline" onClick={() => setOnIzleme(false)}>Geri Dön</Button>
          <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleSubmit} disabled={loading}>
            <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
          </Button>
        </div>
      </div>
    );
  }

  // ==================== FORM ====================
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Evrak Tarihi <span className="text-red-500">*</span></Label>
          <Input
            type="date"
            value={evrakTarihi ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setEvrakTarihi(v || null);
              setTarihGosterim(null);
            }}
            disabled={loading}
          />
        </div>
        <div className="space-y-2">
          <Label>Firma <span className="text-red-500">*</span></Label>
          <select value={firmaId} onChange={(e) => setFirmaId(e.target.value)} disabled={loading} className={selectClass}>
            <option value="">Firma seçin</option>
            {firmalar.filter((f) => (f.durum ?? "aktif") === "aktif").map((f) => (
              <option key={f.id} value={f.id}>{f.firma_adi}</option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label>Şantiye</Label>
          {/* Tüm aktif şantiyeler firma adı altında <optgroup> ile gruplanmış halde gösterilir.
              Firma seçimi şantiye listesini filtrelemez — kullanıcı istediği şantiyeyi seçebilir. */}
          <SantiyeSelect
            santiyeler={santiyeler}
            value={santiyeId}
            onChange={setSantiyeId}
            placeholder="Opsiyonel"
            className={selectClass}
            firmalar={firmalar}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Evrak Sayı No</Label>
          <Input value={evrakSayiNo} disabled className="bg-gray-100 font-mono text-xs" />
          <p className="text-[10px] text-gray-400">Firma/muhatap değişince otomatik üretilir.</p>
        </div>
        <div className="space-y-2">
          <Label>Kaşe</Label>
          <div className="flex items-center gap-3 h-9">
            <Switch checked={kaseDahil} onCheckedChange={setKaseDahil} disabled={loading} />
            <span className="text-sm">{kaseDahil ? "Kaşe Ekli" : "Kaşe Yok"}</span>
            {seciliFirma?.kase_url ? (
              <span className="text-[10px] text-green-600">(Firma kaşesi mevcut)</span>
            ) : (
              <span className="text-[10px] text-red-500">(Firmada kaşe yok)</span>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Konu <span className="text-red-500">*</span></Label>
        <Input
          value={konu}
          onChange={(e) => setKonu(e.target.value)}
          onBlur={(e) => setKonu(formatBaslik(e.target.value))}
          placeholder="Evrak konusu"
          disabled={loading}
        />
      </div>

      {/* Muhatap - aranabilir dropdown + ekle butonu */}
      <div className="space-y-2">
        <Label>Muhatap</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={muhatapArama || (muhatapId ? tekSatirMuhatap(muhataplar.find((m) => m.id === muhatapId)?.deger ?? "") : "")}
              onChange={(e) => { setMuhatapArama(e.target.value); setMuhatapDropdownAcik(true); }}
              onFocus={() => setMuhatapDropdownAcik(true)}
              onBlur={() => setTimeout(() => setMuhatapDropdownAcik(false), 150)}
              placeholder="Muhatap ara veya seç..."
              disabled={loading}
              className={selectClass}
            />
            {muhatapDropdownAcik && (() => {
              const q = trAramaNormalize(muhatapArama);
              const filtreli = q ? muhataplar.filter((m) =>
                trAramaNormalize(tekSatirMuhatap(m.deger)).includes(q) ||
                trAramaNormalize(m.kisa_ad ?? "").includes(q)
              ) : muhataplar;
              if (filtreli.length === 0) return null;
              return (
                // onMouseDown preventDefault: dropdown ALANINA (scrollbar dahil) tıklayınca
                // input blur olmasın, dropdown açık kalsın. Buton onClick'leri etkilenmez.
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto"
                >
                  {muhatapId && (
                    <button type="button"
                      onClick={() => { selectMuhatapById(""); setMuhatapArama(""); setMuhatapDropdownAcik(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 border-b">
                      Muhatap kaldır
                    </button>
                  )}
                  {filtreli.map((m) => (
                    <button key={m.id} type="button"
                      onClick={() => { selectMuhatapById(m.id); setMuhatapArama(""); setMuhatapDropdownAcik(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${muhatapId === m.id ? "bg-blue-50 font-semibold" : ""}`}>
                      {tekSatirMuhatap(m.deger)}{m.kisa_ad ? <span className="text-gray-400 text-xs ml-1">({m.kisa_ad})</span> : ""}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { setYeniMuhatap(""); setYeniMuhatapKisa(""); setMuhatapDialogOpen(true); }}
            disabled={loading}
            className="h-9"
          >
            <Plus size={14} className="mr-1" /> Muhatap Ekle
          </Button>
        </div>
      </div>

      {/* İlgi Listesi */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>İlgi</Label>
          <Button type="button" variant="outline" size="sm" onClick={addIlgi} disabled={loading}>
            <Plus size={14} className="mr-1" /> İlgi Ekle
          </Button>
        </div>
        {ilgiListesi.length > 0 ? (
          <div className="space-y-2">
            {ilgiListesi.map((ilgi, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-medium w-12">İlgi {ilgiHarfler[i] ?? (i + 1)}:</span>
                <Input value={ilgi} onChange={(e) => updateIlgi(i, e.target.value)} placeholder="İlgi metni" className="flex-1" disabled={loading} />
                <button type="button" onClick={() => removeIlgi(i)} className="text-red-400 hover:text-red-600 p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Henüz ilgi eklenmedi. + butonuyla ekleyebilirsiniz.</p>
        )}
      </div>

      {/* Metin */}
      <div className="space-y-2">
        <Label>Metin</Label>
        <RichTextEditor value={metin} onChange={setMetin} placeholder="Yazınızı yazın..." rows={8} disabled={loading} />
      </div>

      {/* Ekler — her ek için ayrı metin + opsiyonel PDF dosyası.
          Format: "metin" | "metin|url" | "url" — | ayracıyla metin ve dosya birlikte */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Label>Ekler</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEk} disabled={loading}>
            <Plus size={14} className="mr-1" /> Ek Ekle
          </Button>
        </div>
        {ekler.length > 0 ? (
          <div className="space-y-2">
            {ekler.map((ek, i) => {
              // Format parse: "url" | "metin" | "metin|url"
              const isUrl = /^https?:\/\//i.test(ek);
              let metin = ek;
              let url: string | null = null;
              if (isUrl) {
                url = ek;
                try {
                  const path = new URL(ek).pathname;
                  const raw = decodeURIComponent(path.split("/").pop() ?? "");
                  metin = raw.replace(/^\d+-/, "") || "";
                } catch { metin = ""; }
              } else {
                const idx = ek.lastIndexOf("|");
                if (idx > 0 && /^https?:\/\//i.test(ek.slice(idx + 1).trim())) {
                  metin = ek.slice(0, idx).trim();
                  url = ek.slice(idx + 1).trim();
                }
              }
              const uploadingBu = ekUploading && ekUploadingIdx === i;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs font-medium w-12 flex-shrink-0">Ek {i + 1}:</span>
                  <Input
                    value={metin}
                    onChange={(e) => {
                      const yeniMetin = basHarfBuyuk(e.target.value);
                      // URL'i koru — sadece metin değişsin
                      setEkler((p) => p.map((x, idx) => {
                        if (idx !== i) return x;
                        if (url) return yeniMetin ? `${yeniMetin}|${url}` : url;
                        return yeniMetin;
                      }));
                    }}
                    placeholder="Ek açıklaması (örn: 1 Adet Taahhütname)"
                    className="flex-1 min-w-0"
                    disabled={loading || uploadingBu}
                  />
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 p-1 text-gray-400 hover:text-green-600"
                      title="Yüklü PDF'i görüntüle"
                    >
                      <Eye size={16} />
                    </a>
                  ) : null}
                  <label
                    className={`flex-shrink-0 p-1 rounded cursor-pointer transition-colors ${
                      uploadingBu || loading
                        ? "text-gray-300 cursor-not-allowed"
                        : url
                          ? "text-blue-500 hover:text-blue-700"
                          : "text-gray-400 hover:text-[#1E3A5F]"
                    }`}
                    title={url ? "PDF'i değiştir" : "Bu ek'e PDF yükle"}
                  >
                    <Upload size={16} />
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      disabled={loading || uploadingBu}
                      onChange={async (e) => {
                        const dosya = e.target.files?.[0];
                        e.target.value = "";
                        if (!dosya) return;
                        if (!firmaId) { toast.error("Önce firma seçin."); return; }
                        setEkUploading(true);
                        setEkUploadingIdx(i);
                        try {
                          const harfHaritasi: Record<string, string> = {
                            "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
                            "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
                          };
                          let temiz = dosya.name.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => harfHaritasi[m] || m);
                          temiz = temiz.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").toLowerCase();
                          const formData = new FormData();
                          formData.append("file", dosya);
                          formData.append("bucket", "yazismalar");
                          formData.append("path", `giden-ek/${firmaId}/${Date.now()}-${temiz}`);
                          const res = await fetch("/api/upload", { method: "POST", body: formData });
                          const data = await res.json();
                          if (!res.ok || !data.url) throw new Error(data?.error ?? "Yüklenemedi");
                          // Metni koru, URL'i ekle/değiştir
                          setEkler((p) => p.map((x, idx) => {
                            if (idx !== i) return x;
                            return metin ? `${metin}|${data.url}` : data.url;
                          }));
                          toast.success(url ? "PDF değiştirildi." : "PDF eklendi.");
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
                          toast.error(`Yükleme hatası: ${msg}`);
                        } finally {
                          setEkUploading(false);
                          setEkUploadingIdx(-1);
                        }
                      }}
                    />
                  </label>
                  <button type="button" onClick={() => removeEk(i)} className="text-red-400 hover:text-red-600 p-1 flex-shrink-0" disabled={loading} title="Kaldır">
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Henüz ek eklenmedi. &quot;Ek Ekle&quot; ile metin satırı oluşturup, yanındaki yükle ikonundan PDF iliştirebilirsiniz.</p>
        )}
      </div>

      {/* PDF */}
      <div className="space-y-2">
        <Label>Evrak Taraması (PDF) - Opsiyonel</Label>
        <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
          <Upload size={16} />
          {pdfFile ? pdfFile.name : evrak?.pdf_url ? "Mevcut dosya yüklü - Değiştir" : "PDF Yükle"}
          <input type="file" accept=".pdf" className="hidden" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} disabled={loading} />
        </label>
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onCancel} disabled={loading}>İptal</Button>
        <Button variant="outline" onClick={() => setOnIzleme(true)} disabled={loading || !firmaId}>
          <Eye size={16} className="mr-1" /> Ön İzleme
        </Button>
        <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleSubmit} disabled={loading}>
          <Save size={16} className="mr-1" /> {loading ? "Kaydediliyor..." : "Kaydet"}
        </Button>
      </div>

      {/* Yeni Muhatap Ekleme Dialog (Tanımlamalardaki ile aynı format) */}
      <Dialog open={muhatapDialogOpen} onOpenChange={setMuhatapDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Muhatap Ekle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Muhatap (Çok Satırlı)</Label>
              <textarea
                value={yeniMuhatap}
                onChange={(e) => setYeniMuhatap(e.target.value)}
                placeholder={"T.C.\nDevlet Su İşleri\nGenel Müdürlüğü\nTOKAT"}
                rows={5}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm text-center outline-none focus:border-ring focus:ring-2 focus:ring-ring/50"
                autoFocus
              />
              <p className="text-[10px] text-gray-400">Her satıra bir bilgi yazın. Son satır şehir olmalı.</p>
            </div>
            <div className="space-y-2">
              <Label>Kısa Ad <span className="text-gray-400 text-[10px]">(Evrak sayı no için)</span></Label>
              <Input
                value={yeniMuhatapKisa}
                onChange={(e) => setYeniMuhatapKisa(e.target.value)}
                placeholder="Örn: DSİ, İBB, TÜGVA"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMuhatapDialogOpen(false)}>İptal</Button>
            <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white" onClick={handleYeniMuhatap}>
              <Plus size={14} className="mr-1" /> Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
