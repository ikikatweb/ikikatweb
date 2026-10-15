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
  getGeciciKabulDilekceleri, getDilekceMetni, type GeciciKabulDilekce,
} from "@/lib/supabase/queries/gecici-kabul-prim";

/** Ana ekranın Bordro Özeti'nden gelen satır — "Kalan" burada hesaplanmış hâliyle gelir. */
export type PrimSatiri = {
  santiyeId: string;
  santiyeAd: string;
  yatmasiGereken: number;         // tahmini fiyat farkı DÂHİL
  yatmasiGerekenTahminsiz: number;
  yatanPrim: number;
  tahminiBordro: number;
};

const tl = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";
const tarih = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");

export default function GeciciKabulPrimHatirlatma({
  satirlar = [],
  tahminiFFKapali = false,
}: {
  /** Bordro Özeti'nin hesapladığı satırlar — aynı hesap ikinci kez YAZILMAZ. */
  satirlar?: PrimSatiri[];
  tahminiFFKapali?: boolean;
}) {
  const { hasPermission, kullanici } = useAuth();
  // "yazismalar" diye bir yetki anahtarı YOK — gerçek anahtar yazismalar-giden-evrak.
  // Yanlış anahtar hasPermission'da hep false döner ve uyarı yalnız işçilik takibi
  // yetkisi olanlara görünürdü.
  const yetkili = hasPermission("iscilik-takibi", "goruntule")
    || hasPermission("bordro-takibi", "goruntule")
    || hasPermission("yazismalar-giden-evrak", "goruntule");
  const [dilekceler, setDilekceler] = useState<GeciciKabulDilekce[]>([]);
  // Dilekçe önizlemesi — sayfa DEĞİŞMEZ, metin pencerede okunur.
  const [onizleme, setOnizleme] = useState<{ konu: string; metin: string | null; tarih: string } | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setDilekceler([]); return; }
    const veri = await getGeciciKabulDilekceleri();
    // Kısıtlı/şantiye admini: yalnız yetkili olduğu şantiyeler.
    setDilekceler(veri.filter((k) => kayitGorunur(k.santiye_id, kullanici)));
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

  // KALAN = (yatması gereken) − yatan − tahmini bordro. Ana ekrandaki "Kalan" sütununun
  // ta kendisi; tahmini fiyat farkı anahtarı da oradan devralınıyor ki iki yer aynı
  // rakamı göstersin.
  // NOT: satırlar ana ekrandaki Bordro Özeti widget'ından geliyor. O widget kullanıcı
  // ayarlarından KAPATILMIŞSA satırlar boş gelir ve uyarı hesaplanamaz. Rakamın tabloyla
  // birebir tutması için bilinçli bir bağımlılık; aynı hesabı burada tekrar yazmaktansa
  // widget'a bağlı kalmak yeğleniyor.
  const satirMap = new Map(satirlar.map((s) => [s.santiyeId, s]));
  const kayitlar = dilekceler
    .map((d) => {
      const s = satirMap.get(d.santiye_id);
      if (!s) return null;
      const gereken = tahminiFFKapali ? s.yatmasiGerekenTahminsiz : s.yatmasiGereken;
      const kalan = gereken - s.yatanPrim - s.tahminiBordro;
      return { ...d, is_adi: s.santiyeAd, gereken, kalan };
    })
    .filter((x): x is NonNullable<typeof x> => !!x && x.kalan >= 1)   // 1 TL altı yuvarlama
    .sort((a, b) => b.kalan - a.kalan);

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
            <span className="font-bold text-red-700">{tl(k.kalan)}</span>
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
