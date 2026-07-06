// Kredi Kartları — elle girilip düzenlenebilen kart durum tablosu (Ödeme Planı ile İcra Takibi arasındaki sayfa).
// Kullanılabilir Limit = Limit - Güncel Borç (otomatik). Satırlar inline düzenlenir; yetkiye göre kilitli.
"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, Plus, Trash2, Loader2, Search, Pencil } from "lucide-react";
import { getKrediKartlar, insertKrediKarti, updateKrediKarti, deleteKrediKarti } from "@/lib/supabase/queries/kredi-karti";
import type { KrediKarti } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Diyalog formu — banka/son4/kart sahibi/hesap kesim/son ödeme tabloda salt-okunur; hepsi burada düzenlenir.
type KKForm = {
  banka_adi: string; son4: string; kart_ozelligi: string; kart_sahibi: string; karti_kullanan: string;
  hesap_kesim: string; son_odeme: string; limit_tutar: string; kullanilabilir: string; aciklama: string;
};
const BOS_FORM: KKForm = {
  banka_adi: "", son4: "", kart_ozelligi: "", kart_sahibi: "", karti_kullanan: "",
  hesap_kesim: "", son_odeme: "", limit_tutar: "", kullanilabilir: "", aciklama: "",
};

function tlFmt(n: number): string { return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Kart sahibine göre satır rengi: KAD-TEM A.Ş. → mavi, İKİKAT LTD ŞTİ → kırmızı.
// Kişi isimli kartlar (Mustafa/Erkan/Tugay İkikat) beyaz kalır. Metin daima siyah (yalnız satır zemini).
function firmaBg(sahibi: string | null): string {
  const n = trAramaNormalize(sahibi ?? "").replace(/[^a-z0-9]/g, "");
  if (n.includes("kadtem")) return "bg-blue-50";
  if (n.includes("ikikat") && n.includes("ltd")) return "bg-red-50"; // yalnız İKİKAT LTD ŞTİ (firma)
  return "";
}
function tarihSaat(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}
function sayiToInput(n: number, bosZero = true): string {
  if (bosZero && (!n || n === 0)) return "";
  const s = Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",");
  return formatParaInput(s || "0");
}

export default function KrediKartiTablosu({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [kartlar, setKartlar] = useState<KrediKarti[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [filtreBanka, setFiltreBanka] = useState("");
  const [filtreSahip, setFiltreSahip] = useState("");
  const [duzen, setDuzen] = useState<Record<string, string>>({}); // düzenlenirken geçici string (id:field)
  const [dialogAcik, setDialogAcik] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<KKForm>(BOS_FORM);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const setF = (key: keyof KKForm, val: string) => setForm((f) => ({ ...f, [key]: val }));

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const k = await getKrediKartlar();
        if (iptal) return;
        setKartlar(k); setHata(null);
      } catch (e) {
        if (iptal) return;
        let msg = "Bilinmeyen hata";
        if (e instanceof Error) msg = e.message;
        else if (typeof e === "string") msg = e;
        else if (e && typeof e === "object") {
          const o = e as { message?: string; details?: string; hint?: string; code?: string };
          msg = o.message || o.details || o.hint || o.code || JSON.stringify(e);
        }
        setHata(msg.includes("does not exist") || msg.includes("kredi_karti") || msg.includes("schema cache")
          ? "Kredi kartı tablosu Supabase'de henüz yok. sql/kredi_karti.sql dosyasını çalıştırın."
          : msg);
      } finally { if (!iptal) setLoading(false); }
    })();
    return () => { iptal = true; };
  }, []);

  const bankalar = useMemo(() => [...new Set(kartlar.map((k) => (k.banka_adi ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [kartlar]);
  const sahipler = useMemo(() => [...new Set(kartlar.map((k) => (k.kart_sahibi ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [kartlar]);

  const gorunen = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    return kartlar.filter((k) => {
      if (filtreBanka && (k.banka_adi ?? "").trim() !== filtreBanka) return false;
      if (filtreSahip && (k.kart_sahibi ?? "").trim() !== filtreSahip) return false;
      if (q && !trAramaNormalize([k.banka_adi, k.son4, k.kart_ozelligi, k.kart_sahibi, k.karti_kullanan, k.aciklama].filter(Boolean).join(" ")).includes(q)) return false;
      return true;
    });
  }, [kartlar, arama, filtreBanka, filtreSahip]);

  const toplamLimit = useMemo(() => gorunen.reduce((t, k) => t + Number(k.limit_tutar || 0), 0), [gorunen]);
  const toplamBorc = useMemo(() => gorunen.reduce((t, k) => t + Number(k.guncel_borc || 0), 0), [gorunen]);
  const toplamKullanilabilir = toplamLimit - toplamBorc;
  const sonGuncelleme = useMemo(() => {
    let en = 0;
    for (const k of kartlar) { const t = new Date(k.updated_at).getTime(); if (t > en) en = t; }
    return en ? new Date(en).toISOString() : null;
  }, [kartlar]);

  async function kartGuncelle(id: string, patch: Partial<KrediKarti>) {
    const now = new Date().toISOString();
    setKartlar((p) => p.map((k) => (k.id === id ? { ...k, ...patch, updated_at: now } : k)));
    try { await updateKrediKarti(id, patch); } catch { toast.error("Kaydedilemedi."); }
  }
  function dialogAc(k: KrediKarti | null) {
    if (k) {
      setEditId(k.id);
      setForm({
        banka_adi: k.banka_adi ?? "", son4: k.son4 ?? "", kart_ozelligi: k.kart_ozelligi ?? "",
        kart_sahibi: k.kart_sahibi ?? "", karti_kullanan: k.karti_kullanan ?? "",
        hesap_kesim: k.hesap_kesim != null ? String(k.hesap_kesim) : "",
        son_odeme: k.son_odeme != null ? String(k.son_odeme) : "",
        limit_tutar: sayiToInput(Number(k.limit_tutar || 0), true),
        kullanilabilir: sayiToInput(Number(k.limit_tutar || 0) - Number(k.guncel_borc || 0), true),
        aciklama: k.aciklama ?? "",
      });
    } else { setEditId(null); setForm(BOS_FORM); }
    setDialogAcik(true);
  }
  async function kaydet() {
    const gun = (s: string): number | null => { const n = parseInt(s.trim(), 10); return (!isNaN(n) && n >= 1 && n <= 31) ? n : null; };
    const t = (v: string) => (v.trim() === "" ? null : v.trim());
    const payload = {
      banka_adi: t(form.banka_adi), son4: t(form.son4), kart_ozelligi: t(form.kart_ozelligi),
      kart_sahibi: t(form.kart_sahibi), karti_kullanan: t(form.karti_kullanan),
      hesap_kesim: gun(form.hesap_kesim), son_odeme: gun(form.son_odeme),
      limit_tutar: parseParaInput(form.limit_tutar),
      guncel_borc: parseParaInput(form.limit_tutar) - parseParaInput(form.kullanilabilir), // güncel borç = limit − kullanılabilir
      aciklama: t(form.aciklama),
    };
    setKaydediliyor(true);
    try {
      if (editId) {
        await updateKrediKarti(editId, payload);
        setKartlar((p) => p.map((k) => (k.id === editId ? { ...k, ...payload, updated_at: new Date().toISOString() } : k)));
      } else {
        const maxSira = kartlar.reduce((m, k) => Math.max(m, k.sira), 0);
        const row = await insertKrediKarti({ ...payload, sira: maxSira + 1 });
        setKartlar((p) => [...p, row]);
      }
      setDialogAcik(false);
    } catch { toast.error("Kaydedilemedi."); }
    finally { setKaydediliyor(false); }
  }
  async function kartSil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu kart satırı silinsin mi?")) return;
    try { await deleteKrediKarti(id); setKartlar((p) => p.filter((k) => k.id !== id)); }
    catch { toast.error("Silinemedi."); }
  }

  const inputCls = "w-full bg-transparent px-1.5 py-1 text-xs outline-none rounded focus:bg-white focus:ring-1 focus:ring-blue-300 read-only:cursor-default disabled:cursor-default";

  function metinHucre(id: string, field: keyof KrediKarti, value: string | null, ph = "") {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? (value ?? "");
    return (
      <input type="text" readOnly={!canDuzenle} placeholder={ph} className={inputCls} value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: e.target.value })); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const v = duzen[key];
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (v !== (value ?? "")) kartGuncelle(id, { [field]: v.trim() === "" ? null : v } as Partial<KrediKarti>);
        }} />
    );
  }
  function paraHucre(id: string, field: string, value: number, persist: (n: number) => void, extra = "") {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? sayiToInput(value, true);
    return (
      <input type="text" inputMode="decimal" dir="ltr" readOnly={!canDuzenle} placeholder="0"
        className={`${inputCls} text-right tabular-nums placeholder:text-gray-300 ${extra}`} value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: formatParaInput(e.target.value) })); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const num = parseParaInput(duzen[key]);
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (num !== value) persist(num);
        }} />
    );
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Yükleniyor…</div>;
  if (hata) return <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">{hata}</div>;

  const th = "px-2 py-2 font-semibold text-[#1E3A5F] border border-gray-200 text-center align-middle whitespace-nowrap";
  const td = "border border-gray-100 px-0.5 py-0.5 align-middle";
  const tdOku = "border border-gray-100 px-1.5 py-1.5 align-middle text-xs"; // salt-okunur hücre
  const islemVar = canDuzenle || canSil;
  const kolon = islemVar ? 13 : 12;
  const fLbl = "text-xs font-medium text-gray-600 mb-1 block";
  const fInp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";

  return (
    <div>
      <div className="flex items-baseline mb-4 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <CreditCard size={24} /> Kredi Kartları
        </h1>
        {sonGuncelleme && <span className="text-xs text-gray-400">Son güncelleme: {tarihSaat(sonGuncelleme)}</span>}
        {canEkle && (
          <button type="button" onClick={() => dialogAc(null)} className="ml-auto flex items-center gap-1.5 h-9 px-3 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus size={15} /> Kart Ekle
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
            placeholder="Banka, kart sahibi, kullanan, açıklama…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
        </div>
        <select value={filtreBanka} onChange={(e) => setFiltreBanka(e.target.value)}
          className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30 max-w-[180px]">
          <option value="">Banka (tümü)</option>
          {bankalar.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filtreSahip} onChange={(e) => setFiltreSahip(e.target.value)}
          className="h-9 px-2.5 text-sm rounded-lg border border-gray-300 bg-white outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30 max-w-[180px]">
          <option value="">Kart sahibi (tümü)</option>
          {sahipler.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(filtreBanka || filtreSahip || arama) && (
          <button type="button" onClick={() => { setArama(""); setFiltreBanka(""); setFiltreSahip(""); }}
            className="h-9 px-2.5 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Temizle</button>
        )}
        <span className="text-xs text-gray-500">{gorunen.length} kart</span>
      </div>

      <div className="w-full bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="text-xs text-gray-900 border-collapse w-full">
          <thead className="bg-gray-100">
            <tr>
              <th className={th}>S.No</th>
              <th className={`${th} text-left`}>Banka Adı</th>
              <th className={th}>Son 4 Hane</th>
              <th className={th}>Kart Özelliği</th>
              <th className={`${th} text-left`}>Kart Sahibi</th>
              <th className={`${th} text-left`}>Kartı Kullanan</th>
              <th className={th}>Hesap Kesim<br /><span className="font-normal text-[10px] text-gray-500">(Her Ayın)</span></th>
              <th className={th}>Son Ödeme<br /><span className="font-normal text-[10px] text-gray-500">(Her Ayın)</span></th>
              <th className={th}>Limit</th>
              <th className={th}>Güncel Borç</th>
              <th className={th}>Kullanılabilir<br />Limit</th>
              <th className={`${th} text-left`}>Açıklama</th>
              {islemVar && <th className={th}>İşlem</th>}
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 && (
              <tr><td colSpan={kolon} className="text-center text-gray-400 py-8">
                {arama.trim() ? "Aramayla eşleşen kart yok." : `Henüz kart yok.${canEkle ? " Aşağıdan “Kart Ekle” ile başlayın." : ""}`}
              </td></tr>
            )}
            {gorunen.map((k, i) => {
              const kullanilabilir = Number(k.limit_tutar || 0) - Number(k.guncel_borc || 0);
              return (
                <tr key={k.id} className={`border-b border-gray-100 ${firmaBg(k.kart_sahibi) || "hover:bg-gray-50/60"}`}>
                  <td className={`${td} text-center text-gray-500 tabular-nums px-1.5`}>{i + 1}</td>
                  <td className={`${tdOku} min-w-[130px] truncate`} title={k.banka_adi ?? ""}>{k.banka_adi || "—"}</td>
                  <td className={`${tdOku} min-w-[80px] truncate`} title={k.son4 ?? ""}>{k.son4 || "—"}</td>
                  <td className={`${tdOku} min-w-[90px] truncate`} title={k.kart_ozelligi ?? ""}>{k.kart_ozelligi || "—"}</td>
                  <td className={`${tdOku} min-w-[110px] truncate`} title={k.kart_sahibi ?? ""}>{k.kart_sahibi || "—"}</td>
                  <td className={`${td} min-w-[110px]`}>{metinHucre(k.id, "karti_kullanan", k.karti_kullanan, "Kullanan")}</td>
                  <td className={`${tdOku} w-14 text-center`}>{k.hesap_kesim ?? "—"}</td>
                  <td className={`${tdOku} w-14 text-center`}>{k.son_odeme ?? "—"}</td>
                  <td className={`${tdOku} min-w-[100px] text-right tabular-nums`}>{tlFmt(Number(k.limit_tutar || 0))}</td>
                  <td className={`${tdOku} min-w-[100px] text-right tabular-nums`}>{tlFmt(Number(k.guncel_borc || 0))}</td>
                  <td className={`${td} min-w-[110px]`}>{paraHucre(k.id, "kullanilabilir", kullanilabilir, (n) => kartGuncelle(k.id, { guncel_borc: Number(k.limit_tutar || 0) - n }), "font-semibold")}</td>
                  <td className={`${td} min-w-[160px]`}>{metinHucre(k.id, "aciklama", k.aciklama, "Açıklama")}</td>
                  {islemVar && (
                    <td className={`${td} text-center px-1 whitespace-nowrap`}>
                      <div className="flex items-center justify-center gap-2">
                        {canDuzenle && <button type="button" onClick={() => dialogAc(k)} className="text-gray-400 hover:text-[#1E3A5F]" title="Düzenle"><Pencil size={14} /></button>}
                        {canSil && <button type="button" onClick={() => kartSil(k.id)} className="text-gray-300 hover:text-red-600" title="Kartı sil"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-[#1E3A5F]">
              <td className={`${td} text-right px-2`} colSpan={8}>TOPLAM</td>
              <td className={`${td} text-right tabular-nums px-2`}>{tlFmt(toplamLimit)}</td>
              <td className={`${td} text-right tabular-nums px-2`}>{tlFmt(toplamBorc)}</td>
              <td className={`${td} text-right tabular-nums px-2`}>{tlFmt(toplamKullanilabilir)}</td>
              <td className={td} />
              {islemVar && <td className={td} />}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">Kullanılabilir Limit = Limit − Güncel Borç (otomatik). Hesap Kesim / Son Ödeme = her ayın günü.</p>

      {/* Ekle / Düzenle diyaloğu */}
      <Dialog open={dialogAcik} onOpenChange={setDialogAcik}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard size={18} /> {editId ? "Kartı Düzenle" : "Yeni Kart"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className={fLbl}>Banka Adı</label>
              <input className={fInp} value={form.banka_adi} onChange={(e) => setF("banka_adi", e.target.value)} placeholder="Banka" />
            </div>
            <div>
              <label className={fLbl}>Son 4 Hane</label>
              <input className={fInp} value={form.son4} onChange={(e) => setF("son4", e.target.value)} placeholder="**0000" />
            </div>
            <div>
              <label className={fLbl}>Kart Özelliği</label>
              <input className={fInp} value={form.kart_ozelligi} onChange={(e) => setF("kart_ozelligi", e.target.value)} placeholder="Bonus / Maximum…" />
            </div>
            <div>
              <label className={fLbl}>Kart Sahibi</label>
              <input className={fInp} value={form.kart_sahibi} onChange={(e) => setF("kart_sahibi", e.target.value)} placeholder="Kart sahibi" />
            </div>
            <div>
              <label className={fLbl}>Kartı Kullanan</label>
              <input className={fInp} value={form.karti_kullanan} onChange={(e) => setF("karti_kullanan", e.target.value)} placeholder="Kullanan" />
            </div>
            <div>
              <label className={fLbl}>Hesap Kesim (Her Ayın)</label>
              <input inputMode="numeric" className={fInp} value={form.hesap_kesim} onChange={(e) => setF("hesap_kesim", e.target.value.replace(/[^\d]/g, "").slice(0, 2))} placeholder="1-31" />
            </div>
            <div>
              <label className={fLbl}>Son Ödeme (Her Ayın)</label>
              <input inputMode="numeric" className={fInp} value={form.son_odeme} onChange={(e) => setF("son_odeme", e.target.value.replace(/[^\d]/g, "").slice(0, 2))} placeholder="1-31" />
            </div>
            <div>
              <label className={fLbl}>Limit</label>
              <input inputMode="decimal" className={`${fInp} text-right`} value={form.limit_tutar} onChange={(e) => setF("limit_tutar", formatParaInput(e.target.value))} placeholder="0" />
            </div>
            <div>
              <label className={fLbl}>Kullanılabilir Limit</label>
              <input inputMode="decimal" className={`${fInp} text-right`} value={form.kullanilabilir} onChange={(e) => setF("kullanilabilir", formatParaInput(e.target.value))} placeholder="0" />
              <div className="text-[10px] text-gray-400 mt-1">Güncel Borç = Limit − Kullanılabilir (otomatik)</div>
            </div>
            <div className="sm:col-span-2">
              <label className={fLbl}>Açıklama</label>
              <input className={fInp} value={form.aciklama} onChange={(e) => setF("aciklama", e.target.value)} placeholder="Açıklama" />
            </div>
          </div>
          <DialogFooter className="flex-col-reverse sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" onClick={() => setDialogAcik(false)} disabled={kaydediliyor}>İptal</Button>
            <Button className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white" onClick={kaydet} disabled={kaydediliyor}>
              {kaydediliyor ? "Kaydediliyor…" : editId ? "Güncelle" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
