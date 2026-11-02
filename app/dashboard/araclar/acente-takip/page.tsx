// Acente Takip — tüm poliçelerin tarih sıralı listesi
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getAraclar, getTumPoliceler, deleteAracPolice, updateAracPolice, uploadPolice, getSigortaTeklifler, getTeklifGonderimler } from "@/lib/supabase/queries/araclar";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { useAuth, useOturumFiltresi } from "@/hooks";
import type { AracWithRelations, AracPolice, SigortaTeklif, TeklifGonderim } from "@/lib/supabase/types";
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
import { Headphones, Search, ExternalLink, Trash2, Pencil, FileDown, FileSpreadsheet } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import toast from "react-hot-toast";
import { trAramaNormalize } from "@/lib/utils/isim";
import { dosyaUrl } from "@/lib/utils/dosya-url";
import { acenteRengi } from "@/lib/utils/acente-renk";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTarih(tarih: string | null): string {
  if (!tarih) return "—";
  const d = new Date(tarih + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function tr(s: string): string {
  return s.replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ı/g,"i").replace(/İ/g,"I").replace(/ö/g,"o").replace(/Ö/g,"O").replace(/ü/g,"u").replace(/Ü/g,"U");
}

function formatPara(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " TL";
}

export default function AcenteTakipPage() {
  const { kullanici, isYonetici, hasPermission } = useAuth();
  const yDuzenle = hasPermission("araclar-acente-takip", "duzenle");
  const ySil = hasPermission("araclar-acente-takip", "sil");
  const [loading, setLoading] = useState(true);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  // "Biz ne zaman teklif istemiştik" — Gelen Teklifler penceresinin başlığında yazar.
  const [teklifGonderimler, setTeklifGonderimler] = useState<TeklifGonderim[]>([]);
  // Filtreler oturum-içi: F5'te korunur, sayfadan çıkıp dönünce sıfırlanır.
  const [arama, setArama] = useOturumFiltresi("acente-takip:arama", "");
  const [tipFiltre, setTipFiltre] = useOturumFiltresi<"" | "kasko" | "trafik">("acente-takip:tip", "");
  const [fBaslangic, setFBaslangic] = useOturumFiltresi("acente-takip:bas", "");
  const [fBitis, setFBitis] = useOturumFiltresi("acente-takip:bit", "");
  const [silOnay, setSilOnay] = useState<string | null>(null);
  const [sigortaFirmalari, setSigortaFirmalari] = useState<string[]>([]);
  const [acenteler, setAcenteler] = useState<string[]>([]);

  // Düzenleme dialog
  const [editPolice, setEditPolice] = useState<AracPolice | null>(null);
  const [eTip, setETip] = useState<"kasko" | "trafik">("trafik");
  const [eTutar, setETutar] = useState("");
  const [eFirma, setEFirma] = useState("");
  const [eAcente, setEAcente] = useState("");
  const [eIslemTarih, setEIslemTarih] = useState("");
  const [eBaslangicTarih, setEBaslangicTarih] = useState("");
  const [eBitisTarih, setEBitisTarih] = useState("");
  const [ePoliceNo, setEPoliceNo] = useState("");
  const [eDosya, setEDosya] = useState<File | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  // Poliçeye bağlı gelen teklifler + görüntüleme diyaloğu
  const [sigortaTeklifler, setSigortaTeklifler] = useState<SigortaTeklif[]>([]);
  const [teklifGor, setTeklifGor] = useState<{ policeId: string; plaka: string; tip: string } | null>(null);
  // Uzun mail metni satırı şişiriyordu: not iki satırda kesilir, istenirse açılır.
  const [acikNotlar, setAcikNotlar] = useState<Record<string, boolean>>({});
  // Varsayılan: her acentenin YALNIZ en uygun teklifi. Bir acente tek mailde 14 firma
  // gönderebiliyor; hepsi alt alta dizilince karşılaştırılacak rakam kayboluyordu.
  const [tumTeklifler, setTumTeklifler] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [aData, pData, sfData, acData, sigTek, gonData] = await Promise.all([
        getAraclar(),
        getTumPoliceler().catch(() => []),
        getDegerler("sigorta_firmasi").catch(() => []),
        getDegerler("sigorta_acente").catch(() => []),
        getSigortaTeklifler().catch(() => []),
        getTeklifGonderimler().catch(() => []),
      ]);
      setAraclar((aData as AracWithRelations[]) ?? []);
      setPoliceler(pData as AracPolice[]);
      setSigortaFirmalari(sfData);
      setAcenteler(acData);
      setSigortaTeklifler(sigTek as SigortaTeklif[]);
      setTeklifGonderimler(gonData as TeklifGonderim[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const aracMap = useMemo(() => {
    const m = new Map<string, AracWithRelations>();
    for (const a of araclar) m.set(a.id, a);
    return m;
  }, [araclar]);

  // Poliçe id → o poliçeye bağlı gelen teklifler (ucuzdan pahalıya).
  const teklifByPolice = useMemo(() => {
    const m = new Map<string, SigortaTeklif[]>();
    for (const t of sigortaTeklifler) {
      if (!t.police_id) continue;
      const arr = m.get(t.police_id) ?? [];
      arr.push(t);
      m.set(t.police_id, arr);
    }
    // AYNI TEKLİF İKİ KEZ GÖRÜNMESİN: aynı acente + aynı firma + aynı tutar tek satır.
    // Elle girilen bir teklif sonradan mailden de okunabiliyor; ikisi aynı şeydir ve
    // listede iki ayrı "En uygun" satırı olarak duruyordu. Kaynağı belli olan kalır.
    const puan = (t: SigortaTeklif) => (t.ek_url ? 2 : 0) + (t.kaynak ? 1 : 0);
    for (const [id, arr] of m) {
      const tek = new Map<string, SigortaTeklif>();
      for (const t of arr) {
        const k = `${t.acente_adi}|${t.sigorta_firmasi ?? ""}|${Math.round(t.teklif_tutari)}`;
        const o = tek.get(k);
        if (!o || puan(t) > puan(o)) tek.set(k, t);
      }
      m.set(id, [...tek.values()].sort((a, b) => a.teklif_tutari - b.teklif_tutari));
    }
    return m;
  }, [sigortaTeklifler]);

  const filtrelenmis = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    // Kısıtlı/şantiye admin: sadece atandığı şantiyelerdeki araçların poliçeleri.
    // santiyesiz_veri_gor=true → şantiye atanmamış (NULL) araçlar da görünür.
    const izinliSantiyeler = !isYonetici && kullanici?.santiye_ids
      ? new Set(kullanici.santiye_ids)
      : null;
    const santiyesizDahil = !!kullanici?.santiyesiz_veri_gor;
    return policeler
      .filter((p) => {
        if (tipFiltre && p.police_tipi !== tipFiltre) return false;
        // Atanmamış şantiyelerin araçlarına ait poliçeleri gizle
        if (izinliSantiyeler) {
          const arac = aracMap.get(p.arac_id);
          if (!arac) return false;
          if (!arac.santiye_id) {
            if (!santiyesizDahil) return false;
          } else if (!izinliSantiyeler.has(arac.santiye_id)) {
            return false;
          }
        }
        // Filtreleme tarihi: islem_tarihi → yoksa kaydedilme tarihi
        const tarih = p.islem_tarihi || p.created_at?.slice(0, 10) || "";
        if (fBaslangic && tarih && tarih < fBaslangic) return false;
        if (fBitis && tarih && tarih > fBitis) return false;
        if (q) {
          const arac = aracMap.get(p.arac_id);
          const text = trAramaNormalize([
            arac?.plaka, arac?.marka, arac?.model,
            arac?.firmalar?.firma_adi,
            p.sigorta_firmasi, p.acente, p.police_no,
            formatTarih(p.islem_tarihi), formatTarih(p.baslangic_tarihi), formatTarih(p.bitis_tarihi),
            p.tutar != null ? p.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : null,
            p.tutar != null ? String(p.tutar) : null,
          ].filter(Boolean).join(" "));
          if (!text.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (b.islem_tarihi ?? b.created_at).localeCompare(a.islem_tarihi ?? a.created_at));
  }, [policeler, tipFiltre, arama, aracMap, fBaslangic, fBitis, isYonetici, kullanici]);

  function duzenleAc(p: AracPolice) {
    setEditPolice(p);
    setETip(p.police_tipi);
    setETutar(p.tutar != null ? String(p.tutar).replace(".", ",") : "");
    setEFirma(p.sigorta_firmasi ?? "");
    setEAcente(p.acente ?? "");
    setEIslemTarih(p.islem_tarihi ?? "");
    setEBaslangicTarih(p.baslangic_tarihi ?? "");
    setEBitisTarih(p.bitis_tarihi ?? "");
    setEPoliceNo(p.police_no ?? "");
    setEDosya(null);
  }

  async function duzenleKaydet() {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (!editPolice) return;
    setEditSaving(true);
    try {
      let policeUrl = editPolice.police_url;
      if (eDosya) {
        policeUrl = await uploadPolice(eDosya, editPolice.id);
      }
      await updateAracPolice(editPolice.id, {
        police_tipi: eTip,
        tutar: parseParaInput(eTutar) || null,
        sigorta_firmasi: eFirma || null,
        acente: eAcente || null,
        islem_tarihi: eIslemTarih || null,
        baslangic_tarihi: eBaslangicTarih || null,
        bitis_tarihi: eBitisTarih || null,
        police_no: ePoliceNo || null,
        police_url: policeUrl,
      });
      setEditPolice(null);
      await loadData();
      toast.success("Poliçe güncellendi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setEditSaving(false);
    }
  }

  async function policeSil() {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!silOnay) return;
    try {
      await deleteAracPolice(silOnay);
      setSilOnay(null);
      await loadData();
      toast.success("Poliçe silindi.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function hizliTarih(ay: number) {
    const bitis = new Date();
    const baslangic = new Date();
    baslangic.setMonth(baslangic.getMonth() - ay);
    if (ay <= 1) baslangic.setDate(1);
    setFBaslangic(baslangic.toISOString().slice(0, 10));
    setFBitis(bitis.toISOString().slice(0, 10));
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Acente Takip - Police Listesi", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    doc.text(`Tarih: ${new Date().toLocaleDateString("tr-TR")}  |  Toplam: ${filtrelenmis.length} police`, 14, 21);
    autoTable(doc, {
      startY: 25,
      head: [["Islem Tarihi", "Plaka", "Firma", "Tip", "Sigorta Firmasi", "Acente", "Tutar", "Baslangic", "Bitis", "Police No"]],
      body: filtrelenmis.map((p) => {
        const arac = aracMap.get(p.arac_id);
        return [
          tr(formatTarih(p.islem_tarihi)), arac?.plaka ?? "", tr(arac?.firmalar?.firma_adi ?? ""),
          p.police_tipi === "kasko" ? "Kasko" : "Trafik",
          tr(p.sigorta_firmasi ?? ""), tr(p.acente ?? ""),
          p.tutar != null ? p.tutar.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : "",
          tr(formatTarih(p.baslangic_tarihi)), tr(formatTarih(p.bitis_tarihi)),
          p.police_no ?? "",
        ];
      }),
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
    });
    doc.save("acente-takip.pdf");
  }

  function exportExcel() {
    const headers = ["İşlem Tarihi", "Plaka", "Firma", "Poliçe Tipi", "Sigorta Firması", "Acente", "Tutar", "Başlangıç", "Bitiş", "Poliçe No"];
    const data = filtrelenmis.map((p) => {
      const arac = aracMap.get(p.arac_id);
      return [
        formatTarih(p.islem_tarihi), arac?.plaka ?? "", arac?.firmalar?.firma_adi ?? "",
        p.police_tipi === "kasko" ? "Kasko" : "Trafik",
        p.sigorta_firmasi ?? "", p.acente ?? "",
        p.tutar ?? "", formatTarih(p.baslangic_tarihi), formatTarih(p.bitis_tarihi),
        p.police_no ?? "",
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Acente Takip");
    XLSX.writeFile(wb, "acente-takip.xlsx");
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Headphones size={24} /> Belgeler
        </h1>
        <div className="text-xs text-gray-400">{filtrelenmis.length} poliçe</div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Plaka, firma, acente..." className="pl-8 h-9 w-56" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Poliçe Tipi</Label>
          <select value={tipFiltre} onChange={(e) => setTipFiltre(e.target.value as typeof tipFiltre)} className={selectClass}>
            <option value="">Tümü</option>
            <option value="trafik">Trafik Sigortası</option>
            <option value="kasko">Kasko</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)} className={selectClass} />
        </div>
        <div className="flex gap-1 items-end flex-wrap">
          {[{ l: "Bu Ay", a: 1 }, { l: "3 Ay", a: 3 }, { l: "6 Ay", a: 6 }, { l: "1 Yıl", a: 12 }].map((b) => (
            <button key={b.l} type="button" onClick={() => hizliTarih(b.a)}
              className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
              {b.l}
            </button>
          ))}
          <button type="button" onClick={() => {
            // En eski poliçe tarihi — tip filtresi uygulanır
            let enEski = "";
            for (const p of policeler) {
              if (tipFiltre && p.police_tipi !== tipFiltre) continue;
              const t = p.islem_tarihi || p.created_at?.slice(0, 10) || "";
              if (t && (!enEski || t < enEski)) enEski = t;
            }
            setFBaslangic(enEski || "");
            setFBitis(new Date().toISOString().slice(0, 10));
          }}
            className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
            Tümü
          </button>
        </div>
        <div className="flex gap-1 items-end ml-auto">
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
          <Headphones size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Poliçe bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B] hover:bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2">İşlem Tarihi</TableHead>
                <TableHead
                  style={{ position: "sticky", left: 0, zIndex: 11, backgroundColor: "#64748B" }}
                  className="text-white text-[11px] px-2 shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                >Plaka</TableHead>
                <TableHead className="text-white text-[11px] px-2">Ruhsat Sahibi / Firma</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Poliçe Tipi</TableHead>
                <TableHead className="text-white text-[11px] px-2">Sigorta Firması</TableHead>
                <TableHead className="text-white text-[11px] px-2">Mevcut Acente</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Tutar</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Başlangıç</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Bitiş</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Poliçe No</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">PDF</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center">Teklifler</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-center w-[50px]">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrelenmis.map((p) => {
                const arac = aracMap.get(p.arac_id);
                return (
                  <TableRow key={p.id} className="hover:bg-gray-50">
                    <TableCell className="px-2 whitespace-nowrap">{formatTarih(p.islem_tarihi)}</TableCell>
                    <TableCell
                      style={{ position: "sticky", left: 0, backgroundColor: "white" }}
                      className="px-2 font-bold text-[#1E3A5F] whitespace-nowrap shadow-[2px_0_3px_rgba(0,0,0,0.15)]"
                    >
                      {arac?.plaka ?? "—"}
                      {p.otomatik_uyari && (
                        <span title={`Mailden otomatik kaydedildi — ${p.otomatik_uyari}`}
                          className="ml-1 inline-block rounded bg-red-600 px-1 text-[9px] font-bold text-white align-middle">!</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 truncate max-w-[150px]" title={arac?.firmalar?.firma_adi ?? ""}>
                      {arac?.firmalar?.firma_adi ?? "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      <Badge className={p.police_tipi === "kasko" ? "bg-blue-600" : "bg-emerald-600"}>
                        {p.police_tipi === "kasko" ? "Kasko" : "Trafik"}
                      </Badge>
                    </TableCell>
                    <TableCell className={`px-2 ${p.otomatik_uyari?.includes("firma:") ? "text-red-700 font-semibold" : ""}`}>
                      {p.sigorta_firmasi ?? "—"}
                    </TableCell>
                    <TableCell className="px-2">{p.acente ?? "—"}</TableCell>
                    <TableCell className={`px-2 text-right whitespace-nowrap ${p.otomatik_uyari?.includes("tutar:") ? "text-red-700 font-semibold" : ""}`}>
                      {formatPara(p.tutar)}
                    </TableCell>
                    <TableCell className="px-2 text-center whitespace-nowrap">{formatTarih(p.baslangic_tarihi)}</TableCell>
                    <TableCell className="px-2 text-center whitespace-nowrap">{formatTarih(p.bitis_tarihi)}</TableCell>
                    <TableCell className="px-2 text-center font-mono text-[10px]">{p.police_no ?? "—"}</TableCell>
                    <TableCell className="px-2 text-center">
                      {p.police_url ? (
                        <a href={dosyaUrl(p.police_url)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700">
                          <ExternalLink size={14} />
                        </a>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      {(() => {
                        const tk = teklifByPolice.get(p.id) ?? [];
                        if (tk.length === 0) return <span className="text-gray-300">—</span>;
                        const enUcuz = tk[0].teklif_tutari;
                        return (
                          <button type="button"
                            onClick={() => setTeklifGor({ policeId: p.id, plaka: arac?.plaka ?? "—", tip: p.police_tipi === "kasko" ? "Kasko" : "Trafik" })}
                            title={`En uygun: ${enUcuz.toLocaleString("tr-TR")} ₺ · ${tk.length} teklif`}
                            className="inline-flex items-center gap-1 text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded px-1.5 py-0.5 hover:bg-purple-100 whitespace-nowrap">
                            {tk.length} teklif
                          </button>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="px-2 text-center">
                      <div className="flex items-center justify-center gap-0.5">
                        {yDuzenle && (
                          <button type="button" onClick={() => duzenleAc(p)} className="p-1 text-gray-400 hover:text-blue-600"><Pencil size={13} /></button>
                        )}
                        {ySil && (
                          <button type="button" onClick={() => setSilOnay(p.id)} className="p-1 text-gray-400 hover:text-red-600"><Trash2 size={13} /></button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Gelen Teklifler (poliçeye bağlı) — görüntüle */}
      <Dialog open={!!teklifGor} onOpenChange={(o) => { if (!o) { setTeklifGor(null); setAcikNotlar({}); setTumTeklifler(false); } }}>
        {/* GENİŞ pencere: dar kutuda firma adı, acente ve not kırpılıyor, TUTAR hiç
            görünmüyordu — teklifleri karşılaştırmak için açılan pencerede rakam yoktu. */}
        {/* sm:max-w-2xl — DialogContent'in kendi sm:max-w-sm kuralı medya sorgulu olduğu
            için düz max-w-* sınıfını eziyor; pencere 384 px'te kalıyordu. */}
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Gelen Teklifler — {teklifGor?.plaka} {teklifGor?.tip}</DialogTitle>
          </DialogHeader>
          {teklifGor && (() => {
            const hepsi = teklifByPolice.get(teklifGor.policeId) ?? [];
            const enUcuz = hepsi.length ? hepsi[0].teklif_tutari : null;
            const firmaSayisi = new Set(hepsi.map((t) => t.sigorta_firmasi ?? "")).size;
            const acenteSayisi = new Set(hepsi.map((t) => t.acente_adi)).size;
            // Liste ucuzdan pahalıya sıralı: her acentenin İLK satırı onun en uygunu.
            const acenteAdet = new Map<string, number>();
            for (const t of hepsi) acenteAdet.set(t.acente_adi, (acenteAdet.get(t.acente_adi) ?? 0) + 1);
            const enIyiler: typeof hepsi = [];
            const alindi = new Set<string>();
            for (const t of hepsi) {
              if (alindi.has(t.acente_adi)) continue;
              alindi.add(t.acente_adi);
              enIyiler.push(t);
            }
            // YEŞİL = POLİÇESİ YAPTIRILAN teklif. Eskiden en ucuz yeşildi; ekrana bakan
            // "hangisini aldık" sorusunun cevabını göremiyordu. Eşleşme poliçenin sigorta
            // firması + acentesiyle; aynı ikiliden birden çok teklif varsa tutarı poliçeye
            // en yakın olan.
            const police = policeler.find((x) => x.id === teklifGor.policeId) ?? null;
            const duzle = (v: string | null | undefined) => (v ?? "").trim().toLocaleLowerCase("tr");
            const adaylar = police
              ? hepsi.filter((t) => duzle(t.sigorta_firmasi) === duzle(police.sigorta_firmasi)
                  && duzle(t.acente_adi) === duzle(police.acente))
              : [];
            const yapilan = adaylar.length
              ? adaylar.reduce((en, t) =>
                  Math.abs(t.teklif_tutari - (police?.tutar ?? 0)) < Math.abs(en.teklif_tutari - (police?.tutar ?? 0)) ? t : en)
              : null;
            // Yaptırılan teklif, acentesinin en ucuzu olmasa bile kısa listede DURUR —
            // yoksa "hangisini aldık" satırı yalnız "tümünü göster"de görünürdü.
            const kisaListe = yapilan && !enIyiler.some((t) => t.id === yapilan.id)
              ? [...enIyiler, yapilan].sort((a, b) => a.teklif_tutari - b.teklif_tutari)
              : enIyiler;
            const tk = tumTeklifler ? hepsi : kisaListe;
            return hepsi.length === 0 ? (
              <p className="text-sm text-gray-400 py-6 text-center">Bu poliçe için teklif kaydı yok.</p>
            ) : (
              <div className="space-y-1.5 py-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] text-gray-500">
                    {hepsi.length} teklif · {firmaSayisi} firma · {acenteSayisi} acente
                    {(() => {
                      // BİZİM TEKLİF İSTEME TARİHİMİZ. Poliçe girilince bu kayıtlar
                      // siliniyordu; eski poliçelerde tarih YOK ve bunu saklamak yerine
                      // açıkça yazıyoruz — "boş" görünüp tarih yokmuş sanılmasın.
                      const istek = teklifGonderimler
                        .filter((g) => police && g.arac_id === police.arac_id && g.police_tipi === police.police_tipi)
                        .map((g) => g.created_at)
                        .sort()
                        .pop();
                      return istek ? (
                        <span> · teklif istendi <b className="text-gray-700">{formatTarih(istek.slice(0, 10))}</b></span>
                      ) : (
                        <span title="Teklif isteği kayıtları eskiden poliçe girilince siliniyordu; bu poliçe için tarih kalmamış."
                          className="text-gray-400"> · teklif isteme tarihi kayıtlı değil</span>
                      );
                    })()}
                  </p>
                  {hepsi.length > kisaListe.length && (
                    <button type="button" onClick={() => setTumTeklifler((v) => !v)}
                      className={`ml-auto rounded-full border px-3 py-1 text-[12px] font-semibold ${tumTeklifler ? "border-[#1E3A5F] bg-[#1E3A5F] text-white" : "border-gray-300 bg-white text-gray-600 hover:border-gray-500"}`}>
                      {tumTeklifler ? `Yalnız en uygunlar (${kisaListe.length})` : `Tümünü göster (${hepsi.length})`}
                    </button>
                  )}
                </div>
                {tk.map((t, i) => {
                  const digerAdet = (acenteAdet.get(t.acente_adi) ?? 1) - 1;
                  const uc = t.teklif_tutari === enUcuz;
                  const alindi = yapilan?.id === t.id;
                  return (
                    <div key={t.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${alindi ? "bg-emerald-50 border-emerald-400" : "bg-white border-gray-200"}`}>
                      {/* Solda sıra ve TEKLİFİN GELDİĞİ TARİH — hangi teklif ne zaman gelmiş,
                          başlıktaki isteme tarihiyle birlikte sürecin zamanı okunur olsun. */}
                      <div className="w-[52px] shrink-0 pt-0.5 text-center">
                        <div className="text-[12px] font-bold text-gray-400 tabular-nums">{i + 1}</div>
                        {(t.teklif_tarihi || t.mail_tarih) && (
                          <div className="mt-0.5 text-[10.5px] leading-tight text-gray-400 tabular-nums">
                            {formatTarih((t.teklif_tarihi ?? t.mail_tarih ?? "").slice(0, 10))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[15px] font-semibold leading-tight text-[#1E3A5F]">{t.sigorta_firmasi || "Firma belirtilmemiş"}</span>
                          {alindi && (
                            <span title="Poliçe bu tekliften yapıldı"
                              className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">POLİÇE BU</span>
                          )}
                          {/* En ucuz teklif yine yeşil rozetle işaretli; RENKSİZ olan satırın
                              kendisi — zemin yeşili yalnız poliçesi yapılan teklifte. */}
                          {uc && !alindi && (
                            <span className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">EN UYGUN</span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded border px-1.5 py-0.5 text-[12px] font-semibold ${acenteRengi(t.acente_adi)}`}>{t.acente_adi}</span>
                          {/* Kaç teklifi gizlendi — "tümünü göster"in neyi açacağı belli olsun. */}
                          {!tumTeklifler && digerAdet > 0 && (
                            <span className="text-[11.5px] text-gray-400">bu acentenin {digerAdet} teklifi daha var</span>
                          )}
                        </div>
                        {/* Not KIRPILMAZ: "şu şartla", "taksitli" gibi bilgiler tam da burada
                            yazıyor ve tek satıra sığmadığı için okunmuyordu. */}
                        {t.notlar && (() => {
                          // Mailden okunan notlar uzun olabiliyor; satır sayfa boyu uzuyordu.
                          // İki satır gösterilir, uzunsa "tamamını göster" ile açılır.
                          const acik = !!acikNotlar[t.id];
                          const uzun = t.notlar.length > 110;
                          return (
                            <div className="mt-1">
                              <div className={`break-words text-[12.5px] leading-snug whitespace-pre-line text-gray-700 ${acik ? "" : "line-clamp-2"}`}>
                                {t.notlar}
                              </div>
                              {uzun && (
                                <button type="button"
                                  onClick={() => setAcikNotlar((o) => ({ ...o, [t.id]: !acik }))}
                                  className="mt-0.5 text-[11.5px] font-semibold text-blue-600 hover:underline">
                                  {acik ? "kısalt" : "tamamını göster"}
                                </button>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <span className={`shrink-0 text-[17px] font-bold tabular-nums ${alindi ? "text-emerald-700" : "text-gray-800"}`}>
                        {formatPara(t.teklif_tutari)} <span className="text-xs font-semibold">₺</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
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

      {/* Düzenleme Dialog */}
      <Dialog open={!!editPolice} onOpenChange={(o) => !o && setEditPolice(null)}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Poliçe Düzenle</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Tipi</Label>
              <select value={eTip} onChange={(e) => setETip(e.target.value as "kasko" | "trafik")} className={selectClass + " w-full"}>
                <option value="trafik">Trafik Sigortası</option>
                <option value="kasko">Kasko</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tutar (TL)</Label>
              <input type="text" inputMode="decimal" value={eTutar} onChange={(e) => setETutar(formatParaInput(e.target.value))}
                placeholder="0,00" className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Sigorta Firması</Label>
              <select value={eFirma} onChange={(e) => setEFirma(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {sigortaFirmalari.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Acente</Label>
              <select value={eAcente} onChange={(e) => setEAcente(e.target.value)} className={selectClass + " w-full"}>
                <option value="">Seçiniz</option>
                {acenteler.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">İşlem Tarihi</Label>
              <input type="date" value={eIslemTarih} onChange={(e) => setEIslemTarih(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Başlangıç Tarihi</Label>
                <input type="date" value={eBaslangicTarih} onChange={(e) => setEBaslangicTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Bitiş Tarihi</Label>
                <input type="date" value={eBitisTarih} onChange={(e) => setEBitisTarih(e.target.value)} className={selectClass + " w-full"} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe Numarası</Label>
              <input type="text" value={ePoliceNo} onChange={(e) => setEPoliceNo(e.target.value)} className={selectClass + " w-full"} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Poliçe PDF (yeni dosya yükle)</Label>
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setEDosya(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-500 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-[#64748B] file:text-white" />
              {editPolice?.police_url && !eDosya && (
                <a href={dosyaUrl(editPolice.police_url)} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">Mevcut dosyayı görüntüle</a>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditPolice(null)}>İptal</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={duzenleKaydet} disabled={editSaving}>
                {editSaving ? "Kaydediliyor..." : "Güncelle"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
