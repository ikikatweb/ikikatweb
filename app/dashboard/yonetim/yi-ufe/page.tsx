// Yi-ÜFE sayfası - Yurt İçi Üretici Fiyat Endeksi tablosu
"use client";

import { useEffect, useState, useCallback } from "react";
import { getYiUfeVerileri } from "@/lib/supabase/queries/yi-ufe";
import type { YiUfe } from "@/lib/supabase/types";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/shared/page-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { RefreshCw, TrendingUp } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";

const AY_BASLIK = [
  "OCAK",
  "ŞUBAT",
  "MART",
  "NİSAN",
  "MAYIS",
  "HAZİRAN",
  "TEMMUZ",
  "AĞUSTOS",
  "EYLÜL",
  "EKİM",
  "KASIM",
  "ARALIK",
];

type YilVerisi = {
  yil: number;
  aylar: (number | null)[];
};

export default function YiUfePage() {
  const { hasPermission } = useAuth();
  const yEkle = hasPermission("yonetim-yi-ufe", "ekle");
  const yDuzenle = hasPermission("yonetim-yi-ufe", "duzenle");
  const [veriler, setVeriler] = useState<YilVerisi[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sonGuncelleme, setSonGuncelleme] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null); // "yil-ay"
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const loadVeriler = useCallback(async () => {
    try {
      const data = await getYiUfeVerileri();
      const grouped = groupByYil(data ?? []);
      setVeriler(grouped);

      // Son güncelleme tarihini bul
      if (data && data.length > 0) {
        const son = data.reduce((max, v) =>
          new Date(v.created_at) > new Date(max.created_at) ? v : max
        );
        setSonGuncelleme(
          new Date(son.created_at).toLocaleDateString("tr-TR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        );
      }
    } catch {
      toast.error("Veriler yüklenirken bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVeriler();
  }, [loadVeriler]);

  function groupByYil(data: YiUfe[]): YilVerisi[] {
    const map = new Map<number, (number | null)[]>();

    for (const item of data) {
      if (!map.has(item.yil)) {
        map.set(item.yil, Array(12).fill(null));
      }
      const aylar = map.get(item.yil)!;
      aylar[item.ay - 1] = item.endeks;
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => b - a)
      .map(([yil, aylar]) => ({ yil, aylar }));
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/yi-ufe/scrape");
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Veri çekilirken bir hata oluştu.");
        return;
      }

      if (data.basarili) {
        toast.success(
          `Veriler güncellendi. ${data.toplamVeri} kayıt işlendi. Son veri: ${data.sonVeri.ay} ${data.sonVeri.yil}`
        );
        setLoading(true);
        await loadVeriler();
      } else {
        toast.error(data.error || "Veri bulunamadı.");
      }
    } catch {
      toast.error("Sunucu bağlantı hatası.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCellSave(yil: number, ay: number, val: string) {
    if (saving) return;
    const trimmed = val.replace(",", ".").trim();
    if (!trimmed) { setEditKey(null); return; }
    const num = parseFloat(trimmed);
    if (isNaN(num) || num <= 0) { toast.error("Geçerli bir değer girin."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/yi-ufe/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yil, ay, endeks: num }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Kaydetme hatası");
      await loadVeriler();
      toast.success(`${yil} / ${AY_BASLIK[ay - 1]} güncellendi.`);
    } catch (err) { console.error("Yi-ÜFE kaydetme hatası:", err); toast.error(`Kaydetme hatası: ${err instanceof Error ? err.message : String(err)}`); }
    setEditKey(null);
    setSaving(false);
  }

  // Son veriyi bul (vurgulama için)
  let sonYil = 0;
  let sonAy = 0;
  for (const v of veriler) {
    for (let i = 11; i >= 0; i--) {
      if (v.aylar[i] !== null) {
        if (v.yil > sonYil || (v.yil === sonYil && i + 1 > sonAy)) {
          sonYil = v.yil;
          sonAy = i + 1;
        }
        break;
      }
    }
  }

  return (
    <div>
      {/* Başlık ve aksiyon butonları */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">
            Yİ-ÜFE Endeks Tablosu
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Yurt İçi Üretici Fiyat Endeksi (2003=100)
          </p>
          {sonGuncelleme && (
            <p className="text-xs text-gray-400 mt-0.5">
              Son güncelleme: {sonGuncelleme}
            </p>
          )}
        </div>
        {yEkle && <Button
          onClick={handleSync}
          disabled={syncing}
          className="bg-[#F97316] hover:bg-[#ea580c] text-white"
        >
          <RefreshCw
            size={16}
            className={`mr-1 ${syncing ? "animate-spin" : ""}`}
          />
          {syncing ? "Güncelleniyor..." : "Verileri Güncelle"}
        </Button>}
      </div>

      {/* Bilgilendirme */}
      <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-900">
        <strong>📌 Not:</strong> 2020 ve sonrası veriler TÜİK'ten <strong>otomatik çekilir</strong> (elle değiştirilemez). Henüz yayınlanmamış aylar boş kalır — TÜİK açıkladıktan sonra &quot;Verileri Güncelle&quot; butonu ile çekilir. Sadece <strong>2020 öncesi</strong> tarihi veriler elle girilebilir.
      </div>

      {/* Tablo */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded animate-pulse" />
          ))}
        </div>
      ) : veriler.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <TrendingUp size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg">Henüz veri yüklenmemiş.</p>
          <p className="text-gray-400 text-sm mt-1">
            &quot;Verileri Güncelle&quot; butonuna tıklayarak verileri çekebilirsiniz.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#64748B]">
                <TableHead className="text-white font-bold text-center sticky left-0 bg-[#64748B] z-10 min-w-[70px]">
                  YIL
                </TableHead>
                {AY_BASLIK.map((ay) => (
                  <TableHead
                    key={ay}
                    className="text-white font-bold text-center min-w-[90px] text-xs"
                  >
                    {ay}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {veriler.map((satir) => (
                <TableRow key={satir.yil} className="hover:bg-gray-50">
                  <TableCell className="font-bold text-center text-[#1E3A5F] sticky left-0 bg-white z-10 border-r">
                    {satir.yil}
                  </TableCell>
                  {satir.aylar.map((deger, ayIndex) => {
                    const isSon =
                      satir.yil === sonYil && ayIndex + 1 === sonAy;
                    const cellKey = `${satir.yil}-${ayIndex + 1}`;
                    const isEditing = editKey === cellKey;
                    // 2020 ve sonrası: SADECE otomatik scrape. Elle müdahale yok.
                    // 2020 öncesi: tarihi veri, TÜİK yayınlamıyor, elle girilir.
                    const elleGirilebilir = satir.yil < 2020;
                    // Ondalık hassasiyeti: 2020 öncesi 6 hane, 2020+ 2 hane
                    const formatEndeks = (v: number) => {
                      const hane = satir.yil < 2020 ? 6 : 2;
                      return v.toFixed(hane).replace(".", ",");
                    };
                    return (
                      <TableCell
                        key={ayIndex}
                        className={`text-center text-sm tabular-nums p-0 ${
                          isSon
                            ? "bg-[#F97316] text-white font-bold"
                            : deger !== null
                            ? "text-gray-700"
                            : "text-gray-300"
                        }`}
                      >
                        {isEditing && elleGirilebilir ? (
                          <div className="flex items-center gap-0.5 px-0.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              autoFocus
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); handleCellSave(satir.yil, ayIndex + 1, editValue); }
                                if (e.key === "Escape") setEditKey(null);
                              }}
                              className="flex-1 min-w-0 h-7 text-center text-sm border-2 border-blue-400 rounded bg-white outline-none px-1"
                              disabled={saving}
                            />
                            <button type="button" onClick={() => handleCellSave(satir.yil, ayIndex + 1, editValue)}
                              className="shrink-0 h-7 px-1.5 text-[10px] bg-emerald-600 text-white rounded hover:bg-emerald-700" disabled={saving}>OK</button>
                          </div>
                        ) : elleGirilebilir && yDuzenle ? (
                          <button
                            type="button"
                            onClick={() => { setEditKey(cellKey); setEditValue(deger != null ? deger.toString().replace(".", ",") : ""); }}
                            className="w-full h-8 px-1 hover:bg-blue-50 cursor-text"
                          >
                            {deger !== null ? formatEndeks(deger) : "—"}
                          </button>
                        ) : (
                          <span
                            className="inline-block h-8 leading-8 px-1"
                            title="2020 ve sonrası veriler TÜİK'ten otomatik çekilir, elle değiştirilemez"
                          >
                            {deger !== null ? formatEndeks(deger) : "—"}
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
