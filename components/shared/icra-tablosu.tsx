// İcra takibi — dosyalar TABLODA salt-okunur listelenir; ekleme/düzenleme PENCERE (dialog) formundan yapılır.
// Aynı borçlu (TC/Vergi No) birden fazla satırda geçerse o satırın borçlu hücreleri KIRMIZI vurgulanır.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Gavel, Plus, Trash2, Loader2, Search, Pencil, ChevronDown } from "lucide-react";
import { getIcraKayitlar, insertIcraKayit, updateIcraKayit, deleteIcraKayit } from "@/lib/supabase/queries/icra";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Cevap Şekli varsayılanları (Tanımlamalar boşsa kullanılır). Tanımlamalar sekmesinden yönetilir.
export const ICRA_CEVAP_VARSAYILAN = ["KEP", "İadeli Taahütlü", "Banka", "Dijital Vergi Dairesi"];

function tlFmt(n: number): string { return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function paraGoster(n: number): string { return n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
function tarihGoster(v: string | null): string { return v ? v.split("-").reverse().join(".") : ""; }
function tarihSaat(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" })} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
}
function sayiToInput(n: number): string {
  if (!n || n === 0) return "";
  const s = Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",");
  return formatParaInput(s || "0");
}
function tcNorm(v: string | null | undefined): string { return (v ?? "").replace(/[^\d]/g, ""); }

type IcraForm = {
  ucuncu_sahis: string; dosya_esas_no: string; gelen_yazi_tarihi: string; teblig_tarihi: string;
  cevap_tarihi: string; cevap_sekli: string; odenen_tutar: string; evrak_no: string;
  alacakli_adi: string; alacakli_vergi_no: string; borclu_adi: string; borclu_tc_no: string;
  borc_miktari: string;
};
const BOS_FORM: IcraForm = {
  ucuncu_sahis: "", dosya_esas_no: "", gelen_yazi_tarihi: "", teblig_tarihi: "",
  cevap_tarihi: "", cevap_sekli: "", odenen_tutar: "", evrak_no: "",
  alacakli_adi: "", alacakli_vergi_no: "", borclu_adi: "", borclu_tc_no: "",
  borc_miktari: "",
};

export default function IcraTablosu({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [satirlar, setSatirlar] = useState<IcraKayit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [arama, setArama] = useState("");
  const [hepsiGoster, setHepsiGoster] = useState(false); // ilk 100 kayıt; fazlası "ok" ile açılır
  const [kompakt, setKompakt] = useState(false); // dar ekran (yatay telefon) → Alacaklı Vergi + Borçlu TC sütunları gizli
  const [firmalar, setFirmalar] = useState<{ firma_adi: string | null; renk?: string | null }[]>([]);
  const [personeller, setPersoneller] = useState<{ ad_soyad: string | null; tc_kimlik_no: string | null }[]>([]);
  const [cevapSekilleri, setCevapSekilleri] = useState<string[]>(ICRA_CEVAP_VARSAYILAN);
  // Dialog
  const [dialogAcik, setDialogAcik] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<IcraForm>(BOS_FORM);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const formRef = useRef<HTMLDivElement>(null); // Enter ile sonraki alana geçiş
  const [kilitli, setKilitli] = useState(false); // dashboard "Tarih gir" (?kilit=1): mevcut veriler kilitli, yalnız cevap/ödeme girilir

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const sb = createClient();
        const [r, fRes, pRes, cevap] = await Promise.all([
          getIcraKayitlar(),
          sb.from("firmalar").select("firma_adi, renk").then((x) => (x.data as { firma_adi: string | null; renk?: string | null }[]) ?? [], () => []),
          sb.from("personel").select("ad_soyad, tc_kimlik_no").then((x) => (x.data as { ad_soyad: string | null; tc_kimlik_no: string | null }[]) ?? [], () => []),
          getDegerler("icra_cevap_sekli").catch(() => [] as string[]),
        ]);
        if (!iptal) {
          setSatirlar(r); setFirmalar(fRes); setPersoneller(pRes);
          setCevapSekilleri(cevap.length > 0 ? cevap : ICRA_CEVAP_VARSAYILAN);
          setHata(null);
        }
      } catch (e) {
        if (iptal) return;
        let msg = "Bilinmeyen hata";
        if (e instanceof Error) msg = e.message;
        else if (e && typeof e === "object") { const o = e as { message?: string; details?: string; code?: string }; msg = o.message || o.details || o.code || JSON.stringify(e); }
        setHata(msg.includes("does not exist") || msg.includes("icra") || msg.includes("schema cache")
          ? "İcra tablosu Supabase'de henüz yok. sql/icra.sql dosyasını çalıştırın." : msg);
      } finally { if (!iptal) setLoading(false); }
    })();
    return () => { iptal = true; };
  }, []);

  // Dashboard'dan "?duzenle=<id>" ile gelinince ilgili dosyanın DÜZENLE penceresini otomatik aç (bir kez).
  const duzenleAcildiRef = useRef(false);
  useEffect(() => {
    if (loading || duzenleAcildiRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("duzenle");
    if (!id) return;
    const row = satirlar.find((s) => s.id === id);
    if (row) { duzenleAcildiRef.current = true; dialogAc(row); if (params.get("kilit") === "1") setKilitli(true); }
  }, [loading, satirlar]);

  // Dar ekran (yatay telefon / küçük pencere, <1024px) → tabloda bazı sütunları gizle
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const uygula = () => setKompakt(mq.matches);
    uygula();
    mq.addEventListener("change", uygula);
    return () => mq.removeEventListener("change", uygula);
  }, []);

  const sirali = useMemo(() => [...satirlar].sort((a, b) => {
    const ta = a.gelen_yazi_tarihi ?? "", tb = b.gelen_yazi_tarihi ?? "";
    if (ta && tb && ta !== tb) return tb.localeCompare(ta);
    if (ta && !tb) return -1;
    if (!ta && tb) return 1;
    return a.sira - b.sira;
  }), [satirlar]);
  const tekrarTc = useMemo(() => {
    const say = new Map<string, number>();
    for (const s of satirlar) { const t = tcNorm(s.borclu_tc_no); if (t) say.set(t, (say.get(t) ?? 0) + 1); }
    return new Set(Array.from(say.entries()).filter(([, n]) => n > 1).map(([t]) => t));
  }, [satirlar]);
  const ucuncuList = useMemo(() => Array.from(new Set(firmalar.map((f) => (f.firma_adi ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")), [firmalar]);
  // Firma adı (BÜYÜK) → tanımlı renk (Üçüncü Şahıs hücresinde gösterilir)
  const firmaRenkMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmalar) { const ad = (f.firma_adi ?? "").trim().toLocaleUpperCase("tr"); if (ad && f.renk) m.set(ad, f.renk); }
    return m;
  }, [firmalar]);
  const firmaRengi = (ad: string | null) => firmaRenkMap.get((ad ?? "").trim().toLocaleUpperCase("tr")) ?? null;
  const borcluList = useMemo(() => Array.from(new Set(personeller.map((p) => (p.ad_soyad ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")), [personeller]);
  const borcluTcMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of personeller) { const ad = (p.ad_soyad ?? "").trim(); const tc = (p.tc_kimlik_no ?? "").trim(); if (ad && tc && !m.has(ad.toLocaleUpperCase("tr"))) m.set(ad.toLocaleUpperCase("tr"), tc); }
    for (const s of satirlar) { const ad = (s.borclu_adi ?? "").trim(); const tc = (s.borclu_tc_no ?? "").trim(); if (ad && tc && !m.has(ad.toLocaleUpperCase("tr"))) m.set(ad.toLocaleUpperCase("tr"), tc); }
    return m;
  }, [personeller, satirlar]);
  const siraNo = useMemo(() => new Map(sirali.map((s, i) => [s.id, i + 1])), [sirali]);
  const gorunen = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    if (!q) return sirali;
    return sirali.filter((s) => trAramaNormalize(
      [s.ucuncu_sahis, s.dosya_esas_no, s.cevap_sekli, s.evrak_no, s.alacakli_adi, s.alacakli_vergi_no, s.borclu_adi, s.borclu_tc_no].filter(Boolean).join(" "),
    ).includes(q));
  }, [sirali, arama]);
  const LIMIT = 100;
  const gosterilecek = hepsiGoster ? gorunen : gorunen.slice(0, LIMIT); // ilk 100; fazlası "ok" ile açılır
  const toplamBorc = useMemo(() => gorunen.reduce((t, s) => t + Number(s.borc_miktari || 0), 0), [gorunen]);
  const toplamOdenen = useMemo(() => gorunen.reduce((t, s) => t + Number(s.odenen_tutar || 0), 0), [gorunen]);
  const sonGuncelleme = useMemo(() => {
    let en = 0;
    for (const s of satirlar) { const t = new Date(s.updated_at).getTime(); if (t > en) en = t; }
    return en ? new Date(en).toISOString() : null;
  }, [satirlar]);

  // ---- Dialog ----
  function dialogAc(row?: IcraKayit) {
    if (row) {
      setEditId(row.id);
      setForm({
        ucuncu_sahis: row.ucuncu_sahis ?? "", dosya_esas_no: row.dosya_esas_no ?? "",
        gelen_yazi_tarihi: row.gelen_yazi_tarihi ?? "", teblig_tarihi: row.teblig_tarihi ?? "",
        cevap_tarihi: row.cevap_tarihi ?? "", cevap_sekli: row.cevap_sekli ?? "",
        odenen_tutar: sayiToInput(Number(row.odenen_tutar || 0)), evrak_no: row.evrak_no ?? "",
        alacakli_adi: row.alacakli_adi ?? "", alacakli_vergi_no: row.alacakli_vergi_no ?? "",
        borclu_adi: row.borclu_adi ?? "", borclu_tc_no: row.borclu_tc_no ?? "",
        borc_miktari: sayiToInput(Number(row.borc_miktari || 0)),
      });
    } else { setEditId(null); setForm(BOS_FORM); }
    setKilitli(false); // normal aç (kalem/yeni) → kilitsiz; ?kilit=1 efekti sonra true yapar
    setDialogAcik(true);
  }
  const setF = (k: keyof IcraForm, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Borçlu adı girilince TC boşsa bilinen borçlunun TC'sini otomatik doldur
  function borcluAdiBlur() {
    const ad = form.borclu_adi.trim();
    if (ad && !form.borclu_tc_no.trim()) { const tc = borcluTcMap.get(ad.toLocaleUpperCase("tr")); if (tc) setF("borclu_tc_no", tc); }
  }
  // Formda Enter → bir SONRAKİ alana geç (submit etmez).
  function formEnter(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
    e.preventDefault();
    const root = formRef.current;
    if (!root) return;
    const odak = Array.from(root.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled])"));
    const i = odak.indexOf(el);
    if (i >= 0 && i + 1 < odak.length) odak[i + 1].focus();
  }
  async function kaydet() {
    if (editId ? !canDuzenle : !canEkle) { toast.error("Yetkiniz yok."); return; }
    // Zorunlu alanlar
    const zorunlu: [string, string][] = [
      [form.ucuncu_sahis, "Üçüncü Şahıs"],
      [form.dosya_esas_no, "Dosya Esas No"],
      [form.gelen_yazi_tarihi, "Gelen İcra Yazısı Tarihi"],
      [form.teblig_tarihi, "Tebliğ Tarihi"],
      [form.alacakli_adi, "Alacaklı Adı Soyadı / Ünvanı"],
      [form.borclu_adi, "Borçlu Adı Soyadı / Ünvanı"],
      [form.borclu_tc_no, "Borçlu Vergi / TC No"],
    ];
    for (const [v, ad] of zorunlu) if (!v.trim()) { toast.error(`${ad} zorunlu.`); return; }
    if (parseParaInput(form.borc_miktari) <= 0) { toast.error("Borç Miktarı zorunlu."); return; }
    // İcraya Cevap Tarihi girildiyse Evrak No zorunlu
    if (form.cevap_tarihi && !form.evrak_no.trim()) { toast.error("İcraya cevap tarihi girildi — Evrak No zorunludur."); return; }
    const t = (v: string) => (v.trim() === "" ? null : v.trim());
    const payload: Partial<IcraKayit> = {
      ucuncu_sahis: t(form.ucuncu_sahis), dosya_esas_no: t(form.dosya_esas_no),
      gelen_yazi_tarihi: form.gelen_yazi_tarihi || null, teblig_tarihi: form.teblig_tarihi || null,
      cevap_tarihi: form.cevap_tarihi || null, cevap_sekli: t(form.cevap_sekli),
      odenen_tutar: parseParaInput(form.odenen_tutar), evrak_no: t(form.evrak_no),
      alacakli_adi: t(form.alacakli_adi), alacakli_vergi_no: t(form.alacakli_vergi_no),
      borclu_adi: t(form.borclu_adi), borclu_tc_no: t(form.borclu_tc_no),
      borc_miktari: parseParaInput(form.borc_miktari),
    };
    setKaydediliyor(true);
    try {
      if (editId) {
        await updateIcraKayit(editId, payload);
        setSatirlar((p) => p.map((s) => (s.id === editId ? { ...s, ...payload, updated_at: new Date().toISOString() } : s)));
      } else {
        const maxSira = satirlar.reduce((m, s) => Math.max(m, s.sira), 0);
        const row = await insertIcraKayit({ ...payload, sira: maxSira + 1 });
        setSatirlar((p) => [...p, row]);
      }
      toast.success(editId ? "İcra dosyası güncellendi." : "İcra dosyası eklendi.");
      setDialogAcik(false);
    } catch { toast.error("Kaydedilemedi."); }
    finally { setKaydediliyor(false); }
  }
  async function sil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu icra dosyası silinsin mi?")) return;
    try { await deleteIcraKayit(id); setSatirlar((p) => p.filter((s) => s.id !== id)); }
    catch { toast.error("Silinemedi."); }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Yükleniyor…</div>;
  if (hata) return <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">{hata}</div>;

  const th = "px-2 py-2 font-semibold text-[#1E3A5F] border border-gray-200 text-center align-middle";
  const td = "border border-gray-100 px-1.5 py-1.5 align-middle text-[11px] truncate";
  const islemVar = canDuzenle || canSil;
  // Form input sınıfları
  const fLbl = "text-xs font-medium text-gray-600 mb-1 block";
  const fInp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";
  const kilitInp = kilitli ? "bg-gray-100 text-gray-500 cursor-not-allowed" : ""; // kilitli alan görünümü
  // Zorunlu alanların hepsi dolu mu? (Kaydet butonu buna göre aktifleşir) — cevap tarihi varsa evrak no da zorunlu.
  const formGecerli = Boolean(
    form.ucuncu_sahis.trim() && form.dosya_esas_no.trim() && form.gelen_yazi_tarihi && form.teblig_tarihi &&
    form.alacakli_adi.trim() &&
    form.borclu_adi.trim() && form.borclu_tc_no.trim() &&
    parseParaInput(form.borc_miktari) > 0 &&
    (!form.cevap_tarihi || form.evrak_no.trim()),
  );

  return (
    <div>
      <div className="flex items-baseline mb-4 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2"><Gavel size={24} /> İcra Takibi</h1>
        {sonGuncelleme && <span className="text-xs text-gray-400">Son güncelleme: {tarihSaat(sonGuncelleme)}</span>}
        {canEkle && (
          <button type="button" onClick={() => dialogAc()}
            className="ml-auto flex items-center gap-1.5 h-9 px-3 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus size={16} /> Yeni İcra Dosyası Ekle
          </button>
        )}
      </div>

      {/* Genel arama */}
      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-96">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
            placeholder="Dosya no, isim, TC / vergi no, evrak no…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
        </div>
        <span className="text-xs text-gray-500">{gorunen.length} kayıt</span>
      </div>

      {/* Tam tablo — YATAY (landscape) ve masaüstünde. Dik telefonda gizli (okunmuyor). */}
      <div className="hidden landscape:block lg:block w-full bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="text-xs text-gray-900 border-collapse w-full table-fixed">
          <colgroup>
            <col className="w-[3%]" />{/* S.No */}
            <col className="w-[3%]" />{/* Üçüncü Şahıs (renk noktası) */}
            <col className="w-[7%]" />{/* Dosya Esas No */}
            <col className="w-[7%]" />{/* Gelen Yazı */}
            <col className="w-[7%]" />{/* Tebliğ */}
            <col className="w-[7%]" />{/* Cevap Tarihi */}
            <col className="w-[8%]" />{/* Cevap Şekli */}
            <col className="w-[7%]" />{/* Ödenen */}
            <col className="w-[6%]" />{/* Evrak No */}
            <col className="w-[10%]" />{/* Alacaklı Adı */}
            {!kompakt && <col className="w-[6%]" />}{/* Alacaklı Vergi */}
            <col className="w-[10%]" />{/* Borçlu Adı */}
            {!kompakt && <col className="w-[6%]" />}{/* Borçlu TC */}
            <col className={islemVar ? "w-[8%]" : "w-[10%]"} />{/* Borç */}
            {islemVar && <col className="w-[6%]" />}
          </colgroup>
          <thead className="bg-gray-100">
            <tr>
              <th rowSpan={2} className={th}>S.No</th>
              <th rowSpan={2} className={th}></th>
              <th rowSpan={2} className={th}>Dosya Esas No</th>
              <th rowSpan={2} className={th}>Gelen İcra Yazısı Tarihi</th>
              <th rowSpan={2} className={th}>Tebliğ Tarihi</th>
              <th rowSpan={2} className={th}>İcraya Cevap Tarihi</th>
              <th rowSpan={2} className={th}>Cevap Şekli</th>
              <th rowSpan={2} className={th}>Ödenen Tutar</th>
              <th rowSpan={2} className={th}>Evrak No</th>
              <th colSpan={kompakt ? 1 : 2} className={th}>Alacaklı Bilgileri</th>
              <th colSpan={kompakt ? 1 : 2} className={`${th} bg-red-50`}>Borçlu Bilgileri</th>
              <th rowSpan={2} className={th}>Borç Miktarı</th>
              {islemVar && <th rowSpan={2} className={th}>İşlem</th>}
            </tr>
            <tr>
              <th className={th}>Adı Soyadı / Ünvanı</th>
              {!kompakt && <th className={th}>Vergi No</th>}
              <th className={`${th} bg-red-50`}>Adı Soyadı / Ünvanı</th>
              {!kompakt && <th className={`${th} bg-red-50`}>Vergi / TC No</th>}
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 && (
              <tr><td colSpan={(islemVar ? 15 : 14) - (kompakt ? 2 : 0)} className="text-center text-gray-400 py-8">
                {arama.trim() ? "Aramayla eşleşen kayıt yok." : `Henüz kayıt yok.${canEkle ? " “Yeni İcra Dosyası Ekle” ile başlayın." : ""}`}
              </td></tr>
            )}
            {gosterilecek.map((s) => {
              const tekrar = tekrarTc.has(tcNorm(s.borclu_tc_no));
              const borcluTxt = tekrar ? "text-red-600 font-medium" : ""; // sadece isim metni kırmızı (zemin yok)
              const evrakGerekli = !!s.cevap_tarihi && !(s.evrak_no ?? "").trim();
              const cevapYok = !(s.cevap_tarihi ?? "").trim(); // icraya cevap verilmemiş → kırmızı
              return (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className={`${td} text-center text-gray-500 tabular-nums`}>{siraNo.get(s.id)}</td>
                  <td className="border border-gray-100 px-1.5 py-1.5 align-middle text-center" title={s.ucuncu_sahis ?? ""}>
                    {firmaRengi(s.ucuncu_sahis) && <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: firmaRengi(s.ucuncu_sahis)! }} />}
                  </td>
                  <td className={td} title={s.dosya_esas_no ?? ""}>{s.dosya_esas_no}</td>
                  <td className={`${td} text-center`}>{tarihGoster(s.gelen_yazi_tarihi)}</td>
                  <td className={`${td} text-center`}>{tarihGoster(s.teblig_tarihi)}</td>
                  <td className={`${td} text-center ${cevapYok ? "bg-red-100 text-red-600 font-medium" : ""}`} title={cevapYok ? "İcraya cevap verilmemiş" : undefined}>{cevapYok ? "Cevap yok" : tarihGoster(s.cevap_tarihi)}</td>
                  <td className={td} title={s.cevap_sekli ?? ""}>{s.cevap_sekli}</td>
                  <td className={`${td} text-right tabular-nums text-emerald-700`}>{paraGoster(Number(s.odenen_tutar || 0))}</td>
                  <td className={`${td} ${evrakGerekli ? "bg-red-50 text-red-600" : ""}`} title={evrakGerekli ? "Cevap tarihi girildi — evrak no zorunlu" : (s.evrak_no ?? "")}>{s.evrak_no || (evrakGerekli ? "Zorunlu!" : "")}</td>
                  <td className={td} title={s.alacakli_adi ?? ""}>{s.alacakli_adi}</td>
                  {!kompakt && <td className={td} title={s.alacakli_vergi_no ?? ""}>{s.alacakli_vergi_no}</td>}
                  <td className={`${td} ${borcluTxt}`} title={s.borclu_adi ?? ""}>{s.borclu_adi}</td>
                  {!kompakt && <td className={td} title={s.borclu_tc_no ?? ""}>{s.borclu_tc_no}</td>}
                  <td className={`${td} text-right tabular-nums text-red-600`}>{paraGoster(Number(s.borc_miktari || 0))}</td>
                  {islemVar && (
                    <td className={`${td} text-center`}>
                      <div className="flex items-center justify-center gap-2">
                        {canDuzenle && <button type="button" onClick={() => dialogAc(s)} className="text-gray-400 hover:text-[#1E3A5F]" title="Düzenle"><Pencil size={14} /></button>}
                        {canSil && <button type="button" onClick={() => sil(s.id)} className="text-gray-300 hover:text-red-600" title="Sil"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-gray-50 border-t-2 border-gray-300 font-semibold text-[#1E3A5F]">
              <td className={`${td} text-right`} colSpan={7}>TOPLAM</td>
              <td className={`${td} text-right tabular-nums text-emerald-700 px-2`}>{tlFmt(toplamOdenen)}</td>
              <td className={td} colSpan={kompakt ? 3 : 5} />
              <td className={`${td} text-right tabular-nums text-red-600 px-2`}>{tlFmt(toplamBorc)}</td>
              {islemVar && <td className={td} />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* DİK (portrait) telefon: kart görünümü — Alacaklı / Borçlu / Borç. Yan çevirince (landscape) gizlenir, tablo gelir. */}
      <div className="block landscape:hidden lg:hidden space-y-2">
        {gosterilecek.length === 0 ? (
          <div className="bg-white rounded-lg border p-6 text-center text-gray-400 text-sm">
            {arama.trim() ? "Aramayla eşleşen kayıt yok." : "Henüz kayıt yok."}
          </div>
        ) : gosterilecek.map((s) => {
          const tekrar = tekrarTc.has(tcNorm(s.borclu_tc_no));
          const renk = firmaRengi(s.ucuncu_sahis);
          return (
            <div key={s.id} className="bg-white rounded-lg border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  {renk && <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: renk }} title={s.ucuncu_sahis ?? ""} />}
                  <div><div className="text-[10px] text-gray-400">Alacaklı</div><div className="text-sm text-gray-900 truncate">{s.alacakli_adi || "—"}</div></div>
                  <div><div className="text-[10px] text-gray-400">Borçlu</div><div className={`text-sm truncate ${tekrar ? "text-red-600 font-medium" : "text-gray-900"}`}>{s.borclu_adi || "—"}</div></div>
                  <div><div className="text-[10px] text-gray-400">Tebliğ Tarihi</div><div className="text-sm text-gray-800">{tarihGoster(s.teblig_tarihi)}</div></div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] text-gray-400">Borç</div>
                  <div className="text-sm font-bold text-red-600 tabular-nums whitespace-nowrap">{paraGoster(Number(s.borc_miktari || 0))}</div>
                  {islemVar && (
                    <div className="flex gap-3 justify-end mt-2">
                      {canDuzenle && <button type="button" onClick={() => dialogAc(s)} className="text-gray-400 hover:text-[#1E3A5F]" title="Düzenle"><Pencil size={16} /></button>}
                      {canSil && <button type="button" onClick={() => sil(s.id)} className="text-gray-300 hover:text-red-600" title="Sil"><Trash2 size={16} /></button>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* İlk 100 kayıt gösterilir; fazlası "ok" ile açılır. */}
      {!hepsiGoster && gorunen.length > LIMIT && (
        <div className="flex justify-center mt-3">
          <button type="button" onClick={() => setHepsiGoster(true)}
            className="flex items-center gap-1.5 text-sm text-[#1E3A5F] hover:bg-gray-100 rounded-md px-3 py-1.5 border border-gray-200">
            <ChevronDown size={16} /> Kalan {gorunen.length - LIMIT} kaydı göster
          </button>
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Aynı borçlu (TC / Vergi No) birden fazla dosyada geçiyorsa o satırlar <span className="text-red-600 font-medium">kırmızı</span> vurgulanır ·
        İcraya Cevap Tarihi girildiğinde <span className="text-red-600 font-medium">Evrak No zorunludur</span>.
      </p>

      {/* Öneri listeleri (form alanları için) */}
      <datalist id="icra-ucuncu-list">{ucuncuList.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="icra-borclu-list">{borcluList.map((v) => <option key={v} value={v} />)}</datalist>

      {/* EKLE / DÜZENLE PENCERESİ */}
      <Dialog open={dialogAcik} onOpenChange={setDialogAcik}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Gavel size={18} /> {editId ? "İcra Dosyasını Düzenle" : "Yeni İcra Dosyası"}</DialogTitle>
          </DialogHeader>

          <div ref={formRef} onKeyDown={formEnter} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {kilitli && (
              <div className="sm:col-span-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                🔒 Mevcut bilgiler kilitli — yalnız <b>Cevap / Ödeme</b> alanları girilebilir.
              </div>
            )}
            {/* ── ZORUNLU ALANLAR (üstte) ── */}
            <div className="sm:col-span-2">
              <label className={fLbl}>Üçüncü Şahıs <span className="text-red-500">*</span></label>
              <input list="icra-ucuncu-list" readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.ucuncu_sahis} onChange={(e) => setF("ucuncu_sahis", e.target.value)} placeholder="Firma seçin veya yazın" />
            </div>
            <div>
              <label className={fLbl}>Dosya Esas No <span className="text-red-500">*</span></label>
              <input readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.dosya_esas_no} onChange={(e) => setF("dosya_esas_no", e.target.value)} placeholder="2020/0000" />
            </div>
            <div>
              <label className={fLbl}>Gelen İcra Yazısı Tarihi <span className="text-red-500">*</span></label>
              <input type="date" disabled={kilitli} className={`${fInp} ${kilitInp}`} value={form.gelen_yazi_tarihi} onChange={(e) => setF("gelen_yazi_tarihi", e.target.value)} />
            </div>
            <div>
              <label className={fLbl}>Tebliğ Tarihi <span className="text-red-500">*</span></label>
              <input type="date" disabled={kilitli} className={`${fInp} ${kilitInp}`} value={form.teblig_tarihi} onChange={(e) => setF("teblig_tarihi", e.target.value)} />
            </div>
            <div>
              <label className={fLbl}>Borç Miktarı <span className="text-red-500">*</span></label>
              <input inputMode="decimal" readOnly={kilitli} className={`${fInp} text-right ${kilitInp}`} value={form.borc_miktari} onChange={(e) => setF("borc_miktari", formatParaInput(e.target.value))} placeholder="0" />
            </div>

            <div className="sm:col-span-2 mt-1 border-t pt-3 text-xs font-semibold text-gray-500">Alacaklı Bilgileri</div>
            <div>
              <label className={fLbl}>Adı Soyadı / Ünvanı <span className="text-red-500">*</span></label>
              <input readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.alacakli_adi} onChange={(e) => setF("alacakli_adi", e.target.value)} />
            </div>
            <div>
              <label className={fLbl}>Vergi No</label>
              <input readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.alacakli_vergi_no} onChange={(e) => setF("alacakli_vergi_no", e.target.value)} />
            </div>

            <div className="sm:col-span-2 mt-1 border-t pt-3 text-xs font-semibold text-gray-500">Borçlu Bilgileri</div>
            <div>
              <label className={fLbl}>Adı Soyadı / Ünvanı <span className="text-red-500">*</span></label>
              <input list="icra-borclu-list" readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.borclu_adi} onChange={(e) => setF("borclu_adi", e.target.value)} onBlur={borcluAdiBlur} placeholder="Personel seçin veya yazın" />
            </div>
            <div>
              <label className={fLbl}>Vergi / TC No <span className="text-red-500">*</span></label>
              <input readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.borclu_tc_no} onChange={(e) => setF("borclu_tc_no", e.target.value)} />
            </div>

            {/* ── OPSİYONEL ALANLAR (altta) ── */}
            <div className="sm:col-span-2 mt-1 border-t pt-3 text-xs font-semibold text-gray-500">Cevap / Ödeme <span className="font-normal text-gray-400">(opsiyonel)</span></div>
            <div>
              <label className={fLbl}>İcraya Cevap Tarihi</label>
              <input type="date" className={fInp} value={form.cevap_tarihi} onChange={(e) => setF("cevap_tarihi", e.target.value)} />
            </div>
            <div>
              <label className={fLbl}>Evrak No {form.cevap_tarihi && <span className="text-red-500">*</span>}</label>
              <input className={`${fInp} ${form.cevap_tarihi && !form.evrak_no.trim() ? "border-red-400 ring-1 ring-red-300" : ""}`} value={form.evrak_no} onChange={(e) => setF("evrak_no", e.target.value)} placeholder="Gönderilen evrak no" />
            </div>
            <div>
              <label className={fLbl}>Cevap Şekli</label>
              <select className={fInp} value={form.cevap_sekli} onChange={(e) => setF("cevap_sekli", e.target.value)}>
                <option value=""></option>
                {(form.cevap_sekli && !cevapSekilleri.includes(form.cevap_sekli) ? [form.cevap_sekli, ...cevapSekilleri] : cevapSekilleri).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={fLbl}>Ödenen Tutar</label>
              <input inputMode="decimal" className={`${fInp} text-right`} value={form.odenen_tutar} onChange={(e) => setF("odenen_tutar", formatParaInput(e.target.value))} placeholder="0" />
            </div>
          </div>

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setDialogAcik(false)} disabled={kaydediliyor}>İptal</Button>
            <Button className="bg-[#1E3A5F] hover:bg-[#15293f] text-white" onClick={kaydet} disabled={kaydediliyor || !formGecerli}>
              {kaydediliyor ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
