"use client";

// Menüdeki kırmızı rozetin sayısı: AÇILMAMIŞ e-tebligat adedi.
//
// Rozet, ana ekrandaki uyarıyla AYNI kümeyi sayar (bkz. components/shared/tebligat-hatirlatma):
//   durum = delivered   → UETS'te henüz açılmamış
//   durum = readtimeout → 5 gün açılmadı, otomatik okundu sayıldı (arşivlenmemişse)
//
// ROZET LİSTEYE BAKINCA SİLİNMEZ. iPhone'da bildirimi açınca rozet gider; burada
// "açmak" demek tebligatı UETS'te açmak demektir, çünkü süre açılsa da açılmasa da
// işliyor (7201 s. K. 7/a). Listeyi görmek tebligatı okumak değildir; rozetin orada
// kalması kasıtlı. Tebligat UETS'te açılınca durum "read" olur ve rozet kendiliğinden
// düşer; süresi dolmuşlarda "Gördüm" düğmesi aynı işi görür.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Rozet sayısının hemen tazelenmesi için: tebligat durumu değişince bunu fırlat. */
export const TEBLIGAT_DEGISTI = "tebligat-degisti";
export function tebligatDegisti() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TEBLIGAT_DEGISTI));
}

export function useOkunmamisTebligat(etkin: boolean): number {
  const [sayi, setSayi] = useState(0);

  const say = useCallback(async () => {
    const sb = createClient();
    // head + exact: satırlar indirilmez, yalnız sayı gelir — menü her açılışta ucuz kalsın.
    const { count, error } = await sb
      .from("tebligat")
      .select("id", { count: "exact", head: true })
      .in("durum", ["delivered", "readtimeout"])
      .eq("arsivlendi", false);
    // Sayı okunamazsa 0 GÖSTERME: "tebligat yok" diye okunur. Eldeki sayı kalsın,
    // sebep konsola düşsün — rozet menüyü kilitleyecek bir şey değil.
    if (error) { console.warn("Okunmamış tebligat sayılamadı:", error.message); return; }
    setSayi(count ?? 0);
  }, []);

  useEffect(() => {
    if (!etkin) return;   // yetkisi yoksa sorgu da yok; sayı aşağıda 0'lanıyor
    // İlk sayım async IIFE içinde: React Compiler kuralı, efekt gövdesinde senkron
    // görünen setState çağrısını reddediyor (react-hooks/set-state-in-effect).
    void (async () => { await say(); })();
    const onFocus = () => void say();
    window.addEventListener("focus", onFocus);
    window.addEventListener(TEBLIGAT_DEGISTI, onFocus);
    // Çekme işi 2 saatte bir çalışıyor; sayfa açık bırakılırsa rozet de aynı gün içinde
    // kendiliğinden güncellensin diye 5 dakikada bir bakılıyor (tek satırlık sayım).
    const t = setInterval(() => void say(), 5 * 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(TEBLIGAT_DEGISTI, onFocus);
      clearInterval(t);
    };
  }, [etkin, say]);

  // Yetki yoksa elde kalmış eski sayı gösterilmesin.
  return etkin ? sayi : 0;
}
