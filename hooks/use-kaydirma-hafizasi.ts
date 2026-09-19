// KAYDIRMA HAFIZASI — F5'te ızgaranın kaldığı yerden devam etmesi için.
//
// Puantaj ızgarası kendi kutusunda kayıyor (overflow-auto). Tarayıcı yalnız SAYFA kaydırmasını
// geri yükler, iç kutularınkini yüklemez; üstelik veri sonradan geldiği için yükseklik de
// sayfa açılırken hazır olmuyor. Sonuç: her yenilemede ızgara en başa dönüyordu ve kullanıcı
// aradığı aracı yeniden bulmak zorunda kalıyordu.
//
// Hem DİKEY hem YATAY konum saklanır (ayın ortasındaki günlere kaydırılmış tablo da yerinde kalsın).
// Değer sessionStorage'da tutulur: F5'te yaşar, sekme kapanınca silinir — filtrelerle aynı mantık.
//
// Geri yükleme veri HAZIR olunca yapılır; içerik yoksa yükseklik de olmadığı için tarayıcı
// scrollTop'u sıfıra kırpardı. İki kare denenir (ilk karede satırlar henüz ölçülmemiş olabiliyor).
"use client";

import { useCallback, useEffect, useRef } from "react";

const ONEK = "ikikat-kaydirma:";

export function useKaydirmaHafizasi<T extends HTMLElement = HTMLDivElement>(
  anahtar: string,
  hazir: boolean,
) {
  const ref = useRef<T | null>(null);
  const yuklendi = useRef(false);
  const tamAnahtar = ONEK + anahtar;

  // Kaydırdıkça sakla — her olayda yazmamak için kareye bağla.
  const kaydet = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    try {
      window.sessionStorage.setItem(tamAnahtar, `${Math.round(el.scrollTop)}|${Math.round(el.scrollLeft)}`);
    } catch { /* sessionStorage kapalı → hafıza çalışmaz, sayfa çalışır */ }
  }, [tamAnahtar]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let bekleyen = 0;
    const dinle = () => {
      if (bekleyen) return;
      bekleyen = requestAnimationFrame(() => { bekleyen = 0; kaydet(); });
    };
    el.addEventListener("scroll", dinle, { passive: true });
    return () => {
      el.removeEventListener("scroll", dinle);
      if (bekleyen) cancelAnimationFrame(bekleyen);
    };
  }, [kaydet, hazir]);

  // Veri gelince bir kez geri yükle.
  useEffect(() => {
    if (!hazir || yuklendi.current) return;
    const el = ref.current;
    if (!el) return;
    let ham: string | null = null;
    try { ham = window.sessionStorage.getItem(tamAnahtar); } catch { return; }
    if (!ham) { yuklendi.current = true; return; }
    const [ust, sol] = ham.split("|").map((x) => parseInt(x, 10));
    if (!Number.isFinite(ust)) { yuklendi.current = true; return; }
    yuklendi.current = true;
    const uygula = () => {
      const e = ref.current;
      if (!e) return;
      e.scrollTop = ust;
      if (Number.isFinite(sol)) e.scrollLeft = sol;
    };
    // İlk karede satırlar henüz ölçülmemiş olabiliyor → ikinci karede bir daha dene.
    const k1 = requestAnimationFrame(() => { uygula(); requestAnimationFrame(uygula); });
    return () => cancelAnimationFrame(k1);
  }, [hazir, tamAnahtar]);

  return ref;
}
