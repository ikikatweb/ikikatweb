"use client";

// Dashboard uyarısı: GEÇİCİ KABUL DİLEKÇESİ verilmiş ama işin SGK primi tamamlanmamış.
//
// Kabul süreci başladıktan sonra eksik prim fark edilirse geç olur. Dilekçe yazılırken de
// aynı uyarı çıkıyor (giden evrak formunda, kaydetmeden önce onay); bu banner "kaydettik
// ama prim hâlâ eksik" durumunu açıkta tutar.
//
// Veri evrakın kendisinden türetiliyor — şantiyeye kopyalanan ayrı bir alan yok.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, FileText, X } from "lucide-react";
import { useAuth } from "@/hooks";
import { kayitGorunur } from "@/lib/utils/santiye-filtre";
import {
  getGeciciKabulPrimEksikleri, getDilekceMetni, type GeciciKabulPrimEksik,
} from "@/lib/supabase/queries/gecici-kabul-prim";

const tl = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const tarih = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");

export default function GeciciKabulPrimHatirlatma() {
  const { hasPermission, kullanici } = useAuth();
  const yetkili = hasPermission("iscilik-takibi", "goruntule") || hasPermission("yazismalar", "goruntule");
  const [kayitlar, setKayitlar] = useState<GeciciKabulPrimEksik[]>([]);
  // Dilekçe önizlemesi — sayfa DEĞİŞMEZ, metin pencerede okunur.
  const [onizleme, setOnizleme] = useState<{ konu: string; metin: string | null; tarih: string } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setKayitlar([]); return; }
    const veri = await getGeciciKabulPrimEksikleri();
    // Kısıtlı/şantiye admini: yalnız yetkili olduğu şantiyeler.
    setKayitlar(veri.filter((k) => kayitGorunur(k.santiye_id, kullanici)));
  }, [yetkili, kullanici]);

  useEffect(() => {
    void kontrol();
    const onFocus = () => void kontrol();   // prim yatırılıp dönülünce uyarı kalksın
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [kontrol]);

  const dilekceyiAc = async (evrakId: string) => {
    setYukleniyor(true);
    try {
      const d = await getDilekceMetni(evrakId);
      if (d) setOnizleme(d);
    } finally {
      setYukleniyor(false);
    }
  };

  if (!yetkili || kayitlar.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-amber-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {kayitlar.length} işte geçici kabul dilekçesi verildi, SGK primi eksik
          </div>
          <div className="text-xs text-amber-700">
            Kabul süreci başlamış ama yatması gereken prim tamamlanmamış.
          </div>
        </div>
      </div>
      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {kayitlar.map((k) => (
          <li key={k.evrakId} className="flex flex-wrap items-baseline gap-x-1.5">
            {k.yazan && <span className="font-semibold text-amber-900">{k.yazan}</span>}
            <span className="font-medium text-amber-900">{k.is_adi}</span>
            <span>işi için</span>
            {/* Tıklanınca dilekçe metni pencerede açılır; sayfa değişmez. */}
            <button
              type="button"
              onClick={() => dilekceyiAc(k.evrakId)}
              disabled={yukleniyor}
              className="inline-flex items-center gap-1 font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2 hover:text-amber-700 disabled:opacity-60"
              title="Dilekçeyi oku"
            >
              <FileText size={12} /> geçici kabul
            </button>
            <span>dilekçesi verdi ({tarih(k.dilekceTarihi)}) ancak hâlâ</span>
            <span className="font-bold text-red-700">{tl(k.eksik)}</span>
            <span>yatması gereken prim var!</span>
          </li>
        ))}
      </ul>

      {onizleme && (
        // Basit katman: sayfa değişmeden metni okumak için yeterli.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOnizleme(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-gray-500">{tarih(onizleme.tarih)}</div>
                <h3 className="font-bold text-[#1E3A5F]">{onizleme.konu}</h3>
              </div>
              <button type="button" onClick={() => setOnizleme(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>
            {onizleme.metin ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{onizleme.metin}</p>
            ) : (
              <p className="text-sm text-gray-400">Bu dilekçenin metni kaydedilmemiş (yalnız PDF olarak yüklenmiş olabilir).</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
