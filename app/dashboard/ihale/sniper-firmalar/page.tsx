// İhale Sniper Firmalar — Sınır değere %0.5 yakın teklif veren firmalar
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  getSniperRapor,
  type SniperRaporResponse,
  type SniperFirmaDto,
  IHALE_AI_BASE,
} from "@/lib/ihale-ai-api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trAramaNormalize } from "@/lib/utils/isim";
import { Label } from "@/components/ui/label";
import {
  Crosshair, AlertCircle, Loader2, Search, RefreshCw, Target,
} from "lucide-react";
import toast from "react-hot-toast";

const inputClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

export default function SniperFirmalarPage() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [rapor, setRapor] = useState<SniperRaporResponse | null>(null);
  const [sadeceUltra, setSadeceUltra] = useState(false);
  const [arama, setArama] = useState("");
  const [acikDetay, setAcikDetay] = useState<string | null>(null);

  const yukle = async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await getSniperRapor({ sadeceUltra, sadeceSniper: true });
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
  }, [sadeceUltra]);

  const filtreli = useMemo(() => {
    if (!rapor) return [];
    if (!arama) return rapor.firmalar;
    const aLow = trAramaNormalize(arama);
    return rapor.firmalar.filter((f) =>
      trAramaNormalize(f.firma_adi).includes(aLow),
    );
  }, [rapor, arama]);

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
          <Crosshair size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Sniper Firmalar</h1>
          <p className="text-sm text-gray-500">
            Sınır değere %0.5 yakın teklif veren firmalar — büyük olasılıkla iç bilgi avantajı
          </p>
        </div>
      </div>

      {/* Filtre satırı */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm flex gap-3 items-end flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
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
        <label className="flex items-center gap-2 mb-2 text-sm">
          <input
            type="checkbox"
            checked={sadeceUltra}
            onChange={(e) => setSadeceUltra(e.target.checked)}
          />
          Sadece Ultra Sniper (%0.20 yakın)
        </label>
        <Button
          onClick={yukle}
          disabled={yukleniyor}
          className="bg-orange-600 hover:bg-orange-700 text-white"
        >
          {yukleniyor ? (
            <><Loader2 className="animate-spin" size={16} /> Hesaplanıyor</>
          ) : (
            <><RefreshCw size={16} /> Yenile</>
          )}
        </Button>
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

      {/* Özet */}
      {rapor && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <OzetKart label="Toplam Analiz Edilen Firma" value={rapor.toplam_firma} icon="🏢" />
          <OzetKart label="Sniper Firma" value={rapor.sniper_sayisi} icon="🎯" />
          <OzetKart label="Ultra Sniper" value={rapor.ultra_sniper_sayisi} icon="🔥" />
        </div>
      )}

      {/* Tablo */}
      {rapor && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Sniper Firmalar ({filtreli.length})
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              En yakın hedefleyenler üstte. Detay için satıra tıklayın.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Firma</TableHead>
                <TableHead className="text-center">İhale</TableHead>
                <TableHead className="text-center">Tip</TableHead>
                <TableHead className="text-center">Ort. Yakınlık</TableHead>
                <TableHead className="text-center">Std</TableHead>
                <TableHead className="text-center">En Yakın</TableHead>
                <TableHead className="text-center">İdare Sayısı</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtreli.map((f, idx) => (
                <SniperRow
                  key={f.firma_kanon}
                  f={f}
                  idx={idx}
                  acik={acikDetay === f.firma_kanon}
                  onToggle={() =>
                    setAcikDetay((a) => (a === f.firma_kanon ? null : f.firma_kanon))
                  }
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function OzetKart({
  label, value, icon,
}: { label: string; value: number; icon: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
      <div className="text-3xl">{icon}</div>
      <div>
        <div className="text-xs text-gray-500 uppercase font-medium">{label}</div>
        <div className="text-2xl font-bold text-gray-900 mt-1">{value}</div>
      </div>
    </div>
  );
}

function SniperRow({
  f, idx, acik, onToggle,
}: {
  f: SniperFirmaDto;
  idx: number;
  acik: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow
        className={`cursor-pointer hover:bg-gray-50 ${acik ? "bg-orange-50" : ""}`}
        onClick={onToggle}
      >
        <TableCell className="text-gray-400 text-xs">{idx + 1}</TableCell>
        <TableCell className="max-w-[300px] truncate font-medium" title={f.firma_adi}>
          {f.firma_adi}
        </TableCell>
        <TableCell className="text-center">{f.toplam_ihale}</TableCell>
        <TableCell className="text-center">
          {f.is_ultra_sniper ? (
            <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold">
              🔥 ULTRA
            </span>
          ) : f.is_sniper ? (
            <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs font-medium">
              🎯 SNIPER
            </span>
          ) : (
            <span className="text-gray-400 text-xs">—</span>
          )}
        </TableCell>
        <TableCell className="text-center font-mono text-sm">
          %{f.global_ortalama_yakinlik_pct.toFixed(3)}
        </TableCell>
        <TableCell className="text-center font-mono text-sm">
          %{f.global_std_pct.toFixed(2)}
        </TableCell>
        <TableCell className="text-center font-mono text-sm font-semibold text-orange-700">
          %{f.en_yakin_teklif_pct.toFixed(3)}
        </TableCell>
        <TableCell className="text-center">{f.sniper_idareler.length}</TableCell>
      </TableRow>
      {acik && f.sniper_idareler.length > 0 && (
        <TableRow className="bg-orange-50/50">
          <TableCell colSpan={8} className="p-0">
            <div className="p-4">
              <div className="text-xs font-semibold text-orange-900 mb-2 flex items-center gap-1.5">
                <Target size={12} />
                Sniper Davranışı Gösterdiği İdareler
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>İdare</TableHead>
                    <TableHead className="text-center">Toplam İhale</TableHead>
                    <TableHead className="text-center">In-Band Sayısı</TableHead>
                    <TableHead className="text-center">In-Band %</TableHead>
                    <TableHead className="text-center">Ort. Yakınlık</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {f.sniper_idareler.map((i) => (
                    <TableRow key={i.idare_adi}>
                      <TableCell className="max-w-[400px] truncate" title={i.idare_adi}>
                        {i.idare_adi}
                      </TableCell>
                      <TableCell className="text-center">{i.toplam_ihale}</TableCell>
                      <TableCell className="text-center font-semibold">{i.in_band_sayisi}</TableCell>
                      <TableCell className="text-center">
                        {(i.in_band_orani * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        %{i.ortalama_yakinlik_pct.toFixed(3)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
