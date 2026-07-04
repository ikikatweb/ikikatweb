// İcra Tanımlamaları — İcra Takibi sayfasının "Tanımlamalar" sekmesi içeriği (şimdilik: Cevap Şekli seçenekleri).
"use client";

import { useCallback, useEffect, useState } from "react";
import { getTanimlamalar, createTanimlama, updateTanimlama, deleteTanimlama } from "@/lib/supabase/queries/tanimlamalar";
import { createClient } from "@/lib/supabase/client";
import { ICRA_CEVAP_VARSAYILAN } from "@/components/shared/icra-tablosu";
import type { Tanimlama } from "@/lib/supabase/types";
import { Plus, Trash2, Loader2, Pencil, Check, X } from "lucide-react";
import toast from "react-hot-toast";

const KATEGORI = "icra_cevap_sekli";

export default function IcraTanimlamalar({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [liste, setListe] = useState<Tanimlama[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [yeni, setYeni] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [duzenleId, setDuzenleId] = useState<string | null>(null);
  const [duzenleDeger, setDuzenleDeger] = useState("");

  const yukle = useCallback(async () => {
    try { const d = await getTanimlamalar(KATEGORI); setListe((d ?? []) as Tanimlama[]); }
    catch { toast.error("Yüklenemedi."); }
    finally { setYukleniyor(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const varMi = (v: string) => liste.some((t) => t.deger.toLocaleLowerCase("tr") === v.trim().toLocaleLowerCase("tr"));

  async function ekle(deger: string, sira: number) {
    await createTanimlama({ kategori: KATEGORI, sekme: "icra", deger: deger.trim(), sira, aktif: true });
  }
  async function yeniEkle() {
    const v = yeni.trim();
    if (!v) return;
    if (varMi(v)) { toast.error("Bu değer zaten var."); return; }
    setKaydediliyor(true);
    try { await ekle(v, liste.reduce((m, t) => Math.max(m, t.sira), 0) + 1); setYeni(""); await yukle(); }
    catch { toast.error("Eklenemedi."); }
    finally { setKaydediliyor(false); }
  }
  async function varsayilanlariEkle() {
    setKaydediliyor(true);
    try {
      let sira = liste.reduce((m, t) => Math.max(m, t.sira), 0);
      for (const v of ICRA_CEVAP_VARSAYILAN) if (!varMi(v)) { sira += 1; await ekle(v, sira); }
      await yukle();
    } catch { toast.error("Eklenemedi."); }
    finally { setKaydediliyor(false); }
  }
  async function sil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu değer silinsin mi?")) return;
    try { await deleteTanimlama(id); await yukle(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Silinemedi."); }
  }
  function duzenleBasla(t: Tanimlama) { setDuzenleId(t.id); setDuzenleDeger(t.deger); }
  async function duzenleKaydet() {
    if (!duzenleId) return;
    const v = duzenleDeger.trim();
    if (!v) { toast.error("Boş olamaz."); return; }
    const eski = liste.find((t) => t.id === duzenleId)?.deger ?? ""; // eski değer (icra kayıtlarında saklı)
    if (liste.some((t) => t.id !== duzenleId && t.deger.toLocaleLowerCase("tr") === v.toLocaleLowerCase("tr"))) { toast.error("Bu değer zaten var."); return; }
    try {
      await updateTanimlama(duzenleId, { deger: v });
      // Bu cevap şeklini KULLANAN mevcut icra kayıtlarını da yeni değere güncelle (geriye dönük — tabloda da değişsin)
      if (eski && eski !== v) {
        try { await createClient().from("icra").update({ cevap_sekli: v }).eq("cevap_sekli", eski); } catch { /* sessiz */ }
      }
      setDuzenleId(null); await yukle();
    } catch { toast.error("Güncellenemedi."); }
  }

  const eksikVarsayilan = ICRA_CEVAP_VARSAYILAN.filter((v) => !varMi(v));

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-800">Cevap Şekli</h2>
          {canEkle && eksikVarsayilan.length > 0 && (
            <button type="button" onClick={varsayilanlariEkle} disabled={kaydediliyor}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50">
              Varsayılan {eksikVarsayilan.length} seçeneği ekle
            </button>
          )}
        </div>

        {yukleniyor ? (
          <div className="flex items-center gap-2 text-gray-400 py-6"><Loader2 size={16} className="animate-spin" /> Yükleniyor…</div>
        ) : (
          <>
            {liste.length === 0 && <p className="text-sm text-gray-400 mb-3">Henüz seçenek yok. Aşağıdan ekleyin veya varsayılanları yükleyin.</p>}
            <ul className="divide-y divide-gray-100 mb-3">
              {liste.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 gap-2">
                  {duzenleId === t.id ? (
                    <>
                      <input value={duzenleDeger} onChange={(e) => setDuzenleDeger(e.target.value)} autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void duzenleKaydet(); } if (e.key === "Escape") setDuzenleId(null); }}
                        className="flex-1 h-8 px-2 text-sm rounded border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
                      <button type="button" onClick={duzenleKaydet} className="text-emerald-600" title="Kaydet"><Check size={16} /></button>
                      <button type="button" onClick={() => setDuzenleId(null)} className="text-gray-400 hover:text-gray-600" title="İptal"><X size={16} /></button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm text-gray-800 flex-1">{t.deger}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {canDuzenle && <button type="button" onClick={() => duzenleBasla(t)} className="text-gray-300 hover:text-[#1E3A5F]" title="Düzenle"><Pencil size={14} /></button>}
                        {canSil && <button type="button" onClick={() => sil(t.id)} className="text-gray-300 hover:text-red-600" title="Sil"><Trash2 size={15} /></button>}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>

            {canEkle && (
              <div className="flex items-center gap-2">
                <input type="text" value={yeni} onChange={(e) => setYeni(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void yeniEkle(); } }}
                  placeholder="Yeni cevap şekli (ör. KEP)"
                  className="flex-1 h-9 px-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
                <button type="button" onClick={yeniEkle} disabled={kaydediliyor || !yeni.trim()}
                  className="flex items-center gap-1 h-9 px-3 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                  <Plus size={15} /> Ekle
                </button>
              </div>
            )}
          </>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-3">Buraya eklenen değerler İcra Takibi tablosundaki “Cevap Şekli” açılır listesinde görünür.</p>
    </div>
  );
}
