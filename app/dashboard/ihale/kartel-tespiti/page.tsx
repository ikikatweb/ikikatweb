// İhale Kartel Tespiti — 5-sinyal skoru + network grupları
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  getKartelRapor,
  type KartelRaporResponse,
  type CiftDto,
  type KartelGrupDto,
  IHALE_AI_BASE,
} from "@/lib/ihale-ai-api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertTriangle, AlertCircle, Loader2, Search, Network, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { trAramaNormalize } from "@/lib/utils/isim";

const inputClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function kategoriRenk(k: string): string {
  if (k === "Kartel Şüphesi") return "bg-red-100 text-red-800 border-red-300";
  if (k === "Orta Bağ") return "bg-orange-100 text-orange-800 border-orange-300";
  if (k === "Zayıf Bağ") return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-gray-100 text-gray-700";
}

export default function KartelTespitiPage() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [rapor, setRapor] = useState<KartelRaporResponse | null>(null);

  const [minSkor, setMinSkor] = useState(30);
  const [grupMinSkor, setGrupMinSkor] = useState(75);
  const [arama, setArama] = useState("");
  const [topN, setTopN] = useState(50);

  const yukle = async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await getKartelRapor(minSkor, grupMinSkor, topN);
      setRapor(r);
    } catch (e) {
      const msg = (e as Error).message;
      setHata(msg);
      toast.error(msg);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    yukle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtreliCiftler = useMemo(() => {
    if (!rapor) return [];
    if (!arama) return rapor.en_yuksek_ciftler;
    const aLow = trAramaNormalize(arama);
    return rapor.en_yuksek_ciftler.filter(
      (c) =>
        trAramaNormalize(c.firma_a).includes(aLow) ||
        trAramaNormalize(c.firma_b).includes(aLow),
    );
  }, [rapor, arama]);

  const filtreliGruplar = useMemo(() => {
    if (!rapor) return [];
    if (!arama) return rapor.gruplar;
    const aLow = trAramaNormalize(arama);
    return rapor.gruplar.filter((g) =>
      g.firmalar.some((f) => trAramaNormalize(f).includes(aLow)),
    );
  }, [rapor, arama]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
          <AlertTriangle size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Kartel Tespiti</h1>
          <p className="text-sm text-gray-500">
            5 sinyalli skor (Lift, Tenzilat, Teklif Oranı, Rotasyon, İdare) + network grupları
          </p>
        </div>
      </div>

      {/* Filtre satırı */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <Label className="mb-1.5 block">Min Skor (Çift)</Label>
            <Input
              className={inputClass + " w-full"}
              type="number"
              value={minSkor}
              onChange={(e) => setMinSkor(parseFloat(e.target.value) || 30)}
              min={0}
              max={100}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Min Skor (Grup)</Label>
            <Input
              className={inputClass + " w-full"}
              type="number"
              value={grupMinSkor}
              onChange={(e) => setGrupMinSkor(parseFloat(e.target.value) || 75)}
              min={0}
              max={100}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Top N (Tablo)</Label>
            <Input
              className={inputClass + " w-full"}
              type="number"
              value={topN}
              onChange={(e) => setTopN(parseInt(e.target.value) || 50)}
              min={5}
              max={500}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={yukle}
              disabled={yukleniyor}
              className="bg-orange-600 hover:bg-orange-700 text-white w-full"
            >
              {yukleniyor ? (
                <>
                  <Loader2 className="animate-spin" size={16} /> Hesaplanıyor
                </>
              ) : (
                <>
                  <RefreshCw size={16} /> Yenile
                </>
              )}
            </Button>
          </div>
        </div>
        <div className="mt-4 relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            className={inputClass + " w-full pl-8"}
            type="text"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Firma adı ara..."
          />
        </div>
      </div>

      {hata && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 shrink-0" size={20} />
          <div>
            <p className="font-semibold text-red-900">Hata</p>
            <p className="text-sm text-red-700">{hata}</p>
            <p className="text-xs text-red-600 mt-2">
              Python sunucusu çalışıyor mu? <code className="bg-white px-1 rounded">{IHALE_AI_BASE}</code>
            </p>
          </div>
        </div>
      )}

      {/* Özet kartlar */}
      {rapor && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <OzetKart label="Toplam Çift" value={rapor.toplam_cift} color="gray" />
          <OzetKart label="Kartel Şüphesi" value={rapor.kartel_supheli_sayisi} color="red" />
          <OzetKart label="Orta Bağ" value={rapor.orta_bag_sayisi} color="orange" />
          <OzetKart label="Zayıf Bağ" value={rapor.zayif_bag_sayisi} color="yellow" />
        </div>
      )}

      {/* Network Grupları */}
      {rapor && filtreliGruplar.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="p-4 border-b border-gray-100 flex items-center gap-2">
            <Network size={18} className="text-orange-600" />
            <h3 className="text-sm font-semibold text-gray-900">
              Otomatik Kartel Grupları ({filtreliGruplar.length})
            </h3>
          </div>
          <div className="divide-y divide-gray-100">
            {filtreliGruplar.map((g) => (
              <KartelGrubuKart key={g.grup_id} g={g} />
            ))}
          </div>
        </div>
      )}

      {/* Top Çiftler */}
      {rapor && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Şüpheli Çiftler ({filtreliCiftler.length} / {rapor.en_yuksek_ciftler.length})
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Firma A</TableHead>
                <TableHead>Firma B</TableHead>
                <TableHead className="text-center">Skor</TableHead>
                <TableHead>Kategori</TableHead>
                <TableHead className="text-center">Ortak</TableHead>
                <TableHead className="text-center">Lift</TableHead>
                <TableHead className="text-center">Tenz Med Δ</TableHead>
                <TableHead className="text-center">Eşik Altı</TableHead>
                <TableHead className="text-center">İdare %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtreliCiftler.map((c, idx) => (
                <TableRow key={`${c.firma_a_kanon}|${c.firma_b_kanon}`}>
                  <TableCell className="text-gray-400 text-xs">{idx + 1}</TableCell>
                  <TableCell className="max-w-[260px] truncate" title={c.firma_a}>
                    {c.firma_a}
                  </TableCell>
                  <TableCell className="max-w-[260px] truncate" title={c.firma_b}>
                    {c.firma_b}
                  </TableCell>
                  <TableCell className="text-center font-semibold">
                    {c.toplam_skor.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded text-xs border ${kategoriRenk(c.kategori)}`}>
                      {c.kategori}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {c.ortak_ihale}/{Math.min(c.a_toplam, c.b_toplam)}
                  </TableCell>
                  <TableCell className="text-center text-sm">{c.lift.toFixed(2)}</TableCell>
                  <TableCell className="text-center text-sm">
                    %{c.tenzilat_medyan_fark.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {c.tenzilat_esik_alti_pct.toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-center text-sm">
                    {(c.en_yogun_idare_orani * 100).toFixed(0)}%
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function OzetKart({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "red" | "orange" | "yellow" | "gray";
}) {
  const map = {
    red: "bg-red-50 text-red-700 border-red-200",
    orange: "bg-orange-50 text-orange-700 border-orange-200",
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200",
    gray: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <div className={`rounded-xl border p-4 ${map[color]}`}>
      <div className="text-xs uppercase tracking-wide font-medium opacity-75">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}

function KartelGrubuKart({ g }: { g: KartelGrupDto }) {
  const [acik, setAcik] = useState(false);
  return (
    <div className="p-4">
      <button
        className="w-full flex items-center justify-between gap-3 hover:bg-gray-50 -m-2 p-2 rounded-lg"
        onClick={() => setAcik((a) => !a)}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="text-xs font-mono text-gray-500 w-12">#{g.grup_id}</div>
          <div className="flex-1 text-left">
            <div className="text-sm font-medium text-gray-900">
              {g.firmalar.length} firma · {g.cift_sayisi} çift · ort. skor {g.ortalama_skor.toFixed(1)}
            </div>
            <div className="text-xs text-gray-500 truncate">
              {g.firmalar.slice(0, 3).join(" · ")}
              {g.firmalar.length > 3 && ` · +${g.firmalar.length - 3} daha`}
            </div>
          </div>
        </div>
        <div className={`text-xs font-medium ${acik ? "text-orange-600" : "text-gray-400"}`}>
          {acik ? "Kapat" : "Aç"}
        </div>
      </button>
      {acik && (
        <div className="mt-3 pl-15 space-y-2">
          <div>
            <div className="text-xs font-semibold text-gray-700 mb-1">Firmalar:</div>
            <ul className="text-sm text-gray-600 space-y-0.5 ml-4 list-disc">
              {g.firmalar.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
          {g.paylaşilan_idareler.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-700 mb-1">Yoğun İdareler:</div>
              <ul className="text-sm text-gray-600 space-y-0.5 ml-4 list-disc">
                {g.paylaşilan_idareler.slice(0, 5).map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
