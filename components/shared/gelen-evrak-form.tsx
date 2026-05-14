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
import { filtreliSantiyeler } from "@/lib/utils/santiye-filtre";
import SantiyeSelect from "@/components/shared/santiye-select";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { createTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import { trAramaNormalize } from "@/lib/utils/isim";
import { useAuth } from "@/hooks";
import type { GelenEvrakWithRelations, Firma } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Save, Eye, Upload, Plus, ArrowLeft, FileText, Trash2 } from "lucide-react";
import { tekSatirMuhatap } from "@/lib/utils/muhatap";
import { formatBaslik } from "@/lib/utils/isim";
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
  const isEdit = !!evrak?.id;
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
  // İLGİ — çoklu ilgi listesi (A, B, C, ... harfleriyle).
  // DB'de tek metin alanı (`ilgi`) → satırlar `\n` ile birleştirilip kaydedilir.
  const [ilgiListesi, setIlgiListesi] = useState<string[]>(() => {
    const raw = evrak?.ilgi ?? "";
    return raw ? raw.split("\n").map((s) => s.trim()).filter(Boolean) : [];
  });
  const ilgiHarfler = ["A", "B", "C", "D", "E", "F", "G", "H"];
  function basHarfBuyuk(v: string) {
    return v.length === 0 ? v : (v.length === 1 ? v.toUpperCase() : v.charAt(0).toUpperCase() + v.slice(1));
  }
  function addIlgi() { setIlgiListesi((p) => [...p, ""]); }
  function removeIlgi(i: number) { setIlgiListesi((p) => p.filter((_, idx) => idx !== i)); }
  function updateIlgi(i: number, v: string) {
    setIlgiListesi((p) => p.map((x, idx) => (idx === i ? basHarfBuyuk(v) : x)));
  }
  const [icerik, setIcerik] = useState(evrak?.icerik ?? "");
  const [muhatap, setMuhatap] = useState(evrak?.muhatap ?? "");
  // EKLER — artık çoklu PDF dosyası. URL'ler `ekler` alanına \n ile birleştirilip kaydedilir.
  // Backward compat: eski metin açıklamalı kayıtlarda URL olmayan satırlar metin olarak kalır.
  // urlMu(): bir satırın URL olduğunu sezgisel olarak tespit eder.
  function urlMu(s: string): boolean {
    return /^https?:\/\//i.test(s.trim());
  }
  const [eklerListesi, setEklerListesi] = useState<string[]>(() => {
    const raw = evrak?.ekler ?? "";
    return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  });
  const [ekUploading, setEkUploading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [fData, sData, mData] = await Promise.all([
          getFirmalar(), getSantiyelerAll(), getDegerler("muhatap"),
        ]);
        // Firma kapsamı: kullanıcının firma_ids'i tanımlıysa sadece o firmalar görünür
        // (Rol fark etmez. firma_ids boş/null ise tümüne erişir.)
        const izinliFirmaIds = (kullanici?.firma_ids && kullanici.firma_ids.length > 0)
          ? new Set(kullanici.firma_ids) : null;
        const filtreliFirmalar = izinliFirmaIds
          ? (fData ?? []).filter((f) => izinliFirmaIds.has(f.id))
          : (fData ?? []);
        setFirmalar(filtreliFirmalar);

        // Kısıtlı/şantiye_admin sadece atandığı şantiyeleri görür
        const tumSantiyeler = (sData as SantiyeBasic[]) ?? [];
        const filtreliSants = filtreliSantiyeler(tumSantiyeler, kullanici);
        setSantiyeler(filtreliSants);
        setMuhataplar(mData);

        // Otomatik default — yeni kayıtta tek izinli firma/şantiye varsa seç
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
        if (res.ok && data.url) {
          pdfUrl = data.url;
        } else {
          // Upload BAŞARISIZ — kullanıcıya net hata ver, formu boş kayıtla kaydetme.
          toast.error(`Evrak taraması yüklenemedi: ${data?.error ?? "Bilinmeyen hata"}`);
          setLoading(false);
          return;
        }
      }

      const payload = {
        evrak_tarihi: evrakTarihi,
        firma_id: firmaId,
        santiye_id: santiyeId || null,
        evrak_sayi_no: evrakSayiNo,
        konu: formatBaslik(konu),
        ilgi: ilgiListesi.filter((s) => s.trim()).join("\n") || null,
        icerik: icerik || null,
        muhatap: muhatap?.trim() || null,
        ekler: eklerListesi.length > 0 ? eklerListesi.join("\n") : null,
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
        <div className="evrak-print-area">
          <div className="evrak-preview-page shadow-sm border rounded-lg overflow-hidden mx-auto" style={{ width: "210mm", maxWidth: "100%" }}>
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
            ilgi={ilgiListesi.filter((s) => s.trim()).join("\n") || null}
            icerik={icerik}
            ekler={eklerListesi.length > 0 ? eklerListesi.join("\n") : null}
          />
          </div>
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
          <Input
            value={konu}
            onChange={(e) => setKonu(e.target.value)}
            onBlur={(e) => setKonu(formatBaslik(e.target.value))}
            placeholder="Evrak konusu"
            disabled={loading}
          />
        </div>
      </div>

      {/* İlgi — çoklu satır listesi. Label'ın yanında + butonu ile yeni ilgi satırı eklenir.
          Her satır A, B, C, ... harfleriyle etiketlenir. DB'ye `\n` ile birleştirilmiş kaydedilir. */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Label>İlgi</Label>
          <button
            type="button"
            onClick={addIlgi}
            disabled={loading}
            title="Yeni ilgi ekle"
            className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#1E3A5F] text-white hover:bg-[#2a4f7a] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <Plus size={14} />
          </button>
        </div>
        {ilgiListesi.length > 0 ? (
          <div className="space-y-2">
            {ilgiListesi.map((ilgi, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-medium w-12">İlgi {ilgiHarfler[i] ?? (i + 1)}:</span>
                <Input
                  value={ilgi}
                  onChange={(e) => updateIlgi(i, e.target.value)}
                  placeholder="İlgi metni"
                  className="flex-1"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => removeIlgi(i)}
                  className="text-red-400 hover:text-red-600 p-1"
                  title="Kaldır"
                  disabled={loading}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-400">Henüz ilgi eklenmedi. Yandaki + butonuyla ekleyebilirsiniz.</p>
        )}
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
              const q = trAramaNormalize(muhatapArama);
              const filtreli = q ? muhataplar.filter((m) => trAramaNormalize(tekSatirMuhatap(m)).includes(q)) : muhataplar;
              if (filtreli.length === 0) return null;
              return (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  className="absolute z-30 left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg max-h-72 overflow-y-auto"
                >
                  {muhatap && (
                    <button type="button"
                      onClick={() => { setMuhatap(""); setMuhatapArama(""); setMuhatapDropdownAcik(false); }}
                      className="w-full text-left px-3 py-2 text-xs text-gray-400 hover:bg-gray-50 border-b">
                      Muhatap kaldır
                    </button>
                  )}
                  {filtreli.map((m) => (
                    <button key={m} type="button"
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

      {/* Ekler — çoklu PDF yükleme. Yüklenen URL'ler ekler alanına satır satır kaydedilir.
          Eski kayıtlarda metin açıklamaları varsa onlar da listede görünür ve silinebilir. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Ekler (PDF Dosyaları)</Label>
          <label className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
            ekUploading || loading
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-[#1E3A5F] text-white hover:bg-[#2a4f7a]"
          }`}>
            <Upload size={14} />
            {ekUploading ? "Yükleniyor..." : "PDF Yükle"}
            <input
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              disabled={loading || ekUploading}
              onChange={async (e) => {
                const dosyalar = e.target.files;
                if (!dosyalar || dosyalar.length === 0) return;
                if (!firmaId) { toast.error("Önce firma seçin."); e.target.value = ""; return; }
                setEkUploading(true);
                try {
                  // Dosya adını Supabase Storage'a güvenli hale getir:
                  // - Türkçe karakterler ASCII'ye çevrilir (ş→s, ğ→g, ı→i, ...)
                  // - Boşluk, parantez, virgül gibi özel karakterler "_" olur
                  // - Uzantı korunur, sadece ad sanitize edilir
                  const sanitizeDosyaAdi = (ad: string): string => {
                    const harfHaritasi: Record<string, string> = {
                      "ç": "c", "Ç": "C", "ğ": "g", "Ğ": "G", "ı": "i", "İ": "I",
                      "ö": "o", "Ö": "O", "ş": "s", "Ş": "S", "ü": "u", "Ü": "U",
                    };
                    let temiz = ad.replace(/[çÇğĞıİöÖşŞüÜ]/g, (m) => harfHaritasi[m] || m);
                    // Sadece harf, rakam, nokta, tire kabul et — diğerleri _ olsun
                    temiz = temiz.replace(/[^a-zA-Z0-9._-]/g, "_");
                    // Birden fazla _ → tek _
                    temiz = temiz.replace(/_+/g, "_");
                    return temiz.toLowerCase();
                  };

                  const yeniUrls: string[] = [];
                  for (const dosya of Array.from(dosyalar)) {
                    const guvenliAd = sanitizeDosyaAdi(dosya.name);
                    const formData = new FormData();
                    formData.append("file", dosya);
                    formData.append("bucket", "yazismalar");
                    formData.append("path", `gelen-ek/${firmaId}/${Date.now()}-${guvenliAd}`);
                    const res = await fetch("/api/upload", { method: "POST", body: formData });
                    const data = await res.json();
                    if (res.ok && data.url) {
                      yeniUrls.push(data.url);
                    } else {
                      toast.error(`"${dosya.name}" yüklenemedi: ${data?.error ?? "Bilinmeyen hata"}`);
                    }
                  }
                  if (yeniUrls.length > 0) {
                    setEklerListesi((prev) => [...prev, ...yeniUrls]);
                    toast.success(`${yeniUrls.length} dosya eklendi.`);
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
                  toast.error(`Yükleme hatası: ${msg}`);
                } finally {
                  setEkUploading(false);
                  e.target.value = "";
                }
              }}
            />
          </label>
        </div>
        {eklerListesi.length === 0 ? (
          <p className="text-xs text-gray-400">Henüz ek dosya eklenmedi. &quot;PDF Yükle&quot; ile birden fazla PDF ekleyebilirsiniz.</p>
        ) : (
          <div className="space-y-1.5">
            {eklerListesi.map((ek, i) => {
              const isUrl = urlMu(ek);
              return (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-200 bg-gray-50">
                  <span className="text-[10px] font-semibold text-gray-500 w-10 flex-shrink-0">Ek {i + 1}</span>
                  {isUrl ? (
                    <a
                      href={ek}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 flex-1 min-w-0 text-xs text-[#1E3A5F] hover:text-[#F97316] truncate"
                      title={ek}
                    >
                      <FileText size={12} className="flex-shrink-0" />
                      <span className="truncate">
                        {(() => {
                          try {
                            const path = new URL(ek).pathname;
                            const name = decodeURIComponent(path.split("/").pop() ?? "PDF");
                            // Timestamp prefix'i temizle ("123456789-dosya.pdf" → "dosya.pdf")
                            return name.replace(/^\d+-/, "");
                          } catch {
                            return "PDF";
                          }
                        })()}
                      </span>
                    </a>
                  ) : (
                    // Eski metin açıklamaları — düzenlenebilir input olarak göster
                    <input
                      type="text"
                      value={ek}
                      onChange={(e) => setEklerListesi((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))}
                      className="flex-1 text-xs px-2 py-0.5 rounded border bg-white"
                      disabled={loading}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setEklerListesi((p) => p.filter((_, idx) => idx !== i))}
                    className="text-red-400 hover:text-red-600 flex-shrink-0"
                    title="Kaldır"
                    disabled={loading}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
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
