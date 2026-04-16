// Acente Raporu — Acente > Şirket > Poliçe Detayı gruplu, tarih filtreli özet tablo
"use client";

import { useEffect, useState, useCallback, useMemo, Fragment } from "react";
import { getTumPoliceler, getAraclar } from "@/lib/supabase/queries/araclar";
import type { AracPolice, AracWithRelations } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Headphones, Search, FileDown, FileSpreadsheet, ChevronDown, ChevronRight } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const selectClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function tr(s: string): string {
  return s.replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ı/g,"i").replace(/İ/g,"I").replace(/ö/g,"o").replace(/Ö/g,"O").replace(/ü/g,"u").replace(/Ü/g,"U");
}

function formatPara(n: number): string {
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTarih(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

type PoliceDetay = {
  policeNo: string;
  aracAdi: string;
  tip: "kasko" | "trafik";
  baslangic: string | null;
  bitis: string | null;
  tutar: number;
};

type SirketOzet = {
  sirket: string;
  kaskoTutar: number;
  trafikTutar: number;
  toplam: number;
  policeler: PoliceDetay[];
};

type AcenteOzet = {
  acente: string;
  sirketler: SirketOzet[];
  kaskoTutar: number;
  trafikTutar: number;
  toplam: number;
};

export default function AcenteRaporuPage() {
  const [loading, setLoading] = useState(true);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [arama, setArama] = useState("");
  const [fBaslangic, setFBaslangic] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; });
  const [fBitis, setFBitis] = useState(() => new Date().toISOString().slice(0, 10));
  const [acikAcenteler, setAcikAcenteler] = useState<Record<string, boolean>>({});
  const [acikSirketler, setAcikSirketler] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pData, aData] = await Promise.all([
        getTumPoliceler().catch(() => []),
        getAraclar().catch(() => []),
      ]);
      setPoliceler(pData as AracPolice[]);
      setAraclar((aData as AracWithRelations[]) ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Araç map (id → aracAdi)
  const aracMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of araclar) {
      const parts = [a.marka, a.model, a.plaka].filter(Boolean).join(" ");
      m.set(a.id, parts || a.plaka || "—");
    }
    return m;
  }, [araclar]);

  function hizliTarih(secim: "bu-ay" | "3-ay" | "6-ay" | "bu-yil") {
    const bitis = new Date();
    const baslangic = new Date();
    if (secim === "bu-ay") {
      baslangic.setDate(1);
    } else if (secim === "3-ay") {
      baslangic.setMonth(baslangic.getMonth() - 3);
    } else if (secim === "6-ay") {
      baslangic.setMonth(baslangic.getMonth() - 6);
    } else if (secim === "bu-yil") {
      baslangic.setMonth(0); baslangic.setDate(1);
    }
    setFBaslangic(baslangic.toISOString().slice(0, 10));
    setFBitis(bitis.toISOString().slice(0, 10));
  }

  const ozetler = useMemo<AcenteOzet[]>(() => {
    // Acente > Şirket bazlı toplama, poliçe detaylarını topla
    const acenteMap = new Map<string, Map<string, SirketOzet>>();

    for (const p of policeler) {
      const tarih = p.islem_tarihi ?? p.created_at?.slice(0, 10) ?? "";
      if (fBaslangic && tarih < fBaslangic) continue;
      if (fBitis && tarih > fBitis) continue;
      const acenteAdi = (p.acente ?? "").trim() || "(Acentesiz)";
      const sirketAdi = (p.sigorta_firmasi ?? "").trim() || "(Şirket belirtilmemiş)";
      if (!acenteMap.has(acenteAdi)) acenteMap.set(acenteAdi, new Map());
      const sMap = acenteMap.get(acenteAdi)!;
      if (!sMap.has(sirketAdi)) {
        sMap.set(sirketAdi, { sirket: sirketAdi, kaskoTutar: 0, trafikTutar: 0, toplam: 0, policeler: [] });
      }
      const s = sMap.get(sirketAdi)!;
      const tutar = p.tutar ?? 0;
      if (p.police_tipi === "kasko") s.kaskoTutar += tutar;
      else if (p.police_tipi === "trafik") s.trafikTutar += tutar;
      s.toplam = s.kaskoTutar + s.trafikTutar;
      s.policeler.push({
        policeNo: p.police_no?.trim() || "",
        aracAdi: aracMap.get(p.arac_id) ?? "—",
        tip: p.police_tipi,
        baslangic: p.baslangic_tarihi,
        bitis: p.bitis_tarihi,
        tutar,
      });
    }

    const result: AcenteOzet[] = [];
    for (const [acenteAdi, sMap] of acenteMap.entries()) {
      const sirketler = Array.from(sMap.values())
        .map((s) => ({
          ...s,
          policeler: s.policeler.sort((a, b) => (b.baslangic ?? "").localeCompare(a.baslangic ?? "")),
        }))
        .sort((a, b) => b.toplam - a.toplam);
      const kaskoTutar = sirketler.reduce((s, x) => s + x.kaskoTutar, 0);
      const trafikTutar = sirketler.reduce((s, x) => s + x.trafikTutar, 0);
      result.push({
        acente: acenteAdi,
        sirketler,
        kaskoTutar,
        trafikTutar,
        toplam: kaskoTutar + trafikTutar,
      });
    }

    const q = arama.trim().toLowerCase();
    let filtered = result;
    if (q) {
      filtered = filtered.filter((o) =>
        o.acente.toLowerCase().includes(q) ||
        o.sirketler.some((s) =>
          s.sirket.toLowerCase().includes(q) ||
          s.policeler.some((p) =>
            p.aracAdi.toLowerCase().includes(q) ||
            p.policeNo.toLowerCase().includes(q)
          )
        )
      );
    }
    return filtered.sort((a, b) => b.toplam - a.toplam);
  }, [policeler, fBaslangic, fBitis, arama, aracMap]);

  // Genel toplam
  const genelToplam = useMemo(() => {
    return ozetler.reduce(
      (acc, o) => ({
        kaskoTutar: acc.kaskoTutar + o.kaskoTutar,
        trafikTutar: acc.trafikTutar + o.trafikTutar,
        toplam: acc.toplam + o.toplam,
      }),
      { kaskoTutar: 0, trafikTutar: 0, toplam: 0 }
    );
  }, [ozetler]);

  function toggleAcente(acente: string) {
    setAcikAcenteler((p) => ({ ...p, [acente]: !p[acente] }));
  }
  function toggleSirket(key: string) {
    setAcikSirketler((p) => ({ ...p, [key]: !p[key] }));
  }

  function tumunuAc() {
    const hA: Record<string, boolean> = {};
    const hS: Record<string, boolean> = {};
    ozetler.forEach((o) => {
      hA[o.acente] = true;
      o.sirketler.forEach((s) => { hS[`${o.acente}__${s.sirket}`] = true; });
    });
    setAcikAcenteler(hA);
    setAcikSirketler(hS);
  }

  function tumunuKapat() {
    setAcikAcenteler({});
    setAcikSirketler({});
  }

  function exportPDF() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Acente Raporu", 14, 15);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const aralik = `${formatTarih(fBaslangic)} - ${formatTarih(fBitis)}`;
    doc.text(`Tarih Araligi: ${aralik}  |  ${ozetler.length} acente`, 14, 21);

    type Row = [string, string, string, string, string, string];
    const body: Row[] = [];
    for (const o of ozetler) {
      body.push([tr(o.acente), "", "", "", "", formatPara(o.toplam)]);
      for (const s of o.sirketler) {
        body.push(["", tr(s.sirket), "", "", "", formatPara(s.toplam)]);
        for (const p of s.policeler) {
          body.push([
            "", p.policeNo || "—", tr(p.aracAdi),
            p.tip.toUpperCase(),
            `${tr(formatTarih(p.baslangic))} - ${tr(formatTarih(p.bitis))}`,
            formatPara(p.tutar),
          ]);
        }
      }
    }

    autoTable(doc, {
      startY: 25,
      head: [["Acente", "Police No / Sirket", "Plaka", "Belge Tipi", "Baslangic - Bitis", "Tutar"]],
      body,
      foot: [[
        "GENEL TOPLAM", "", "", "", "", formatPara(genelToplam.toplam),
      ]],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95], halign: "left" },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 58, 95], fontStyle: "bold" },
      columnStyles: {
        5: { halign: "right" },
      },
      didParseCell: (hookData) => {
        if (hookData.section !== "body") return;
        const row = hookData.row.raw as Row;
        // Acente başlık: ilk kolonda değer var, ikinci boş → lacivert
        if (row[0] && !row[1]) {
          hookData.cell.styles.fillColor = [30, 58, 95];
          hookData.cell.styles.textColor = [255, 255, 255];
          hookData.cell.styles.fontStyle = "bold";
        }
        // Şirket satırı: ilk boş, ikinci var, üçüncü boş → açık gri
        else if (!row[0] && row[1] && !row[2]) {
          hookData.cell.styles.fillColor = [226, 232, 240];
          hookData.cell.styles.textColor = [30, 58, 95];
          hookData.cell.styles.fontStyle = "bold";
        }
      },
    });
    doc.save("acente-raporu.pdf");
  }

  function exportExcel() {
    const headers = ["Acente", "Poliçe No / Şirket", "Plaka", "Belge Tipi", "Başlangıç", "Bitiş", "Tutar (TL)"];
    const rows: (string | number)[][] = [];
    for (const o of ozetler) {
      rows.push([o.acente, "", "", "", "", "", o.toplam]);
      for (const s of o.sirketler) {
        rows.push(["", s.sirket, "", "", "", "", s.toplam]);
        for (const p of s.policeler) {
          rows.push([
            "", p.policeNo || "—", p.aracAdi, p.tip.toUpperCase(),
            formatTarih(p.baslangic), formatTarih(p.bitis), p.tutar,
          ]);
        }
      }
    }
    rows.push(["GENEL TOPLAM", "", "", "", "", "", genelToplam.toplam]);

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{ wch: 24 }, { wch: 22 }, { wch: 36 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Acente Raporu");
    XLSX.writeFile(wb, "acente-raporu.xlsx");
  }

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <Headphones size={24} /> Acente Raporu
        </h1>
        <div className="text-xs text-gray-400">{ozetler.length} acente</div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-lg border p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Arama</Label>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Acente, şirket, plaka, poliçe no..." className="pl-8 h-9 w-60" />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Başlangıç</Label>
          <input type="date" value={fBaslangic} onChange={(e) => setFBaslangic(e.target.value)} className={selectClass} />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">Bitiş</Label>
          <input type="date" value={fBitis} onChange={(e) => setFBitis(e.target.value)} className={selectClass} />
        </div>
        <div className="flex gap-1 items-end">
          {[
            { l: "Bu Ay", s: "bu-ay" as const },
            { l: "3 Ay", s: "3-ay" as const },
            { l: "6 Ay", s: "6-ay" as const },
            { l: "Bu Yıl", s: "bu-yil" as const },
          ].map((b) => (
            <button key={b.s} type="button" onClick={() => hizliTarih(b.s)}
              className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
              {b.l}
            </button>
          ))}
        </div>
        <div className="flex gap-1 items-end ml-auto">
          <button type="button" onClick={tumunuAc}
            className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-gray-100">
            Tümünü Aç
          </button>
          <button type="button" onClick={tumunuKapat}
            className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-gray-100">
            Tümünü Kapat
          </button>
          <Button variant="outline" size="sm" onClick={exportPDF} className="h-9 gap-1 text-xs">
            <FileDown size={14} /> PDF
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} className="h-9 gap-1 text-xs">
            <FileSpreadsheet size={14} /> Excel
          </Button>
        </div>
      </div>

      {ozetler.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Headphones size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">Seçilen tarih aralığında poliçe bulunamadı.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white text-[11px] px-2 w-[28%]">Acente</TableHead>
                <TableHead className="text-white text-[11px] px-2 w-[22%]">Şirket</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">KASKO</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">TRAFİK SİGORTASI</TableHead>
                <TableHead className="text-white text-[11px] px-2 text-right">Genel Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ozetler.map((o) => {
                const acenteAcik = !!acikAcenteler[o.acente];
                return (
                  <Fragment key={`a-${o.acente}`}>
                    {/* Acente başlık satırı — tıklanınca açılır/kapanır */}
                    <TableRow
                      onClick={() => toggleAcente(o.acente)}
                      className="cursor-pointer bg-[#1E3A5F] hover:bg-[#274a76]">
                      <TableCell className="px-2 py-1.5 text-white font-bold whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          {acenteAcik ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          {o.acente}
                        </span>
                      </TableCell>
                      <TableCell className="px-2 py-1.5 text-white" />
                      <TableCell className="px-2 py-1.5 text-white text-right font-bold whitespace-nowrap">{formatPara(o.kaskoTutar)}</TableCell>
                      <TableCell className="px-2 py-1.5 text-white text-right font-bold whitespace-nowrap">{formatPara(o.trafikTutar)}</TableCell>
                      <TableCell className="px-2 py-1.5 text-white text-right font-bold whitespace-nowrap">{formatPara(o.toplam)}</TableCell>
                    </TableRow>

                    {/* Şirket alt satırları */}
                    {acenteAcik && o.sirketler.map((s) => {
                      const sirketKey = `${o.acente}__${s.sirket}`;
                      const sirketAcik = !!acikSirketler[sirketKey];
                      return (
                        <Fragment key={`s-${sirketKey}`}>
                          <TableRow
                            onClick={() => toggleSirket(sirketKey)}
                            className="cursor-pointer bg-slate-50 hover:bg-slate-100">
                            <TableCell className="px-2" />
                            <TableCell className="px-2 text-gray-800 font-semibold whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                {sirketAcik ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {s.sirket}
                              </span>
                            </TableCell>
                            <TableCell className="px-2 text-right whitespace-nowrap">{formatPara(s.kaskoTutar)}</TableCell>
                            <TableCell className="px-2 text-right whitespace-nowrap">{formatPara(s.trafikTutar)}</TableCell>
                            <TableCell className="px-2 text-right whitespace-nowrap font-semibold">{formatPara(s.toplam)}</TableCell>
                          </TableRow>

                          {/* Poliçe detay tablosu — şirket açıldığında görünür */}
                          {sirketAcik && (
                            <TableRow key={`d-${sirketKey}`} className="bg-white">
                              <TableCell colSpan={5} className="p-0">
                                <div className="border-t border-b border-gray-200 bg-gray-50 px-2 py-2">
                                  <Table className="text-[11px]">
                                    <TableHeader>
                                      <TableRow className="bg-gray-200 hover:bg-gray-200">
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5 w-[140px]">Poliçe No</TableHead>
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5">Plaka</TableHead>
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5 w-[110px]">Belge Tipi</TableHead>
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5 w-[110px] text-center">Başlangıç</TableHead>
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5 w-[110px] text-center">Bitiş</TableHead>
                                        <TableHead className="text-gray-700 text-[10px] px-2 py-1.5 w-[120px] text-right">Tutar</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {s.policeler.map((p, i) => (
                                        <TableRow key={`p-${sirketKey}-${i}`} className="bg-white hover:bg-gray-50">
                                          <TableCell className="px-2 py-1 font-mono text-gray-800">{p.policeNo || "—"}</TableCell>
                                          <TableCell className="px-2 py-1 text-gray-800">{p.aracAdi}</TableCell>
                                          <TableCell className="px-2 py-1">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold text-white ${p.tip === "kasko" ? "bg-blue-600" : "bg-emerald-600"}`}>
                                              {p.tip === "kasko" ? "KASKO" : "TRAFİK"}
                                            </span>
                                          </TableCell>
                                          <TableCell className="px-2 py-1 text-center whitespace-nowrap">{formatTarih(p.baslangic)}</TableCell>
                                          <TableCell className="px-2 py-1 text-center whitespace-nowrap">{formatTarih(p.bitis)}</TableCell>
                                          <TableCell className="px-2 py-1 text-right whitespace-nowrap">{formatPara(p.tutar)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}

              {/* Genel Toplam satırı */}
              <TableRow className="bg-[#1E3A5F]/10 font-bold">
                <TableCell className="px-2 text-[#1E3A5F]">GENEL TOPLAM</TableCell>
                <TableCell className="px-2" />
                <TableCell className="px-2 text-right whitespace-nowrap text-[#1E3A5F]">{formatPara(genelToplam.kaskoTutar)}</TableCell>
                <TableCell className="px-2 text-right whitespace-nowrap text-[#1E3A5F]">{formatPara(genelToplam.trafikTutar)}</TableCell>
                <TableCell className="px-2 text-right whitespace-nowrap text-[#1E3A5F]">{formatPara(genelToplam.toplam)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
