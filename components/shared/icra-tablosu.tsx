// İcra takibi — elle girilip silinebilen icra dosyaları tablosu (Kasa ile Şantiye Defteri arasındaki "İcra" sekmesi).
// Excel birebir sütunlar. Aynı borçlu (TC/Vergi No) birden fazla satırda geçerse o satırların borçlu hücreleri
// otomatik KIRMIZI vurgulanır (tekrarlayan borçlu — Excel'deki gibi).
"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Gavel, Plus, Trash2, Loader2, Search } from "lucide-react";
import { getIcraKayitlar, insertIcraKayit, updateIcraKayit, deleteIcraKayit } from "@/lib/supabase/queries/icra";
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";

function tlFmt(n: number): string { return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function tarihSaat(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}
function sayiToInput(n: number): string {
  if (!n || n === 0) return "";
  const s = Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",");
  return formatParaInput(s || "0");
}
// TC/Vergi no normalize (boşluk/nokta at) → tekrar tespiti için
function tcNorm(v: string | null | undefined): string { return (v ?? "").replace(/[^\d]/g, ""); }

export default function IcraTablosu({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [satirlar, setSatirlar] = useState<IcraKayit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [duzen, setDuzen] = useState<Record<string, string>>({});
  const [arama, setArama] = useState("");
  // Öneri kaynakları: Yönetim → Firmalar (Üçüncü Şahıs) + Yönetim → Personeller (Borçlu)
  const [firmalar, setFirmalar] = useState<{ firma_adi: string | null }[]>([]);
  const [personeller, setPersoneller] = useState<{ ad_soyad: string | null; tc_kimlik_no: string | null }[]>([]);

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const sb = createClient();
        const [r, fRes, pRes] = await Promise.all([
          getIcraKayitlar(),
          // Hafif doğrudan sorgu (öneri için) — yetki/RLS yoksa boş döner, hata vermez
          sb.from("firmalar").select("firma_adi").then((x) => (x.data as { firma_adi: string | null }[]) ?? [], () => []),
          sb.from("personel").select("ad_soyad, tc_kimlik_no").then((x) => (x.data as { ad_soyad: string | null; tc_kimlik_no: string | null }[]) ?? [], () => []),
        ]);
        if (!iptal) {
          setSatirlar(r);
          setFirmalar(fRes);
          setPersoneller(pRes);
          setHata(null);
        }
      } catch (e) {
        if (iptal) return;
        let msg = "Bilinmeyen hata";
        if (e instanceof Error) msg = e.message;
        else if (e && typeof e === "object") { const o = e as { message?: string; details?: string; code?: string }; msg = o.message || o.details || o.code || JSON.stringify(e); }
        setHata(msg.includes("does not exist") || msg.includes("icra") || msg.includes("schema cache")
          ? "İcra tablosu Supabase'de henüz yok. sql/icra.sql dosyasını çalıştırın."
          : msg);
      } finally { if (!iptal) setLoading(false); }
    })();
    return () => { iptal = true; };
  }, []);

  // Gelen İcra Yazısı Tarihi'ne göre sırala: EN SON tarih EN ÜSTTE (yeniden eskiye); tarihsiz (yeni eklenen) satırlar sona.
  const sirali = useMemo(() => [...satirlar].sort((a, b) => {
    const ta = a.gelen_yazi_tarihi ?? "", tb = b.gelen_yazi_tarihi ?? "";
    if (ta && tb && ta !== tb) return tb.localeCompare(ta); // en son tarih üstte
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return a.sira - b.sira;
  }), [satirlar]);
  // Tekrarlayan borçlu TC/Vergi no kümesi (>1 kez geçen, dolu olanlar)
  const tekrarTc = useMemo(() => {
    const say = new Map<string, number>();
    for (const s of satirlar) { const t = tcNorm(s.borclu_tc_no); if (t) say.set(t, (say.get(t) ?? 0) + 1); }
    return new Set(Array.from(say.entries()).filter(([, n]) => n > 1).map(([t]) => t));
  }, [satirlar]);
  // Öneri listeleri — Üçüncü Şahıs: Yönetim'deki FİRMALAR; Borçlu: Yönetim'deki PERSONELLER
  const ucuncuList = useMemo(() => Array.from(new Set(firmalar.map((f) => (f.firma_adi ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")), [firmalar]);
  const borcluList = useMemo(() => Array.from(new Set(personeller.map((p) => (p.ad_soyad ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")), [personeller]);
  // Borçlu adı (BÜYÜK) → TC eşleşmesi: seçilen personelin TC'sini otomatik öner (personelde yoksa mevcut icra kaydından)
  const borcluTcMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personeller) { const ad = (p.ad_soyad ?? "").trim(); const tc = (p.tc_kimlik_no ?? "").trim(); if (ad && tc && !m.has(ad.toLocaleUpperCase("tr"))) m.set(ad.toLocaleUpperCase("tr"), tc); }
    for (const s of satirlar) { const ad = (s.borclu_adi ?? "").trim(); const tc = (s.borclu_tc_no ?? "").trim(); if (ad && tc && !m.has(ad.toLocaleUpperCase("tr"))) m.set(ad.toLocaleUpperCase("tr"), tc); }
    return m;
  }, [personeller, satirlar]);
  // S.No = tam sıralı listedeki konum (filtrede de sabit kalsın)
  const siraNo = useMemo(() => new Map(sirali.map((s, i) => [s.id, i + 1])), [sirali]);
  // Genel arama: dosya no, isim, TC, vergi no, evrak no, açıklama vb.
  const gorunen = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return sirali;
    return sirali.filter((s) => trAramaNormalize(
      [s.ucuncu_sahis, s.dosya_esas_no, s.cevap_sekli, s.evrak_no, s.alacakli_adi, s.alacakli_vergi_no, s.borclu_adi, s.borclu_tc_no, s.aciklama].filter(Boolean).join(" "),
    ).includes(q));
  }, [sirali, arama]);
  // Toplamlar görünen (filtreli) satırlara göre
  const toplamBorc = useMemo(() => gorunen.reduce((t, s) => t + Number(s.borc_miktari || 0), 0), [gorunen]);
  const toplamOdenen = useMemo(() => gorunen.reduce((t, s) => t + Number(s.odenen_tutar || 0), 0), [gorunen]);
  const sonGuncelleme = useMemo(() => {
    let en = 0;
    for (const s of satirlar) { const t = new Date(s.updated_at).getTime(); if (t > en) en = t; }
    return en ? new Date(en).toISOString() : null;
  }, [satirlar]);

  async function guncelle(id: string, patch: Partial<IcraKayit>) {
    const now = new Date().toISOString();
    setSatirlar((p) => p.map((s) => (s.id === id ? { ...s, ...patch, updated_at: now } : s)));
    try { await updateIcraKayit(id, patch); } catch { toast.error("Kaydedilemedi."); }
  }
  async function satirEkle() {
    const maxSira = satirlar.reduce((m, s) => Math.max(m, s.sira), 0);
    try {
      const row = await insertIcraKayit({ sira: maxSira + 1, borc_miktari: 0, odenen_tutar: 0 });
      setSatirlar((p) => [...p, row]);
    } catch { toast.error("Satır eklenemedi."); }
  }
  async function satirSil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu icra kaydı silinsin mi?")) return;
    try { await deleteIcraKayit(id); setSatirlar((p) => p.filter((s) => s.id !== id)); }
    catch { toast.error("Silinemedi."); }
  }

  const inputCls = "w-full min-w-0 bg-transparent px-1 py-1 text-xs outline-none rounded focus:bg-white focus:ring-1 focus:ring-blue-300 read-only:cursor-default";

  // Metin hücresi
  function metinHucre(id: string, field: keyof IcraKayit, value: string | null, ph = "", extra = "", opts?: { list?: string; onPersist?: (v: string | null) => void }) {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? (value ?? "");
    return (
      <input type="text" readOnly={!canDuzenle} placeholder={ph} list={opts?.list}
        className={`${inputCls} ${extra}`} value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: e.target.value })); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const v = duzen[key];
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (v !== (value ?? "")) {
            const yeni = v.trim() === "" ? null : v;
            if (opts?.onPersist) opts.onPersist(yeni);
            else guncelle(id, { [field]: yeni } as Partial<IcraKayit>);
          }
        }}
      />
    );
  }
  // Tarih hücresi
  function tarihHucre(id: string, field: keyof IcraKayit, value: string | null) {
    return (
      <input type="date" disabled={!canDuzenle} value={value ?? ""}
        className="w-full min-w-0 bg-transparent px-0.5 py-1 text-[11px] outline-none rounded focus:bg-white focus:ring-1 focus:ring-blue-300 disabled:cursor-default"
        onChange={(e) => guncelle(id, { [field]: e.target.value || null } as Partial<IcraKayit>)} />
    );
  }
  // Para hücresi
  function paraHucre(id: string, field: keyof IcraKayit, value: number, extra = "") {
    const key = `${id}:${field}`;
    const gosterim = duzen[key] ?? sayiToInput(value);
    return (
      <input type="text" inputMode="decimal" dir="ltr" readOnly={!canDuzenle} placeholder="0"
        className={`${inputCls} text-right tabular-nums placeholder:text-gray-300 ${extra}`} value={gosterim}
        onChange={(e) => { if (canDuzenle) setDuzen((d) => ({ ...d, [key]: formatParaInput(e.target.value) })); }}
        onBlur={() => {
          if (duzen[key] === undefined) return;
          const num = parseParaInput(duzen[key]);
          setDuzen((d) => { const c = { ...d }; delete c[key]; return c; });
          if (num !== value) guncelle(id, { [field]: num } as Partial<IcraKayit>);
        }}
      />
    );
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Yükleniyor…</div>;
  if (hata) return <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">{hata}</div>;

  const th = "px-2 py-2 font-semibold text-[#1E3A5F] border border-gray-200 text-center align-middle";
  const td = "border border-gray-100 px-0.5 py-0.5 align-middle";

  return (
    <div>
      <div className="flex items-baseline mb-4 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2"><Gavel size={24} /> İcra</h1>
        {sonGuncelleme && <span className="text-xs text-gray-400">Son güncelleme: {tarihSaat(sonGuncelleme)}</span>}
      </div>

      {/* Otomatik öneri listeleri (yazarken açılır) */}
      <datalist id="icra-ucuncu-list">{ucuncuList.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="icra-borclu-list">{borcluList.map((v) => <option key={v} value={v} />)}</datalist>

      {/* Genel arama */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-96">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
            placeholder="Dosya no, isim, TC / vergi no, evrak no, açıklama…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
        </div>
        {arama.trim() && <span className="text-xs text-gray-500">{gorunen.length} kayıt</span>}
      </div>

      <div className="w-full bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="text-xs border-collapse w-full table-fixed">
          <colgroup>
            <col className="w-[3%]" />{/* S.No */}
            <col className="w-[8%]" />{/* Üçüncü Şahıs */}
            <col className="w-[6%]" />{/* Dosya Esas No */}
            <col className="w-[6%]" />{/* Gelen Yazı */}
            <col className="w-[6%]" />{/* Tebliğ */}
            <col className="w-[6%]" />{/* Cevap Tarihi */}
            <col className="w-[7%]" />{/* Cevap Şekli */}
            <col className="w-[6%]" />{/* Evrak No */}
            <col className="w-[11%]" />{/* Alacaklı Adı */}
            <col className="w-[6%]" />{/* Alacaklı Vergi */}
            <col className="w-[11%]" />{/* Borçlu Adı */}
            <col className="w-[6%]" />{/* Borçlu TC */}
            <col className="w-[6%]" />{/* Borç */}
            <col className="w-[6%]" />{/* Ödenen */}
            <col className={canSil ? "w-[7%]" : "w-[10%]"} />{/* Açıklama */}
            {canSil && <col className="w-[3%]" />}
          </colgroup>
          <thead className="bg-gray-100">
            <tr>
              <th rowSpan={2} className={th}>S.No</th>
              <th rowSpan={2} className={th}>Üçüncü Şahıs</th>
              <th rowSpan={2} className={th}>Dosya Esas No</th>
              <th rowSpan={2} className={th}>Gelen İcra Yazısı Tarihi</th>
              <th rowSpan={2} className={th}>Tebliğ Tarihi</th>
              <th rowSpan={2} className={th}>İcraya Cevap Tarihi</th>
              <th rowSpan={2} className={th}>Cevap Şekli</th>
              <th rowSpan={2} className={th}>Evrak No</th>
              <th colSpan={2} className={th}>Alacaklı Bilgileri</th>
              <th colSpan={2} className={`${th} bg-red-50`}>Borçlu Bilgileri</th>
              <th rowSpan={2} className={th}>Borç Miktarı</th>
              <th rowSpan={2} className={th}>Ödenen Tutar</th>
              <th rowSpan={2} className={th}>Açıklama</th>
              {canSil && <th rowSpan={2} className={th} />}
            </tr>
            <tr>
              <th className={th}>Adı Soyadı / Ünvanı</th>
              <th className={th}>Vergi No</th>
              <th className={`${th} bg-red-50`}>Adı Soyadı / Ünvanı</th>
              <th className={`${th} bg-red-50`}>Vergi / TC No</th>
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 && (
              <tr><td colSpan={canSil ? 16 : 15} className="text-center text-gray-400 py-8">
                {arama.trim() ? "Aramayla eşleşen kayıt yok." : `Henüz kayıt yok.${canEkle ? " Aşağıdan “Satır Ekle” ile başlayın." : ""}`}
              </td></tr>
            )}
            {gorunen.map((s) => {
              const tekrar = tekrarTc.has(tcNorm(s.borclu_tc_no)); // tekrarlayan borçlu → kırmızı vurgu
              const borcluCls = tekrar ? "bg-red-100" : "";
              const borcluTxt = tekrar ? "text-red-700 font-medium" : "";
              const evrakGerekli = !!s.cevap_tarihi && !(s.evrak_no ?? "").trim(); // cevap tarihi var, evrak no yok → zorunlu
              return (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className={`${td} text-center text-gray-500 tabular-nums`}>{siraNo.get(s.id)}</td>
                  <td className={td}>{metinHucre(s.id, "ucuncu_sahis", s.ucuncu_sahis, "Üçüncü şahıs", "", { list: "icra-ucuncu-list" })}</td>
                  <td className={td}>{metinHucre(s.id, "dosya_esas_no", s.dosya_esas_no, "2020/0000")}</td>
                  <td className={td}>{tarihHucre(s.id, "gelen_yazi_tarihi", s.gelen_yazi_tarihi)}</td>
                  <td className={td}>{tarihHucre(s.id, "teblig_tarihi", s.teblig_tarihi)}</td>
                  <td className={td}>{tarihHucre(s.id, "cevap_tarihi", s.cevap_tarihi)}</td>
                  <td className={td}>{metinHucre(s.id, "cevap_sekli", s.cevap_sekli, "Cevap şekli")}</td>
                  <td className={`${td} ${evrakGerekli ? "bg-red-50" : ""}`} title={evrakGerekli ? "Cevap tarihi girildi — evrak no zorunlu" : undefined}>
                    {metinHucre(s.id, "evrak_no", s.evrak_no, evrakGerekli ? "Zorunlu!" : "Evrak no", evrakGerekli ? "ring-1 ring-red-400 placeholder:text-red-500" : "")}
                  </td>
                  <td className={td}>{metinHucre(s.id, "alacakli_adi", s.alacakli_adi, "Alacaklı")}</td>
                  <td className={td}>{metinHucre(s.id, "alacakli_vergi_no", s.alacakli_vergi_no, "Vergi no")}</td>
                  <td className={`${td} ${borcluCls}`}>{metinHucre(s.id, "borclu_adi", s.borclu_adi, "Borçlu", borcluTxt, {
                    list: "icra-borclu-list",
                    onPersist: (v) => {
                      const patch: Partial<IcraKayit> = { borclu_adi: v };
                      // Bilinen borçlu adı + bu satırın TC'si boşsa → TC'yi otomatik doldur (öner)
                      if (v && !s.borclu_tc_no) { const tc = borcluTcMap.get(v.toLocaleUpperCase("tr")); if (tc) patch.borclu_tc_no = tc; }
                      guncelle(s.id, patch);
                    },
                  })}</td>
                  <td className={`${td} ${borcluCls}`}>{metinHucre(s.id, "borclu_tc_no", s.borclu_tc_no, "TC / Vergi no", borcluTxt)}</td>
                  <td className={td}>{paraHucre(s.id, "borc_miktari", Number(s.borc_miktari || 0), "text-red-600")}</td>
                  <td className={td}>{paraHucre(s.id, "odenen_tutar", Number(s.odenen_tutar || 0), "text-emerald-700")}</td>
                  <td className={td}>{metinHucre(s.id, "aciklama", s.aciklama, "Açıklama")}</td>
                  {canSil && (
                    <td className={`${td} text-center`}>
                      <button type="button" onClick={() => satirSil(s.id)} className="text-gray-300 hover:text-red-600" title="Satırı sil"><Trash2 size={14} /></button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-[#1E3A5F]">
              <td className={`${td} text-right`} colSpan={12}>TOPLAM</td>
              <td className={`${td} text-right tabular-nums text-red-600 px-2`}>{tlFmt(toplamBorc)}</td>
              <td className={`${td} text-right tabular-nums text-emerald-700 px-2`}>{tlFmt(toplamOdenen)}</td>
              <td className={td} />
              {canSil && <td className={td} />}
            </tr>
          </tfoot>
        </table>
      </div>

      {canEkle && (
        <div className="mt-3">
          <button type="button" onClick={satirEkle} className="flex items-center gap-1.5 h-9 px-3 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus size={15} /> Satır Ekle
          </button>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Aynı borçlu (TC / Vergi No) birden fazla dosyada geçiyorsa o satırlar <span className="text-red-600 font-medium">kırmızı</span> vurgulanır ·
        İcraya Cevap Tarihi girildiğinde <span className="text-red-600 font-medium">Evrak No zorunludur</span> (boşsa kırmızı).
      </p>
    </div>
  );
}
