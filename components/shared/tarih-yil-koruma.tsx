// TARİH YIL KORUMASI — site genelindeki TÜM tarih girişlerinde yılın 4 haneli olmasını zorlar.
// Neden: native <input type="date"> 5-6 haneli yıl kabul ediyor (ör. "20025-11-27", "252026-02-16"
// kasa kayıtlarına girmişti) → sayfa (metin karşılaştırma) ile sunucu (gerçek tarih tipi) aynı kaydı
// farklı yorumlayıp bakiye/rapor tutarsızlığı yaratıyordu. Tek tek formları düzeltmek yerine kök
// layout'a takılan bu bileşen, yakalama fazında (capture) delegasyonla her tarih alanını denetler:
// yıl 4 hane değilse ya da makul aralık (1900–2100) dışındaysa alanı TEMİZLER ve kullanıcıyı uyarır
// (yanlış yılı tahmin edip "düzeltmek" güvenli değil — kullanıcı doğrusunu yeniden girer).
"use client";

import { useEffect } from "react";
import toast from "react-hot-toast";

const TARIH_TIPLERI = new Set(["date", "datetime-local", "month"]);
// date: YYYY-MM-DD · datetime-local: YYYY-MM-DDTHH:MM · month: YYYY-MM → hepsinde yıl baştaki parça
const GECERLI = /^(\d{4})-/;

export default function TarihYilKoruma() {
  useEffect(() => {
    const handler = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !TARIH_TIPLERI.has(t.type) || !t.value) return;
      const m = t.value.match(GECERLI);
      const yil = m ? parseInt(m[1], 10) : NaN;
      if (m && yil >= 1900 && yil <= 2100) return; // geçerli → dokunma
      // React controlled input'lar da güncellensin: native setter + input event
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) { setter.call(t, ""); t.dispatchEvent(new Event("input", { bubbles: true })); }
      else t.value = "";
      toast.error("Geçersiz tarih: yıl 4 haneli olmalı (ör. 2026). Lütfen tarihi yeniden girin.", { id: "tarih-yil-koruma" });
    };
    // capture: change olayını her formdan önce yakala (stopPropagation'lı bileşenler de kapsansın)
    document.addEventListener("change", handler, true);
    return () => document.removeEventListener("change", handler, true);
  }, []);
  return null;
}
