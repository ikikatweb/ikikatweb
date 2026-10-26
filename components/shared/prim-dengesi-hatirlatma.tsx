"use client";

// SGK PRİM DENGESİ uyarısı — iki yönlü.
//
//  • EKSİK: işin bitimine kadar mevcut kadroyla prim dolmayacak → kaç kişi EKLENMELİ.
//  • FAZLA: prim doldu ya da bitimden önce dolacak → kaç kişi ÇIKARILABİLİR.
//
// Fazla ödeme doğrudan para kaybı olduğu için eksik kadar önemli; ikisi de aynı şeritte.
// Kişi sayıları iki sınırı gözetir:
//   – teknik personel tabanı (sözleşme şartı, altına inilemez),
//   – çalışılmayan dönem (o günlerde prim üretilmez; takvim gün gün yürütülür).
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, UserPlus, UserMinus } from "lucide-react";
import { useAuth } from "@/hooks";
import { kayitGorunur } from "@/lib/utils/santiye-filtre";
import { getPrimDengeleri, type PrimDengeSatiri } from "@/lib/supabase/queries/prim-dengesi";
import { damgala, anaEkrandaGosterildiIsaretle } from "@/lib/bordro/prim-dengesi-gorulen";

const tl = (n: number) => Math.round(n).toLocaleString("tr-TR") + " ₺";
const tarih = (g: string) => new Date(g + "T00:00:00").toLocaleDateString("tr-TR");

export default function PrimDengesiHatirlatma({ mod = "ana-ekran" }: {
  /** "ana-ekran": her iş BİR KEZ gösterilir, sonra düşer — listeye yeni iş girerse
   *  yalnız o görünür. "sayfa": Bordro Takibi'nde her zaman tamamı görünür. */
  mod?: "ana-ekran" | "sayfa";
} = {}) {
  const { hasPermission, kullanici } = useAuth();
  // Bordro yetkisi olanlar görür — kişi ekleme/çıkarma kararını onlar veriyor.
  const yetkili = hasPermission("bordro-takibi", "goruntule");
  const [satirlar, setSatirlar] = useState<PrimDengeSatiri[]>([]);
  // Bu sayfa açılışında ana ekranda gösterilen işler — tazelemede kaybolmasınlar.
  const buAcilistaGosterilen = useRef<Set<string>>(new Set());

  const kontrol = useCallback(async () => {
    if (!yetkili || !kullanici?.id) { setSatirlar([]); return; }
    const veri = (await getPrimDengeleri()).filter((s) => kayitGorunur(s.santiyeId, kullanici));
    // Damga: yeni girenlere zaman damgası, listeden çıkanları depodan sil.
    const depo = damgala(kullanici.id, veri.map((s) => s.santiyeId));
    // LİSTEYE EN SON GİREN EN ÜSTTE.
    const sirali = [...veri].sort((a, b) =>
      (depo[b.santiyeId]?.ilkGorulme ?? "").localeCompare(depo[a.santiyeId]?.ilkGorulme ?? ""));
    if (mod === "sayfa") { setSatirlar(sirali); return; }
    // Ana ekran: yalnız HENÜZ GÖSTERİLMEMİŞ olanlar.
    // BU AÇILIŞTA gösterilenler listede KALIR: aksi hâlde kontrol ikinci kez çalışınca
    // (odak/görünürlük olayı) uyarı kendi işaretlediğini eleyip gözden kayboluyordu.
    // Sayfadan çıkılıp dönüldüğünde artık çıkmaz — istenen davranış bu.
    const yeni = sirali.filter(
      (s) => !depo[s.santiyeId]?.anaEkrandaGosterildi || buAcilistaGosterilen.current.has(s.santiyeId),
    );
    for (const s of yeni) buAcilistaGosterilen.current.add(s.santiyeId);
    setSatirlar(yeni);
    // İŞARETLEME EKRANDAN ÇIKARKEN yapılır (aşağıdaki effect), burada DEĞİL:
    // React geliştirme kipinde bileşeni iki kez bağlıyor; hemen işaretlersek ikinci
    // bağlanma kendi işaretlediğini eleyip uyarı hiç görünmüyordu.
  }, [yetkili, kullanici, mod]);

  useEffect(() => {
    void kontrol();
    const onFocus = () => void kontrol();
    const onGorunur = () => { if (document.visibilityState === "visible") void kontrol(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onGorunur);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onGorunur);
    };
  }, [kontrol]);

  // Ana ekrandan AYRILIRKEN gösterilenleri "görüldü" say. Böylece kullanıcı sayfada
  // kaldığı sürece uyarı durur, bir dahaki girişte çıkmaz.
  useEffect(() => {
    if (mod !== "ana-ekran") return;
    const kid = kullanici?.id;
    const kume = buAcilistaGosterilen.current;
    const isaretle = () => { if (kid && kume.size > 0) anaEkrandaGosterildiIsaretle(kid, [...kume]); };
    // pagehide: sekme kapatma ve SERT sayfa geçişi (tam yükleme). Bu durumlarda React
    // temizliği çalışmıyor ve uyarı "görüldü" sayılmadan kalıyordu.
    window.addEventListener("pagehide", isaretle);
    return () => {
      window.removeEventListener("pagehide", isaretle);
      isaretle();   // uygulama içi (client-side) geçişler
    };
  }, [mod, kullanici?.id]);

  if (!yetkili || satirlar.length === 0) return null;

  const eksik = satirlar.filter((s) => s.durum === "eksik");
  const fazla = satirlar.filter((s) => s.durum === "fazla");

  return (
    <div className="mb-4 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-orange-900 shadow-sm">
      <div className="flex items-center gap-3">
        <AlertTriangle size={22} className="shrink-0 text-orange-600" />
        <div className="flex-1">
          <div className="font-semibold">
            ⚠️ {satirlar.length} işte SGK prim dengesi bozuk{mod === "ana-ekran" ? " (yeni)" : ""}
            {eksik.length > 0 && fazla.length > 0 && (
              <span className="ml-2 text-xs font-normal text-orange-700">
                ({eksik.length} eksik kalacak · {fazla.length} fazla ödeniyor)
              </span>
            )}
          </div>
          <div className="text-xs text-orange-700">
            Hesap, işin bitimine kadar ÇALIŞILAN günler üzerinden; teknik personel tabanı korunur.
            {mod === "ana-ekran" && " Tamamı Bordro Takibi sayfasında."}
          </div>
        </div>
      </div>

      <ul className="mt-2 space-y-1.5 pl-9 text-sm">
        {satirlar.map((s) => (
          <li key={s.santiyeId} className="flex flex-wrap items-baseline gap-x-1.5">
            {s.durum === "eksik"
              ? <UserPlus size={13} className="shrink-0 text-emerald-600" />
              : <UserMinus size={13} className="shrink-0 text-red-600" />}
            <span className="font-medium text-orange-950">{s.santiyeAd.slice(0, 50)}</span>

            {s.durum === "eksik" && s.isBitti ? (
              <>
                {/* İŞ BİTMİŞ: prim artık çalışmayla dolmaz. "Kişi ekleyin" demek anlamsız;
                    eksik tutar bildirilir, çözümü bordro dışında (ek bildirge vb.). */}
                <span>iş {tarih(s.bitimTarihi)}&apos;de bitti,</span>
                <span className="font-bold text-red-700">{tl(s.kalanPrim)}</span>
                <span>prim eksik kaldı</span>
                <span className="text-xs text-orange-700">
                  ({s.aktifKisi > 0 ? `${s.aktifKisi} sigortalı duruyor` : "sigortalı kalmadı"})
                </span>
              </>
            ) : s.durum === "eksik" ? (
              <>
                <span>bitime ({tarih(s.bitimTarihi)}, {s.kalanCalismaGunu} çalışma günü) kadar</span>
                <span className="font-bold text-red-700">{tl(s.kalanPrim)}</span>
                <span>prim dolmayacak —</span>
                {/* EYLEM RENGİ: ekleme yeşil, çıkarma kırmızı. Tutarlar kendi
                    anlamlarının rengini korur (eksik prim kırmızı, fazla ödeme amber). */}
                <span className="font-bold text-emerald-700">
                  {s.kisiFarki > 0 ? `${s.kisiFarki} kişi ekleyin` : "sigortalı girin"}
                </span>
              </>
            ) : s.fazlaTutar > 0 ? (
              <>
                <span>primi doldu,</span>
                <span className="font-bold text-amber-800">{tl(s.fazlaTutar)}</span>
                <span>fazla ödendi —</span>
                {/* Çıkarılacak kişi 0 olabilir: sigortalıların HEPSİ teknik personelse
                    sözleşme gereği hiçbiri çıkarılamaz. "0 kişi çıkarın" demek saçma olurdu. */}
                {s.kisiFarki > 0 ? (
                  <>
                    <span className="font-bold text-red-700">{s.kisiFarki} kişi çıkarın</span>
                    <span className="text-xs text-orange-700">({s.aktifKisi} sigortalıdan)</span>
                  </>
                ) : (
                  <span className="font-semibold text-amber-800">
                    çıkarılabilecek kişi yok — {s.aktifKisi} sigortalının hepsi teknik personel
                  </span>
                )}
              </>
            ) : (
              <>
                <span>primi</span>
                <span className="font-semibold text-amber-800">{s.dolmaTarihi ? tarih(s.dolmaTarihi) : "—"}</span>
                <span>dolacak, iş {tarih(s.bitimTarihi)}'de bitiyor —</span>
                {s.kisiFarki > 0 ? (
                  <>
                    <span className="font-bold text-red-700">{s.kisiFarki} kişi çıkarın</span>
                    <span className="text-xs text-orange-700">({s.aktifKisi} sigortalıdan)</span>
                  </>
                ) : (
                  <span className="font-semibold text-amber-800">
                    çıkarılabilecek kişi yok — {s.aktifKisi} sigortalının hepsi teknik personel
                  </span>
                )}
              </>
            )}

            {s.tabanEngeli > 0 && (
              <span className="text-[11px] text-orange-600" title="Sözleşme gereği bu kadar teknik personel kalmalı">
                · {s.tabanEngeli} teknik personel kalmalı
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
