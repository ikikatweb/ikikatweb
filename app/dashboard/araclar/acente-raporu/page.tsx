// Acente Raporu — Acente > Şirket > Poliçe Detayı gruplu, tarih filtreli özet tablo
"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getTumPoliceler, getAraclar } from "@/lib/supabase/queries/araclar";
import { getTanimlamalar } from "@/lib/supabase/queries/tanimlamalar";
import type { AracPolice, AracWithRelations, Tanimlama } from "@/lib/supabase/types";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Headphones, Search, FileDown, FileSpreadsheet, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { trAramaNormalize } from "@/lib/utils/isim";
import { useAuth } from "@/hooks";

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
  const { kullanici, isYonetici } = useAuth();
  const [loading, setLoading] = useState(true);
  const [policeler, setPoliceler] = useState<AracPolice[]>([]);
  const [araclar, setAraclar] = useState<AracWithRelations[]>([]);
  const [arama, setArama] = useState("");
  const [fBaslangic, setFBaslangic] = useState("");
  const [fBitis, setFBitis] = useState("");
  const [acikAcenteler, setAcikAcenteler] = useState<Record<string, boolean>>({});
  const [acikSirketler, setAcikSirketler] = useState<Record<string, boolean>>({});
  // Tanımlamalardaki sıra (Yönetim > Tanımlamalar)
  const [acenteSiraMap, setAcenteSiraMap] = useState<Map<string, number>>(new Map());
  const [sirketSiraMap, setSirketSiraMap] = useState<Map<string, number>>(new Map());
  // Aktif/Pasif filtresi — varsayılan: aktif (bitis_tarihi >= bugün)
  const [pasifGoster, setPasifGoster] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pData, aData, acenteTan, sirketTan] = await Promise.all([
        getTumPoliceler().catch(() => []),
        getAraclar().catch(() => []),
        getTanimlamalar("sigorta_acente").catch(() => [] as Tanimlama[]),
        getTanimlamalar("sigorta_firmasi").catch(() => [] as Tanimlama[]),
      ]);
      setPoliceler(pData as AracPolice[]);
      setAraclar((aData as AracWithRelations[]) ?? []);
      // Tanımlama sırası — getTanimlamalar genellikle sira ASC döner
      const acMap = new Map<string, number>();
      (acenteTan as Tanimlama[]).forEach((t, i) => acMap.set(t.deger.trim(), i));
      setAcenteSiraMap(acMap);
      const sMap = new Map<string, number>();
      (sirketTan as Tanimlama[]).forEach((t, i) => sMap.set(t.deger.trim(), i));
      setSirketSiraMap(sMap);
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

  // Kısıtlı/şantiye admin için izinli araç id seti:
  //  - Varsayılan: atanmamış şantiyelerin araçları gizli
  //  - santiyesiz_veri_gor=true → şantiye atanmamış (NULL) araçlar da görünür
  const izinliAracIds = useMemo(() => {
    if (isYonetici || !kullanici?.santiye_ids) return null;
    const izinliS = new Set(kullanici.santiye_ids);
    const santiyesizDahil = !!kullanici.santiyesiz_veri_gor;
    return new Set(
      araclar
        .filter((a) => {
          if (a.santiye_id) return izinliS.has(a.santiye_id);
          return santiyesizDahil;
        })
        .map((a) => a.id),
    );
  }, [araclar, isYonetici, kullanici]);

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
    const bugun = new Date().toISOString().slice(0, 10);

    for (const p of policeler) {
      // Kısıtlı/şantiye admin: atanmamış şantiyelerin araçlarına ait poliçeler gizli
      if (izinliAracIds && !izinliAracIds.has(p.arac_id)) continue;
      // Aktif/Pasif filtresi — pasif = bitiş tarihi geçmiş poliçe
      if (!pasifGoster && p.bitis_tarihi && p.bitis_tarihi < bugun) continue;
      // Filtreleme tarihi: poliçenin işlem (giriş) tarihi → yoksa kaydedilme tarihi
      const tarih = p.islem_tarihi || p.created_at?.slice(0, 10) || "";
      if (fBaslangic && tarih && tarih < fBaslangic) continue;
      if (fBitis && tarih && tarih > fBitis) continue;
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
      // Şirketler: tanımlamalardaki sıraya göre (Yönetim > Tanımlamalar > sigorta_firmasi)
      const sirketler = Array.from(sMap.values())
        .map((s) => ({
          ...s,
          policeler: s.policeler.sort((a, b) => (b.baslangic ?? "").localeCompare(a.baslangic ?? "")),
        }))
        .sort((a, b) => {
          const sa = sirketSiraMap.get(a.sirket.trim()) ?? Number.MAX_SAFE_INTEGER;
          const sb = sirketSiraMap.get(b.sirket.trim()) ?? Number.MAX_SAFE_INTEGER;
          if (sa !== sb) return sa - sb;
          return a.sirket.localeCompare(b.sirket, "tr");
        });
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

    const q = trAramaNormalize(arama.trim());
    let filtered = result;
    if (q) {
      // Akıllı filtreleme: arama plaka/poliçe gibi alt seviye eşleşirse,
      // sadece o poliçeleri içeren şirketleri ve onları içeren acenteleri tut.
      // Tutarlar filtrelenmiş poliçelere göre yeniden hesaplanır.
      filtered = result
        .map((o) => {
          // Acente adı doğrudan eşleşiyorsa içeriğe dokunma — tüm acente görünsün
          const acenteEslesti = trAramaNormalize(o.acente).includes(q);

          const yeniSirketler = o.sirketler
            .map((s) => {
              const sirketEslesti = acenteEslesti || trAramaNormalize(s.sirket).includes(q);
              // Şirket eşleştiyse tüm poliçeler kalsın; eşleşmediyse sadece eşleşen poliçeler
              const yeniPoliceler = sirketEslesti
                ? s.policeler
                : s.policeler.filter((p) =>
                    trAramaNormalize(p.aracAdi).includes(q) ||
                    trAramaNormalize(p.policeNo).includes(q)
                  );
              if (yeniPoliceler.length === 0) return null;
              // Tutarları yeniden hesapla (filtrelenmiş poliçelere göre)
              const kaskoT = yeniPoliceler.filter((p) => p.tip === "kasko").reduce((s, p) => s + p.tutar, 0);
              const trafikT = yeniPoliceler.filter((p) => p.tip === "trafik").reduce((s, p) => s + p.tutar, 0);
              return {
                ...s,
                policeler: yeniPoliceler,
                kaskoTutar: kaskoT,
                trafikTutar: trafikT,
                toplam: kaskoT + trafikT,
              };
            })
            .filter((s): s is SirketOzet => s !== null);

          if (yeniSirketler.length === 0) return null;
          const kaskoT = yeniSirketler.reduce((s, x) => s + x.kaskoTutar, 0);
          const trafikT = yeniSirketler.reduce((s, x) => s + x.trafikTutar, 0);
          return {
            acente: o.acente,
            sirketler: yeniSirketler,
            kaskoTutar: kaskoT,
            trafikTutar: trafikT,
            toplam: kaskoT + trafikT,
          };
        })
        .filter((o): o is AcenteOzet => o !== null);
    }
    // Acenteler: tanımlamalardaki sıraya göre (Yönetim > Tanımlamalar > sigorta_acente)
    return filtered.sort((a, b) => {
      const sa = acenteSiraMap.get(a.acente.trim()) ?? Number.MAX_SAFE_INTEGER;
      const sb = acenteSiraMap.get(b.acente.trim()) ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      return a.acente.localeCompare(b.acente, "tr");
    });
  }, [policeler, fBaslangic, fBitis, arama, aracMap, acenteSiraMap, sirketSiraMap, pasifGoster, izinliAracIds]);

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
    const aralik = (fBaslangic || fBitis)
      ? `${fBaslangic ? formatTarih(fBaslangic) : "Baslangic"} - ${fBitis ? formatTarih(fBitis) : "Bugun"}`
      : "Tum tarihler";
    doc.text(`Tarih Araligi: ${aralik}  |  ${ozetler.length} acente`, 14, 21);

    type Row = [string, string, string, string, string, string];
    const body: Row[] = [];
    for (const o of ozetler) {
      const acenteAcik = !!acikAcenteler[o.acente];
      body.push([tr(o.acente), "", "", "", "", formatPara(o.toplam)]);
      // Acente kapalıysa şirketleri ve poliçeleri ATLA
      if (!acenteAcik) continue;

      for (const s of o.sirketler) {
        const sirketKey = `${o.acente}__${s.sirket}`;
        const sirketAcik = !!acikSirketler[sirketKey];
        body.push(["", tr(s.sirket), "", "", "", formatPara(s.toplam)]);
        // Şirket kapalıysa poliçe detaylarını ATLA
        if (!sirketAcik) continue;

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
      head: [[
        "Acente", "Police No / Sirket", "Plaka", "Belge Tipi", "Baslangic - Bitis",
        { content: "Tutar", styles: { halign: "right" } },
      ]],
      body,
      foot: [[
        { content: "GENEL TOPLAM", colSpan: 5, styles: { halign: "left" } },
        { content: formatPara(genelToplam.toplam), styles: { halign: "right" } },
      ]],
      styles: { fontSize: 8, cellPadding: 1.5 },
      headStyles: { fillColor: [30, 58, 95] },
      footStyles: { fillColor: [241, 245, 249], textColor: [30, 58, 95], fontStyle: "bold" },
      columnStyles: {
        0: { halign: "left" },
        1: { halign: "left" },
        2: { halign: "left" },
        3: { halign: "left" },
        4: { halign: "left" },
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
        <div className="flex gap-1 items-end flex-wrap">
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
          <button type="button" onClick={() => {
            // En eski poliçe tarihi — arama yapılmışsa eşleşen poliçelere göre
            const q = trAramaNormalize(arama.trim());
            let enEski = "";
            for (const p of policeler) {
              // Arama filtresi varsa: araç adı veya poliçe no eşleşmeli
              if (q) {
                const aracAdi = aracMap.get(p.arac_id) ?? "";
                const acente = (p.acente ?? "").trim();
                const sirket = (p.sigorta_firmasi ?? "").trim();
                const text = `${aracAdi} ${p.police_no ?? ""} ${acente} ${sirket}`;
                if (!trAramaNormalize(text).includes(q)) continue;
              }
              const t = p.islem_tarihi || p.created_at?.slice(0, 10) || "";
              if (t && (!enEski || t < enEski)) enEski = t;
            }
            setFBaslangic(enEski || "");
            setFBitis(new Date().toISOString().slice(0, 10));
          }}
            className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 hover:bg-[#64748B] hover:text-white transition-colors">
            Tümü
          </button>
          <label className="h-9 px-2.5 text-[10px] rounded-lg border bg-gray-50 inline-flex items-center gap-1.5 cursor-pointer hover:bg-gray-100">
            <input type="checkbox" checked={pasifGoster} onChange={(e) => setPasifGoster(e.target.checked)} className="w-3 h-3" />
            Pasifleri Gör
          </label>
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
        <div className="space-y-3">
          {(() => {
            // Acentenin kendi rengi olmadığından, sıraya göre renk paleti uygulanır.
            // Bordro takibindeki firma kartlarıyla aynı görsel dil.
            const fallbackRenkler = ["#1E3A5F", "#7c3aed", "#dc2626", "#059669", "#d97706", "#0891b2", "#be185d", "#0d9488"];
            return ozetler.map((o, aIdx) => {
              const acenteAcik = !!acikAcenteler[o.acente];
              const acenteRenk = fallbackRenkler[aIdx % fallbackRenkler.length];
              return (
                <div key={`a-${o.acente}`} className="rounded-lg overflow-hidden shadow-md ring-1 ring-gray-200">
                  {/* Acente başlığı — gradient renkli kart */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-opacity hover:opacity-95"
                    style={{ background: `linear-gradient(135deg, ${acenteRenk} 0%, ${acenteRenk}dd 100%)` }}
                    onClick={() => toggleAcente(o.acente)}
                  >
                    {acenteAcik
                      ? <ChevronDown size={20} className="text-white flex-shrink-0" />
                      : <ChevronRight size={20} className="text-white flex-shrink-0" />}
                    <Building2 size={18} className="text-white flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h2 className="font-bold text-base text-white truncate" title={o.acente}>{o.acente}</h2>
                      <div className="text-[10px] text-white/80 font-mono mt-0.5 truncate">
                        Kasko: <span className="text-white font-semibold">{formatPara(o.kaskoTutar)}</span>
                        <span className="mx-2 text-white/40">•</span>
                        Trafik: <span className="text-white font-semibold">{formatPara(o.trafikTutar)}</span>
                      </div>
                    </div>
                    <span className="text-[11px] bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full font-semibold flex-shrink-0">
                      {o.sirketler.length} şirket
                    </span>
                    <span className="text-[11px] bg-white/25 backdrop-blur text-white px-2.5 py-0.5 rounded-full font-bold flex-shrink-0">
                      {formatPara(o.toplam)} ₺
                    </span>
                  </div>

                  {/* Acente içeriği — şirketler */}
                  {acenteAcik && (
                    <div className="bg-slate-50 border-t border-slate-200 p-3 space-y-2 pl-6">
                      {o.sirketler.length === 0 ? (
                        <div className="text-center py-3 text-gray-400 text-xs italic">Bu acentede şirket yok</div>
                      ) : (
                        o.sirketler.map((s) => {
                          const sirketKey = `${o.acente}__${s.sirket}`;
                          const sirketAcik = !!acikSirketler[sirketKey];
                          return (
                            <div key={`s-${sirketKey}`} className="rounded-md overflow-hidden bg-white ring-1 ring-slate-200">
                              <div
                                className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 border-l-4"
                                style={{ borderLeftColor: acenteRenk }}
                                onClick={() => toggleSirket(sirketKey)}
                              >
                                {sirketAcik
                                  ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" />
                                  : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />}
                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">ŞİRKET</span>
                                <span className="font-semibold text-gray-800 text-sm truncate flex-1" title={s.sirket}>{s.sirket}</span>
                                <span className="text-[10px] text-gray-500 font-medium flex-shrink-0">
                                  {s.policeler.length} poliçe
                                </span>
                                <div className="flex items-center gap-2 text-[11px] font-mono flex-shrink-0">
                                  <span className="text-blue-600" title="Kasko">{formatPara(s.kaskoTutar)}</span>
                                  <span className="text-emerald-600" title="Trafik">{formatPara(s.trafikTutar)}</span>
                                  <span className="font-bold text-gray-900 px-2 py-0.5 bg-gray-100 rounded">{formatPara(s.toplam)} ₺</span>
                                </div>
                              </div>

                              {/* Poliçe detayları */}
                              {sirketAcik && (
                                <div className="border-t border-slate-200 bg-white">
                                  <Table className="text-[11px]">
                                    <TableHeader>
                                      <TableRow className="bg-slate-50 hover:bg-slate-50 border-b border-slate-200">
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 w-[140px] font-semibold">Poliçe No</TableHead>
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 font-semibold">Plaka</TableHead>
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 w-[110px] font-semibold">Belge Tipi</TableHead>
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 w-[110px] text-center font-semibold">Başlangıç</TableHead>
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 w-[110px] text-center font-semibold">Bitiş</TableHead>
                                        <TableHead className="text-gray-500 text-[10px] uppercase tracking-wide px-3 py-1.5 w-[120px] text-right font-semibold">Tutar</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {s.policeler.map((p, i) => (
                                        <TableRow key={`p-${sirketKey}-${i}`} className="hover:bg-slate-50 border-b border-gray-100">
                                          <TableCell className="px-3 py-1.5 font-mono text-gray-700">{p.policeNo || "—"}</TableCell>
                                          <TableCell className="px-3 py-1.5 text-gray-700">{p.aracAdi}</TableCell>
                                          <TableCell className="px-3 py-1.5">
                                            <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${p.tip === "kasko" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                                              {p.tip === "kasko" ? "KASKO" : "TRAFİK"}
                                            </span>
                                          </TableCell>
                                          <TableCell className="px-3 py-1.5 text-center whitespace-nowrap text-gray-600 tabular-nums">{formatTarih(p.baslangic)}</TableCell>
                                          <TableCell className="px-3 py-1.5 text-center whitespace-nowrap text-gray-600 tabular-nums">{formatTarih(p.bitis)}</TableCell>
                                          <TableCell className="px-3 py-1.5 text-right whitespace-nowrap text-gray-800 tabular-nums font-medium">{formatPara(p.tutar)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            });
          })()}

          {/* Genel toplam — alt kart */}
          <div className="rounded-lg bg-gradient-to-r from-gray-800 to-gray-900 px-4 py-3 flex items-center gap-4 shadow-md">
            <span className="text-white font-bold text-sm uppercase tracking-wider flex-1">Genel Toplam</span>
            <span className="text-[11px] bg-white/20 text-white px-3 py-1 rounded-full font-mono">
              Kasko: <span className="font-semibold">{formatPara(genelToplam.kaskoTutar)}</span>
            </span>
            <span className="text-[11px] bg-white/20 text-white px-3 py-1 rounded-full font-mono">
              Trafik: <span className="font-semibold">{formatPara(genelToplam.trafikTutar)}</span>
            </span>
            <span className="text-sm bg-white text-gray-900 px-3 py-1 rounded-full font-bold tabular-nums">
              {formatPara(genelToplam.toplam)} ₺
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
