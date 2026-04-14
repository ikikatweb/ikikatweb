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
import { getMuhataplarFull, createTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import { useAuth } from "@/hooks";
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
import GidenEvrakOnIzleme from "@/components/shared/giden-evrak-onizleme";
import toast from "react-hot-toast";

type Props = {
  evrak?: GidenEvrakWithRelations;
  onSuccess: () => void;
  onCancel: () => void;
};

type SantiyeBasic = { id: string; is_adi: string; durum: string };
type MuhatapItem = { id: string; deger: string; kisa_ad: string | null };

const selectClass = "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function GidenEvrakForm({ evrak, onSuccess, onCancel }: Props) {
  const isEdit = !!evrak;
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

  const [evrakTarihi, setEvrakTarihi] = useState(evrak?.evrak_tarihi ?? new Date().toISOString().split("T")[0]);
  const [firmaId, setFirmaId] = useState(evrak?.firma_id ?? "");
  const [santiyeId, setSantiyeId] = useState(evrak?.santiye_id ?? "");
  const [evrakSayiNo, setEvrakSayiNo] = useState(evrak?.evrak_sayi_no ?? "");
  const [konu, setKonu] = useState(evrak?.konu ?? "");
  const [muhatap, setMuhatap] = useState(evrak?.muhatap ?? "");
  const [muhatapId, setMuhatapId] = useState(evrak?.muhatap_id ?? "");
  const [ilgiListesi, setIlgiListesi] = useState<string[]>(evrak?.ilgi_listesi ?? []);
  const [metin, setMetin] = useState(evrak?.metin ?? "");
  const [ekler, setEkler] = useState<string[]>(evrak?.ekler ?? []);
  const [kaseDahil, setKaseDahil] = useState(evrak?.kase_dahil ?? false);

  useEffect(() => {
    async function load() {
      try {
        const [fData, sData, mData] = await Promise.all([
          getFirmalar(), getSantiyelerAll(), getMuhataplarFull(),
        ]);
        setFirmalar(fData ?? []);
        setSantiyeler((sData as SantiyeBasic[]) ?? []);
        setMuhataplar(mData);
      } catch { /* sessiz */ }
    }
    load();
  }, []);

  // Firma veya muhatap değişince sayı no'yu yeniden üret (yeni evrakta)
  useEffect(() => {
    if (isEdit) return;
    if (!firmaId) { setEvrakSayiNo(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const no = await getGidenEvrakSayiNo(firmaId, muhatapId || null);
        if (!cancelled) setEvrakSayiNo(no);
      } catch { /* sessiz */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaId, muhatapId]);

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

  function addIlgi() { setIlgiListesi((p) => [...p, ""]); }
  function removeIlgi(i: number) { setIlgiListesi((p) => p.filter((_, idx) => idx !== i)); }
  function updateIlgi(i: number, v: string) { setIlgiListesi((p) => p.map((x, idx) => idx === i ? v : x)); }

  function addEk() { setEkler((p) => [...p, ""]); }
  function removeEk(i: number) { setEkler((p) => p.filter((_, idx) => idx !== i)); }
  function updateEk(i: number, v: string) { setEkler((p) => p.map((x, idx) => idx === i ? v : x)); }

  // Metin değişince ilk paragraf otomatik tab + büyük harf
  function handleMetinChange(val: string) {
    if (val.length === 1 && val !== "\t") {
      setMetin("\t" + val.toUpperCase());
    } else {
      setMetin(val);
    }
  }

  async function handleSubmit() {
    if (!evrakTarihi) { toast.error("Evrak tarihi zorunludur."); return; }
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

      const payload = {
        evrak_tarihi: evrakTarihi,
        firma_id: firmaId,
        santiye_id: santiyeId || null,
        evrak_sayi_no: evrakSayiNo,
        evrak_kayit_no: evrak?.evrak_kayit_no ?? null,
        konu,
        muhatap: muhatap || null,
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
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer size={16} className="mr-1" /> Yazdır / PDF İndir
          </Button>
        </div>

        {/* Print alanı - yazdırıldığında sadece bu görünür */}
        <div className="evrak-print-area">
          <div className="border rounded-lg shadow-sm overflow-hidden mx-auto" style={{ width: "210mm" }}>
            <GidenEvrakOnIzleme
              firma={seciliFirma}
              evrakTarihi={evrakTarihi}
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
          <Input type="date" value={evrakTarihi} onChange={(e) => setEvrakTarihi(e.target.value)} disabled={loading} />
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
          <SantiyeSelect santiyeler={santiyeler} value={santiyeId} onChange={setSantiyeId} placeholder="Opsiyonel" className={selectClass} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Evrak Sayı No</Label>
          <Input value={evrakSayiNo} disabled className="bg-gray-100 font-mono text-xs" />
          <p className="text-[10px] text-gray-400">Firma + muhatap seçilince otomatik üretilir</p>
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
        <Input value={konu} onChange={(e) => setKonu(e.target.value)} placeholder="Evrak konusu" disabled={loading} />
      </div>

      {/* Muhatap - dropdown seçimli (firma/şantiye gibi) + ekle butonu */}
      <div className="space-y-2">
        <Label>Muhatap</Label>
        <div className="flex gap-2">
          <select
            value={muhatapId}
            onChange={(e) => selectMuhatapById(e.target.value)}
            disabled={loading}
            className={selectClass + " flex-1"}
          >
            <option value="">Muhatap seçin</option>
            {muhataplar.map((m) => (
              <option key={m.id} value={m.id}>
                {tekSatirMuhatap(m.deger)}{m.kisa_ad ? ` (${m.kisa_ad})` : ""}
              </option>
            ))}
          </select>
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

      {/* Ekler */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Ekler</Label>
          <Button type="button" variant="outline" size="sm" onClick={addEk} disabled={loading}>
            <Plus size={14} className="mr-1" /> Ek Ekle
          </Button>
        </div>
        {ekler.length > 0 ? (
          <div className="space-y-2">
            {ekler.map((ek, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-medium w-12">Ek {i + 1}:</span>
                <Input value={ek} onChange={(e) => updateEk(i, e.target.value)} placeholder="Ek açıklaması" className="flex-1" disabled={loading} />
                <button type="button" onClick={() => removeEk(i)} className="text-red-400 hover:text-red-600 p-1">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Henüz ek eklenmedi. + butonuyla ekleyebilirsiniz.</p>
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
