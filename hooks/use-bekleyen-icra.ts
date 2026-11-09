"use client";

// Menüdeki "İcra Dosyaları" rozetinin sayısı: ELE ALINMAMIŞ icra işi.
//
// NİYE BU KÜME: tebligat rozeti gibi bu da "senden bir şey bekliyor" demek. İki defter
// var, ikisinde bekleyen iş başka şey:
//
//   · Üçüncü Şahıs Hacizleri → İCRAYA CEVAP VERİLMEMİŞ dosyalar
//     (cevap_tarihi boş). Haciz kaldırma yazısı gelmiş dosyalar sayılmaz: orada artık
//     cevaplanacak bir şey yok.
//   · Şirkete Açılan Takipler → durum "yeni" olanlar, yani henüz hiçbir şey yapılmamış
//     ödeme emirleri. Avukata verilen / itiraz edilen / ödenen dosya sayılmaz — iş
//     görülmüştür; sayılsa rozet hiç düşmez ve bakılmaz hale gelir.
//
// ROZET LİSTEYE BAKINCA SİLİNMEZ: sayı, yapılacak işin kendisine bağlı. Cevap tarihi
// girilince / dosyanın durumu değişince kendiliğinden düşer.
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Rozetin hemen tazelenmesi için: icra kaydı değişince bunu fırlat. */
export const ICRA_DEGISTI = "icra-degisti";
export function icraDegisti() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ICRA_DEGISTI));
}

/** Sayılar ayrı ayrı: menü rozeti toplamı, sekme rozetleri kendi kalemini gösterir. */
export type BekleyenIcra = { ucuncuSahis: number; sirket: number; toplam: number };
const BOS: BekleyenIcra = { ucuncuSahis: 0, sirket: 0, toplam: 0 };

export function useBekleyenIcra(etkin: boolean): BekleyenIcra {
  const [sayi, setSayi] = useState<BekleyenIcra>(BOS);

  const say = useCallback(async () => {
    const sb = createClient();
    // head + exact: satırlar indirilmez, yalnız sayı gelir.
    const [ucuncuSahis, sirket] = await Promise.all([
      sb.from("icra").select("id", { count: "exact", head: true })
        .is("cevap_tarihi", null).is("haciz_kaldirma_tarihi", null),
      sb.from("icra_sirket_takip").select("id", { count: "exact", head: true })
        .eq("durum", "yeni"),
    ]);
    // Sayı okunamazsa 0 GÖSTERME: "bekleyen iş yok" diye okunur. Eldeki sayı kalsın,
    // sebep konsola düşsün. Şirket tablosu Supabase'de henüz kurulmadıysa (sql dosyası
    // çalıştırılmadıysa) o kalem 0 sayılır ama üçüncü şahıs sayısı gösterilmeye devam eder.
    if (ucuncuSahis.error) { console.warn("Cevapsız icra dosyası sayılamadı:", ucuncuSahis.error.message); return; }
    if (sirket.error) console.warn("Şirkete açılan takip sayılamadı:", sirket.error.message);
    const u = ucuncuSahis.count ?? 0;
    const k = sirket.count ?? 0;
    setSayi({ ucuncuSahis: u, sirket: k, toplam: u + k });
  }, []);

  useEffect(() => {
    if (!etkin) return;
    void (async () => { await say(); })();
    const onFocus = () => void say();
    window.addEventListener("focus", onFocus);
    window.addEventListener(ICRA_DEGISTI, onFocus);
    const t = setInterval(() => void say(), 5 * 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(ICRA_DEGISTI, onFocus);
      clearInterval(t);
    };
  }, [etkin, say]);

  return etkin ? sayi : BOS;
}
