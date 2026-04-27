// Sigorta & Muayene takip sayfası — öz mal araçların sigorta/muayene bitiş tarihleri + poliçe yönetimi
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getAraclar, updateArac,
  getTumPoliceler, insertAracPolice, deleteAracPolice, uploadPolice,
} from "@/lib/supabase/queries/araclar";
import { getDegerler, getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import type { Tanimlama } from "@/lib/supabase/types";
import { useAuth } from "@/hooks";
import type { AracWithRelations, AracPolice } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Shield, Search, Plus, FileText, Trash2, ExternalLink, FileDown, FileSpreadsheet,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function tr(s: string): string {
  return s.replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ı/g,"i").replace(/İ/g,"I").replace(/ö/g,"o").replace(/Ö/g,"O").replace(/ü/g,"u").replace(/Ü/g,"U");
}

function tarihDurumHesapla(tarih: string | null, yaklasirGun: number, azKaldiGun: number): { durum: "gecmis" | "az_kaldi" | "yaklasıyor" | "normal" | "bos"; kalanGun: number } {
  if (!tarih) return { durum: "bos", kalanGun: 0 };
  const bugun = new Date(); bugun.setHours(0, 0, 0, 0);
  const bitis = new Date(tarih + "T00:00:00");
  const kalanGun = Math.ceil((bitis.getTime() - bugun.getTime()) / (1000 * 60 * 60 * 24));
  if (kalanGun < 0) return { durum: "gecmis", kalanGun };
  if (kalanGun <= azKaldiGun) return { durum: "az_kaldi", kalanGun };
  if (kalanGun <= yaklasirGun) return { durum: "yaklasıyor", kalanGun };
  return { durum: "normal", kalanGun };
}

function tarihClass(durum: string): string {
  switch (durum) {
    case "gecmis": return "bg-red-100 text-red-700 font-semibold";
    case "az_kaldi": return "bg-orange-100 text-orange-700 font-semibold";
    case "yaklasıyor": return "bg-amber-100 text-amber-700 font-semibold";
    case "normal": return "text-gray-700";
    default: return "text-gray-300";
  }
}

function durumLabel(durum: string, kalanGun: number): string {
  switch (durum) {
    case "gecmis": return "Süresi Geçmiş";
    case "az_kaldi": return `Az Kaldı (${kalanGun} gün)`;
    case "yaklasıyor": return `Yaklaşıyor (${kalanGun} gün)`;
    default: return "";
  }
}

function formatTarih(tarih: string | null): string {
  if (!tarih) return "—";
  const d = new Date(tarih + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default function SigortaMuayenePage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yEkle = hasPermission("araclar-sigorta-muayene", "ekle");
  const ySil = hasPermission("araclar-sigorta-muayene", "sil");
  const [loading, setLoading] = useState(true);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  const [sigortaFirmalari, setSigortaFirmalari] = useState<string[]>([]);
  const [cinsSiralama, setCinsSiralama] = useState<Map<string, number>>(new Map());
  const [acenteler, setAcenteler] = useState<string[]>([]);
  const [arama, setArama] = useState("");
  const [durumFiltre, setDurumFiltre] = useState<"tumu" | "aktif" | "pasif">("aktif");

  // Inline edit (muayene/taşıt kartı)
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  // Poliçe dialog
  const [policeDialogOpen, setPoliceDialogOpen] = useState(false);
  const [policeAracId, setPoliceAracId] = useState("");
  const [pTip, setPTip] = useState<"kasko" | "trafik">("trafik");
  const [pTutar, setPTutar] = useState("");
  const [pFirma, setPFirma] = useState("");
  const [pAcente, setPAcente] = useState("");
  const [pIslemTarih, setPIslemTarih] = useState(() => new Date().toISOString().slice(0, 10));
  const [pBaslangicTarih, setPBaslangicTarih] = useState("");
  const [pBitisTarih, setPBitisTarih] = useState("");
  const [pPoliceNo, setPPoliceNo] = useState("");
  const [pDosya, setPDosya] = useState<File | null>(null);
  const [policeSaving, setPoliceSaving] = useState(false);

  // Poliçe listesi dialog
  const [policeListeAracId, setPoliceListeAracId] = useState<string | null>(null);

  // Silme onayı
  const [silOnay, setSilOnay] = useState<string | null>(null);

  // Uyarı gün süreleri (tanımlamalardan)
  const [yaklasirGun, setYaklasirGun] = useState(30);
  const azKaldiGun = Math.round(yaklasirGun / 3);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aData, pData, sfData, acData, yakGun, cinsData] = await Promise.all([
        getAraclar(),
        getTumPoliceler().catch(() => []),
        getDegerler("sigorta_firmasi").catch(() => []),
        getDegerler("sigorta_acente").catch(() => []),
        getDegerler("sigorta_yaklasir_gun").catch(() => []),
        getTanimlamalar("arac_cinsi").catch(() => []),
      ]);
      const araclarData = (aData as AracWithRelations[]) ?? [];
      const policelerData = pData as AracPolice[];

      // Stale temizlik: aracta trafik_sigorta_bitis/kasko_bitis var ama hiç poliçe yoksa temizle
      const policeAracTipSet = new Set(policelerData.map((p) => `${p.arac_id}-${p.police_tipi}`));
      for (const a of araclarData) {
        const temizle: { trafik_sigorta_bitis?: null; kasko_bitis?: null } = {};
        if (a.trafik_sigorta_bitis && !policeAracTipSet.has(`${a.id}-trafik`)) temizle.trafik_sigorta_bitis = null;
        if (a.kasko_bitis && !policeAracTipSet.has(`${a.id}-kasko`)) temizle.kasko_bitis = null;
        if (Object.keys(temizle).length > 0) {
          try {
            await updateArac(a.id, temizle);
            if ("trafik_sigorta_bitis" in temizle) a.trafik_sigorta_bitis = null;
            if ("kasko_bitis" in temizle) a.kasko_bitis = null;
          } catch {
            // Sessizce geç — UI'yi yine de doğru göstermek için police-only display kullanılıyor
          }
        }
      }

      setAraclar(araclarData);
      const sMap = new Map<string, number>();
      ((cinsData as Tanimlama[]) ?? []).forEach((t, i) => sMap.set(t.deger, i));
      setCinsSiralama(sMap);
      setPoliceler(policelerData);
      setSigortaFirmalari(sfData);
      setAcenteler(acData);
      if (yakGun.length > 0) setYaklasirGun(parseInt(yakGun[0]) || 30);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Araç bazlı son poliçe map'i
  // Her araç için bitiş tarihi en ileri olan poliçeyi bul
  const sonPoliceMap = useMemo(() => {
    const map = new Map<string, { kasko: AracPolice | null; trafik: AracPolice | null }>();
    for (const p of policeler) {
      if (!map.has(p.arac_id)) map.set(p.arac_id, { kasko: null, trafik: null });
      const entry = map.get(p.arac_id)!;
      if (p.police_tipi === "kasko") {
        if (!entry.kasko || (p.bitis_tarihi ?? "") > (entry.kasko.bitis_tarihi ?? "")) entry.kasko = p;
      }
      if (p.police_tipi === "trafik") {
        if (!entry.trafik || (p.bitis_tarihi ?? "") > (entry.trafik.bitis_tarihi ?? "")) entry.trafik = p;
      }
    }
    return map;
  }, [policeler]);

  const filtrelenmis = araclar.filter((a) => {
    if (a.tip !== "ozmal") return false;
    if (a.durum === "trafikten_cekildi") return false;
    if (durumFiltre !== "tumu" && a.durum !== durumFiltre) return false;
    if (arama.trim()) {
      const q = arama.trim().toLowerCase();
      const sp = sonPoliceMap.get(a.id);
      const text = [
        a.plaka, a.marka, a.model, a.cinsi,
        formatTarih(sp?.trafik?.bitis_tarihi ?? a.trafik_sigorta_bitis),
        formatTarih(sp?.kasko?.bitis_tarihi ?? a.kasko_bitis),
        formatTarih(a.muayene_bitis), formatTarih(a.tasit_karti_bitis),
        durumLabel(tarihDurumHesapla(sp?.trafik?.bitis_tarihi ?? a.trafik_sigorta_bitis, yaklasirGun, azKaldiGun).durum, tarihDurumHesapla(sp?.trafik?.bitis_tarihi ?? a.trafik_sigorta_bitis, yaklasirGun, azKaldiGun).kalanGun),
      ].filter(Boolean).join(" ").toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const sa = cinsSiralama.get(a.cinsi ?? "") ?? 999;
    const sb = cinsSiralama.get(b.cinsi ?? "") ?? 999;
    return sa - sb;
  });

  // Inline tarih kaydetme (muayene/taşıt kartı)
  async function saveDate(aracId: string, field: string, value: string) {
    try {
      await updateArac(aracId, { [field]: value || null });
      await loadData();
      setEditKey(null);
      toast.success("Tarih güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Poliçe dialog aç
  function policeDialogAc(aracId: string) {
    setPoliceAracId(aracId);
    setPTip("trafik");
    setPTutar(""); setPFirma(""); setPAcente("");
    setPIslemTarih(new Date().toISOString().slice(0, 10));
    setPBaslangicTarih(""); setPBitisTarih(""); setPPoliceNo(""); setPDosya(null);
    setPoliceDialogOpen(true);
  }

  // Poliçe kaydet
  async function policeKaydet() {
    if (!policeAracId) return;
    if (!pBitisTarih) { toast.error("Bitiş tarihi girin."); return; }
    setPoliceSaving(true);
    try {
      const result = await insertAracPolice({
        arac_id: policeAracId,
        police_tipi: pTip,
        tutar: parseParaInput(pTutar) || null,
        sigorta_firmasi: pFirma || null,
        acente: pAcente || null,
        islem_tarihi: pIslemTarih || null,
        baslangic_tarihi: pBaslangicTarih || null,
        bitis_tarihi: pBitisTarih,
        police_no: pPoliceNo || null,
        police_url: null,
        created_by: kullanici?.id ?? null,
      });

      // PDF yükle
      if (pDosya && result.id) {
        const url = await uploadPolice(pDosya, result.id);
        // URL'i güncelle — basit insert sonrası update gerekli
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        await supabase.from("arac_police").update({ police_url: url }).eq("id", result.id);
      }

      // Aracın ilgili bitiş tarihini güncelle — mevcut poliçeler + yeni poliçe içindeki en ileri bitiş
      const ayniTipPoliceler = policeler.filter(
        (p) => p.arac_id === policeAracId && p.police_tipi === pTip
      );
      let enIleriBitis = pBitisTarih;
      for (const p of ayniTipPoliceler) {
        if (p.bitis_tarihi && p.bitis_tarihi > enIleriBitis) enIleriBitis = p.bitis_tarihi;
      }
      const updateField = pTip === "kasko" ? "kasko_bitis" : "trafik_sigorta_bitis";
      await updateArac(policeAracId, { [updateField]: enIleriBitis });

      await loadData();
      setPoliceDialogOpen(false);
      toast.success("Poliçe kaydedildi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPoliceSaving(false);
    }
  }

  // Poliçe sil — silinen poliçeye göre araç bitiş tarihini de güncelle
  async function policeSil() {
    if (!silOnay) return;
    try {
      // Silinmeden önce poliçe bilgilerini al
      const silinen = policeler.find((p) => p.id === silOnay);
      await deleteAracPolice(silOnay);

      if (silinen) {
        // Silinen poliçenin tipinde aynı araca ait kalan poliçeler
        const kalan = policeler.filter(
          (p) => p.id !== silOnay && p.arac_id === silinen.arac_id && p.police_tipi === silinen.police_tipi
        );
        // Kalan poliçelerden en ileri bitiş tarihini bul (yoksa null)
        let yeniBitis: string | null = null;
        for (const k of kalan) {
          if (k.bitis_tarihi && (!yeniBitis || k.bitis_tarihi > yeniBitis)) {
            yeniBitis = k.bitis_tarihi;
          }
        }
        const updateField = silinen.police_tipi === "kasko" ? "kasko_bitis" : "trafik_sigorta_bitis";
        await updateArac(silinen.arac_id, { [updateField]: yeniBitis });
      }

      setSilOnay(null);
      await loadData();
      toast.success("Poliçe silindi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // renderTarihCell — inline render (sub-component olarak değil, focus kaybını önler)
  function renderTarihCell(arac: AracWithRelations, field: string) {
    const tarih = arac[field as keyof AracWithRelations] as string | null;
    const { durum, kalanGun } = tarihDurumHesapla(tarih, yaklasirGun, azKaldiGun);
    const key = `${arac.id}-${field}`;

    if (editKey === key) {
      return (
        <div className="flex items-center gap-1">
          <input type="date" defaultValue={editValue} autoFocus
            data-date-field={key}
            onKeyDown={(e) => {
              const val = (e.target as HTMLInputElement).value;
              if (e.key === "Enter") saveDate(arac.id, field, val);
              if (e.key === "Escape") setEditKey(null);
            }}
            className="h-7 text-xs border rounded px-1 flex-1" />
          <button type="button" onClick={() => {
            const el = document.querySelector(`[data-date-field="${key}"]`) as HTMLInputElement | null;
            if (el) saveDate(arac.id, field, el.value);
          }} className="text-[10px] text-white bg-emerald-600 rounded px-1.5 py-1 hover:bg-emerald-700" title="Kaydet">OK</button>
          <button type="button" onClick={() => saveDate(arac.id, field, "")}
            className="text-[10px] text-white bg-red-500 rounded px-1.5 py-1 hover:bg-red-600" title="Tarihi temizle">
            Temizle
          </button>
        </div>
      );
    }

    return (
      <button type="button" onClick={() => { setEditKey(key); setEditValue(tarih ?? ""); }}
        className={`w-full text-center px-1.5 py-1 rounded text-xs cursor-pointer hover:ring-2 hover:ring-blue-300 ${tarihClass(durum)}`}>
        {tarih ? formatTarih(tarih) : "—"}
        {durumLabel(durum, kalanGun) && <span className="block text-[9px]">{durumLabel(durum, kalanGun)}</span>}
      </button>
    );
  }

  // SigortaCell — sadece poliçeden veri gelir, elle düzenleme yok
  function SigortaCell({ arac, tip }: { arac: AracWithRelations; tip: "kasko" | "trafik" }) {
    const police = sonPoliceMap.get(arac.id)?.[tip];
    const tarih = police?.bitis_tarihi ?? null;
    const { durum, kalanGun } = tarihDurumHesapla(tarih, yaklasirGun, azKaldiGun);

    return (
      <div className={`text-center px-1.5 py-1 rounded text-xs ${tarihClass(durum)}`} title={police ? "Bu tarih aktif poliçeden gelir" : "Poliçe ekleyin"}>
        {tarih ? formatTarih(tarih) : "—"}
        {durumLabel(durum, kalanGun) && <span className="block text-[9px]">{durumLabel(durum, kalanGun)}</span>}
      </div>
    );
  }

  // Araça ait poliçeler
  const listePolice = policeListeAracId ? policeler.filter((p) => p.arac_id === policeListeAracId) : [];
  const listeArac = policeListeAracId ? araclar.find((a) => a.id === policeListeAracId) : null;

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Sigorta & Muayene Takip", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length} arac`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["No", "Plaka", "Marka", "Model", "Cinsi", "Trafik Sigorta Bitis", "Kasko Bitis", "Muayene Bitis", "Tasit Karti Bitis"]],
      body: filtrelenmis.map((a, i) => {
        const sp = sonPoliceMap.get(a.id);
        return [
          String(i + 1), a.plaka, tr(a.marka ?? ""), tr(a.model ?? ""), tr(a.cinsi ?? ""),
          tr(formatTarih(sp?.trafik?.bitis_tarihi ?? a.trafik_sigorta_bitis)),
          tr(formatTarih(sp?.kasko?.bitis_tarihi ?? a.kasko_bitis)),
          tr(formatTarih(a.muayene_bitis)),
          tr(formatTarih(a.tasit_karti_bitis)),
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("sigorta-muayene.pdf");
  }

  function exportExcel() {
    const headers = ["No", "Plaka", "Marka", "Model", "Cinsi", "Trafik Sigorta Bitiş", "Kasko Bitiş", "Muayene Bitiş", "Taşıt Kartı Bitiş"];
    const data = filtrelenmis.map((a, i) => {
      const sp = sonPoliceMap.get(a.id);
      return [
        i + 1, a.plaka, a.marka ?? "", a.model ?? "", a.cinsi ?? "",
        formatTarih(sp?.trafik?.bitis_tarihi ?? a.trafik_sigorta_bitis),
        formatTarih(sp?.kasko?.bitis_tarihi ?? a.kasko_bitis),
        formatTarih(a.muayene_bitis),
        formatTarih(a.tasit_karti_bitis),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sigorta Muayene");
    XLSX.writeFile(wb, "sigorta-muayene.xlsx");
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Shield size={24} /> Sigorta & Muayene
        </h1>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Plaka, marka, model..." className="pl-8 h-9 w-48" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Durum</Label>
          <select value={durumFiltre} onChange={(e) => setDurumFiltre(e.target.value as typeof durumFiltre)} className={selectClass}>
            <option value="tumu">Tümü</option>
            <option value="aktif">Aktif</option>
            <option value="pasif">Pasif</option>
          </select>
        </div>
        <div className="flex gap-1 items-end ml-auto">
          <span className="text-xs text-gray-400 mr-2">{filtrelenmis.length} öz mal araç</span>
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-9 gap-1 text-xs">
            <FileDown size={14} /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs">
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {filtrelenmis.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Shield size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Öz mal araç bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2 w-10">No</TableHead>
                <TableHead className="text-white text-[11px] px-2">Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Marka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Model</TableHead>
                <TableHead className="text-white text-[11px] px-2">Cinsi</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[100px]">Trafik Sigorta Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[100px]">Kasko Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[100px]">Muayene Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center min-w-[100px]">Taşıt Kartı Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Durum</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center w-[80px]">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((a, i) => (
                <TableRow key={a.id} className="hover:bg-gray-50">
                  <TableCell className="px-2 text-center text-gray-400">{i + 1}</TableCell>
                  <TableCell className="px-2 font-bold text-[#1E3A5F]">{a.plaka}</TableCell>
                  <TableCell className="px-2">{a.marka ?? "—"}</TableCell>
                  <TableCell className="px-2">{a.model ?? "—"}</TableCell>
                  <TableCell className="px-2">{a.cinsi ?? "—"}</TableCell>
                  <TableCell className="px-2"><SigortaCell arac={a} tip="trafik" /></TableCell>
                  <TableCell className="px-2"><SigortaCell arac={a} tip="kasko" /></TableCell>
                  <TableCell className="px-2">{renderTarihCell(a, "muayene_bitis")}</TableCell>
                  <TableCell className="px-2">{renderTarihCell(a, "tasit_karti_bitis")}</TableCell>
                  <TableCell className="px-2 text-center">
                    <Badge className={a.durum === "aktif" ? "bg-green-600" : "bg-gray-400"}>{a.durum === "aktif" ? "Aktif" : "Pasif"}</Badge>
                  </TableCell>
                  <TableCell className="px-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {yEkle && (
                        <button type="button" onClick={() => policeDialogAc(a.id)} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100">
                          <Plus size={11} /> Poliçe Ekle
                        </button>
                      )}
                      <button type="button" onClick={() => setPoliceListeAracId(a.id)} className="p-1 text-gray-400 hover:text-blue-600" title="Poliçeler">
                        <FileText size={14} />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Poliçe Ekle Dialog */}
      <Dialog open={policeDialogOpen} onOpenChange={setPoliceDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Poliçe Ekle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Tipi <span className="text-red-500">*</span></Label>
              <select value={pTip} onChange={(e) => setPTip(e.target.value as "kasko" | "trafik")} className={selectClass + " w-full"}>
                <option value="trafik">Trafik Sigortası</option>
                <option value="kasko">Kasko</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tutar (TL)</Label>
              <input type="text" inputMode="decimal" value={pTutar} onChange={(e) => setPTutar(formatParaInput(e.target.value))}
                placeholder="0,00" className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sigorta Firması</Label>
              <select value={pFirma} onChange={(e) => setPFirma(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {sigortaFirmalari.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acente</Label>
              <select value={pAcente} onChange={(e) => setPAcente(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {acenteler.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">İşlem Tarihi (Veri giriş tarihi)</Label>
              <input type="date" value={pIslemTarih} onChange={(e) => setPIslemTarih(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Başlangıç Tarihi <span className="text-red-500">*</span></Label>
                <input type="date" value={pBaslangicTarih} onChange={(e) => setPBaslangicTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bitiş Tarihi <span className="text-red-500">*</span></Label>
                <input type="date" value={pBitisTarih} onChange={(e) => setPBitisTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Numarası</Label>
              <input type="text" value={pPoliceNo} onChange={(e) => setPPoliceNo(e.target.value)} placeholder="Poliçe No"
                className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe PDF</Label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setPDosya(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white" />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setPoliceDialogOpen(false)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={policeKaydet} disabled={policeSaving}>
                {policeSaving ? "Kaydediliyor..." : "Kaydet"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Poliçe Listesi Dialog */}
      <Dialog open={!!policeListeAracId} onOpenChange={(o) => !o && setPoliceListeAracId(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{listeArac?.plaka ?? ""} — Poliçeler</DialogTitle>
          </DialogHeader>
          {listePolice.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Bu araca ait poliçe bulunmuyor.</p>
          ) : (
            <div className="space-y-2">
              {listePolice.map((p) => (
                <div key={p.id} className="border rounded-lg px-3 py-2 text-xs flex items-center gap-3">
                  <Badge className={p.police_tipi === "kasko" ? "bg-blue-600" : "bg-emerald-600"}>
                    {p.police_tipi === "kasko" ? "Kasko" : "Trafik"}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{p.police_no ?? "—"}</div>
                    <div className="text-gray-400">
                      {p.sigorta_firmasi ?? ""} {p.acente ? `/ ${p.acente}` : ""}
                      {p.tutar ? ` — ${p.tutar.toLocaleString("tr-TR")} TL` : ""}
                    </div>
                    <div className="text-gray-400">
                      {p.islem_tarihi ? formatTarih(p.islem_tarihi) : ""} → {formatTarih(p.bitis_tarihi)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {p.police_url && (
                      <a href={p.police_url} target="_blank" rel="noopener noreferrer" className="p-1 text-blue-500 hover:text-blue-700">
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {ySil && (
                      <button type="button" onClick={() => setSilOnay(p.id)} className="p-1 text-gray-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Silme Onayı */}
      <Dialog open={!!silOnay} onOpenChange={(o) => !o && setSilOnay(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Poliçeyi Sil</DialogTitle></DialogHeader>
          <p className="text-sm text-gray-600 py-2">Bu poliçeyi silmek istediğinize emin misiniz?</p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setSilOnay(null)}>İptal</Button>
            <Button variant="destructive" onClick={policeSil}>Sil</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
