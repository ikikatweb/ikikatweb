// Arvento "Tümü" sekmesi — o gün içindeki bütün operasyonları (Reglaj/Serme greyder
// çizgisi, Sıkıştırma silindir zikzak çizgisi, Stabilize damper noktaları) TEK haritada
// üst üste gösterir. Renkli lejant ile hangi rengin hangi operasyon olduğu belirtilir.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getGuzergahByTarih, getArventoRaporByTarih } from "@/lib/supabase/queries/arvento";
import { sadelesGuzergah } from "@/lib/arvento/guzergah-sadelestir";
import { ekleHaritaKatmanlari } from "@/lib/arvento/harita-katman";
import { OPERASYONLAR, sinifEslesir, zikzakla } from "@/lib/arvento/operasyonlar";
import type { AracArventoGuzergah, AracArventoRapor } from "@/lib/supabase/types";
import { Layers } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

type DamperOlay = { saat: string | null; adres: string | null; lat?: number | null; lng?: number | null };

function formatTarih(t: string | null): string {
  if (!t) return "—";
  const d = new Date(t + "T00:00:00");
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

export default function ArventoTumu({ tarih, tekrarEsigi = 0, silindirEsik = 0, gridMesafe = 12, guzergahMesafe = 30, refreshKey = 0 }: { tarih: string; tekrarEsigi?: number; silindirEsik?: number; gridMesafe?: number; guzergahMesafe?: number; refreshKey?: number }) {
  const [guzergahlar, setGuzergahlar] = useState<AracArventoGuzergah[]>([]);
  const [raporlar, setRaporlar] = useState<AracArventoRapor[]>([]);
  const [loading, setLoading] = useState(true);
  const mapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tarih) { setGuzergahlar([]); setRaporlar([]); setLoading(false); return; }
    setLoading(true);
    Promise.all([getGuzergahByTarih(tarih), getArventoRaporByTarih(tarih)])
      .then(([g, r]) => { setGuzergahlar(g); setRaporlar(r); })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("does not exist")) toast.error("Tablo yok — SQL'i çalıştırın.", { duration: toastSuresi() });
      })
      .finally(() => setLoading(false));
  }, [tarih, refreshKey]);

  // Katman özeti (kaç greyder / silindir çizgisi, kaç damper)
  const ozet = useMemo(() => {
    const greyder = guzergahlar.filter((k) => sinifEslesir(k.arac_sinifi, "reglaj", k.plaka)).length;
    const silindir = guzergahlar.filter((k) => sinifEslesir(k.arac_sinifi, "sikistirma", k.plaka)).length;
    let damper = 0;
    for (const r of raporlar) for (const o of (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[]) if (o.lat != null && o.lng != null) damper++;
    return { greyder, silindir, damper };
  }, [guzergahlar, raporlar]);

  useEffect(() => {
    if (!tarih) return;
    let iptal = false;
    let map: LeafletMap | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (iptal || !mapRef.current) return;
      map = L.map(mapRef.current).setView([39, 35], 6);
      ekleHaritaKatmanlari(L, map, "uydu");
      const bounds: [number, number][] = [];
      // Güzergah çizgileri — sınıfa göre operasyon rengi/stili
      guzergahlar.forEach((k) => {
        const noktalar = (k.noktalar ?? []).filter((p) => p.lat != null && p.lng != null);
        const latlngs: [number, number][] = noktalar.map((p) => [p.lat, p.lng]);
        if (latlngs.length === 0) return;
        const op = sinifEslesir(k.arac_sinifi, "sikistirma", k.plaka) ? "sikistirma"
          : sinifEslesir(k.arac_sinifi, "reglaj", k.plaka) ? "reglaj" : null;
        if (!op) return; // tanınmayan sınıf → çizme
        const def = OPERASYONLAR[op];
        // Greyder → Güzergah Tekrar Eşiği, Silindir → Silindir Tekrar Eşiği
        const esik = op === "sikistirma" ? silindirEsik : tekrarEsigi;
        const cizim: [number, number][][] = gridMesafe > 0
          ? sadelesGuzergah(noktalar, esik, gridMesafe, guzergahMesafe).parcalar
          : [latlngs];
        (cizim.length ? cizim : [latlngs]).forEach((seg) =>
          L.polyline(def.zikzak ? zikzakla(seg) : seg, { color: def.renk, weight: 3.5, opacity: 0.85 })
            .addTo(map!).bindPopup(`<b>${k.plaka}</b><br>${def.ad} · ${k.arac_sinifi ?? ""}`));
        for (const ll of latlngs) bounds.push(ll);
      });
      // Damper noktaları (Stabilize) — turuncu yuvarlak
      raporlar.forEach((r) => {
        const olaylar = (Array.isArray(r.damper_olaylar) ? r.damper_olaylar : []) as DamperOlay[];
        olaylar.filter((o) => o.lat != null && o.lng != null).forEach((o) => {
          L.circleMarker([o.lat as number, o.lng as number], { radius: 6, color: "#9a3412", fillColor: OPERASYONLAR.stabilize.renk, fillOpacity: 0.9, weight: 1 })
            .addTo(map!).bindPopup(`<b>🔻 ${r.plaka}</b><br>Stabilize (damper)<br>${o.saat ?? ""}<br>${o.adres ?? ""}`);
          bounds.push([o.lat as number, o.lng as number]);
        });
      });
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
      setTimeout(() => { try { map?.invalidateSize(); } catch { /* sessiz */ } }, 150);
    })();
    return () => { iptal = true; if (map) { try { map.remove(); } catch { /* sessiz */ } } };
  }, [tarih, guzergahlar, raporlar, tekrarEsigi, silindirEsik, gridMesafe, guzergahMesafe]);

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!tarih) {
    return (
      <div className="text-center py-16 bg-white rounded-lg border">
        <Layers size={48} className="mx-auto text-gray-300 mb-4" />
        <p className="text-gray-500">Yukarıdan bir tarih seçin.</p>
      </div>
    );
  }
  const veriYok = guzergahlar.length === 0 && ozet.damper === 0;

  return (
    <div className="space-y-3">
      {/* Lejant + özet */}
      <div className="bg-white rounded-lg border p-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="text-xs font-semibold text-gray-600">{formatTarih(tarih)} — Tüm operasyonlar</span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-4 h-1.5 rounded" style={{ background: OPERASYONLAR.reglaj.renk }} />
          Reglaj / Serme (greyder) <strong className="text-gray-500">· {ozet.greyder} çizgi</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-4 h-1.5 rounded" style={{ background: OPERASYONLAR.sikistirma.renk }} />
          Sıkıştırma (silindir, zikzak) <strong className="text-gray-500">· {ozet.silindir} çizgi</strong>
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-3 h-3 rounded-full border border-orange-800" style={{ background: OPERASYONLAR.stabilize.renk }} />
          Stabilize (damper) <strong className="text-gray-500">· {ozet.damper} nokta</strong>
        </span>
      </div>

      {veriYok ? (
        <div className="text-center py-16 bg-white rounded-lg border">
          <Layers size={48} className="mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500">{formatTarih(tarih)} için operasyon verisi yok. Mesafe Bilgisi / damper raporlarını yükleyin.</p>
        </div>
      ) : (
        <div ref={mapRef} className="w-full rounded-lg border bg-gray-100" style={{ height: "66vh" }} />
      )}
    </div>
  );
}
