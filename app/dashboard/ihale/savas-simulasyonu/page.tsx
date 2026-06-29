// İhale Savaş Simülasyonu — Monte Carlo war room
// Python ihale-ai sunucusu üzerinden çalışır (port 8000).
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  getIdareler,
  postSavasSimulasyonu,
  savasGrafikUrl,
  IHALE_AI_BASE,
  type IdareListItem,
  type SavasSimulasyonuResponse,
} from "@/lib/ihale-ai-api";
import { trAramaNormalize } from "@/lib/utils/isim";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Swords, Target, AlertCircle, TrendingUp, Search, Loader2,
  CheckCircle2, XCircle, Crosshair,
} from "lucide-react";
import toast from "react-hot-toast";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

const inputClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 w-full";

function formatTL(n: number): string {
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " TL";
}
function formatPct(n: number, digits = 1): string {
  return (n * 100).toFixed(digits) + "%";
}

export default function SavasSimulasyonuPage() {
  const [idareler, setIdareler] = useState<IdareListItem[]>([]);
  const [idareArama, setIdareArama] = useState("");
  const [loadingIdareler, setLoadingIdareler] = useState(true);

  // Form
  const [ymStr, setYmStr] = useState("");
  const [secilenIdare, setSecilenIdare] = useState<string>("");
  // Maliyet marjı kullanıcıdan ALINMIYOR — backend geçmiş SELF tekliflerinden otomatik hesaplar.
  // Sonuç döndüğünde kaynak ve hangi yüzde kullanıldığı response'ta gelir.
  const [nKatsayisi, setNKatsayisi] = useState(1.0);
  const [nIterasyon, setNIterasyon] = useState(1000);
  const [maxRakip, setMaxRakip] = useState(20);
  const [tekTenzilat, setTekTenzilat] = useState<string>("");

  // Sonuç
  const [calisiyor, setCalisiyor] = useState(false);
  const [sonuc, setSonuc] = useState<SavasSimulasyonuResponse | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [grafikRefresh, setGrafikRefresh] = useState(0);

  // Idare listesi yükle
  useEffect(() => {
    setLoadingIdareler(true);
    getIdareler()
      .then((d) => setIdareler(d))
      .catch((e) => toast.error("İdareler yüklenemedi: " + e.message))
      .finally(() => setLoadingIdareler(false));
  }, []);

  const filtreliIdareler = useMemo(() => {
    if (!idareArama) return idareler;
    const aLow = trAramaNormalize(idareArama);
    return idareler.filter((i) =>
      trAramaNormalize(i.idare_adi).includes(aLow),
    );
  }, [idareler, idareArama]);

  const ym = parseParaInput(ymStr);

  async function calistir() {
    if (!ym || ym <= 0) {
      toast.error("Yaklaşık maliyet girin");
      return;
    }
    if (!secilenIdare) {
      toast.error("İdare seçin");
      return;
    }
    setCalisiyor(true);
    setHata(null);
    setSonuc(null);
    try {
      const tenzilat = tekTenzilat ? parseFloat(tekTenzilat.replace(",", ".")) : null;
      const res = await postSavasSimulasyonu({
        yaklasik_maliyet: ym,
        idare_adi: secilenIdare,
        tenzilat: Number.isFinite(tenzilat as number) ? tenzilat : null,
        n_iterasyon: nIterasyon,
        n_katsayisi: nKatsayisi,
        // maliyet_marji gönderilmez → backend geçmiş SELF tekliflerden otomatik hesaplar
        max_rakip: maxRakip,
        seed: 42,
      });
      setSonuc(res);
      setGrafikRefresh((r) => r + 1);
      toast.success("Simülasyon tamamlandı");
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      setHata(msg);
      toast.error(msg);
    } finally {
      setCalisiyor(false);
    }
  }

  // Önerilen tenzilatın index'i (öne çıkar)
  const oneriIndex = sonuc
    ? sonuc.optimum_noktalar.findIndex((n) => Math.abs(n.tenzilat - sonuc.onerilen_tenzilat) < 0.01)
    : -1;

  return (
    <div className="space-y-5 max-w-7xl">
      {/* Başlık */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
          <Swords size={22} />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">İhale Savaş Simülasyonu</h1>
          <p className="text-sm text-gray-500">
            Monte Carlo ile rakip davranışına göre optimum teklif
          </p>
        </div>
      </div>

      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label className="mb-1.5 block">
              Yaklaşık Maliyet (TL)
              <span className="ml-1 text-[10px] text-gray-400 font-normal" title="Sizin metrajdan hesapladığınız YM. Geçmiş ihalelerden hesaplanan idare bias'ı ile çarpılarak tahmini idare YM'sine çevrilir.">
                — sizin hesabınız
              </span>
            </Label>
            <Input
              className={inputClass}
              type="text"
              value={ymStr}
              onChange={(e) => setYmStr(formatParaInput(e.target.value))}
              placeholder="50.000.000"
              disabled={calisiyor}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">KİK n Katsayısı</Label>
            <select
              className={inputClass}
              value={nKatsayisi}
              onChange={(e) => setNKatsayisi(parseFloat(e.target.value))}
              disabled={calisiyor}
            >
              <option value={1.0}>1.00 (Yapım)</option>
              <option value={1.2}>1.20 (Genel)</option>
            </select>
          </div>
          <div>
            <Label className="mb-1.5 block">Tek Tenzilat (opsiyonel)</Label>
            <Input
              className={inputClass}
              type="text"
              value={tekTenzilat}
              onChange={(e) => setTekTenzilat(e.target.value)}
              placeholder="boş = optimum aranır"
              disabled={calisiyor}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label className="mb-1.5 block">İterasyon</Label>
            <Input
              className={inputClass}
              type="number"
              min={100}
              max={10000}
              step={100}
              value={nIterasyon}
              onChange={(e) => setNIterasyon(parseInt(e.target.value) || 1000)}
              disabled={calisiyor}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Max Rakip</Label>
            <Input
              className={inputClass}
              type="number"
              min={2}
              max={50}
              value={maxRakip}
              onChange={(e) => setMaxRakip(parseInt(e.target.value) || 20)}
              disabled={calisiyor}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">İdare Arama</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                className={inputClass + " pl-8"}
                type="text"
                value={idareArama}
                onChange={(e) => setIdareArama(e.target.value)}
                placeholder="DSİ 12 yazın..."
                disabled={calisiyor}
              />
            </div>
          </div>
        </div>

        <div>
          <Label className="mb-1.5 block">
            İdare ({filtreliIdareler.length} sonuç) {loadingIdareler && "yükleniyor..."}
          </Label>
          <select
            className={inputClass}
            size={6}
            value={secilenIdare}
            onChange={(e) => setSecilenIdare(e.target.value)}
            disabled={calisiyor || loadingIdareler}
          >
            {filtreliIdareler.slice(0, 200).map((i) => (
              <option key={i.idare_adi} value={i.idare_adi}>
                {i.idare_adi} ({i.ihale_sayisi} ihale)
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-end">
          <Button onClick={calistir} disabled={calisiyor} className="bg-orange-600 hover:bg-orange-700 text-white">
            {calisiyor ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Hesaplanıyor...
              </>
            ) : (
              <>
                <Swords size={16} />
                Simülasyonu Başlat
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Hata */}
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

      {/* Sonuç */}
      {sonuc && (
        <div className="space-y-5">
          {/* İhale Tahmini Özeti — net sonuç kartı */}
          {(() => {
            const oneriNoktasi = oneriIndex >= 0 ? sonuc.optimum_noktalar[oneriIndex] : null;
            const idareYM = sonuc.yaklasik_maliyet;

            // En düşük tahmini teklif veren rakip
            type RakipTahmin = { ad: string; teklif: number; tenzilat: number };
            const tahminler: RakipTahmin[] = sonuc.rakipler.map((r) => {
              let teklif: number;
              let tenzilat: number;
              if (r.sniper_idare_match && r.idare_yakinlik) {
                teklif = idareYM * r.idare_yakinlik.ortalama_yakinlik;
                tenzilat = (1 - r.idare_yakinlik.ortalama_yakinlik) * 100;
              } else if (r.idare_yakinlik && r.idare_yakinlik.n_ihale >= 2) {
                teklif = idareYM * r.idare_yakinlik.ortalama_yakinlik;
                tenzilat = (1 - r.idare_yakinlik.ortalama_yakinlik) * 100;
              } else {
                teklif = idareYM * (1 - r.mu / 100);
                tenzilat = r.mu;
              }
              return { ad: r.firma_ad, teklif, tenzilat };
            }).sort((a, b) => a.teklif - b.teklif);
            const enAgresifRakip = tahminler[0] ?? null;

            // Bizim teklif vs en agresif rakip — sınır değer üstündeyse geçerli
            const bizimTeklif = sonuc.onerilen_teklif;
            const sdP10 = oneriNoktasi?.sd_p10 ?? sonuc.sd_medyan;
            const sdP50 = oneriNoktasi?.sd_p50 ?? sonuc.sd_medyan;
            const sdP90 = oneriNoktasi?.sd_p90 ?? sonuc.sd_medyan;

            // Bizim durum
            const bizimSDAltinda = bizimTeklif < sdP50;
            const bizimEnDusuk = enAgresifRakip ? bizimTeklif < enAgresifRakip.teklif : true;
            const bizimDurum = bizimSDAltinda
              ? { etiket: "Bizim teklif sınır altında — eleniriz", renk: "red" as const }
              : bizimEnDusuk
                ? { etiket: "Bizim teklif en düşük geçerli — kazanırız", renk: "emerald" as const }
                : { etiket: "Bizden ucuz rakip var — kaybederiz", renk: "amber" as const };

            return (
              <div className={`rounded-xl border-2 shadow-sm overflow-hidden ${
                bizimDurum.renk === "emerald" ? "border-emerald-300" :
                bizimDurum.renk === "red" ? "border-red-300" : "border-amber-300"
              }`}>
                <div className={`px-4 py-2.5 ${
                  bizimDurum.renk === "emerald" ? "bg-emerald-100 text-emerald-900" :
                  bizimDurum.renk === "red" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"
                }`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="font-bold text-sm flex items-center gap-1.5">
                      <Crosshair size={16} /> İhale Tahmini
                    </h3>
                    <span className="text-xs font-semibold">{bizimDurum.etiket}</span>
                  </div>
                </div>
                <div className="p-4 bg-white grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Tahmini Sınır Değer */}
                  <div className="border-r border-gray-200 last:border-r-0 pr-3 md:pr-4">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-1">
                      Tahmini Sınır Değer
                    </div>
                    <div className="text-lg font-bold text-[#1E3A5F] tabular-nums">{formatTL(sdP50)}</div>
                    <div className="text-[11px] text-gray-500 mt-1 font-mono">
                      P10: {formatTL(sdP10)}
                      <br />
                      P90: {formatTL(sdP90)}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1.5">
                      Sınır altı kalma: %{((oneriNoktasi?.sinir_alti_olasiligi ?? 0) * 100).toFixed(1)}
                    </div>
                  </div>

                  {/* Tahmini Kazanan Rakip */}
                  <div className="border-r border-gray-200 last:border-r-0 pr-3 md:pr-4">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-1">
                      En Agresif Rakip
                    </div>
                    {enAgresifRakip ? (
                      <>
                        <div className="text-sm font-bold text-[#1E3A5F] truncate" title={enAgresifRakip.ad}>
                          🥇 {enAgresifRakip.ad}
                        </div>
                        <div className="text-base font-bold text-orange-700 tabular-nums mt-1">
                          {formatTL(enAgresifRakip.teklif)}
                        </div>
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          Tenzilat: %{enAgresifRakip.tenzilat.toFixed(1)}
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-gray-400">Rakip yok</div>
                    )}
                  </div>

                  {/* Bizim Pozisyonumuz */}
                  <div className="pr-3 md:pr-4">
                    <div className="text-[11px] text-gray-500 uppercase tracking-wide font-semibold mb-1">
                      Bizim Teklif (önerilen)
                    </div>
                    <div className={`text-lg font-bold tabular-nums ${
                      bizimDurum.renk === "emerald" ? "text-emerald-700" :
                      bizimDurum.renk === "red" ? "text-red-700" : "text-amber-700"
                    }`}>
                      {formatTL(bizimTeklif)}
                    </div>
                    <div className="text-[11px] text-gray-500 mt-1">
                      Tenzilat: %{sonuc.onerilen_tenzilat.toFixed(1)}
                    </div>
                    {enAgresifRakip && (
                      <div className={`text-[10px] mt-1.5 ${bizimEnDusuk ? "text-emerald-600" : "text-red-600"}`}>
                        {bizimEnDusuk
                          ? `En agresif rakipten ${formatTL(enAgresifRakip.teklif - bizimTeklif)} daha düşük ✓`
                          : `En agresif rakipten ${formatTL(bizimTeklif - enAgresifRakip.teklif)} daha yüksek ✗`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Otomatik Maliyet Marjı bilgisi */}
          {sonuc.maliyet_marji_kaynak !== "manuel" && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs flex items-center gap-2">
              <span className="text-amber-700">💰</span>
              <span className="text-amber-900">
                <span className="font-semibold">Maliyet marjı otomatik:</span>{" "}
                <span className="font-bold">%{sonuc.maliyet_marji.toFixed(1)}</span>
                {" — "}
                {sonuc.maliyet_marji_kaynak === "idare" && `Bu idarede geçmiş ${sonuc.maliyet_marji_n_kayit} kendi teklifinizin medyanı`}
                {sonuc.maliyet_marji_kaynak === "global" && `Geçmiş ${sonuc.maliyet_marji_n_kayit} kendi teklifinizin medyanı`}
                {sonuc.maliyet_marji_kaynak === "varsayilan" && "Geçmiş veri yetersiz — varsayılan kullanıldı"}
              </span>
            </div>
          )}

          {/* Bias güvenilirlik uyarısı — az veri varsa */}
          {sonuc.bias_detay && sonuc.bias_detay.bias_n_ihale < 5 && sonuc.bias_detay.bias_kaynak !== "yok" && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-3 text-xs flex items-center gap-2">
              <span className="text-yellow-700">⚠</span>
              <span className="text-yellow-900">
                <span className="font-semibold">Bias güvenilirliği düşük:</span> sadece{" "}
                <span className="font-bold">{sonuc.bias_detay.bias_n_ihale}</span> ihale verisi var
                ({sonuc.bias_detay.bias_kaynak === "idare" ? "bu idarede" : "global"}).
                Tahmini idare YM&apos;si gerçek değerden sapmış olabilir. Daha çok geçmiş ihale girdikçe doğruluk artar.
              </span>
            </div>
          )}

          {/* Bias Detayı — bizim YM → tahmini idare YM */}
          {sonuc.bias_detay && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  📊
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">Bizim YM → Tahmini İdare YM Çevirisi</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <div className="text-[11px] text-blue-700">Bizim Hesabımız</div>
                      <div className="font-semibold text-blue-900">{formatTL(sonuc.bias_detay.bizim_ym)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-blue-700">Bias Faktörü</div>
                      <div className="font-semibold text-blue-900">×{sonuc.bias_detay.bias_factor.toFixed(4)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-blue-700">Tahmini İdare YM</div>
                      <div className="font-bold text-blue-900">{formatTL(sonuc.bias_detay.tahmini_idare_ym)}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-blue-700">Bias Kaynağı</div>
                      <div className="font-medium text-blue-900">
                        {sonuc.bias_detay.bias_kaynak === "idare" && `İdare özel (${sonuc.bias_detay.bias_n_ihale} ihale)`}
                        {sonuc.bias_detay.bias_kaynak === "global" && `Global (${sonuc.bias_detay.bias_n_ihale} ihale)`}
                        {sonuc.bias_detay.bias_kaynak === "yok" && "Veri yok — 1.0 kabul"}
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const bias = sonuc.bias_detay.bias_factor;
                    const fark = Math.abs((bias - 1) * 100);
                    const bizYontemiYon = bias < 1 ? "YÜKSEK" : "DÜŞÜK";
                    const idareYontemiYon = bias < 1 ? "DÜŞÜK" : "YÜKSEK";
                    return (
                      <>
                        <p className="text-[11px] text-blue-700 mt-2">
                          Geçmişte bu idarede bizim hesabımız idarenin YM&apos;sinden ortalama
                          {" "}%<span className="font-bold">{fark.toFixed(1)}</span> {bizYontemiYon}{" "}
                          (yani idare YM&apos;leri bizden %{fark.toFixed(1)} {idareYontemiYon} açıklanıyor).
                        </p>
                        <p className="text-[11px] text-blue-700 mt-1 font-mono">
                          Hesap: {formatTL(sonuc.bias_detay.bizim_ym)} × {bias.toFixed(4)} = {formatTL(sonuc.bias_detay.tahmini_idare_ym)}
                        </p>
                      </>
                    );
                  })()}

                  {/* Bias hesabını oluşturan geçmiş ihaleler (şeffaflık) */}
                  {sonuc.bias_detay.ornekler && sonuc.bias_detay.ornekler.length > 0 && (
                    <details className="mt-3">
                      <summary className="text-[11px] text-blue-700 cursor-pointer hover:underline">
                        🔍 Bu hesabı oluşturan {sonuc.bias_detay.ornekler.length} ihaleyi göster
                      </summary>
                      <div className="mt-2 bg-white border border-blue-200 rounded-lg overflow-hidden">
                        <table className="w-full text-[11px]">
                          <thead className="bg-blue-100 text-blue-900">
                            <tr>
                              <th className="px-2 py-1.5 text-left">İş</th>
                              <th className="px-2 py-1.5 text-center">Tarih</th>
                              <th className="px-2 py-1.5 text-right">Bizim YM</th>
                              <th className="px-2 py-1.5 text-right">İdare YM</th>
                              <th className="px-2 py-1.5 text-right">Oran</th>
                              <th className="px-2 py-1.5 text-right">Fark</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-blue-100">
                            {sonuc.bias_detay.ornekler.map((o, i) => {
                              const farkPct = ((o.oran - 1) * 100);
                              return (
                                <tr key={i} className="hover:bg-blue-50">
                                  <td className="px-2 py-1 truncate max-w-[200px]" title={o.is_adi}>
                                    {o.is_adi}
                                  </td>
                                  <td className="px-2 py-1 text-center text-gray-500 whitespace-nowrap">
                                    {o.ihale_tarihi ?? "—"}
                                  </td>
                                  <td className="px-2 py-1 text-right tabular-nums">{formatTL(o.bizim_ym)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums">{formatTL(o.resmi_ym)}</td>
                                  <td className="px-2 py-1 text-right tabular-nums font-mono">{o.oran.toFixed(4)}</td>
                                  <td className={`px-2 py-1 text-right tabular-nums ${farkPct < 0 ? "text-red-600" : "text-emerald-600"}`}>
                                    {farkPct > 0 ? "+" : ""}{farkPct.toFixed(1)}%
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[10px] text-blue-600 mt-1.5 ml-1">
                        Oran = İdare YM ÷ Bizim YM. Fark % = (Oran − 1) × 100.
                        Negatif fark: idare bizden düşük açıklamış. Pozitif fark: idare bizden yüksek açıklamış.
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Öneri Kartı */}
          <div className={`rounded-xl border-2 p-5 shadow-md ${
            sonuc.girilmemeli
              ? "bg-red-50 border-red-300"
              : "bg-emerald-50 border-emerald-300"
          }`}>
            <div className="flex items-start gap-4">
              {sonuc.girilmemeli ? (
                <XCircle className="text-red-600 shrink-0 mt-1" size={28} />
              ) : (
                <CheckCircle2 className="text-emerald-600 shrink-0 mt-1" size={28} />
              )}
              <div className="flex-1">
                <h2 className={`text-lg font-bold ${sonuc.girilmemeli ? "text-red-900" : "text-emerald-900"}`}>
                  {sonuc.girilmemeli ? "İhaleye Girmeyin" : "Strateji Önerisi"}
                </h2>
                <p className={`text-sm ${sonuc.girilmemeli ? "text-red-700" : "text-emerald-700"} mb-3`}>
                  {sonuc.girilmemeli
                    ? "Hiçbir tenzilatta pozitif beklenen kar yok. Maliyet marjınız piyasa altında veya rekabet çok agresif."
                    : `Optimum tenzilat: ${sonuc.onerilen_tenzilat.toFixed(1)}%`}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
                  <Metrik
                    label="Önerilen Tenzilat"
                    value={`%${sonuc.onerilen_tenzilat.toFixed(1)}`}
                    color={sonuc.girilmemeli ? "red" : "emerald"}
                  />
                  <Metrik
                    label="Bizim Teklif"
                    value={formatTL(sonuc.onerilen_teklif)}
                    color={sonuc.girilmemeli ? "red" : "emerald"}
                  />
                  <Metrik
                    label="Win Probability"
                    value={formatPct(sonuc.onerilen_win_prob)}
                    color={sonuc.girilmemeli ? "red" : "emerald"}
                  />
                  <Metrik
                    label="Beklenen Kar"
                    value={formatTL(sonuc.onerilen_beklenen_kar)}
                    color={sonuc.girilmemeli ? "red" : "emerald"}
                    bold
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 text-sm">
                  <div className="text-gray-600">
                    SD Medyan: <span className="font-medium">{formatTL(sonuc.sd_medyan)}</span>
                  </div>
                  <div className="text-gray-600">
                    Kazandığında Kar: <span className="font-medium">{formatTL(sonuc.onerilen_kar_kazanildiginda)}</span>
                  </div>
                  <div className="text-gray-600">
                    Rakip Sayısı: <span className="font-medium">{sonuc.rakipler.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Grafikler */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sonuc.optimum_noktalar.length > 1 && (
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <TrendingUp size={16} />
                  Win Prob / Beklenen Kar Eğrisi
                </h3>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${savasGrafikUrl(sonuc.grafik_token, "winprob-kar")}?t=${grafikRefresh}`}
                  alt="Win Prob Curve"
                  className="w-full rounded-lg"
                />
              </div>
            )}
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Crosshair size={16} />
                Sınır Değer Dağılımı
              </h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${savasGrafikUrl(sonuc.grafik_token, "sd-dagilimi")}?t=${grafikRefresh}`}
                alt="SD Distribution"
                className="w-full rounded-lg"
              />
            </div>
          </div>

          {/* Rakipler grafiği */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Target size={16} />
              Rakip Tenzilat Dağılımı (μ ± σ)
            </h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`${savasGrafikUrl(sonuc.grafik_token, "rakipler")}?t=${grafikRefresh}`}
              alt="Rakipler"
              className="w-full rounded-lg"
            />
          </div>

          {/* Tenzilat tablosu */}
          {sonuc.optimum_noktalar.length > 1 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">
                  Tüm Tenzilat Noktaları ({sonuc.optimum_noktalar.length})
                </h3>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tenzilat</TableHead>
                    <TableHead>Bizim Teklif</TableHead>
                    <TableHead>Win Prob</TableHead>
                    <TableHead>SD Altı Risk</TableHead>
                    <TableHead>SD P50</TableHead>
                    <TableHead>Kar (Kazanırsa)</TableHead>
                    <TableHead>Beklenen Kar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sonuc.optimum_noktalar.map((n, idx) => (
                    <TableRow
                      key={idx}
                      className={idx === oneriIndex ? "bg-emerald-50 font-medium" : ""}
                    >
                      <TableCell>%{n.tenzilat.toFixed(1)}</TableCell>
                      <TableCell>{formatTL(n.bizim_teklif)}</TableCell>
                      <TableCell>{formatPct(n.win_prob)}</TableCell>
                      <TableCell className={n.sinir_alti_olasiligi > 0.5 ? "text-red-600" : ""}>
                        {formatPct(n.sinir_alti_olasiligi)}
                      </TableCell>
                      <TableCell>{formatTL(n.sd_p50)}</TableCell>
                      <TableCell className={n.kar_kazanildiginda < 0 ? "text-red-600" : ""}>
                        {formatTL(n.kar_kazanildiginda)}
                      </TableCell>
                      <TableCell className={n.beklenen_kar > 0 ? "text-emerald-700 font-semibold" : "text-gray-500"}>
                        {formatTL(n.beklenen_kar)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Rakip tablosu */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">
                Rakipler ({sonuc.rakipler.length}) — tahmini teklifler
              </h3>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Her rakip için <strong>tahmini tenzilat ve teklif</strong> idare YM&apos;sinin{" "}
                <strong>{formatTL(sonuc.yaklasik_maliyet)}</strong> olduğu varsayımıyla hesaplanır.
                Öncelik: 1) Sniper firma + idare match → sınır değer civarında teklif,
                2) İdare yakınlığı var → o yakınlığa göre teklif, 3) Tarihsel tenzilat ortalaması.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Firma</TableHead>
                  <TableHead className="text-right">Tahmini Tenzilat</TableHead>
                  <TableHead className="text-right">Tahmini Teklif</TableHead>
                  <TableHead>Kaynak</TableHead>
                  <TableHead>Gözlem</TableHead>
                  <TableHead>Sniper</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(() => {
                  // Tahmini teklif hesabı — simulation.py _sample_teklif paralelliği
                  const idareYM = sonuc.yaklasik_maliyet;
                  type RakipTahmin = {
                    r: typeof sonuc.rakipler[number];
                    tahmTenzilat: number;
                    tahmTeklif: number;
                    kaynak: string;
                  };
                  const tahminler: RakipTahmin[] = sonuc.rakipler.map((r) => {
                    let tahmTenzilat: number;
                    let tahmTeklif: number;
                    let kaynak: string;
                    if (r.sniper_idare_match) {
                      // Sniper firma o idarede sınır değer civarında teklif verir.
                      // SD genelde ~%30-35 civarı çıkar, burada ortalama olarak yakınlık veya 30 kullanalım.
                      const yak = r.idare_yakinlik?.ortalama_yakinlik;
                      if (yak) {
                        tahmTeklif = idareYM * yak;
                        tahmTenzilat = (1 - yak) * 100;
                      } else {
                        tahmTenzilat = r.mu;
                        tahmTeklif = idareYM * (1 - r.mu / 100);
                      }
                      kaynak = "Sniper";
                    } else if (r.idare_yakinlik && r.idare_yakinlik.n_ihale >= 2) {
                      // O idarede tarihsel yakınlık
                      const yak = r.idare_yakinlik.ortalama_yakinlik;
                      tahmTeklif = idareYM * yak;
                      tahmTenzilat = (1 - yak) * 100;
                      kaynak = `İdare (${r.idare_yakinlik.n_ihale})`;
                    } else {
                      // Tarihsel tenzilat ortalaması
                      tahmTenzilat = r.mu;
                      tahmTeklif = idareYM * (1 - r.mu / 100);
                      kaynak = `Tarihsel (${r.n_gozlem})`;
                    }
                    return { r, tahmTenzilat, tahmTeklif, kaynak };
                  });
                  // En düşük teklif veren en üstte (en tehlikeli rakip)
                  tahminler.sort((a, b) => a.tahmTeklif - b.tahmTeklif);

                  return tahminler.map(({ r, tahmTenzilat, tahmTeklif, kaynak }, idx) => (
                    <TableRow key={r.firma_kanon} className={idx === 0 ? "bg-red-50/50" : ""}>
                      <TableCell className="max-w-[280px] truncate" title={r.firma_ad}>
                        {idx === 0 && <span className="text-[10px] mr-1">🥇</span>}
                        {r.firma_ad}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="font-semibold text-orange-700">%{tahmTenzilat.toFixed(2)}</span>
                        <div className="text-[10px] text-gray-400">±%{r.sigma.toFixed(1)}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold text-[#1E3A5F]">{formatTL(tahmTeklif)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-gray-600">{kaynak}</span>
                      </TableCell>
                      <TableCell className="text-[11px] text-gray-500">{r.n_gozlem}</TableCell>
                      <TableCell>
                        {r.sniper_idare_match ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                            🎯 Sniper
                          </span>
                        ) : r.is_sniper ? (
                          <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                            Sniper (başka idare)
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ));
                })()}
              </TableBody>
            </Table>
          </div>

          {/* Bu idarenin geçmiş ihaleleri — şeffaflık için */}
          {sonuc.idare_gecmis && sonuc.idare_gecmis.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-700">
                  📂 Bu İdaredeki Geçmiş İhaleler ({sonuc.idare_gecmis.length})
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Sistemin tahminleri <strong>bu tablodaki ihalelerden</strong> türetildi. Sizin ve diğer firmaların geçmiş davranışları analiz edildi.
                  Tüm verileri burada görerek sonuçları doğrulayabilirsiniz.
                </p>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>İş</TableHead>
                    <TableHead className="text-center">Tarih</TableHead>
                    <TableHead className="text-right">İdare YM</TableHead>
                    <TableHead className="text-right">Bizim YM</TableHead>
                    <TableHead className="text-right">Sınır Değer</TableHead>
                    <TableHead className="text-right">Bizim Teklif</TableHead>
                    <TableHead>Kazanan</TableHead>
                    <TableHead className="text-right">Kazanan Tutar</TableHead>
                    <TableHead className="text-center">Katılımcı</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sonuc.idare_gecmis.map((g, idx) => {
                    const oran = g.bizim_ym && g.resmi_ym && g.bizim_ym > 0
                      ? (g.resmi_ym / g.bizim_ym)
                      : null;
                    return (
                      <TableRow key={idx} className={g.bizim_katildik ? "bg-emerald-50/30" : ""}>
                        <TableCell className="max-w-[260px] truncate text-xs" title={g.is_adi}>
                          {g.bizim_katildik && <span className="text-[10px] mr-1">✅</span>}
                          {g.is_adi}
                        </TableCell>
                        <TableCell className="text-center text-[11px] text-gray-500 whitespace-nowrap">
                          {g.ihale_tarihi ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px]">
                          {g.resmi_ym != null ? formatTL(g.resmi_ym) : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px]">
                          {g.bizim_ym != null ? (
                            <span title={oran ? `Oran: ${oran.toFixed(4)} (idare ${((oran - 1) * 100).toFixed(1)}%)` : undefined}>
                              {formatTL(g.bizim_ym)}
                              {oran != null && (
                                <span className="block text-[9px] text-gray-400">
                                  oran {oran.toFixed(3)}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-[10px] italic">girilmedi</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] text-blue-700">
                          {g.sinir_deger != null ? formatTL(g.sinir_deger) : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px]">
                          {g.bizim_teklif != null ? (
                            <span className="text-emerald-700 font-semibold">
                              {formatTL(g.bizim_teklif)}
                              {g.bizim_tenzilat != null && (
                                <span className="block text-[9px] text-gray-400">
                                  %{g.bizim_tenzilat.toFixed(1)} tenz.
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-[10px]">—</span>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-[11px]" title={g.muhtemel_kazanan ?? undefined}>
                          {g.muhtemel_kazanan ?? <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-[11px] text-orange-700">
                          {g.muhtemel_kazanan_tutar != null ? formatTL(g.muhtemel_kazanan_tutar) : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-center text-[11px] text-gray-500">
                          {g.katilimci_sayisi}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <p className="px-4 py-2 text-[10px] text-gray-500 bg-gray-50">
                ✅ = Biz teklif vermiş ihale. Oran = İdare YM ÷ Bizim YM — bu idarenin sizin hesabınızdan ne kadar farklı YM açıkladığını gösterir.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Metrik({
  label,
  value,
  color,
  bold = false,
}: {
  label: string;
  value: string;
  color: "red" | "emerald";
  bold?: boolean;
}) {
  const colorMap = {
    red: "text-red-700",
    emerald: "text-emerald-700",
  };
  return (
    <div className="bg-white rounded-lg p-3 border border-gray-100">
      <div className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        {label}
      </div>
      <div className={`text-lg ${bold ? "font-bold" : "font-semibold"} ${colorMap[color]} mt-1`}>
        {value}
      </div>
    </div>
  );
}
