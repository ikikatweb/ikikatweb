// Gelen evrak ekleme/düzenleme formu - Yazışma şablonu ön izleme
"use client";

import { useState, useEffect } from "react";
import RichTextEditor from "@/components/shared/rich-text-editor";
import {
  createGelenEvrak,
  updateGelenEvrak,
} from "@/lib/supabase/queries/gelen-evrak";
import { getFirmalar } from "@/lib/supabase/queries/firmalar";
import { getSantiyelerAll } from "@/lib/supabase/queries/santiyeler";
import SantiyeSelect from "@/components/shared/santiye-select";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { createTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import { useAuth } from "@/hooks";
import type { GelenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Save, Eye, Upload, Plus, ArrowLeft, Printer } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import GelenEvrakOnIzleme from "@/components/shared/gelen-evrak-onizleme";
import toast from "react-hot-toast";

type Props = {
  evrak?: GelenEvrakWithRelations;
  onSuccess: () => void;
  onCancel: () => void;
};

type SantiyeBasic = { id: string; is_adi: string; durum: string };

const selectClass = "w-full h-9 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function GelenEvrakForm({ evrak, onSuccess, onCancel }: Props) {
  const isEdit = !!evrak;
  const { kullanici } = useAuth();
  const [loading, setLoading] = useState(false);
  const [onIzleme, setOnIzleme] = useState(false);

  const [firmalar, setFirmalar] = useState<Firma[]>([]);
  const [santiyeler, setSantiyeler] = useState<SantiyeBasic[]>([]);
  const [muhataplar, setMuhataplar] = useState<string[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [yeniMuhatap, setYeniMuhatap] = useState("");
  const [muhatapDialogOpen, setMuhatapDialogOpen] = useState(false);
  const [muhatapArama, setMuhatapArama] = useState("");
  const [muhatapDropdownAcik, setMuhatapDropdownAcik] = useState(false);

  const [evrakTarihi, setEvrakTarihi] = useState(evrak?.evrak_tarihi ?? new Date().toISOString().split("T")[0]);
  const [firmaId, setFirmaId] = useState(evrak?.firma_id ?? "");
  const [santiyeId, setSantiyeId] = useState(evrak?.santiye_id ?? "");
  const [evrakSayiNo, setEvrakSayiNo] = useState(evrak?.evrak_sayi_no ?? "");
  const [konu, setKonu] = useState(evrak?.konu ?? "");
  const [ilgi, setIlgi] = useState(evrak?.ilgi ?? "");
  const [icerik, setIcerik] = useState(evrak?.icerik ?? "");
  const [muhatap, setMuhatap] = useState(evrak?.muhatap ?? "");
  const [ekler, setEkler] = useState(evrak?.ekler ?? "");

  useEffect(() => {
    async function load() {
      try {
        const [fData, sData, mData] = await Promise.all([
          getFirmalar(), getSantiyelerAll(), getDegerler("muhatap"),
        ]);
        setFirmalar(fData ?? []);
        setSantiyeler((sData as SantiyeBasic[]) ?? []);
        setMuhataplar(mData);
      } catch { /* sessiz */ }
    }
    load();
  }, []);

  async function handleYeniMuhatap() {
    if (!yeniMuhatap.trim()) { toast.error("Muhatap adı boş olamaz."); return; }
    const ad = yeniMuhatap.trim();
    if (muhataplar.includes(ad)) {
      setMuhatap(ad);
      setYeniMuhatap("");
      setMuhatapDialogOpen(false);
      return;
    }
    try {
      await createTanimlama({ kategori: "muhatap", sekme: "yazismalar", deger: ad, sira: muhataplar.length + 1, aktif: true });
      setMuhataplar((p) => [...p, ad]);
      setMuhatap(ad);
      setYeniMuhatap("");
      setMuhatapDialogOpen(false);
      toast.success(`Muhatap eklendi.`);
    } catch { toast.error("Muhatap eklenemedi."); }
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
        formData.append("path", `gelen/${firmaId}/${Date.now()}.pdf`);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        const data = await res.json();
        if (res.ok) pdfUrl = data.url;
      }

      const payload = {
        evrak_tarihi: evrakTarihi,
        firma_id: firmaId,
        santiye_id: santiyeId || null,
        evrak_sayi_no: evrakSayiNo,
        konu,
        ilgi: ilgi || null,
        icerik: icerik || null,
        muhatap: muhatap || null,
        ekler: ekler || null,
        pdf_url: pdfUrl,
      };

      if (isEdit) {
        await updateGelenEvrak(evrak.id, payload);
        toast.success("Evrak güncellendi.");
      } else {
        await createGelenEvrak({
          ...payload,
          olusturan_id: kullanici?.id ?? "",
          olusturma_tarihi: new Date().toISOString(),
          silindi: false,
          silme_nedeni: null,
        });
        toast.success("Evrak kaydedildi.");
      }
      onSuccess();
    } catch {
      toast.error("Kaydetme hatası.");
    } finally {
      setLoading(false);
    }
  }

  const seciliFirma = firmalar.find((f) => f.id === firmaId);

  function handleYazdir() {
    window.print();
  }

  // ==================== ÖN İZLEME ====================
  if (onIzleme) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center print:hidden">
          <Button variant="ghost" size="sm" onClick={() => setOnIzleme(false)} className="text-gray-500">
            <ArrowLeft size={16} className="mr-1" /> Düzenlemeye Dön
          </Button>
        </div>

        {/* Yazışma Şablonu - paylaşılan ön izleme bileşeni */}
        <div className="evrak-print-area shadow-sm border rounded-lg overflow-hidden">
          <GelenEvrakOnIzleme
            firma={seciliFirma ? {
              firma_adi: seciliFirma.firma_adi,
              kisa_adi: seciliFirma.kisa_adi ?? null,
              adres: seciliFirma.adres ?? null,
              antet_url: seciliFirma.antet_url ?? null,
              kase_url: seciliFirma.kase_url ?? null,
            } : null}
            evrakTarihi={evrakTarihi}
            evrakSayiNo={evrakSayiNo}
            konu={konu}
            muhatap={muhatap}
            ilgi={ilgi}
            icerik={icerik}
            ekler={ekler}
          />
        </div>

        {/* Butonlar */}
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
          <Input value={evrakSayiNo} onChange={(e) => setEvrakSayiNo(e.target.value)} placeholder="Evrak sayı numarası" disabled={loading} />
        </div>
        <div className="space-y-2">
          <Label>Konu <span className="text-red-500">*</span></Label>
          <Input value={konu} onChange={(e) => setKonu(e.target.value)} placeholder="Evrak konusu" disabled={loading} />
        </div>
      </div>

      <div className="space-y-2">
        <Label>İlgi</Label>
        <Input value={ilgi} onChange={(e) => setIlgi(e.target.value)} placeholder="İlgi bilgisi" disabled={loading} />
      </div>

      {/* Muhatap - aranabilir dropdown */}
      <div className="space-y-2">
        <Label>Muhatap</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={muhatapArama || (muhatap ? tekSatirMuhatap(muhatap) : "")}
              onChange={(e) => { setMuhatapArama(e.target.value); setMuhatapDropdownAcik(true); }}
              onFocus={() => setMuhatapDropdownAcik(true)}
              onBlur={() => setTimeout(() => setMuhatapDropdownAcik(false), 150)}
              placeholder="Muhatap ara veya seç..."
              disabled={loading}
              className={selectClass}
            />
            {muhatapDropdownAcik && (() => {
              const q = muhatapArama.toLowerCase();
              const filtreli = q ? muhataplar.filter((m) => tekSatirMuhatap(m).toLowerCase().includes(q)) : muhataplar;
              if (filtreli.length === 0) return null;
              return (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {muhatap && (
                    <button type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setMuhatap(""); setMuhatapArama(""); setMuhatapDropdownAcik(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 border-b">
                      Muhatap kaldır
                    </button>
                  )}
                  {filtreli.map((m) => (
                    <button key={m} type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => { setMuhatap(m); setMuhatapArama(""); setMuhatapDropdownAcik(false); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${muhatap === m ? "bg-blue-50 font-semibold" : ""}`}>
                      {tekSatirMuhatap(m)}
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
            onClick={() => { setYeniMuhatap(""); setMuhatapDialogOpen(true); }}
            disabled={loading}
            className="h-9"
          >
            <Plus size={14} className="mr-1" /> Muhatap Ekle
          </Button>
        </div>
      </div>

      {/* İçerik */}
      <div className="space-y-2">
        <Label>Yazı Metni (İçerik)</Label>
        <RichTextEditor value={icerik} onChange={setIcerik} placeholder="Taahhüdümüz altında yapımı devam eden..." rows={6} disabled={loading} />
      </div>

      {/* Ekler */}
      <div className="space-y-2">
        <Label>Ekler</Label>
        <Textarea value={ekler} onChange={(e) => setEkler(e.target.value)} placeholder="Ek açıklamaları" rows={2} disabled={loading} />
      </div>

      {/* PDF */}
      <div className="space-y-2">
        <Label>Evrak Taraması (PDF)</Label>
        <label className="flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white rounded-md cursor-pointer hover:bg-[#2a4f7a] transition-colors text-sm w-fit">
          <Upload size={16} />
          {pdfFile ? pdfFile.name : evrak?.pdf_url ? "Mevcut dosya yüklü - Değiştir" : "PDF Yükle"}
          <input type="file" accept=".pdf" className="hidden" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} disabled={loading} />
        </label>
      </div>

      {/* Butonlar */}
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
