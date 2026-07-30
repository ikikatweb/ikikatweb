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
// date: YYYY-MM-DD · datetime-local: YYYY-MM-DDTHH:MM · month: YYYY-MM → hepsinde yıl baştaki parça (ilk "-" öncesi)

export default function TarihYilKoruma() {
  useEffect(() => {
    // YAZARKEN (input): yıl 4 haneyi AŞARSA fazlasını kes → alana 4 haneden fazla girilemez; ama 4 haneli yıl
    // (2026) hiç kesintiye uğramadan yazılır. ARTIK ALAN TEMİZLENMEZ / <1900 kontrolü yapılmaz — o kontrol,
    // yılı rakam rakam yazarken (0002→…) araya girip yazmayı engelliyordu. Amaç yalnız 5-6 haneli yılları önlemek.
    const inputHandler = (e: Event) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || !TARIH_TIPLERI.has(t.type) || !t.value) return;
      const yilToken = t.value.split("-")[0];
      if (yilToken.length <= 4) return; // 4 hane ve altı → dokunma (normal yazım)
      // İlk 4 haneye kırp (2026'ya fazladan rakam eklenirse orijinal 4 hane korunur).
      const yeni = yilToken.slice(0, 4) + t.value.slice(yilToken.length);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) { setter.call(t, yeni); t.dispatchEvent(new Event("input", { bubbles: true })); }
      else t.value = yeni;
      toast.error("Yıl en fazla 4 haneli olabilir (ör. 2026).", { id: "tarih-yil-koruma" });
    };
    document.addEventListener("input", inputHandler, true);
    return () => document.removeEventListener("input", inputHandler, true);
  }, []);
  return null;
}
