// İCRA DOSYALARI — sayfa-içi üç sekme.
//
// SAYFA ADI NİYE "İCRA TAKİBİ" DEĞİL: artık iki ayrı defter var ve ikisinde ŞİRKETİN
// ROLÜ TERS. "İcra Takibi" tek defteri anlatıyordu, ikincisi eklenince hangisini
// kastettiği belirsizleşti. İki defteri de kapsayan ad "İcra Dosyaları".
//
//   · Üçüncü Şahıs Hacizleri   → borçlu bir BAŞKASI, şirket üçüncü şahıs (işveren).
//                                 89/1 haciz ihbarnamesi, maaş haczi müzekkeresi.
//                                 İzlenen şey: icraya cevap ve evrak no.
//   · Şirkete Açılan Takipler  → borçlu ŞİRKETİN KENDİSİ. Ödeme emri.
//                                 İzlenen şey: itiraz süresi, itiraz ve ödeme.
//   · Tanımlamalar             → Cevap Şekli seçenekleri.
"use client";

import { useEffect, useRef } from "react";
import { useAuth, useOturumFiltresi, useBekleyenIcra } from "@/hooks";
import IcraTablosu from "@/components/shared/icra-tablosu";
import IcraSirketTablosu from "@/components/shared/icra-sirket-tablosu";
import IcraTanimlamalar from "@/components/shared/icra-tanimlamalar";
import { Gavel, ListChecks, Scale } from "lucide-react";

export default function IcraPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("icra", "goruntule");
  const canEkle = isYonetici || hasPermission("icra", "ekle");
  const canDuzenle = isYonetici || hasPermission("icra", "duzenle");
  const canSil = isYonetici || hasPermission("icra", "sil");
  const [sekme, setSekme] = useOturumFiltresi<"takip" | "sirket" | "tanim">("icra:sekme", "takip");
  const bekleyen = useBekleyenIcra(gor);

  // Bildirimden/başka ekrandan "?sekme=sirket&duzenle=<id>" ile gelinince doğru sekme açılsın —
  // yoksa bağlantı üçüncü şahıs defterine düşer ve dosya "yok" görünür.
  const sekmeAyarlandi = useRef(false);
  useEffect(() => {
    if (sekmeAyarlandi.current || typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("sekme");
    if (s === "sirket" || s === "takip" || s === "tanim") { sekmeAyarlandi.current = true; setSekme(s); }
  }, [setSekme]);

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  // SEKME ROZETLERİ: menüdeki tek yuvarlak sayı burada ikiye ayrılır — hangi defterde
  // kaç iş beklediği sekmeye girmeden görünsün. Toplamları menü rozetiyle aynıdır.
  const sekmeler = [
    { id: "takip" as const, label: "Üçüncü Şahıs Hacizleri", icon: <Gavel size={15} />,
      rozet: bekleyen.ucuncuSahis, baslik: `${bekleyen.ucuncuSahis} dosyada icraya cevap verilmemiş` },
    { id: "sirket" as const, label: "Şirkete Açılan Takipler", icon: <Scale size={15} />,
      rozet: bekleyen.sirket, baslik: `${bekleyen.sirket} ödeme emri henüz ele alınmadı` },
    { id: "tanim" as const, label: "Tanımlamalar", icon: <ListChecks size={15} />, rozet: 0, baslik: "" },
  ];

  return (
    <div>
      {/* Sayfa-içi sekme çubuğu */}
      <div className="inline-flex items-center rounded-lg border border-gray-200 bg-gray-50 p-1 mb-4">
        {sekmeler.map((s) => (
          <button key={s.id} type="button" onClick={() => setSekme(s.id)}
            className={`flex items-center gap-1.5 px-3.5 h-9 rounded-md text-sm font-medium transition-colors ${
              sekme === s.id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"
            }`}>
            {s.icon} {s.label}
            {s.rozet > 0 && (
              <span title={s.baslik} aria-label={s.baslik}
                className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none ${
                  sekme === s.id ? "bg-white text-[#1E3A5F]" : "bg-red-600 text-white"
                }`}>
                {s.rozet > 99 ? "99+" : s.rozet}
              </span>
            )}
          </button>
        ))}
      </div>

      {sekme === "takip" ? (
        <IcraTablosu canEkle={canEkle} canDuzenle={canDuzenle} canSil={canSil} />
      ) : sekme === "sirket" ? (
        <IcraSirketTablosu canEkle={canEkle} canDuzenle={canDuzenle} canSil={canSil} />
      ) : (
        <IcraTanimlamalar canEkle={canEkle} canDuzenle={canDuzenle} canSil={canSil} />
      )}
    </div>
  );
}
