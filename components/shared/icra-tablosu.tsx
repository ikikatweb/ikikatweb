// İcra takibi — dosyalar TABLODA salt-okunur listelenir; ekleme/düzenleme PENCERE (dialog) formundan yapılır.
// Aynı borçlu (TC/Vergi No) birden fazla satırda geçerse o satırın borçlu hücreleri KIRMIZI vurgulanır.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOturumFiltresi, icraDegisti } from "@/hooks";
import toast from "react-hot-toast";
import { Gavel, Plus, Trash2, Loader2, Search, Pencil, ChevronDown } from "lucide-react";
import { getIcraKayitlar, insertIcraKayit, updateIcraKayit, deleteIcraKayit } from "@/lib/supabase/queries/icra";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { createClient } from "@/lib/supabase/client";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { trAramaNormalize } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import IcraCevapAlanlari, { BOS_CEVAP, cevapKipi, cevapDogrula, eksikCevapAlanlari, type CevapAlanlari } from "@/components/shared/icra-cevap-alanlari";
import { kapanabilir, ayniMi } from "@/lib/utils/pencere-kapanis";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
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
  alacakli_adi: string; alacakli_vergi_no: string; borclu_adi: string; borclu_tc_no: string;
  borc_miktari: string;
};
const BOS_FORM: IcraForm = {
  ucuncu_sahis: "", dosya_esas_no: "", gelen_yazi_tarihi: "", teblig_tarihi: "",
  alacakli_adi: "", alacakli_vergi_no: "", borclu_adi: "", borclu_tc_no: "",
  borc_miktari: "",
};

// Türkçe büyük/küçük harf DUYARSIZ arama yapan açılır liste (native <datalist> İ/i eşleşmesini
// doğru yapmadığı için: "ikikat" yazınca "İKİKAT" seçeneğini de bulur). Serbest yazıma da izin verir.
function AramaSecim({ value, onChange, onBlur, secenekler, placeholder, className, kilit }: {
  value: string; onChange: (v: string) => void; onBlur?: () => void;
  secenekler: string[]; placeholder?: string; className?: string; kilit?: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const [vurgu, setVurgu] = useState(0);
  const kapsayici = useRef<HTMLDivElement>(null);
  const q = trAramaNormalize(value.trim());
  const filtre = useMemo(() => {
    const list = q ? secenekler.filter((o) => trAramaNormalize(o).includes(q)) : secenekler;
    return list.slice(0, 50);
  }, [secenekler, q]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (kapsayici.current && !kapsayici.current.contains(e.target as Node)) setAcik(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const sec = (v: string) => { onChange(v); setAcik(false); };
  return (
    <div ref={kapsayici} className="relative">
      <input
        className={className} value={value} readOnly={kilit} placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); if (!kilit) { setAcik(e.target.value.trim().length > 0); setVurgu(0); } }}
        onBlur={onBlur}
        onKeyDown={(e) => {
          if (!acik || filtre.length === 0) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setVurgu((i) => Math.min(i + 1, filtre.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setVurgu((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); sec(filtre[vurgu] ?? filtre[0]); }
          else if (e.key === "Escape") { setAcik(false); }
        }}
      />
      {acik && !kilit && filtre.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg text-sm">
          {filtre.map((o, i) => (
            <li key={o}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); sec(o); }}
                className={`w-full text-left px-3 py-1.5 ${i === vurgu ? "bg-[#1E3A5F] text-white" : "hover:bg-gray-100"}`}>{o}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function IcraTablosu({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [satirlar, setSatirlar] = useState<IcraKayit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [arama, setArama] = useOturumFiltresi("icra-tablosu:arama", "");
  const [hepsiGoster, setHepsiGoster] = useState(false); // ilk 100 kayıt; fazlası "ok" ile açılır
  const [kompakt, setKompakt] = useState(false); // dar ekran (yatay telefon) → Alacaklı Vergi + Borçlu TC sütunları gizli
  const [firmalar, setFirmalar] = useState<{ firma_adi: string | null; renk?: string | null }[]>([]);
  const [personeller, setPersoneller] = useState<{ ad_soyad: string | null; tc_kimlik_no: string | null }[]>([]);
  const [cevapSekilleri, setCevapSekilleri] = useState<string[]>(ICRA_CEVAP_VARSAYILAN);
  // Dialog
  const [dialogAcik, setDialogAcik] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<IcraForm>(BOS_FORM);
  // CEVAP/ÖDEME ALANLARI AYRI: kuralları ortak bileşende (icra-cevap-alanlari),
  // ana sayfadaki hızlı pencereyle aynı. İki yerde ayrı yazılsaydı biri değişip
  // öbürü geride kalırdı.
  const [cevap, setCevap] = useState<CevapAlanlari>(BOS_CEVAP);
  // Kaydet denendi ve cevap bölümünde eksik vardı — kutular kırmızıya boyanır
  // (uyarı balonu değil, hızlı pencereyle aynı davranış).
  const [cevapDenendi, setCevapDenendi] = useState(false);
  // AÇILIŞTAKİ HALİ: pencere kazara kapanırken "bir şey yazılmış mıydı" sorusu.
  const [baslangic, setBaslangic] = useState("");
  // Düzenlenen kaydın avukat maili daha önce gitti mi? Gittiyse Kaydet tekrar
  // göndermez — her düzenlemede avukata aynı mailin gitmesi hem gereksiz hem de
  // "hangisi geçerli" karışıklığı yaratır.
  const duzenlenen = editId ? satirlar.find((x) => x.id === editId) ?? null : null;
  const mailBilgisi = {
    tarih: duzenlenen?.avukat_mail_at ?? null, ek: duzenlenen?.avukat_mail_ek ?? null,
    gonderen: duzenlenen?.avukat_mail_gonderen ?? null, sayi: duzenlenen?.avukat_mail_sayisi ?? 0,
  };
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
  // TC/Vergi no → kaç dosyada geçiyor (borçlu bazında). >1 olanlar "tekrar" (isim kırmızı + sayı rozeti).
  const tcSayim = useMemo(() => {
    const say = new Map<string, number>();
    for (const s of satirlar) { const t = tcNorm(s.borclu_tc_no); if (t) say.set(t, (say.get(t) ?? 0) + 1); }
    return say;
  }, [satirlar]);
  const tekrarTc = useMemo(() => new Set(Array.from(tcSayim.entries()).filter(([, n]) => n > 1).map(([t]) => t)), [tcSayim]);
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
  const sonGuncelleme = useMemo(() => {
    let en = 0;
    for (const s of satirlar) { const t = new Date(s.updated_at).getTime(); if (t > en) en = t; }
    return en ? new Date(en).toISOString() : null;
  }, [satirlar]);

  // ---- Dialog ----
  function dialogAc(row?: IcraKayit) {
    let ilkForm: IcraForm = BOS_FORM;
    let ilkCevap: CevapAlanlari = BOS_CEVAP;
    if (row) {
      setEditId(row.id);
      ilkForm = {
        ucuncu_sahis: row.ucuncu_sahis ?? "", dosya_esas_no: row.dosya_esas_no ?? "",
        gelen_yazi_tarihi: row.gelen_yazi_tarihi ?? "", teblig_tarihi: row.teblig_tarihi ?? "",
        alacakli_adi: row.alacakli_adi ?? "", alacakli_vergi_no: row.alacakli_vergi_no ?? "",
        borclu_adi: row.borclu_adi ?? "", borclu_tc_no: row.borclu_tc_no ?? "",
        borc_miktari: sayiToInput(Number(row.borc_miktari || 0)),
      };
      ilkCevap = {
        cevap_sekli: row.cevap_sekli ?? "", cevap_tarihi: row.cevap_tarihi ?? "",
        evrak_no: row.evrak_no ?? "", odenen_tutar: sayiToInput(Number(row.odenen_tutar || 0)),
        banka_adi: row.banka_adi ?? "", avukat_id: row.avukat_id ?? "",
        avukat_adi: row.avukat_adi ?? "", avukat_notu: row.avukat_notu ?? "",
      };
      setForm(ilkForm);
      setCevap(ilkCevap);
    } else { setEditId(null); setForm(BOS_FORM); setCevap(BOS_CEVAP); }
    setBaslangic(JSON.stringify([ilkForm, ilkCevap]));
    setCevapDenendi(false);
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
    // Tebliğ Tarihi, Gelen İcra Yazısı Tarihinden önce olamaz (ISO yyyy-mm-dd → metin karşılaştırması yeterli)
    if (form.gelen_yazi_tarihi && form.teblig_tarihi && form.teblig_tarihi < form.gelen_yazi_tarihi) {
      toast.error("Tebliğ Tarihi, Gelen İcra Yazısı Tarihinden önce olamaz."); return;
    }
    // İcraya Cevap Tarihi, Tebliğ Tarihinden önce olamaz
    // Cevap/ödeme kuralları ORTAK (icra-cevap-alanlari): cevap şekline göre hangi
    // alanın zorunlu olduğu değişiyor ve hızlı pencereyle aynı olmalı.
    // EKSİK ALAN BALONLA DEĞİL KIRMIZIYLA: bölüm opsiyonel, ama bir şey
    // yazıldıysa o kipin bütün alanları isteniyor (eksikCevapAlanlari).
    if (eksikCevapAlanlari(cevap, false).length) {
      // KIRMIZI KUTU + KISA UYARI: bu form uzun, cevap bölümü ekranın altında
      // kalabiliyor; yalnız kırmızıya boyamak sessiz kalmakla aynı şey olurdu.
      setCevapDenendi(true);
      toast.error("Cevap / Ödeme bölümünde eksik alan var — kırmızı kutulara bakın.");
      return;
    }
    setCevapDenendi(false);
    // CEVABI GERİ ALMA — hızlı penceredekiyle aynı: kayıtlı cevap siliniyorsa
    // sorulur, dosya yeniden cevap bekleyenlere döner.
    if (duzenlenen && (duzenlenen.cevap_sekli || duzenlenen.cevap_tarihi)
      && !cevap.cevap_sekli.trim() && !cevap.cevap_tarihi && !cevap.evrak_no.trim() && !cevap.avukat_id
      && typeof window !== "undefined" && !window.confirm(
        "Bu dosyadaki cevap kaydı silinecek ve dosya yeniden CEVAP BEKLEYENLER listesine girecek.\n\n"
      + "Cevap tarihi, evrak no ve ödenen tutar da silinir. Avukata gönderilmiş mailin kaydı "
      + "silinmez — mail gerçekten gitti.\n\nDevam edilsin mi?")) return;
    const cevapSorun = cevapDogrula(cevap, form.teblig_tarihi);
    if (cevapSorun) { toast.error(cevapSorun); return; }
    const t = (v: string) => (v.trim() === "" ? null : v.trim());
    const payload: Partial<IcraKayit> = {
      ucuncu_sahis: t(form.ucuncu_sahis), dosya_esas_no: t(form.dosya_esas_no),
      gelen_yazi_tarihi: form.gelen_yazi_tarihi || null, teblig_tarihi: form.teblig_tarihi || null,
      // AVUKAT KİPİNDE CEVAP TARİHİ YAZILMAZ: mail gidince sunucu yazar.
      cevap_sekli: t(cevap.cevap_sekli),
      banka_adi: t(cevap.banka_adi),
      avukat_id: cevap.avukat_id || null,
      avukat_adi: t(cevap.avukat_adi),
      avukat_notu: t(cevap.avukat_notu),
      ...(cevapKipi(cevap.cevap_sekli).avukat ? {} : {
        cevap_tarihi: cevap.cevap_tarihi || null,
        evrak_no: t(cevap.evrak_no),
        odenen_tutar: parseParaInput(cevap.odenen_tutar),
      }),
      alacakli_adi: t(form.alacakli_adi), alacakli_vergi_no: t(form.alacakli_vergi_no),
      borclu_adi: t(form.borclu_adi), borclu_tc_no: t(form.borclu_tc_no),
      borc_miktari: parseParaInput(form.borc_miktari),
    };
    setKaydediliyor(true);
    try {
      let kayitId = editId;
      if (editId) {
        await updateIcraKayit(editId, payload);
        setSatirlar((p) => p.map((s) => (s.id === editId ? { ...s, ...payload, updated_at: new Date().toISOString() } : s)));
      } else {
        const maxSira = satirlar.reduce((m, s) => Math.max(m, s.sira), 0);
        const row = await insertIcraKayit({ ...payload, sira: maxSira + 1 });
        setSatirlar((p) => [...p, row]);
        kayitId = row.id;
      }

      // AVUKATA MAİL — hızlı pencereyle aynı kural: yalnız daha önce gitmediyse.
      // Mail gitmezse cevap_tarihi yazılmaz ve dosya cevapsız kalır; bu SÖYLENİR,
      // yoksa kullanıcı cevabı iletmiş sanıp süre kaçırır.
      if (cevapKipi(cevap.cevap_sekli).avukat && cevap.avukat_id && kayitId && !mailBilgisi.tarih) {
        try {
          const c = await avukataGonder(kayitId, cevap.avukat_id, cevap.avukat_notu);
          setSatirlar((p) => p.map((s) => (s.id === kayitId
            ? { ...s, cevap_tarihi: c.cevap_tarihi, avukat_mail_ek: c.ek, avukat_mail_at: new Date().toISOString() }
            : s)));
          toast.success(`${c.alici} adresine gönderildi · ek: ${c.ek}`, { duration: 7000 });
          avukatTakipNotuGoster();   // Tamam'a basılana kadar durur
          if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
          if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
        } catch (e) {
          toast.error(`${e instanceof Error ? e.message : "Mail gönderilemedi."}

`
            + `Kayıt tutuldu ama dosya cevapsız sayılmaya devam ediyor.`, { duration: 12000 });
        }
      }

      icraDegisti();   // cevap tarihi girildiyse menü rozeti hemen düşsün
      toast.success(editId ? "İcra dosyası güncellendi." : "İcra dosyası eklendi.");
      setDialogAcik(false);
    } catch (e) {
      // SEBEBİ YUTULMAZ: eksik sütun gibi tek komutla çözülecek sorunlar
      // "Kaydedilemedi." altında saatlerce gizleniyordu.
      const m = e instanceof Error ? e.message : String(e);
      toast.error(/banka_adi|avukat_/.test(m)
        ? `Eksik sütun — ilgili sql dosyası çalıştırılmalı: ${m}`
        : `Kaydedilemedi: ${m}`, { duration: 8000 });
    }
    finally { setKaydediliyor(false); }
  }
  async function sil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu icra dosyası silinsin mi?")) return;
    try { await deleteIcraKayit(id); setSatirlar((p) => p.filter((s) => s.id !== id)); icraDegisti(); }
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
    (!cevap.cevap_tarihi || cevap.evrak_no.trim()),
  );

  return (
    <div>
      <div className="flex items-baseline mb-4 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2"><Gavel size={24} /> Üçüncü Şahıs Hacizleri</h1>
        {sonGuncelleme && <span className="text-xs text-gray-400">Son güncelleme: {tarihSaat(sonGuncelleme)}</span>}
        {canEkle && (
          <button type="button" onClick={() => dialogAc()}
            className="ml-auto flex items-center gap-1.5 h-9 px-3 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus size={16} /> Yeni İcra Dosyası Ekle
          </button>
        )}
      </div>

      <p className="text-xs text-gray-500 -mt-2 mb-4">
        Borçlu bir BAŞKASI; şirket üçüncü şahıs (işveren) sıfatıyla cevap veriyor — 89/1 haciz
        ihbarnamesi, maaş haczi müzekkeresi. Şirketin kendisinin borçlu olduğu ödeme emirleri
        diğer sekmede.
      </p>

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
                  {/* FİRMA RENGİ: yuvarlak nokta değil ince dikey çubuk — panelde
                      firma rengi her yerde ("Eksik Evrak", icra kartları) bu biçimde
                      gösteriliyor, ekranlar arasında aynı dil olsun. */}
                  <td className="border border-gray-100 px-1.5 py-1.5 align-middle" title={s.ucuncu_sahis ?? ""}>
                    <span className="mx-auto block w-1 rounded-full"
                      style={{ backgroundColor: firmaRengi(s.ucuncu_sahis) ?? "#e5e7eb", minHeight: "1.25rem" }} />
                  </td>
                  {/* HACİZ KALDIRMA ROZETİ (09.11.2026): icra dairesinden "haczin
                      kaldırılmasına karar verilmiştir" yazısı gelmişse burada görünür.
                      Kaldırma yazısı YENİ bir dosya değil, bu dosyanın haczinin
                      kalkması — o yüzden ayrı satır değil, satırın üstünde rozet.
                      DOSYA KAPANMIŞ SAYILMAZ: kaldırma kısmi olabiliyor ("bu dosyamıza
                      şamil olmak üzere"), başka dosyalardan gelen hacizler sürebilir.
                      Rozet haber verir, kararı insan verir. */}
                  <td className={td} title={s.dosya_esas_no ?? ""}>
                    {s.dosya_esas_no}
                    {s.haciz_kaldirma_tarihi && (
                      <div className="mt-0.5">
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                          title={s.haciz_kaldirma_notu
                            ?? "İcra dairesinden haciz kaldırma yazısı geldi. Dosya otomatik kapatılmadı — kaldırma kısmi olabilir."}>
                          haciz kaldırıldı · {new Date(s.haciz_kaldirma_tarihi + "T00:00:00").toLocaleDateString("tr-TR")}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className={`${td} text-center`}>{tarihGoster(s.gelen_yazi_tarihi)}</td>
                  <td className={`${td} text-center`}>{tarihGoster(s.teblig_tarihi)}</td>
                  <td className={`${td} text-center ${cevapYok ? "bg-red-100 text-red-600 font-medium" : ""}`} title={cevapYok ? "İcraya cevap verilmemiş" : undefined}>{cevapYok ? "Cevap yok" : tarihGoster(s.cevap_tarihi)}</td>
                  {/* AVUKAT ARACILIĞIYSA DOĞRUDAN AVUKATIN ADI: "Avukat Aracılığı"
                      yazısı hangi avukat olduğunu söylemiyor ve tabloda asıl
                      aranan o. Ad, gönderim anında kopyalanıyor (avukat_adi);
                      kopya yoksa kipin kendisi yazılır — ad UYDURULMAZ. */}
                  <td className={td} title={[s.cevap_sekli, s.avukat_adi].filter(Boolean).join(" · ")}>
                    {cevapKipi(s.cevap_sekli ?? "").avukat && s.avukat_adi ? s.avukat_adi : s.cevap_sekli}
                  </td>
                  <td className={`${td} text-right tabular-nums text-emerald-700`}>{paraGoster(Number(s.odenen_tutar || 0))}</td>
                  <td className={`${td} ${evrakGerekli ? "bg-red-50 text-red-600" : ""}`} title={evrakGerekli ? "Cevap tarihi girildi — evrak no zorunlu" : (s.evrak_no ?? "")}>{s.evrak_no || (evrakGerekli ? "Zorunlu!" : "")}</td>
                  <td className={td} title={s.alacakli_adi ?? ""}>{s.alacakli_adi}</td>
                  {!kompakt && <td className={td} title={s.alacakli_vergi_no ?? ""}>{s.alacakli_vergi_no}</td>}
                  <td className={`${td} ${borcluTxt}`} title={s.borclu_adi ?? ""}>
                    <span className="flex items-center gap-1 min-w-0">
                      <span className="truncate">{s.borclu_adi}</span>
                      {tekrar && <span className="shrink-0 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-red-600 text-white text-[9px] font-semibold leading-none" title={`Bu borçlu ${tcSayim.get(tcNorm(s.borclu_tc_no)) ?? 0} dosyada geçiyor`}>{tcSayim.get(tcNorm(s.borclu_tc_no)) ?? 0}</span>}
                    </span>
                  </td>
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
              <td className={`${td} text-right`} colSpan={kompakt ? 11 : 13}>TOPLAM</td>
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
                  <div><div className="text-[10px] text-gray-400">Borçlu</div><div className={`text-sm flex items-center gap-1 min-w-0 ${tekrar ? "text-red-600 font-medium" : "text-gray-900"}`}><span className="truncate">{s.borclu_adi || "—"}</span>{tekrar && <span className="shrink-0 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-semibold leading-none">{tcSayim.get(tcNorm(s.borclu_tc_no)) ?? 0}</span>}</div></div>
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

      {/* EKLE / DÜZENLE PENCERESİ */}
      {/* KAZARA KAPANMA: dışarı dokunmak ya da ESC, doldurulan formu sessizce
          siliyordu — uzun bir icra kaydını baştan yazmak gerekiyordu. */}
      <Dialog open={dialogAcik} onOpenChange={(a, d) => {
        if (a) { setDialogAcik(true); return; }
        if (!kapanabilir(d, !ayniMi(JSON.stringify([form, cevap]), baslangic))) return;
        setDialogAcik(false);
      }}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Gavel size={18} /> {editId ? "İcra Dosyasını Düzenle" : "Yeni İcra Dosyası"}</DialogTitle>
          </DialogHeader>

          <div ref={formRef} onKeyDown={formEnter}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1">
            {kilitli && (
              <div className="sm:col-span-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                🔒 Mevcut bilgiler kilitli — yalnız <b>Cevap / Ödeme</b> alanları girilebilir.
              </div>
            )}
            {/* ── ZORUNLU ALANLAR (üstte) ── */}
            <div className="sm:col-span-2">
              <label className={fLbl}>Üçüncü Şahıs <span className="text-red-500">*</span></label>
              <AramaSecim value={form.ucuncu_sahis} onChange={(v) => setF("ucuncu_sahis", v)} secenekler={ucuncuList} kilit={kilitli} className={`${fInp} ${kilitInp}`} placeholder="Firma seçin veya yazın" />
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
              <input type="date" disabled={kilitli} min={form.gelen_yazi_tarihi || undefined} className={`${fInp} ${kilitInp}`} value={form.teblig_tarihi} onChange={(e) => setF("teblig_tarihi", e.target.value)} />
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
              <AramaSecim value={form.borclu_adi} onChange={(v) => setF("borclu_adi", v)} onBlur={borcluAdiBlur} secenekler={borcluList} kilit={kilitli} className={`${fInp} ${kilitInp}`} placeholder="Personel seçin veya yazın" />
            </div>
            <div>
              <label className={fLbl}>Vergi / TC No <span className="text-red-500">*</span></label>
              <input readOnly={kilitli} className={`${fInp} ${kilitInp}`} value={form.borclu_tc_no} onChange={(e) => setF("borclu_tc_no", e.target.value)} />
            </div>

            {/* ── OPSİYONEL ALANLAR (altta) ── */}
            <div className="sm:col-span-2 mt-1 border-t pt-3 text-xs font-semibold text-gray-500">Cevap / Ödeme <span className="font-normal text-gray-400">(opsiyonel)</span></div>
            {/* ALANLAR ORTAK BİLEŞENDEN: ana sayfadaki hızlı "Cevabı işle"
                penceresiyle birebir aynı kurallar (cevap şekline göre sorulan
                alanlar değişiyor, avukatta mail gidiyor). */}
            <IcraCevapAlanlari
              deger={cevap} degistir={(y) => setCevap((p) => ({ ...p, ...y }))}
              sekiller={cevapSekilleri} tebligTarihi={form.teblig_tarihi}
              mailBilgisi={mailBilgisi} icraId={editId} denendi={cevapDenendi} denendiSifirla={() => setCevapDenendi(false)}
              tekrarGonderildi={(c) => setSatirlar((p) => p.map((x) => (x.id === editId
                ? { ...x, avukat_mail_at: c.gonderildiAt, avukat_mail_ek: c.ek,
                    avukat_mail_gonderen: c.gonderen, avukat_mail_sayisi: (x.avukat_mail_sayisi ?? 0) + 1 }
                : x)))}
            />
          </div>

          {/* DÜĞMELER ALTTA SABİT: pencere içeriği uzayınca (avukat kipinde liste,
              not kutusu, gönderim bilgisi) İptal/Kaydet aşağı kayıp görünmez
              oluyordu — kullanıcı kaydetmek için kaydırmak zorunda kalıyordu.
              Gövde kendi içinde kayıyor, alt şerit yerinde duruyor. */}
          <DialogFooter className="gap-2 mt-3 shrink-0 border-t pt-3">
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
