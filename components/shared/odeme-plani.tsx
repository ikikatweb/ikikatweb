// Ödeme Planı — elle girilip silinebilen ileriye dönük nakit planı (Kasa Defteri "Ödeme Planı" sekmesi).
// İki tablo: (1) ödeme/tahsilat satırları, (2) yan "Kullanılabilir Krediler ve Kasa" listesi.
// Kümülatif OTOMATİK: başlangıç = yan liste TOPLAM'ı, her satırda -gider +gelir (yürüyen bakiye).
"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, Plus, Trash2, Loader2 } from "lucide-react";
import {
  getOdemePlaniSatirlar, insertOdemePlaniSatir, updateOdemePlaniSatir, deleteOdemePlaniSatir,
  getOdemePlaniKasa, insertOdemePlaniKasa, updateOdemePlaniKasa, deleteOdemePlaniKasa,
} from "@/lib/supabase/queries/odeme-plani";
import type { OdemePlaniSatir, OdemePlaniKasa } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

const GUNLER = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
// Tarih grubu renkleri (yumuşak tonlar — hücreler okunur kalsın)
const PALET = ["bg-orange-50", "bg-sky-50", "bg-violet-50", "bg-emerald-50", "bg-rose-50", "bg-amber-50", "bg-teal-50"];

function gunAdi(tarih: string): string { const d = new Date(tarih + "T00:00:00"); return GUNLER[d.getDay()] ?? ""; }
function tarihUzun(tarih: string): string {
  const d = new Date(tarih + "T00:00:00");
  return `${d.getDate()} ${AYLAR[d.getMonth()] ?? ""} ${d.getFullYear()} ${GUNLER[d.getDay()] ?? ""}`;
}
function tlFmt(n: number): string { return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function tarihSaat(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}
// number → input gösterimi ("1.234.567,89"); boşZero=true ise 0 boş görünür
function sayiToInput(n: number, bosZero = true): string {
  if (bosZero && (!n || n === 0)) return "";
  const s = Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ","); // yalnız tam ",00"u kaldır (,30 gibi korunur)
  return formatParaInput(s || "0");
}
function bugunStr(): string { return new Date().toISOString().slice(0, 10); }

export default function OdemePlani({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [satirlar, setSatirlar] = useState<OdemePlaniSatir[]>([]);
  const [kasa, setKasa] = useState<OdemePlaniKasa[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  // Düzenlenirken geçici string (id:field) — sayı/metin serbest yazılabilsin, blur'da parse+kaydet
  const [duzen, setDuzen] = useState<Record<string, string>>({});

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const [s, k] = await Promise.all([getOdemePlaniSatirlar(), getOdemePlaniKasa()]);
        if (iptal) return;
        setSatirlar(s); setKasa(k); setHata(null);
      } catch (e) {
        if (iptal) return;
        // Supabase hataları Error instance DEĞİL (düz obje) → mesajı elle ayıkla ("[object Object]" olmasın)
        let msg = "Bilinmeyen hata";
        if (e instanceof Error) msg = e.message;
        else if (typeof e === "string") msg = e;
        else if (e && typeof e === "object") {
          const o = e as { message?: string; details?: string; hint?: string; code?: string };
          msg = o.message || o.details || o.hint || o.code || JSON.stringify(e);
        }
        setHata(msg.includes("does not exist") || msg.includes("odeme_plani") || msg.includes("schema cache")
          ? "Ödeme planı tabloları Supabase'de henüz yok. sql/odeme_plani.sql dosyasını çalıştırın."
          : msg);
      } finally { if (!iptal) setLoading(false); }
    })();
    return () => { iptal = true; };
  }, []);

  // Sıralı satırlar (tarih, sıra) + kümülatif
  const sirali = useMemo(
    () => [...satirlar].sort((a, b) => a.tarih.localeCompare(b.tarih) || a.sira - b.sira),
    [satirlar],
  );
  const kasaToplam = useMemo(() => kasa.reduce((t, k) => t + Number(k.tutar || 0), 0), [kasa]);
  const kumulatifler = useMemo(() => {
    const arr: number[] = []; let run = kasaToplam;
    for (const s of sirali) { run = run - Number(s.gider || 0) + Number(s.gelir || 0); arr.push(run); }
    return arr;
  }, [sirali, kasaToplam]);
  const tarihRenk = useMemo(() => {
    const m = new Map<string, string>(); let i = 0;
    for (const s of sirali) if (!m.has(s.tarih)) { m.set(s.tarih, PALET[i % PALET.length]); i++; }
    return m;
  }, [sirali]);
  const toplamGider = useMemo(() => satirlar.reduce((t, s) => t + Number(s.gider || 0), 0), [satirlar]);
  const toplamGelir = useMemo(() => satirlar.reduce((t, s) => t + Number(s.gelir || 0), 0), [satirlar]);
  const sonKumulatif = kumulatifler.length ? kumulatifler[kumulatifler.length - 1] : kasaToplam;
  // En son güncelleme = tüm satır + kasa updated_at'larının en yenisi
  const sonGuncelleme = useMemo(() => {
    let en = 0;
    for (const s of satirlar) { const t = new Date(s.updated_at).getTime(); if (t > en) en = t; }
    for (const k of kasa) { const t = new Date(k.updated_at).getTime(); if (t > en) en = t; }
    return en ? new Date(en).toISOString() : null;
  }, [satirlar, kasa]);

  // ---- Satır işlemleri ----
  async function satirGuncelle(id: string, patch: Partial<OdemePlaniSatir>) {
    const now = new Date().toISOString();
    setSatirlar((p) => p.map((s) => (s.id === id ? { ...s, ...patch, updated_at: now } : s)));
    try { await updateOdemePlaniSatir(id, patch); } catch { toast.error("Kaydedilemedi."); }
  }
  async function satirEkle() {
    const sonTarih = satirlar.length ? [...satirlar].sort((a, b) => a.tarih.localeCompare(b.tarih))[satirlar.length - 1].tarih : bugunStr();
    const maxSira = satirlar.reduce((m, s) => Math.max(m, s.sira), 0);
    try {
      const row = await insertOdemePlaniSatir({ tarih: sonTarih, aciklama: "", gider: 0, gelir: 0, sira: maxSira + 1 });
      setSatirlar((p) => [...p, row]);
    } catch { toast.error("Satır eklenemedi."); }
  }
  async function satirSil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu satır silinsin mi?")) return;
    try { await deleteOdemePlaniSatir(id); setSatirlar((p) => p.filter((s) => s.id !== id)); }
    catch { toast.error("Silinemedi."); }
  }

  // ---- Yan kasa işlemleri ----
  async function kasaGuncelle(id: string, patch: Partial<OdemePlaniKasa>) {
    const now = new Date().toISOString();
    setKasa((p) => p.map((k) => (k.id === id ? { ...k, ...patch, updated_at: now } : k)));
    try { await updateOdemePlaniKasa(id, patch); } catch { toast.error("Kaydedilemedi."); }
  }
  async function kasaEkle() {
    const maxSira = kasa.reduce((m, k) => Math.max(m, k.sira), 0);
    try {
      const row = await insertOdemePlaniKasa({ etiket: "", tutar: 0, sira: maxSira + 1 });
      setKasa((p) => [...p, row]);
    } catch { toast.error("Satır eklenemedi."); }
  }
  async function kasaSil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu satır silinsin mi?")) return;
    try { await deleteOdemePlaniKasa(id); setKasa((p) => p.filter((k) => k.id !== id)); }
    catch { toast.error("Silinemedi."); }
  }

  const inputCls = "w-full bg-transparent px-1.5 py-1 text-sm outline-none rounded focus:bg-white focus:ring-1 focus:ring-blue-300 read-only:cursor-default disabled:cursor-default";

  // Sayı hücresi (blur'da parse+kaydet; boş=0)
  function paraHucre(id: string, field: string, value: number, persist: (n: number) => void, bosZero = true, extra = "") {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? sayiToInput(value, bosZero);
    return (
      <input
        type="text" inputMode="decimal" dir="ltr"
        readOnly={!canDuzenle}
        className={`${inputCls} text-right tabular-nums ${extra}`}
        value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: formatParaInput(e.target.value) })); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const num = parseParaInput(duzen[key]);
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (num !== value) persist(num);
        }}
      />
    );
  }
  // Metin hücresi
  function metinHucre(id: string, field: string, value: string | null, persist: (v: string | null) => void, ph = "") {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? (value ?? "");
    return (
      <input
        type="text" readOnly={!canDuzenle} placeholder={ph}
        className={inputCls}
        value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: e.target.value })); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const v = duzen[key];
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (v !== (value ?? "")) persist(v.trim() === "" ? null : v);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
        <Loader2 size={18} className="animate-spin" /> Yükleniyor…
      </div>
    );
  }
  if (hata) {
    return <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">{hata}</div>;
  }

  return (
    <div>
      <div className="flex items-baseline mb-4 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
          <CalendarClock size={24} /> Ödeme Planı
        </h1>
        {sonGuncelleme && (
          <span className="text-xs text-gray-400">Son güncelleme: {tarihSaat(sonGuncelleme)}</span>
        )}
      </div>

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        {/* Ana tablo — Ödeme ve Tahsilatlar */}
        <div className="flex-1 min-w-0 w-full bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[#F0A868] text-[#5b3a1a]">
                  <th className="text-left font-semibold px-2 py-2 w-44">Tarih</th>
                  <th className="text-left font-semibold px-2 py-2">Ödeme ve Tahsilatlar</th>
                  <th className="text-right font-semibold px-2 py-2 w-32">Gider</th>
                  <th className="text-right font-semibold px-2 py-2 w-32">Gelir</th>
                  <th className="text-right font-semibold px-2 py-2 w-36">Kümülatif</th>
                  {canSil && <th className="w-8" />}
                </tr>
              </thead>
              <tbody>
                {sirali.length === 0 && (
                  <tr><td colSpan={canSil ? 6 : 5} className="text-center text-gray-400 py-8">
                    Henüz satır yok.{canEkle ? " Aşağıdan “Satır Ekle” ile başlayın." : ""}
                  </td></tr>
                )}
                {sirali.map((s, i) => {
                  const kum = kumulatifler[i] ?? 0;
                  return (
                    <tr key={s.id} className={`border-b border-gray-100 ${tarihRenk.get(s.tarih) ?? ""}`}>
                      <td className="px-1 py-0.5 align-middle">
                        <input type="date" value={s.tarih} disabled={!canDuzenle}
                          onChange={(e) => e.target.value && satirGuncelle(s.id, { tarih: e.target.value })}
                          className="w-full bg-transparent px-1 py-0.5 text-xs outline-none rounded focus:bg-white focus:ring-1 focus:ring-blue-300 disabled:cursor-default" />
                        <div className="text-[10px] text-gray-500 px-1.5 truncate" title={tarihUzun(s.tarih)}>{gunAdi(s.tarih)}</div>
                      </td>
                      <td className="px-1 py-0.5">{metinHucre(s.id, "aciklama", s.aciklama, (v) => satirGuncelle(s.id, { aciklama: v }), "Açıklama")}</td>
                      <td className="px-1 py-0.5">{paraHucre(s.id, "gider", Number(s.gider || 0), (n) => satirGuncelle(s.id, { gider: n }), true, "text-red-600")}</td>
                      <td className="px-1 py-0.5">{paraHucre(s.id, "gelir", Number(s.gelir || 0), (n) => satirGuncelle(s.id, { gelir: n }), true, "text-emerald-700")}</td>
                      <td className={`px-2 py-1 text-right tabular-nums font-semibold ${kum < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>{tlFmt(kum)}</td>
                      {canSil && (
                        <td className="px-1 py-0.5 text-center">
                          <button type="button" onClick={() => satirSil(s.id)} className="text-gray-300 hover:text-red-600" title="Satırı sil">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-[#1E3A5F]">
                  <td className="px-2 py-2" colSpan={2}>TOPLAM</td>
                  <td className="px-2 py-2 text-right tabular-nums text-red-600">{tlFmt(toplamGider)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{tlFmt(toplamGelir)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${sonKumulatif < 0 ? "text-red-600" : "text-[#1E3A5F]"}`}>{tlFmt(sonKumulatif)}</td>
                  {canSil && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
          {canEkle && (
            <div className="p-2 border-t border-gray-100">
              <button type="button" onClick={satirEkle} className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus size={14} /> Satır Ekle
              </button>
            </div>
          )}
        </div>

        {/* Yan tablo — Kullanılabilir Krediler ve Kasa */}
        <div className="w-full xl:w-80 shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-gray-200 text-[#1E3A5F] font-semibold text-center px-2 py-2 text-sm">Kullanılabilir Krediler ve Kasa</div>
          <table className="w-full text-sm border-collapse">
            <tbody>
              {kasa.length === 0 && (
                <tr><td className="text-center text-gray-400 py-6 text-xs">Henüz kayıt yok.</td></tr>
              )}
              {kasa.map((k) => (
                <tr key={k.id} className="border-b border-gray-100">
                  <td className="px-1 py-0.5 w-28">{paraHucre(k.id, "tutar", Number(k.tutar || 0), (n) => kasaGuncelle(k.id, { tutar: n }), false)}</td>
                  <td className="px-1 py-0.5">{metinHucre(k.id, "etiket", k.etiket, (v) => kasaGuncelle(k.id, { etiket: v }), "Banka / Kasa")}</td>
                  {canSil && (
                    <td className="px-1 py-0.5 text-center w-8">
                      <button type="button" onClick={() => kasaSil(k.id)} className="text-gray-300 hover:text-red-600" title="Satırı sil">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-300 font-bold text-[#1E3A5F]">
                <td className="px-1.5 py-2 text-right tabular-nums">{tlFmt(kasaToplam)}</td>
                <td className="px-1.5 py-2" colSpan={canSil ? 2 : 1}>TOPLAM</td>
              </tr>
            </tfoot>
          </table>
          {canEkle && (
            <div className="p-2 border-t border-gray-100">
              <button type="button" onClick={kasaEkle} className="flex items-center gap-1.5 h-8 px-3 text-sm rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700 border">
                <Plus size={14} /> Satır Ekle
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-3">
        Kümülatif otomatik: başlangıç = “Kullanılabilir Krediler ve Kasa” toplamı, her satırda gider düşülür / gelir eklenir.
      </p>
    </div>
  );
}
