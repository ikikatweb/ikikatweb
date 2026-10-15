"use client";

// Dashboard uyarısı: GEÇİCİ KABUL DİLEKÇESİ verilmiş ama işin SGK primi tamamlanmamış.
//
// Kabul süreci başladıktan sonra eksik prim fark edilirse geç olur. Dilekçe yazılırken de
// aynı uyarı çıkıyor (giden evrak formunda, kaydetmeden önce onay); bu banner "kaydettik
// ama prim hâlâ eksik" durumunu açıkta tutar.
//
// Veri evrakın kendisinden türetiliyor — şantiyeye kopyalanan ayrı bir alan yok.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, Minus, Plus, X } from "lucide-react";
import { useAuth } from "@/hooks";
import { kayitGorunur } from "@/lib/utils/santiye-filtre";
import {
  getGeciciKabulDilekceleri, getDilekceOnizleme,
  type GeciciKabulDilekce, type DilekceOnizleme,
} from "@/lib/supabase/queries/gecici-kabul-prim";
import GidenEvrakOnIzleme from "@/components/shared/giden-evrak-onizleme";

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
  // Dilekçe önizlemesi — sayfa DEĞİŞMEZ, evrak pencerede AÇILIR.
  // Düz metin değil, yazdırma önizlemesinin aynısı: gövde HTML olduğu için düz metinde
  // "Geç<i>c</i> kabul" gibi ham etiketler görünüyordu.
  const [onizleme, setOnizleme] = useState<DilekceOnizleme | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const kontrol = useCallback(async () => {
    if (!yetkili) { setDilekceler([]); return; }
    const veri = await getGeciciKabulDilekceleri();
    // Kısıtlı/şantiye admini: yalnız yetkili olduğu şantiyeler.
    setDilekceler(veri.filter((k) => kayitGorunur(k.santiye_id, kullanici)));
  }, [yetkili, kullanici]);

  useEffect(() => {
    void kontrol();
    // Yazışma silinince uyarı DERHÂL kalksın. Banner ana ekranda asılı kaldığı için
    // tek başına mount yetmiyor: sekme değiştirip dönüldüğünde de tazelenir.
    // ("focus" sekme geçişinde her tarayıcıda tetiklenmiyor, visibilitychange tetikleniyor.)
    const onFocus = () => void kontrol();
    const onGorunur = () => { if (document.visibilityState === "visible") void kontrol(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onGorunur);
    // Aynı sekmede silme yapıldığında sayfa değişmeden haber verilir.
    window.addEventListener("yazisma-degisti", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onGorunur);
      window.removeEventListener("yazisma-degisti", onFocus);
    };
  }, [kontrol]);

  // Zoom + pan — kasa defterindeki "Slip Görüntüle" penceresiyle aynı davranış.
  // Başlangıç %70: %60'ta yazı okunmayacak kadar küçük kalıyordu.
  const BASLANGIC = 0.7;
  const [zoom, setZoom] = useState(BASLANGIC);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [suruklenen, setSuruklenen] = useState(false);
  const surukleRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  // Callback ref: wheel dinleyicisi node tam bağlanınca kurulur ({passive:false} şart,
  // yoksa preventDefault çalışmaz ve tekerlek sayfayı kaydırır).
  const wheelTemizle = useRef<(() => void) | null>(null);
  const setViewport = useCallback((node: HTMLDivElement | null) => {
    if (wheelTemizle.current) { wheelTemizle.current(); wheelTemizle.current = null; }
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const adim = e.deltaY < 0 ? 0.15 : -0.15;
      setZoom((z) => Math.max(0.3, Math.min(3, Math.round((z + adim) * 100) / 100)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    wheelTemizle.current = () => node.removeEventListener("wheel", onWheel);
  }, []);
  const sifirla = () => { setZoom(BASLANGIC); setPan({ x: 0, y: 0 }); };

  const dilekceyiAc = async (evrakId: string) => {
    setYukleniyor(true);
    try {
      const d = await getDilekceOnizleme(evrakId);
      if (d) { sifirla(); setOnizleme(d); }
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
            <span className="font-bold text-emerald-700">{tl(k.kalan)}</span>
            <span>yatması gereken prim var!</span>
          </li>
        ))}
      </ul>

      {onizleme && (
        // Basit katman: sayfa değişmeden evrağı okumak için yeterli.
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOnizleme(null)}
          onMouseUp={() => { surukleRef.current = null; setSuruklenen(false); }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-[640px] flex-col rounded-xl bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <h3 className="font-bold text-[#1E3A5F]">Evrak Önizleme — {onizleme.evrak_sayi_no}</h3>
              <button type="button" onClick={() => setOnizleme(null)} className="rounded p-1 text-gray-500 hover:bg-gray-100">
                <X size={18} />
              </button>
            </div>

            {/* Zoom kontrolleri */}
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                type="button" title="Küçült"
                onClick={() => setZoom((z) => Math.max(0.3, Math.round((z - 0.1) * 100) / 100))}
                className="flex h-7 w-7 items-center justify-center rounded border text-gray-700 hover:bg-gray-100"
              ><Minus size={14} /></button>
              <span className="min-w-[56px] rounded bg-gray-100 px-2 py-1 text-center text-sm font-medium tabular-nums">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button" title="Büyüt"
                onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.1) * 100) / 100))}
                className="flex h-7 w-7 items-center justify-center rounded border text-gray-700 hover:bg-gray-100"
              ><Plus size={14} /></button>
              <button
                type="button" onClick={sifirla}
                className="rounded px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
              >Sıfırla</button>
              <span className="ml-1 hidden text-xs text-gray-500 sm:inline">Tekerlek: zoom · Sürükle: kaydır</span>
            </div>

            {/* Görüntü viewport'u — sayfa transform ile ölçeklenir, sürüklenerek kaydırılır */}
            <div
              ref={setViewport}
              className="relative flex-1 select-none overflow-hidden rounded-lg bg-gray-100"
              style={{ minHeight: "60vh", cursor: suruklenen ? "grabbing" : "grab", touchAction: "none" }}
              onMouseDown={(e) => {
                surukleRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
                setSuruklenen(true);
              }}
              onMouseMove={(e) => {
                const d = surukleRef.current;
                if (!d) return;
                setPan({ x: d.panX + (e.clientX - d.x), y: d.panY + (e.clientY - d.y) });
              }}
              onMouseUp={() => { surukleRef.current = null; setSuruklenen(false); }}
              onMouseLeave={() => { surukleRef.current = null; setSuruklenen(false); }}
            >
              <div
                className="absolute left-1/2 top-0 origin-top bg-white shadow-sm"
                style={{
                  width: "210mm",
                  transform: `translateX(-50%) translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: suruklenen ? "none" : "transform 120ms",
                }}
              >
                <GidenEvrakOnIzleme
                  firma={onizleme.firmalar}
                  evrakTarihi={onizleme.evrak_tarihi}
                  tarihGosterim={onizleme.tarih_gosterim}
                  evrakSayiNo={onizleme.evrak_sayi_no}
                  konu={onizleme.konu}
                  muhatap={onizleme.muhatap}
                  ilgiListesi={onizleme.ilgi_listesi}
                  metin={onizleme.metin}
                  ekler={onizleme.ekler}
                  kaseDahil={onizleme.kase_dahil}
                />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
