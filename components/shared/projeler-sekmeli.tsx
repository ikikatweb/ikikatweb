// Ana sayfa "Projelerimiz" — Devam Eden / Tamamlanan AYRI SEKMELERDE; her sekme içinde projeler
// İŞ TANIMLARINA (santiyeler.is_grubu) göre KATEGORİ BAŞLIKLARIYLA gruplanır.
//  • Grup SIRASI: Tanımlamalar → "ihale_is_grubu" listesindeki sıra (grupSirasi prop). Listede olmayan
//    gruplar sona, proje sayısına göre eklenir.
//  • Grup İÇİ sıra: en son biten iş üstte (siraTarih azalan; tarihsizler sona).
"use client";

import { useState } from "react";
import { CircleDot, CheckCircle2 } from "lucide-react";
import type { Proje } from "@/lib/supabase/queries/santiyeler-public";

// Eşleştirme için normalizasyon: "Üst Yapı (Bina İşleri)" ≈ "Üstyapı" olsun diye parantez öncesi + harf/rakam.
function norm(s: string): string {
  return (s || "").toLocaleLowerCase("tr").split("(")[0].replace(/[^a-z0-9çğıöşü]/gi, "");
}

function grupla(liste: Proje[], grupSirasi: string[]): { ad: string; projeler: string[] }[] {
  // Bir kategori değerini KANONİK etikete eşle (is_tanimlari listesindeki karşılığı). Etiketler birebir
  // aynı olmayabilir (ör. "Baraj & Gölet" ↔ "Gölet", "Toplulaştırma Ve T.İ.G.H." ↔ "Toplulaştırma") ve
  // veride aynı kategorinin iki yazımı olabilir → normalize + İÇERME ile tek kanonik başlıkta birleşir.
  const kanon = (kategori: string) => {
    const n = norm(kategori);
    return grupSirasi.find((g) => { const gn = norm(g); return gn === n || gn.includes(n) || n.includes(gn); }) ?? kategori;
  };
  const map = new Map<string, Proje[]>();
  for (const p of liste) { const k = kanon(p.kategori || "Diğer"); (map.get(k) ?? map.set(k, []).get(k)!).push(p); }
  // grup-içi: en son biten üstte (siraTarih azalan; boş olan sona)
  for (const arr of map.values()) arr.sort((a, b) => (b.siraTarih ?? "").localeCompare(a.siraTarih ?? ""));
  // grup sırası: is_tanimlari listesindeki indeks; listede olmayan gruplar sona (proje sayısı çok olan önce)
  const idx = (ad: string) => { const i = grupSirasi.indexOf(ad); return i < 0 ? Infinity : i; };
  return [...map.entries()]
    .map(([ad, ps]) => ({ ad, projeler: ps.map((p) => p.ad) }))
    .sort((a, b) => (idx(a.ad) - idx(b.ad)) || (b.projeler.length - a.projeler.length));
}

function SekmeBtn({ etiket, sayi, secili, onSelect }: { etiket: string; sayi: number; secili: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect}
      className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
        secili ? "bg-[#1E3A5F] text-white shadow" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
      }`}>
      {etiket}
      <span className={`rounded-full px-2 py-0.5 text-xs ${secili ? "bg-white/20" : "bg-white text-slate-500"}`}>{sayi}</span>
    </button>
  );
}

export default function ProjelerSekmeli({ devam, tamamlanan, grupSirasi = [] }: { devam: Proje[]; tamamlanan: Proje[]; grupSirasi?: string[] }) {
  const [sekme, setSekme] = useState<"devam" | "tamam">(devam.length ? "devam" : "tamam");
  const aktifDevam = sekme === "devam";
  const liste = aktifDevam ? devam : tamamlanan;
  const Ikon = aktifDevam ? CircleDot : CheckCircle2;
  const renk = aktifDevam ? "text-[#F97316]" : "text-emerald-600";
  const nokta = aktifDevam ? "bg-[#F97316]" : "bg-emerald-600";
  const gruplar = grupla(liste, grupSirasi);

  return (
    <div>
      <div className="flex flex-wrap justify-center gap-3">
        <SekmeBtn etiket="Devam Eden" sayi={devam.length} secili={sekme === "devam"} onSelect={() => setSekme("devam")} />
        <SekmeBtn etiket="Tamamlanan" sayi={tamamlanan.length} secili={sekme === "tamam"} onSelect={() => setSekme("tamam")} />
      </div>

      <div className="mt-8 space-y-8">
        {gruplar.map((g) => (
          <div key={g.ad}>
            <div className="mb-3 flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${nokta}`} />
              <h3 className="text-base font-bold text-slate-800">{g.ad}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{g.projeler.length}</span>
              <span className="ml-1 h-px flex-1 bg-slate-200" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.projeler.map((ad, i) => (
                <div key={`${ad}-${i}`} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow">
                  <Ikon size={18} className={`mt-0.5 shrink-0 ${renk}`} />
                  <span className="text-sm leading-snug text-slate-700">{ad}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {liste.length === 0 && (
        <p className="mt-8 text-center text-sm text-slate-400">Bu kategoride kayıt bulunamadı.</p>
      )}
    </div>
  );
}
