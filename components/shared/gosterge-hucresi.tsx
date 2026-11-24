// SAYAÇ HÜCRESİ — tahmini göstergeyi gösterir, tıklayınca SAYAÇTAN OKUNAN değer girilir.
//
// NEDEN ELLE GİRİŞ: Arvento eksik sayıyor. 60 AJ 465'te taban 23.05.2026 bakımındaki 501.130 km,
// Arvento 165 günde 10.945 km eklemiş → 512.075 km; sayaçta 513.110 km vardı. Yarım yılda 1.035 km
// sapma, bakım eşiğini geç haber verdiriyor. Girilen değer O GÜNÜN okuması olarak saklanır
// (araclar.son_okuma_deger + son_okuma_tarihi); tahmin tabanı o güne taşınır, Arvento ERTESİ
// GÜNDEN itibaren yeniden eklemeye başlar.
//
// NEDEN ORTAK BİLEŞEN: aynı sayaç iki ekranda görünüyor (Sigorta & Muayene, Araç Bakım Listesi).
// Yazma kuralı tek yerde: guncel_gosterge ile son_okuma_deger/tarihi HER ZAMAN birlikte yazılır.
// Ayrı yazılsaydı tarihsiz bir kart değeri tahmini yanlış tabana oturtur.
"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { updateArac } from "@/lib/supabase/queries/araclar";
import type { TahminiGosterge } from "@/lib/arac/tahmini-gosterge";

const KAYNAK_METNI = {
  elle: "sayaçtan okunan",
  yakit: "yakıt kaydında girilen",
  bakim: "bakım kaydında girilen",
  puantaj: "araç puantajında girilen",
} as const;

export function formatGosterge(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

function formatTarih(d: string | null | undefined): string {
  if (!d) return "—";
  const dt = new Date(d.slice(0, 10) + "T00:00:00");
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

type Props = {
  aracId: string;
  sayacTipi: "km" | "saat" | null;
  /** Araç kartındaki değer (tahmin üretilemediğinde gösterilen). */
  guncelGosterge: number | null;
  /** Varsa tahmin — gösterilecek değer bu olur. */
  tahmin?: TahminiGosterge | null;
  duzenlenebilir: boolean;
  /** Kayıttan sonra listeyi tazelemek için: yeni değer üst bileşene verilir. */
  onKaydedildi?: (aracId: string, deger: number) => void;
};

export function GostergeHucresi({
  aracId, sayacTipi, guncelGosterge, tahmin, duzenlenebilir, onKaydedildi,
}: Props) {
  const [duzenle, setDuzenle] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const birim = sayacTipi === "saat" ? "sa" : "km";
  const deger = tahmin ? tahmin.tahmini : guncelGosterge;

  async function kaydet(metin: string) {
    const temiz = metin.replace(/[.\s]/g, "").replace(",", ".");
    if (!temiz) { setDuzenle(false); return; }
    const sayi = Number(temiz);
    if (!isFinite(sayi) || sayi <= 0) {
      toast.error("Geçerli bir sayaç değeri girin.");
      return;
    }
    const yeni = Math.round(sayi);
    setKaydediyor(true);
    try {
      // SESSİZ YAZMA YOK: updateArac şema kayması olursa bilinmeyen kolonu çıkarıp tekrar
      // deniyor; okuma tarihi yazılmazsa tahmin yanlış tabana oturur. Dönen satır kontrol edilir.
      const sonuc = await updateArac(aracId, {
        guncel_gosterge: yeni,
        son_okuma_deger: yeni,
        son_okuma_tarihi: new Date().toISOString(),
      });
      const kayitli = sonuc as unknown as { son_okuma_deger?: number | null; son_okuma_tarihi?: string | null };
      if (kayitli.son_okuma_deger == null || !kayitli.son_okuma_tarihi) {
        toast.error(
          `${formatGosterge(yeni)} ${birim} karta yazıldı ama OKUMA TARİHİ saklanamadı — `
          + "tahmin bu değerden devam etmeyecek. sql: araclar.son_okuma_deger/son_okuma_tarihi",
          { duration: 12000 },
        );
      } else {
        toast.success(
          `${formatGosterge(yeni)} ${birim} kaydedildi (${formatTarih(new Date().toISOString())} okuması). `
          + "Arvento yarından itibaren bu değerin üstüne ekleyecek.",
        );
      }
      setDuzenle(false);
      onKaydedildi?.(aracId, yeni);
    } catch (e) {
      toast.error(`Sayaç kaydedilemedi: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setKaydediyor(false);
    }
  }

  if (duzenle) {
    return (
      <input
        type="text" inputMode="numeric" autoFocus disabled={kaydediyor}
        defaultValue={deger != null ? String(deger) : ""}
        placeholder={`Sayaçtaki ${birim}`}
        title="Sayaçtaki değeri yazıp Enter'a basın. Esc: vazgeç."
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void kaydet((e.target as HTMLInputElement).value); }
          if (e.key === "Escape") { e.preventDefault(); setDuzenle(false); }
        }}
        // BLUR = İPTAL, kayıt YOK. Yanlışlıkla hücreye tıklayıp başka yere tıklandığında
        // ekrandaki TAHMİN gerçek okuma gibi yazılırdı ("~512.075" bir anda kesinleşirdi).
        // Aynı tablodaki tarih hücreleri de böyle çalışıyor: Enter kaydeder, Esc/boşluk iptal.
        onBlur={() => { if (!kaydediyor) setDuzenle(false); }}
        className="h-7 w-full rounded border px-1 text-right text-xs tabular-nums"
      />
    );
  }

  const ipucu = tahmin
    ? `Tahmini. ${formatTarih(tahmin.tabanTarih)} ${KAYNAK_METNI[tahmin.tabanKaynak]} `
      + `${formatGosterge(tahmin.taban)} ${birim} + Arvento'dan ${formatGosterge(tahmin.eklenen)} ${birim} `
      + `(${tahmin.gun} gün).${duzenlenebilir ? " Sayaçtaki değeri yazmak için tıklayın." : ""}`
    : duzenlenebilir ? "Sayaçtaki değeri yazmak için tıklayın." : "";

  const icerik = deger == null ? (
    <span className="text-gray-400">{duzenlenebilir ? "gir" : "—"}</span>
  ) : tahmin ? (
    <span className="text-[#C2410C]">
      ~{formatGosterge(deger)} <span className="text-[#C2410C]/70">{birim}</span>
      <span className="block text-[9px] text-[#C2410C]/80">tahmini</span>
    </span>
  ) : (
    <>{formatGosterge(deger)} <span className="text-gray-400">{birim}</span></>
  );

  if (!duzenlenebilir) {
    return <span className="tabular-nums" title={ipucu}>{icerik}</span>;
  }

  return (
    <button
      type="button" title={ipucu} onClick={() => setDuzenle(true)}
      className="w-full rounded px-1 py-0.5 text-right tabular-nums hover:ring-2 hover:ring-blue-300"
    >
      {icerik}
    </button>
  );
}
