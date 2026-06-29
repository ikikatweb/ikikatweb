// İhale Rakip Karneleri — Tüm rakip firmaların kapsamlı profili
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  getRakipKarneleri,
  type RakipKarneResponse,
  type RakipKarneDto,
  IHALE_AI_BASE,
} from "@/lib/ihale-ai-api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FileBarChart2, AlertCircle, Loader2, Search, RefreshCw,
} from "lucide-react";
import toast from "react-hot-toast";
import { trAramaNormalize } from "@/lib/utils/isim";

const inputClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

function formatTL(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M TL";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(0) + "K TL";
  return n.toFixed(0) + " TL";
}

type SiraOlcek =
  | "ihale" | "kazanma" | "kazanma_orani" | "tenzilat" | "deneyim";

export default function RakipKarneleriPage() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [rapor, setRapor] = useState<RakipKarneResponse | null>(null);

  const [arama, setArama] = useState("");
  const [sadeceRakip, setSadeceRakip] = useState(true);
  const [sadeceSniper, setSadeceSniper] = useState(false);
  const [sadeceTopl, setSadeceTopl] = useState(false);
  const [sira, setSira] = useState<SiraOlcek>("ihale");
  const [minIhale, setMinIhale] = useState(5);

  const yukle = async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await getRakipKarneleri(sadeceRakip);
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
  }, [sadeceRakip]);

  const filtreli = useMemo(() => {
    if (!rapor) return [];
    let liste = rapor.karneler.filter((k) => k.toplam_ihale >= minIhale);
    if (arama) {
      const aLow = trAramaNormalize(arama);
      liste = liste.filter((k) =>
        trAramaNormalize(k.firma_adi).includes(aLow),
      );
    }
    if (sadeceSniper) liste = liste.filter((k) => k.is_sniper || k.is_ultra_sniper);
    if (sadeceTopl) liste = liste.filter((k) => k.is_toplulastirmaci);

    // Sırala
    const yon = (k: RakipKarneDto): number => {
      switch (sira) {
        case "kazanma": return -k.toplam_kazanma;
        case "kazanma_orani": return -k.kazanma_orani;
        case "tenzilat": return -k.ortalama_tenzilat;
        case "deneyim": return -k.deneyim_tutari;
        default: return -k.toplam_ihale;
      }
    };
    return [...liste].sort((a, b) => yon(a) - yon(b));
  }, [rapor, arama, sadeceSniper, sadeceTopl, sira, minIhale]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
          <FileBarChart2 size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Rakip Karneleri</h1>
          <p className="text-sm text-gray-500">
            Deneyim, kazanma istatistiği ve sniper davranışı birleştirilmiş profil
          </p>
        </div>
      </div>

      {/* Filtreler */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Label className="mb-1.5 block">Firma Ara</Label>
            <Search size={14} className="absolute left-2.5 top-[34px] text-gray-400" />
            <Input
              className={inputClass + " w-full pl-8"}
              type="text"
              value={arama}
              onChange={(e) => setArama(e.target.value)}
              placeholder="Firma adı..."
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Min İhale</Label>
            <Input
              className={inputClass + " w-full"}
              type="number"
              value={minIhale}
              onChange={(e) => setMinIhale(parseInt(e.target.value) || 0)}
              min={0}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Sıralama</Label>
            <select
              className={inputClass + " w-full"}
              value={sira}
              onChange={(e) => setSira(e.target.value as SiraOlcek)}
            >
              <option value="ihale">Toplam İhale</option>
              <option value="kazanma">Toplam Kazanma</option>
              <option value="kazanma_orani">Kazanma Oranı</option>
              <option value="tenzilat">Ortalama Tenzilat</option>
              <option value="deneyim">Deneyim Tutarı</option>
            </select>
          </div>
          <div className="flex items-end">
            <Button onClick={yukle} disabled={yukleniyor} className="bg-orange-600 hover:bg-orange-700 text-white w-full">
              {yukleniyor ? (
                <><Loader2 className="animate-spin" size={16} /> Hesaplanıyor</>
              ) : (
                <><RefreshCw size={16} /> Yenile</>
              )}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sadeceRakip}
              onChange={(e) => setSadeceRakip(e.target.checked)}
            />
            Sadece Rakip (kendi firmaların hariç)
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sadeceSniper}
              onChange={(e) => setSadeceSniper(e.target.checked)}
            />
            🎯 Sadece Sniper
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={sadeceTopl}
              onChange={(e) => setSadeceTopl(e.target.checked)}
            />
            🏗 Sadece Toplulaştırmacı
          </label>
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

      {/* Tablo */}
      {rapor && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Karneler ({filtreli.length} / {rapor.karneler.length})
            </h3>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead className="text-center">İhale</TableHead>
                <TableHead className="text-center">Kazanma</TableHead>
                <TableHead className="text-center">Kazanma %</TableHead>
                <TableHead className="text-center">Ort. Tenzilat</TableHead>
                <TableHead className="text-right">Deneyim</TableHead>
                <TableHead className="text-center">Profil</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtreli.map((k, idx) => (
                <TableRow key={k.firma_kanon}>
                  <TableCell className="text-gray-400 text-xs">{idx + 1}</TableCell>
                  <TableCell className="max-w-[320px] truncate font-medium" title={k.firma_adi}>
                    {k.firma_adi}
                  </TableCell>
                  <TableCell>
                    {k.etiket === "SELF" ? (
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-semibold">
                        BİZ
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                        Rakip
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">{k.toplam_ihale}</TableCell>
                  <TableCell className="text-center">{k.toplam_kazanma}</TableCell>
                  <TableCell className="text-center font-medium">
                    {(k.kazanma_orani * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-center">
                    %{k.ortalama_tenzilat.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatTL(k.deneyim_tutari)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-center gap-1 flex-wrap">
                      {k.is_ultra_sniper && (
                        <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-semibold" title="Ultra Sniper">
                          🔥
                        </span>
                      )}
                      {k.is_sniper && !k.is_ultra_sniper && (
                        <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px]" title="Sniper">
                          🎯
                        </span>
                      )}
                      {k.is_toplulastirmaci && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px]" title="Toplulaştırmacı">
                          🏗
                        </span>
                      )}
                    </div>
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
