// Bizden Haberler — YÖNETİM. Yönetici haber ekler/düzenler/siler; ana sayfada gösterilir.
/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useState } from "react";
import { getHaberler, createHaber, updateHaber, deleteHaber, uploadHaberGorsel } from "@/lib/supabase/queries/haberler";
import type { Haber } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Pencil, Trash2, Upload, Eye, EyeOff, X, Newspaper } from "lucide-react";
import toast from "react-hot-toast";

const BOS = { id: "", baslik: "", ozet: "", icerik: "", gorsel_url: "", yayinda: true };

export default function HaberlerYonetim() {
  const [liste, setListe] = useState<Haber[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof BOS>(BOS);
  const [formAcik, setFormAcik] = useState(false);
  const [kaydediyor, setKaydediyor] = useState(false);
  const [yukluyor, setYukluyor] = useState(false);

  const yukle = useCallback(async () => {
    setLoading(true);
    try { setListe(await getHaberler()); }
    catch { toast.error("Haberler yüklenemedi (tablo oluşturuldu mu?)."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void yukle(); }, [yukle]);

  const yeni = () => { setForm(BOS); setFormAcik(true); };
  const duzenle = (h: Haber) => {
    setForm({ id: h.id, baslik: h.baslik, ozet: h.ozet ?? "", icerik: h.icerik, gorsel_url: h.gorsel_url ?? "", yayinda: h.yayinda });
    setFormAcik(true);
  };

  async function dosyaSec(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setYukluyor(true);
    try { const url = await uploadHaberGorsel(f); setForm((s) => ({ ...s, gorsel_url: url })); toast.success("Görsel yüklendi."); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Görsel yüklenemedi (public 'haberler' bucket'ı var mı?)."); }
    finally { setYukluyor(false); }
  }

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    if (!form.baslik.trim() || !form.icerik.trim()) { toast.error("Başlık ve içerik zorunludur."); return; }
    setKaydediyor(true);
    try {
      const payload = {
        baslik: form.baslik.trim(), ozet: form.ozet.trim() || null, icerik: form.icerik.trim(),
        gorsel_url: form.gorsel_url.trim() || null, yayinda: form.yayinda,
      };
      if (form.id) { await updateHaber(form.id, payload); toast.success("Haber güncellendi."); }
      else { await createHaber({ ...payload, created_by: null }); toast.success("Haber eklendi."); }
      setFormAcik(false); setForm(BOS); await yukle();
    } catch (err) { toast.error(err instanceof Error ? err.message : "Kaydedilemedi."); }
    finally { setKaydediyor(false); }
  }

  async function sil(h: Haber) {
    if (!window.confirm(`"${h.baslik}" haberini silmek istediğinize emin misiniz?`)) return;
    try { await deleteHaber(h.id); toast.success("Haber silindi."); await yukle(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Silinemedi."); }
  }

  async function yayinToggle(h: Haber) {
    try { await updateHaber(h.id, { yayinda: !h.yayinda }); await yukle(); }
    catch { toast.error("Güncellenemedi."); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#1E3A5F]">Bizden Haberler</h1>
          <p className="text-sm text-gray-500">Ana sayfada gösterilen haberleri yönetin.</p>
        </div>
        <Button onClick={yeni} className="bg-[#1E3A5F] text-white hover:bg-[#16304f]"><Plus size={16} className="mr-1" /> Yeni Haber</Button>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Yükleniyor…</div>
      ) : liste.length === 0 ? (
        <div className="rounded-lg border bg-white py-16 text-center text-gray-500">
          <Newspaper size={40} className="mx-auto mb-3 text-gray-300" />
          Henüz haber eklenmemiş. &quot;Yeni Haber&quot; ile ekleyin.
        </div>
      ) : (
        <div className="space-y-3">
          {liste.map((h) => (
            <div key={h.id} className="flex items-center gap-4 rounded-lg border bg-white p-3">
              <div className="h-16 w-24 shrink-0 overflow-hidden rounded bg-slate-100">
                {h.gorsel_url ? <img src={h.gorsel_url} alt="" className="h-full w-full object-cover" />
                  : <div className="flex h-full w-full items-center justify-center text-slate-300"><Newspaper size={20} /></div>}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-slate-800">{h.baslik}</span>
                  {!h.yayinda && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">Taslak</span>}
                </div>
                <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{h.ozet || h.icerik}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => yayinToggle(h)} title={h.yayinda ? "Yayından kaldır" : "Yayınla"}
                  className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-[#1E3A5F]">
                  {h.yayinda ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button onClick={() => duzenle(h)} title="Düzenle" className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-[#1E3A5F]"><Pencil size={16} /></button>
                <button onClick={() => sil(h)} title="Sil" className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600"><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* EKLE/DÜZENLE FORMU (modal) */}
      {formAcik && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={() => !kaydediyor && setFormAcik(false)}>
          <form onSubmit={kaydet} onClick={(e) => e.stopPropagation()}
            className="my-8 w-full max-w-lg space-y-3 rounded-xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#1E3A5F]">{form.id ? "Haberi Düzenle" : "Yeni Haber"}</h2>
              <button type="button" onClick={() => setFormAcik(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Başlık *</label>
              <Input value={form.baslik} onChange={(e) => setForm((s) => ({ ...s, baslik: e.target.value }))} placeholder="Haber başlığı" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Özet (kart altında görünür)</label>
              <textarea value={form.ozet} onChange={(e) => setForm((s) => ({ ...s, ozet: e.target.value }))} rows={2}
                placeholder="Kısa özet (boş bırakılırsa içerikten alınır)"
                className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">İçerik *</label>
              <textarea value={form.icerik} onChange={(e) => setForm((s) => ({ ...s, icerik: e.target.value }))} rows={6}
                placeholder="Haberin tam metni"
                className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50" />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600">Görsel</label>
              <div className="flex items-center gap-2">
                <Input value={form.gorsel_url} onChange={(e) => setForm((s) => ({ ...s, gorsel_url: e.target.value }))} placeholder="Görsel URL'si veya dosya yükleyin" />
                <label className={`inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border px-3 py-2 text-sm ${yukluyor ? "opacity-60" : "hover:bg-gray-50"}`}>
                  <Upload size={15} /> {yukluyor ? "Yükleniyor…" : "Yükle"}
                  <input type="file" accept="image/*" className="hidden" onChange={dosyaSec} disabled={yukluyor} />
                </label>
              </div>
              {form.gorsel_url && <img src={form.gorsel_url} alt="" className="mt-2 h-32 w-full rounded-lg object-cover" />}
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.yayinda} onChange={(e) => setForm((s) => ({ ...s, yayinda: e.target.checked }))} className="h-4 w-4 accent-[#1E3A5F]" />
              Yayında (ana sayfada göster)
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setFormAcik(false)} disabled={kaydediyor}>Vazgeç</Button>
              <Button type="submit" disabled={kaydediyor || yukluyor} className="bg-[#1E3A5F] text-white hover:bg-[#16304f]">
                {kaydediyor ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
