// ŞİRKETE AÇILAN TAKİPLER — "İcra Dosyaları" sayfasının ikinci sekmesi.
//
// BURADA ROL TERS: üçüncü şahıs defterinde (icra-tablosu) borçlu bir başkasıdır ve
// şirket işveren sıfatıyla cevap verir. Burada BORÇLU ŞİRKETİN KENDİSİDİR — ödeme
// emri gelmiştir. O yüzden izlenen alanlar da başka: "icraya cevap / evrak no"
// değil, İTİRAZ SÜRESİ, itiraz ve ödeme.
//
// 09.11.2026'da kutuda dört ödeme emri çıktı, DÖRDÜ DE HİÇ AÇILMAMIŞTI (biri
// 252.199,22 TL) — hiçbir ekranda görünmedikleri için kimse fark etmemişti.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useOturumFiltresi, icraDegisti } from "@/hooks";
import toast from "react-hot-toast";
import { Scale, Plus, Trash2, Loader2, Search, Pencil, FileText, Send } from "lucide-react";
import {
  getIcraSirketTakipler, insertIcraSirketTakip, updateIcraSirketTakip, deleteIcraSirketTakip,
} from "@/lib/supabase/queries/icra-sirket";
import { createClient } from "@/lib/supabase/client";
import type { IcraSirketTakip, IcraSirketDurum } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import AvukatSecim, { type AvukatEk } from "@/components/shared/avukat-secim";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
import { MuhasebeBandi } from "@/components/shared/muhasebe-gosterim";
import { muhasebeyeGonder, muhasebeGerekliMi } from "@/lib/supabase/queries/icra-muhasebe";
import { trAramaNormalize } from "@/lib/utils/isim";
import { dosyaUrl } from "@/lib/utils/dosya-url";
import { sonGunHesapla, bugunISO } from "@/lib/utils/icra-sure";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Durum kodları ve ekranda görünen adları. Kod saklanır, ad burada yazılır. */
export const DURUMLAR: { kod: IcraSirketDurum; ad: string; sinif: string }[] = [
  { kod: "yeni", ad: "Yeni geldi", sinif: "bg-red-100 text-red-700" },
  { kod: "avukatta", ad: "Avukatta", sinif: "bg-amber-100 text-amber-800" },
  { kod: "itiraz_edildi", ad: "İtiraz edildi", sinif: "bg-sky-100 text-sky-800" },
  { kod: "taksit", ad: "Taksitlendi", sinif: "bg-indigo-100 text-indigo-800" },
  { kod: "odendi", ad: "Ödendi", sinif: "bg-emerald-100 text-emerald-800" },
  { kod: "kapandi", ad: "Kapandı", sinif: "bg-gray-100 text-gray-600" },
];
const durumBilgi = (k: string) => DURUMLAR.find((d) => d.kod === k) ?? DURUMLAR[0];

/**
 * CEVAP ŞEKLİ OLARAK SEÇİLEBİLENLER.
 *
 * "Yeni geldi" listede YOK: o bir cevap değil, cevabın henüz verilmediği hâl —
 * seçeneği "Seçin…" temsil ediyor ve dosya ele alınmamış sayılıyor (menü
 * rozeti, ana sayfa kartı ve süre uyarısı bu koda bakıyor). Böylece işlenmiş
 * bir takip "Seçin…"e çekilerek geri de alınabiliyor.
 *
 * "İtiraz edildi" ve "Taksitlendi" de çıkarıldı. ESKİ KAYITTA DURUYORSA
 * LİSTEYE EKLENİR (bkz. durumSecenekleri) — seçeneği kaldırmak, kayıttaki
 * değeri sessizce değiştirmenin gerekçesi değil.
 */
export const SECILEBILIR_DURUMLAR: IcraSirketDurum[] = ["avukatta", "odendi", "kapandi"];

/** Seçilebilirler + kayıtta duran (artık listede olmayan) değer. */
export function durumSecenekleri(mevcut: IcraSirketDurum): IcraSirketDurum[] {
  return mevcut !== "yeni" && !SECILEBILIR_DURUMLAR.includes(mevcut)
    ? [mevcut, ...SECILEBILIR_DURUMLAR] : SECILEBILIR_DURUMLAR;
}

function tlFmt(n: number): string { return "₺" + n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function paraGoster(n: number): string { return n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""; }
function tarihGoster(v: string | null): string { return v ? v.split("-").reverse().join(".") : ""; }
function sayiToInput(n: number): string {
  if (!n || n === 0) return "";
  return formatParaInput(Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",") || "0");
}

/**
 * Son itiraz günü = tebliğ tarihi + belgede YAZAN süre.
 * SÜRE YOKSA GÜN DE YOK: varsayılan bir sayı uydurup gün göstermek, insanın
 * güvendiği bir tarihi uydurmak olurdu (bkz. icra defterinde cevap süresi kuralı).
 */
const sonItirazGunu = (t: IcraSirketTakip) => sonGunHesapla(t.teblig_tarihi, t.itiraz_suresi_gun);
const BUGUN = bugunISO;

type Form = {
  borclu_firma: string; dosya_esas_no: string; icra_dairesi: string;
  alacakli_adi: string; alacakli_vergi_no: string; takip_tutari: string;
  belge_tarihi: string; teblig_tarihi: string; itiraz_suresi_gun: string;
  odenen_tutar: string; odeme_tarihi: string; banka_adi: string;
  avukat_id: string; avukat_adi: string; avukat_notu: string;
  /** Avukat mailine EK olarak gidecek dosyalar (ödeme emri belgesi bu listede değil). */
  avukat_ekler: AvukatEk[];
  durum: IcraSirketDurum; aciklama: string;
};
const BOS: Form = {
  borclu_firma: "", dosya_esas_no: "", icra_dairesi: "",
  alacakli_adi: "", alacakli_vergi_no: "", takip_tutari: "",
  belge_tarihi: "", teblig_tarihi: "", itiraz_suresi_gun: "",
  odenen_tutar: "", odeme_tarihi: "", banka_adi: "",
  avukat_id: "", avukat_adi: "", avukat_notu: "", avukat_ekler: [],
  durum: "yeni", aciklama: "",
};

export default function IcraSirketTablosu({ canEkle, canDuzenle, canSil }: { canEkle: boolean; canDuzenle: boolean; canSil: boolean }) {
  const [satirlar, setSatirlar] = useState<IcraSirketTakip[]>([]);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [arama, setArama] = useOturumFiltresi("icra-sirket:arama", "");
  const [sadeceAcik, setSadeceAcik] = useOturumFiltresi("icra-sirket:acik", false);
  const [firmalar, setFirmalar] = useState<{ firma_adi: string | null; renk?: string | null }[]>([]);
  const [dialogAcik, setDialogAcik] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BOS);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let iptal = false;
    (async () => {
      try {
        const sb = createClient();
        const [r, f] = await Promise.all([
          getIcraSirketTakipler(),
          sb.from("firmalar").select("firma_adi, renk").then((x) => (x.data as { firma_adi: string | null; renk?: string | null }[]) ?? [], () => []),
        ]);
        if (!iptal) { setSatirlar(r); setFirmalar(f); setHata(null); }
      } catch (e) {
        if (iptal) return;
        let msg = "Bilinmeyen hata";
        if (e instanceof Error) msg = e.message;
        else if (e && typeof e === "object") { const o = e as { message?: string; details?: string; code?: string }; msg = o.message || o.details || o.code || JSON.stringify(e); }
        setHata(msg.includes("does not exist") || msg.includes("schema cache")
          ? "Tablo Supabase'de henüz yok. sql/icra_sirket_takip.sql dosyasını çalıştırın."
          : msg);
      } finally { if (!iptal) setLoading(false); }
    })();
    return () => { iptal = true; };
  }, []);

  // Tebligat ekranından "?duzenle=<id>" ile gelinince ilgili dosyanın penceresini aç.
  const acildiRef = useRef(false);
  useEffect(() => {
    if (loading || acildiRef.current || typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("duzenle");
    if (!id) return;
    const row = satirlar.find((s) => s.id === id);
    if (row) { acildiRef.current = true; dialogAc(row); }
  }, [loading, satirlar]);

  const firmaAdlari = useMemo(
    () => Array.from(new Set(firmalar.map((f) => (f.firma_adi ?? "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "tr")),
    [firmalar]);
  const firmaRenkMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of firmalar) { const ad = (f.firma_adi ?? "").trim().toLocaleUpperCase("tr"); if (ad && f.renk) m.set(ad, f.renk); }
    return m;
  }, [firmalar]);
  const firmaRengi = (ad: string | null) => firmaRenkMap.get((ad ?? "").trim().toLocaleUpperCase("tr")) ?? null;

  const gorunen = useMemo(() => {
    const q = trAramaNormalize(arama.trim());
    let l = satirlar;
    if (sadeceAcik) l = l.filter((s) => s.durum !== "odendi" && s.durum !== "kapandi");
    if (!q) return l;
    return l.filter((s) => trAramaNormalize(
      [s.borclu_firma, s.dosya_esas_no, s.icra_dairesi, s.alacakli_adi, s.alacakli_vergi_no, s.evrak_no, s.aciklama].filter(Boolean).join(" "),
    ).includes(q));
  }, [satirlar, arama, sadeceAcik]);
  const siraNo = useMemo(() => new Map(gorunen.map((s, i) => [s.id, i + 1])), [gorunen]);
  const toplamTakip = useMemo(() => gorunen.reduce((t, s) => t + Number(s.takip_tutari || 0), 0), [gorunen]);
  const toplamOdenen = useMemo(() => gorunen.reduce((t, s) => t + Number(s.odenen_tutar || 0), 0), [gorunen]);
  const yeniSayisi = useMemo(() => satirlar.filter((s) => s.durum === "yeni").length, [satirlar]);

  function dialogAc(row?: IcraSirketTakip) {
    if (row) {
      setEditId(row.id);
      setForm({
        borclu_firma: row.borclu_firma ?? "", dosya_esas_no: row.dosya_esas_no ?? "",
        icra_dairesi: row.icra_dairesi ?? "", alacakli_adi: row.alacakli_adi ?? "",
        alacakli_vergi_no: row.alacakli_vergi_no ?? "", takip_tutari: sayiToInput(Number(row.takip_tutari || 0)),
        belge_tarihi: row.belge_tarihi ?? "", teblig_tarihi: row.teblig_tarihi ?? "",
        itiraz_suresi_gun: row.itiraz_suresi_gun == null ? "" : String(row.itiraz_suresi_gun),
        odenen_tutar: sayiToInput(Number(row.odenen_tutar || 0)),
        odeme_tarihi: row.odeme_tarihi ?? "", banka_adi: row.banka_adi ?? "",
        avukat_id: row.avukat_id ?? "", avukat_adi: row.avukat_adi ?? "",
        avukat_notu: row.avukat_notu ?? "", avukat_ekler: row.avukat_ek_dosyalar ?? [],
        // MUHASEBENİN BELİRLEDİĞİ ŞEKİLLE AÇILIR: dosya henüz ele alınmamışsa
        // (durum "yeni") ve muhasebe bir şekil bildirmişse o seçili gelir.
        // Kayıtlı bir durum varsa dokunulmaz — verilmiş cevabı değiştirmek olurdu.
        durum: row.durum === "yeni" && row.muhasebe_cevap_sekli
          ? (row.muhasebe_cevap_sekli as IcraSirketDurum) : row.durum,
        aciklama: row.aciklama ?? "",
      });
    } else { setEditId(null); setForm(BOS); }
    setDialogAcik(true);
  }
  const setF = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  // Düzenlenen kaydın avukat gönderimi HÂLÂ geçerli mi? (aynı avukat + mail
  // gitmiş + dosya hâlâ avukatta). Değilse kaydetmek YENİDEN gönderir.
  const duzenlenen = editId ? satirlar.find((x) => x.id === editId) ?? null : null;
  const avukatCevabiDuruyor = Boolean(duzenlenen?.avukat_id) && duzenlenen?.avukat_id === form.avukat_id
    && Boolean(duzenlenen?.avukat_mail_at) && duzenlenen?.durum === "avukatta";
  const gonderilecek = form.durum === "avukatta" && Boolean(form.avukat_id) && !avukatCevabiDuruyor;
  // YENİ TAKİPTE MUHASEBEYE MAİL GİDER (kaydetme anında). Süresi geçmiş eski
  // kayıt girilirken gitmez (muhasebeGerekliMi).
  const muhasebeyeGidecek = !editId && muhasebeGerekliMi({
    teblig_tarihi: form.teblig_tarihi || null,
    cevapVerildi: form.durum !== "yeni",
    sureGun: form.itiraz_suresi_gun ? Number(form.itiraz_suresi_gun) : null,
  }, true);

  /**
   * Cevap şekli değişince o kipe ait OLMAYAN alanlar boşalır — hızlı pencereyle
   * aynı. Boşalmasaydı "Seçin…"e çekilen bir takip ele alınmamış görünürken
   * kayıtta ödeme bilgisi durmaya devam ederdi: ekranda olmayan, veritabanında
   * duran bir veri. Avukata gönderilmiş mailin KAYDI SİLİNMEZ (avukat_mail_*).
   */
  function sekilDegistir(k: IcraSirketDurum) {
    setForm((f) => ({
      ...f,
      durum: k,
      ...(k === "odendi" ? {} : { odeme_tarihi: "", odenen_tutar: "", banka_adi: "" }),
      ...(k === "avukatta" ? {} : { avukat_id: "", avukat_adi: "" }),
    }));
  }

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
    const zorunlu: [string, string][] = [
      [form.borclu_firma, "Borçlu firma"],
      [form.dosya_esas_no, "Dosya esas no"],
      [form.icra_dairesi, "İcra dairesi"],
      [form.alacakli_adi, "Alacaklı"],
      [form.teblig_tarihi, "Tebliğ tarihi"],
    ];
    for (const [v, ad] of zorunlu) if (!v.trim()) { toast.error(`${ad} zorunlu.`); return; }
    if (parseParaInput(form.takip_tutari) <= 0) { toast.error("Takip tutarı zorunlu."); return; }
    if (form.odeme_tarihi && form.odeme_tarihi < form.teblig_tarihi) { toast.error("Ödeme tarihi, tebliğ tarihinden önce olamaz."); return; }
    // KİPE GÖRE ZORUNLULAR — hızlı pencereyle aynı kural.
    if (form.durum === "odendi") {
      const eksik = [!form.odeme_tarihi && "ödeme tarihi", !(parseParaInput(form.odenen_tutar) > 0) && "ödenen tutar",
        !form.banka_adi.trim() && "hangi banka"].filter(Boolean);
      if (eksik.length) { toast.error(`Ödendi için ${eksik.join(", ")} zorunlu.`); return; }
    }
    if (form.durum === "avukatta" && !form.avukat_id) { toast.error("Avukat seçilmeli."); return; }
    // CEVABI GERİ ALMA: işlenmiş bir takip "Seçin…"e çekilmiş. Sessizce silinmez.
    if (form.durum === "yeni" && duzenlenen && duzenlenen.durum !== "yeni"
      && typeof window !== "undefined" && !window.confirm(
        "Bu takipteki cevap kaydı silinecek ve dosya yeniden ELE ALINMAMIŞ sayılacak.\n\n"
        + "Ödeme bilgileri ve avukat seçimi silinir. Avukata gönderilmiş mailin kaydı "
        + "silinmez — mail gerçekten gitti.\n\nDevam edilsin mi?")) return;
    const sure = form.itiraz_suresi_gun.trim() === "" ? null : Number(form.itiraz_suresi_gun);
    if (sure != null && (!Number.isFinite(sure) || sure <= 0)) { toast.error("İtiraz süresi gün olarak girilmeli."); return; }
    const t = (v: string) => (v.trim() === "" ? null : v.trim());
    const payload: Partial<IcraSirketTakip> = {
      borclu_firma: t(form.borclu_firma), dosya_esas_no: t(form.dosya_esas_no),
      icra_dairesi: t(form.icra_dairesi), alacakli_adi: t(form.alacakli_adi),
      alacakli_vergi_no: t(form.alacakli_vergi_no), takip_tutari: parseParaInput(form.takip_tutari),
      belge_tarihi: form.belge_tarihi || null, teblig_tarihi: form.teblig_tarihi || null,
      itiraz_suresi_gun: sure,
      odenen_tutar: parseParaInput(form.odenen_tutar), odeme_tarihi: form.odeme_tarihi || null,
      banka_adi: t(form.banka_adi),
      avukat_id: form.avukat_id || null, avukat_adi: t(form.avukat_adi), avukat_notu: t(form.avukat_notu),
      durum: form.durum, aciklama: t(form.aciklama),
      // EKLER KAYITTA DURUR: mail servisi kayıttan okuyor, tekrar gönderimde de gider.
      avukat_ek_dosyalar: form.avukat_ekler.length ? form.avukat_ekler : null,
    };
    setKaydediliyor(true);
    // MAİL İÇİN KAYIT ID'Sİ: yeni kayıtta id ancak eklemeden sonra doğuyor.
    let kayitId: string | null = editId;
    try {
      if (editId) {
        await updateIcraSirketTakip(editId, payload);
        setSatirlar((p) => p.map((s) => (s.id === editId ? { ...s, ...payload, updated_at: new Date().toISOString() } : s)));
      } else {
        const maxSira = satirlar.reduce((m, s) => Math.max(m, s.sira), 0);
        const row = await insertIcraSirketTakip({ ...payload, sira: maxSira + 1 });
        setSatirlar((p) => [row, ...p]);
        kayitId = row.id;

        // ── MUHASEBEYE OTOMATİK GÖNDERİM (YALNIZ YENİ KAYITTA) ──
        // Ödeme emrinde soru şu: borç ödenmiş mi, ödenecek mi, itiraz mı
        // edilecek. Cevabı muhasebe veriyor; dosya panele girildiği an gidiyor.
        // GEÇMİŞ KAYIT GİRİLİRKEN GÖNDERİLMEZ (bkz. muhasebeGerekliMi).
        const gerekli = muhasebeGerekliMi({
          teblig_tarihi: row.teblig_tarihi,
          cevapVerildi: row.durum !== "yeni",
          sureGun: row.itiraz_suresi_gun,
        }, true);
        if (gerekli) {
          try {
            const m = await muhasebeyeGonder(row.id, "sirket", form.avukat_notu);
            setSatirlar((p) => p.map((x) => (x.id === row.id ? {
              ...x, muhasebe_mail_at: m.gonderildiAt, muhasebe_mail_ek: m.ek,
              muhasebe_mail_alici: m.alicilar.join(", "), muhasebe_mail_gonderen: m.gonderen,
              muhasebe_mail_sayisi: 1,
            } : x)));
            toast.success(`Muhasebeye gönderildi (${m.alicilar.length} alıcı) · ek: ${m.ek}`);
            if (m.kayitHatasi) toast.error(`Muhasebe maili gitti ama kayıt güncellenemedi: ${m.kayitHatasi}`, { duration: 10000 });
            if (m.antetInemedi) toast.error("Muhasebe maili ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
          } catch (e) {
            // SESSİZ GEÇİLMEZ (AGENTS.md): ek inmediyse mail HİÇ gitmedi.
            toast.error(`${e instanceof Error ? e.message : "Muhasebeye mail gönderilemedi."}\n\n`
              + `Dosya kaydedildi ama MUHASEBEYE GÖNDERİLMEDİ — Muhasebe penceresinden tekrar deneyin.`,
              { duration: 14000 });
          }
        }
      }
      icraDegisti();   // durum "yeni"den çıktıysa menü rozeti hemen düşsün
      toast.success(editId ? "Dosya güncellendi." : "Dosya eklendi.");
      // AVUKATA MAİL — hızlı penceredekiyle aynı kural. Mail gitmezse SÖYLENİR:
      // kayıt tutuldu ama dosya avukata ULAŞMADI, bu sessiz geçilemez.
      if (gonderilecek && kayitId) {
        try {
          const c = await avukataGonder(kayitId, form.avukat_id, form.avukat_notu, "sirket");
          setSatirlar((p) => p.map((x) => (x.id === kayitId
            ? { ...x, avukat_mail_at: c.gonderildiAt, avukat_mail_ek: c.ek, avukat_mail_gonderen: c.gonderen,
                avukat_mail_sayisi: (x.avukat_mail_sayisi ?? 0) + 1 }
            : x)));
          toast.success(`${c.alici} adresine gönderildi · ek: ${c.ek}`);
          if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
          if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
          avukatTakipNotuGoster();
        } catch (e) {
          toast.error(`${e instanceof Error ? e.message : "Mail gönderilemedi."}

`
            + `Kayıt tutuldu ama dosya avukata ULAŞMADI.`, { duration: 12000 });
        }
      }
      setDialogAcik(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast.error(m.includes("duplicate") || m.includes("icra_sirket_takip_dosya_uq")
        ? "Bu icra dairesinde bu dosya numarası zaten kayıtlı." : "Kaydedilemedi.");
    }
    finally { setKaydediliyor(false); }
  }
  async function sil(id: string) {
    if (typeof window !== "undefined" && !window.confirm("Bu takip kaydı silinsin mi?")) return;
    try { await deleteIcraSirketTakip(id); setSatirlar((p) => p.filter((s) => s.id !== id)); icraDegisti(); }
    catch { toast.error("Silinemedi."); }
  }

  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400 gap-2"><Loader2 size={18} className="animate-spin" /> Yükleniyor…</div>;
  if (hata) return <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">{hata}</div>;

  const th = "px-2 py-2 font-semibold text-[#1E3A5F] border border-gray-200 text-center align-middle";
  const td = "border border-gray-100 px-1.5 py-1.5 align-middle text-[11px] truncate";
  const islemVar = canDuzenle || canSil;
  const fLbl = "text-xs font-medium text-gray-600 mb-1 block";
  const fInp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";
  const formGecerli = Boolean(
    form.borclu_firma.trim() && form.dosya_esas_no.trim() && form.icra_dairesi.trim() &&
    form.alacakli_adi.trim() && form.teblig_tarihi && parseParaInput(form.takip_tutari) > 0,
  );

  /** Son itiraz günü hücresi — süre belgede yoksa gün YAZILMAZ, sebebi yazılır. */
  function SureHucresi({ s }: { s: IcraSirketTakip }) {
    const gun = sonItirazGunu(s);
    if (!gun) return <span className="text-gray-400" title="Belgede itiraz süresi yazmıyor — gün uydurulmadı">belgede yok</span>;
    const itirazVar = Boolean(s.itiraz_tarihi);
    const gecti = gun < BUGUN();
    if (itirazVar) return <span className="text-gray-600">{tarihGoster(gun)}</span>;
    if (gecti) return <span className="text-red-600 font-medium" title="İtiraz süresi geçmiş, itiraz kaydı yok">{tarihGoster(gun)} · geçti</span>;
    return <span className="text-amber-700 font-medium" title="İtiraz süresi işliyor">{tarihGoster(gun)}</span>;
  }

  return (
    <div>
      <div className="flex items-baseline mb-1 gap-x-3 gap-y-1 flex-wrap">
        <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2"><Scale size={24} /> Şirkete Açılan Takipler</h1>
        {yeniSayisi > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {yeniSayisi} dosya henüz ele alınmadı
          </span>
        )}
        {canEkle && (
          <button type="button" onClick={() => dialogAc()}
            className="ml-auto flex items-center gap-1.5 h-9 px-3 text-sm rounded-md bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus size={16} /> Yeni Takip Ekle
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Borçlu şirketin KENDİSİ — ödeme emirleri. Üçüncü şahıs (işveren) olarak cevap verdiğimiz haciz
        yazıları diğer sekmede. Tebligat gelince bu liste kendiliğinden dolar.
      </p>

      <div className="mb-3 flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-96">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" value={arama} onChange={(e) => setArama(e.target.value)}
            placeholder="Dosya no, icra dairesi, alacaklı, firma…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
        </div>
        <button type="button" onClick={() => setSadeceAcik(!sadeceAcik)}
          className={`h-8 px-2.5 text-xs rounded-md border transition-colors ${
            sadeceAcik ? "bg-[#1E3A5F] text-white border-[#1E3A5F]" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
          }`}>
          Yalnız açık dosyalar
        </button>
        <span className="text-xs text-gray-500">{gorunen.length} kayıt</span>
      </div>

      {/* Tam tablo — yatay/masaüstü. Dik telefonda kart görünümü aşağıda. */}
      {/* 15 SATIRLIK PENCERE — üçüncü şahıs tablosuyla aynı. Başlık yapışkan;
          arka planı THEAD'de duruyor (globals.css'teki katmansız
          `thead th { background-color: inherit }` th'ye verilen rengi eziyor).
          YÜKSEKLİK: 15 × 33px satır + 65px başlık. */}
      <div className="hidden landscape:block lg:block w-full bg-white rounded-lg border border-gray-200 overflow-auto max-h-[560px]">
        <table className="text-xs text-gray-900 border-collapse w-full table-fixed">
          <colgroup>
            <col className="w-[3%]" />{/* S.No */}
            <col className="w-[3%]" />{/* firma rengi */}
            <col className="w-[8%]" />{/* Dosya */}
            <col className="w-[13%]" />{/* İcra dairesi */}
            <col className="w-[15%]" />{/* Alacaklı */}
            <col className="w-[9%]" />{/* Takip tutarı */}
            <col className="w-[7%]" />{/* Tebliğ */}
            <col className="w-[10%]" />{/* Son itiraz günü */}
            <col className="w-[8%]" />{/* Ödenen */}
            <col className="w-[9%]" />{/* Durum */}
            <col className="w-[4%]" />{/* Belge */}
            {islemVar && <col className="w-[6%]" />}
          </colgroup>
          {/* ARKA PLAN SATIRA İNLINE VERİLİYOR — başlığın altından satırlar
              görünmesin diye. globals.css'te katmansız iki kural var:
              `thead { position: sticky }` ve `thead th { background-color: inherit }`.
              Yapışkan thead'in KENDİ arka planı border-collapse'lı tabloda
              boyanmıyor; th'ler de "inherit" dediği için satırdan renk alıyor,
              satırın rengi yoksa saydam kalıyorlar. Rengi tr'ye inline vermek
              hem o kuralla çalışıyor hem de Tailwind sınıflarının ezilmesine
              takılmıyor (#f3f4f6 = gray-100). */}
          <thead className="bg-gray-100">
            <tr style={{ backgroundColor: "#f3f4f6" }}>
              <th className={th}>S.No</th>
              <th className={th}></th>
              <th className={th}>Dosya Esas No</th>
              <th className={th}>İcra Dairesi</th>
              <th className={th}>Alacaklı</th>
              <th className={th}>Takip Tutarı</th>
              <th className={th}>Tebliğ</th>
              <th className={th}>Son İtiraz Günü</th>
              <th className={th}>Ödenen</th>
              {/* Pencerede de "Cevap şekli" diyor — iki yerde iki ad karışıklık yapıyordu. */}
              <th className={th}>Cevap Şekli</th>
              <th className={th}>Belge</th>
              {islemVar && <th className={th}>İşlem</th>}
            </tr>
          </thead>
          <tbody>
            {gorunen.length === 0 && (
              <tr><td colSpan={islemVar ? 12 : 11} className="text-center text-gray-400 py-8">
                {arama.trim() || sadeceAcik ? "Süzgeçle eşleşen kayıt yok." : "Henüz kayıt yok. Şirkete ödeme emri gelirse buraya düşer."}
              </td></tr>
            )}
            {gorunen.map((s) => {
              const d = durumBilgi(s.durum);
              return (
                <tr key={s.id} className="border-b border-gray-100 hover:bg-gray-50/60">
                  <td className={`${td} text-center text-gray-500 tabular-nums`}>{siraNo.get(s.id)}</td>
                  {/* FİRMA RENGİ: ince dikey çubuk (üçüncü şahıs defteriyle aynı dil). */}
                  <td className="border border-gray-100 px-1.5 py-1.5 align-middle" title={s.borclu_firma ?? ""}>
                    <span className="mx-auto block w-1 rounded-full"
                      style={{ backgroundColor: firmaRengi(s.borclu_firma) ?? "#e5e7eb", minHeight: "1.25rem" }} />
                  </td>
                  <td className={td} title={s.dosya_esas_no ?? ""}>{s.dosya_esas_no}</td>
                  <td className={td} title={s.icra_dairesi ?? ""}>{s.icra_dairesi}</td>
                  <td className={td} title={s.alacakli_adi ?? ""}>{s.alacakli_adi}</td>
                  <td className={`${td} text-right tabular-nums text-red-600`}>{paraGoster(Number(s.takip_tutari || 0))}</td>
                  <td className={`${td} text-center`}>{tarihGoster(s.teblig_tarihi)}</td>
                  <td className={`${td} text-center`}><SureHucresi s={s} /></td>
                  <td className={`${td} text-right tabular-nums text-emerald-700`}>{paraGoster(Number(s.odenen_tutar || 0))}</td>
                  <td className={`${td} text-center`}>
                    <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${d.sinif}`}>{d.ad}</span>
                  </td>
                  <td className={`${td} text-center`}>
                    {s.belge_yolu ? (
                      <a href={dosyaUrl(s.belge_yolu)} target="_blank" rel="noopener noreferrer"
                        className="text-[#1E3A5F] hover:text-emerald-700 inline-flex" title="Tebligat belgesini aç">
                        <FileText size={14} />
                      </a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
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
              <td className={`${td} text-right`} colSpan={5}>TOPLAM</td>
              <td className={`${td} text-right tabular-nums text-red-600 px-2`}>{tlFmt(toplamTakip)}</td>
              {/* Tebliğ + Son İtiraz Günü */}
              <td className={td} colSpan={2} />
              <td className={`${td} text-right tabular-nums text-emerald-700 px-2`}>{tlFmt(toplamOdenen)}</td>
              <td className={td} colSpan={islemVar ? 3 : 2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Dik telefon: kart görünümü */}
      <div className="block landscape:hidden lg:hidden space-y-2">
        {gorunen.length === 0 ? (
          <div className="bg-white rounded-lg border p-6 text-center text-gray-400 text-sm">Kayıt yok.</div>
        ) : gorunen.map((s) => {
          const d = durumBilgi(s.durum);
          const renk = firmaRengi(s.borclu_firma);
          return (
            <div key={s.id} className="bg-white rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                    {renk && <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: renk }} />}
                    <span className="truncate">{s.dosya_esas_no}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{s.icra_dairesi}</div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${d.sinif}`}>{d.ad}</span>
              </div>
              <div className="mt-2 text-[11px] text-gray-600 space-y-0.5">
                <div><span className="text-gray-400">Alacaklı:</span> {s.alacakli_adi}</div>
                <div><span className="text-gray-400">Takip tutarı:</span> <span className="text-red-600 font-medium tabular-nums">{paraGoster(Number(s.takip_tutari || 0))}</span></div>
                <div><span className="text-gray-400">Tebliğ:</span> {tarihGoster(s.teblig_tarihi)}</div>
                <div><span className="text-gray-400">Son itiraz günü:</span> <SureHucresi s={s} /></div>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {s.belge_yolu && (
                  <a href={dosyaUrl(s.belge_yolu)} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] text-[#1E3A5F] inline-flex items-center gap-1"><FileText size={12} /> Belge</a>
                )}
                {canDuzenle && <button type="button" onClick={() => dialogAc(s)} className="text-[11px] text-[#1E3A5F] inline-flex items-center gap-1"><Pencil size={12} /> Düzenle</button>}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={dialogAcik} onOpenChange={setDialogAcik}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editId ? "Takibi Düzenle" : "Yeni Takip Ekle"}</DialogTitle>
          </DialogHeader>
          <div ref={formRef} onKeyDown={formEnter}
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
            <div className="sm:col-span-1">
              <label className={fLbl}>Borçlu firma *</label>
              <select className={fInp} value={form.borclu_firma} onChange={(e) => setF("borclu_firma", e.target.value)}>
                <option value="">Seçin…</option>
                {firmaAdlari.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div><label className={fLbl}>Dosya esas no *</label>
              <input className={fInp} value={form.dosya_esas_no} onChange={(e) => setF("dosya_esas_no", e.target.value)} placeholder="2026/27774" /></div>
            <div><label className={fLbl}>İcra dairesi *</label>
              <input className={fInp} value={form.icra_dairesi} onChange={(e) => setF("icra_dairesi", e.target.value)} placeholder="Ankara 7. Genel İcra Dairesi" /></div>

            <div className="sm:col-span-2"><label className={fLbl}>Alacaklı *</label>
              <input className={fInp} value={form.alacakli_adi} onChange={(e) => setF("alacakli_adi", e.target.value)} /></div>
            <div><label className={fLbl}>Alacaklı vergi no</label>
              <input className={fInp} value={form.alacakli_vergi_no} onChange={(e) => setF("alacakli_vergi_no", e.target.value)} /></div>

            <div><label className={fLbl}>Takip tutarı *</label>
              <input className={`${fInp} text-right`} value={form.takip_tutari}
                onChange={(e) => setF("takip_tutari", formatParaInput(e.target.value))} inputMode="decimal" /></div>
            <div><label className={fLbl}>Belge tarihi</label>
              <input type="date" className={fInp} value={form.belge_tarihi} onChange={(e) => setF("belge_tarihi", e.target.value)} /></div>
            <div><label className={fLbl}>Tebliğ tarihi *</label>
              <input type="date" className={fInp} value={form.teblig_tarihi} onChange={(e) => setF("teblig_tarihi", e.target.value)} /></div>

            <div>
              <label className={fLbl}>İtiraz süresi (gün)</label>
              <input className={fInp} value={form.itiraz_suresi_gun} inputMode="numeric"
                onChange={(e) => setF("itiraz_suresi_gun", e.target.value.replace(/\D/g, ""))} placeholder="belgede yazan" />
              <p className="text-[10px] text-gray-400 mt-0.5">Belgede yazmıyorsa boş bırakın — gün uydurulmaz.</p>
            </div>
            {/* CEVAP BÖLÜMÜ — hızlı pencereyle aynı düzen: cevap şekli önce ve tek
                satır, sorulan alanlar ona bağlı. "Seçin…" ele alınmamış demek
                (durum="yeni"); işlenmiş bir takip buraya çekilerek geri alınır. */}
            <div className="sm:col-span-3 mt-1 border-t pt-3 text-xs font-semibold text-gray-500">Cevap / Ödeme</div>
            {/* MUHASEBENİN BİLDİRDİĞİ, CEVAP ŞEKLİNİN ÜSTÜNDE: şekli belirleyen o. */}
            <div className="sm:col-span-3"><MuhasebeBandi kayit={duzenlenen} sirket /></div>
            <div className="sm:col-span-3"><label className={fLbl}>Cevap şekli</label>
              <select className={fInp} value={form.durum} onChange={(e) => sekilDegistir(e.target.value as IcraSirketDurum)}>
                <option value="yeni">Seçin…</option>
                {durumSecenekleri(form.durum as IcraSirketDurum).map((k) => (
                  <option key={k} value={k}>{DURUMLAR.find((d) => d.kod === k)?.ad ?? k}</option>
                ))}
              </select></div>

            {/* SEÇİM YAPILMADAN ALT ALANLAR GÖRÜNMEZ — hızlı pencereyle aynı.
                İTİRAZ ALANLARI KALDIRILDI: "İtiraz edildi" bir cevap şekli
                olmaktan çıktı; kayıttaki değerler silinmiyor, sorulmuyor. */}
            {form.durum === "avukatta" && (
              <div className="sm:col-span-3">
                <AvukatSecim
                  avukatId={form.avukat_id} not_={form.avukat_notu} kaynak="sirket" kayitId={editId}
                  degistir={(y) => setForm((f) => ({
                    ...f,
                    ...(y.avukat_id !== undefined ? { avukat_id: y.avukat_id } : {}),
                    ...(y.avukat_adi !== undefined ? { avukat_adi: y.avukat_adi } : {}),
                    ...(y.avukat_notu !== undefined ? { avukat_notu: y.avukat_notu } : {}),
                    ...(y.avukat_ekler !== undefined ? { avukat_ekler: y.avukat_ekler } : {}),
                  }))}
                  ekler={form.avukat_ekler}
                  muhasebeEkleri={duzenlenen?.muhasebe_cevap_mail_ekler ?? []}
                  mailBilgisi={{
                    tarih: duzenlenen?.avukat_mail_at ?? null, ek: duzenlenen?.avukat_mail_ek ?? null,
                    gonderen: duzenlenen?.avukat_mail_gonderen ?? null,
                    sayi: duzenlenen?.avukat_mail_sayisi ?? 0,
                    gecerli: avukatCevabiDuruyor,
                  }}
                />
              </div>
            )}

            {form.durum === "odendi" && (
              <>
                <div><label className={fLbl}>Ödeme tarihi *</label>
                  <input type="date" className={fInp} value={form.odeme_tarihi} onChange={(e) => setF("odeme_tarihi", e.target.value)} /></div>
                <div><label className={fLbl}>Ödenen tutar *</label>
                  <input className={`${fInp} text-right`} value={form.odenen_tutar}
                    onChange={(e) => setF("odenen_tutar", formatParaInput(e.target.value))} inputMode="decimal" /></div>
                <div><label className={fLbl}>Hangi bankadan ödendi *</label>
                  <input className={fInp} value={form.banka_adi} placeholder="Ödemenin yapıldığı banka"
                    onChange={(e) => setF("banka_adi", e.target.value)} /></div>
              </>
            )}

            {form.durum !== "yeni" && (
              <div className="sm:col-span-3"><label className={fLbl}>Açıklama</label>
                <input className={fInp} value={form.aciklama} onChange={(e) => setF("aciklama", e.target.value)} /></div>
            )}
          </div>
          {/* DÜĞMELER ALTTA SABİT: pencere içeriği uzayınca (avukat kipinde liste,
              not kutusu, gönderim bilgisi) İptal/Kaydet aşağı kayıp görünmez
              oluyordu — kullanıcı kaydetmek için kaydırmak zorunda kalıyordu.
              Gövde kendi içinde kayıyor, alt şerit yerinde duruyor. */}
          <DialogFooter className="shrink-0 border-t pt-3">
            {/* KAYDETMEDEN ÖNCE SÖYLENİR: bu pencereden DIŞARIYA MAİL ÇIKIYOR —
                yeni takipte muhasebeye, avukat seçiliyse avukata. */}
            {(gonderilecek || muhasebeyeGidecek) && (
              <span className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                {kaydediliyor
                  ? <><Loader2 size={12} className="animate-spin" /> Mail gönderiliyor…</>
                  : <><Send size={12} /> Kaydedince {[muhasebeyeGidecek ? "muhasebeye" : "", gonderilecek ? "avukata" : ""].filter(Boolean).join(" ve ")} mail gider</>}
              </span>
            )}
            <Button variant="outline" onClick={() => setDialogAcik(false)}>Vazgeç</Button>
            <Button onClick={kaydet} disabled={kaydediliyor || !formGecerli}>
              {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
              {gonderilecek ? "Kaydet ve avukata gönder" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
