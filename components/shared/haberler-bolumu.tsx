// Ana sayfa "Bizden Haberler" — kartlar + "Devamını Oku" ile ekranda modal (büyütme).
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { Calendar, ArrowRight, X, Newspaper, ChevronDown, ChevronUp } from "lucide-react";
import type { Haber } from "@/lib/supabase/types";

const LIMIT = 6; // başlangıçta gösterilen haber (2 satır × 3 sütun)

function zamanOnce(tarih: string): string {
  const fark = Date.now() - new Date(tarih).getTime();
  const dk = Math.floor(fark / 60000);
  if (dk < 60) return `${Math.max(1, dk)} dakika önce`;
  const sa = Math.floor(dk / 60);
  if (sa < 24) return `${sa} saat önce`;
  const gun = Math.floor(sa / 24);
  if (gun < 30) return `${gun} gün önce`;
  const ay = Math.floor(gun / 30);
  if (ay < 12) return `${ay} ay önce`;
  return `${Math.floor(ay / 12)} yıl önce`;
}

export default function HaberlerBolumu({ haberler }: { haberler: Haber[] }) {
  const [acik, setAcik] = useState<Haber | null>(null);
  const [genislet, setGenislet] = useState(false);
  const gosterilen = genislet ? haberler : haberler.slice(0, LIMIT);

  useEffect(() => {
    if (!acik) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAcik(null); };
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden"; // modal açıkken arka plan kaymasın
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [acik]);

  return (
    <div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {gosterilen.map((h) => (
          <article key={h.id} className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg">
            <div className="relative h-48 overflow-hidden bg-slate-100">
              {h.gorsel_url ? (
                <img src={h.gorsel_url} alt={h.baslik} className="h-full w-full object-cover transition duration-500 group-hover:scale-105" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#1E3A5F] to-[#2c5480] text-white/70">
                  <Newspaper size={40} />
                </div>
              )}
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-base font-semibold leading-snug text-slate-800">{h.baslik}</h3>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Calendar size={13} /> {zamanOnce(h.created_at)}
              </div>
              <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-slate-500">{h.ozet || h.icerik}</p>
              <button type="button" onClick={() => setAcik(h)}
                className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-semibold text-[#F97316] transition hover:gap-2.5">
                Devamını Oku <ArrowRight size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {haberler.length > LIMIT && (
        <div className="mt-8 text-center">
          <button type="button" onClick={() => setGenislet((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-[#1E3A5F] transition hover:bg-slate-50">
            {genislet ? (<>Daha Az Göster <ChevronUp size={16} /></>) : (<>Devamını Göster ({haberler.length - LIMIT} haber) <ChevronDown size={16} /></>)}
          </button>
        </div>
      )}

      {/* MODAL — haberi büyütür */}
      {acik && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={() => setAcik(null)}>
          <div className="relative my-8 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => setAcik(null)}
              className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white transition hover:bg-black/60" aria-label="Kapat">
              <X size={18} />
            </button>
            {acik.gorsel_url && (
              <img src={acik.gorsel_url} alt={acik.baslik} className="max-h-[45vh] w-full object-cover" />
            )}
            <div className="p-6">
              <h2 className="text-xl font-bold text-[#1E3A5F]">{acik.baslik}</h2>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                <Calendar size={13} /> {zamanOnce(acik.created_at)}
              </div>
              <div className="mt-4 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">{acik.icerik}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
