// MUHASEBE AŞAMASI PENCERESİ — gönderim izi + muhasebenin bildirdiği cevap.
//
// NİYE VAR: cevabın altlığını muhasebe hazırlıyor, borç durumunu o çıkarıyor ve
// CEVAP ŞEKLİNİ (yazışma / havale / avukat) belirleyen de o. Bu aşama panelde hiç
// yoktu; "muhasebeye gönderdik mi, cevap geldi mi" sorusu mail kutusunda
// aranıyordu. Artık dosyanın yanında duruyor.
//
// İKİ DEFTERE BİRDEN: kaynak="icra" üçüncü şahıs haczi, kaynak="sirket" ödeme
// emri. Sorular ters yönde (bize borç var mı / biz ödedik mi) ama aşama, gönderim
// izi ve kayıt aynı — ayrı iki pencere yazılsaydı biri düzelir öbürü geride kalırdı.
//
// CEVAP MAİLDE DEĞİL PANELDE SAYILIR: muhasebenin cevabı bu pencereye girilince
// dosya "cevaplandı" oluyor. Mail kutusunda duran bir cevabı panel bilemez;
// bilmediği şeyi de "geldi" sayamaz.
"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2, Send, Mail, MailCheck, MailX, AlertTriangle, Paperclip, X } from "lucide-react";
import { useAuth, icraDegisti } from "@/hooks";
import { updateIcraKayit } from "@/lib/supabase/queries/icra";
import { updateIcraSirketTakip } from "@/lib/supabase/queries/icra-sirket";
import { muhasebeyeGonder, muhasebeAsamasi, muhasebeBorcMetni, type MuhasebeDurumu } from "@/lib/supabase/queries/icra-muhasebe";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { dosyaUrl } from "@/lib/utils/dosya-url";
import { kapanabilir, ayniMi } from "@/lib/utils/pencere-kapanis";
import { sonGunHesapla, VARSAYILAN_CEVAP_SURESI } from "@/lib/utils/icra-sure";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Pencerenin iki defterden de beklediği alanlar. */
export type MuhasebeKaydi = MuhasebeDurumu & {
  id: string;
  dosya_esas_no: string | null;
  teblig_tarihi: string | null;
  alacakli_adi: string | null;
  muhasebe_mail_ek?: string | null;
  muhasebe_mail_alici?: string | null;
  muhasebe_mail_gonderen?: string | null;
  muhasebe_mail_sayisi?: number | null;
  muhasebe_cevap_yazan?: string | null;
  /** Üçüncü şahıs defteri */
  borclu_adi?: string | null;
  borc_miktari?: number | null;
  cevap_suresi_gun?: number | null;
  /** Şirket defteri */
  borclu_firma?: string | null;
  takip_tutari?: number | null;
  itiraz_suresi_gun?: number | null;
};

type Form = { borc_durumu: string; tutar: string; cevap_sekli: string; not: string };
const BOS: Form = { borc_durumu: "", tutar: "", cevap_sekli: "", not: "" };

const gunTR = (v: string | null | undefined) => (v ? v.split("-").reverse().join(".") : "—");
const paraGoster = (n: number) => (n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
const sayiToInput = (n: number | null | undefined) =>
  (n ? formatParaInput(Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",")) : "");
const saatTR = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("tr-TR")} ${d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`;
};

/**
 * KART SATIRINDAKİ MUHASEBE İŞARETLERİ — iki ayrı ikon, iki ayrı soru:
 *
 *   ① GİTTİ Mİ?   icra yazısı muhasebeye mail edildi mi (tebliğden sonraki ilk adım)
 *   ② GELDİ Mİ?   muhasebeden cevap döndü mü
 *
 * NİYE İKİSİ AYRI: tek ikon "aşama nerede" sorusunu cevaplıyor ama "gitti ama
 * cevap yok" ile "hiç gitmedi"yi aynı yerde gösteriyordu. Ayrı duran iki işaret,
 * listeye bakarken hangi tarafın beklediğini söylüyor.
 *
 * ② İKİ KAYNAKTAN DOLAR: muhasebenin cevap maili posta kutusunda yakalandıysa
 * (muhasebe_cevap_mail_at) ya da cevabı panele giren oldu (muhasebe_cevap_at).
 * İkincisi kesin bilgidir — insan okuyup girmiştir; birincisi "mail geldi,
 * içeriği henüz işlenmedi" demek.
 */
export type MuhasebeIkonKaydi = MuhasebeDurumu & {
  muhasebe_mail_at?: string | null;
  muhasebe_mail_alici?: string | null;
  muhasebe_cevap_mail_at?: string | null;
  muhasebe_cevap_mail_gonderen?: string | null;
};

const anTR = (iso: string | null | undefined) => (iso
  ? `${new Date(iso).toLocaleDateString("tr-TR")} ${new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
  : "");

export function MuhasebeIkon({ kayit, sirket, boyut = 15 }: {
  kayit: MuhasebeIkonKaydi | null;
  sirket: boolean;
  boyut?: number;
}) {
  if (!kayit) return null;
  const gitti = Boolean(kayit.muhasebe_mail_at);
  const cevapMaili = Boolean(kayit.muhasebe_cevap_mail_at);
  const cevapGirildi = Boolean(kayit.muhasebe_cevap_at);

  const gittiIpucu = gitti
    ? `İcra yazısı muhasebeye gönderildi · ${anTR(kayit.muhasebe_mail_at)}`
      + (kayit.muhasebe_mail_alici ? ` · ${kayit.muhasebe_mail_alici}` : "")
    : "İcra yazısı muhasebeye GÖNDERİLMEDİ";
  const cevapIpucu = cevapGirildi
    ? `Muhasebe cevabı işlendi: ${muhasebeBorcMetni(kayit, sirket)}`
      + (kayit.muhasebe_cevap_sekli ? ` → ${kayit.muhasebe_cevap_sekli}` : "")
    : cevapMaili
      ? `Muhasebeden cevap maili geldi · ${anTR(kayit.muhasebe_cevap_mail_at)}`
        + (kayit.muhasebe_cevap_mail_gonderen ? ` · ${kayit.muhasebe_cevap_mail_gonderen}` : "")
        + " — içeriği panele girilmedi"
      : gitti ? "Muhasebeden cevap gelmedi" : "Muhasebe aşaması başlamadı";

  return (
    <span className="inline-flex items-center gap-2.5 align-middle">
      <span title={gittiIpucu} className="inline-flex">
        {gitti
          ? <Send size={boyut} className="shrink-0 text-sky-600" aria-label="Muhasebeye gönderildi" />
          : <MailX size={boyut} className="shrink-0 text-red-500" aria-label="Muhasebeye gönderilmedi" />}
      </span>
      <span title={cevapIpucu} className="inline-flex">
        {cevapGirildi
          ? <MailCheck size={boyut} className="shrink-0 text-emerald-600" aria-label="Muhasebe cevabı işlendi" />
          : cevapMaili
            ? <Mail size={boyut} className="shrink-0 text-emerald-600" aria-label="Muhasebeden cevap maili geldi" />
            : <Mail size={boyut} className="shrink-0 text-gray-300" aria-label="Muhasebeden cevap gelmedi" />}
      </span>
    </span>
  );
}

/**
 * MUHASEBENİN MAİLİ — pencerenin üstüne binen okuma katmanı.
 *
 * NİYE KATMAN: mesaj önce şeridin ALTINDA açılıyordu, form aşağı kayıp Kaydet
 * ekrandan çıkıyordu. Ayrı sekme de denendi: dashboard yerleşimiyle birlikte
 * açıldığı için ağır kaldı ve bağlam koptu. Katman cevap penceresinin üstünde
 * duruyor; kapatınca form olduğu gibi yerinde.
 *
 * KATMAN PENCERENİN İÇİNDE (portal DEĞİL): dışarı taşınsaydı buraya yapılan
 * tıklama üstteki pencere için "dışarı tıklama" sayılır ve doldurulan cevap
 * penceresi kapanırdı.
 *
 * ══ DIŞ KAYNAKLI İÇERİK SANDBOX'TA ══
 * Bu HTML'i panel yazmadı, MUHASEBEDEN GELDİ. Doğrudan gömülseydi mailin
 * içindeki betik panelin sayfasında çalışırdı. srcDoc + sandbox="" ile
 * gösteriliyor: betik yok, form yok, panelin verisine erişim yok.
 */
function MuhasebeMaili({ kayit, kapat }: { kayit: MuhasebeDurumu; kapat: () => void }) {
  const ekler = (kayit.muhasebe_cevap_mail_ekler ?? []) as { ad: string; yol: string }[];
  const kacar = (v: string) => v.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  // MAİLİN ASLI: HTML mail düz metne çevrilince biçim dağılıyor (alıntılanan
  // yazışma, tablolar iç içe giriyor). Asıl yoksa metin, satır araları korunarak.
  const govde = kayit.muhasebe_cevap_mail_html
    ?? `<pre style="white-space:pre-wrap;word-wrap:break-word;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;margin:0">`
      + kacar(kayit.muhasebe_cevap_mail_metin ?? "Mailin içeriği kaydedilmemiş.") + `</pre>`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); kapat(); } }}>
      <button type="button" aria-label="Kapat" onClick={kapat}
        className="absolute inset-0 cursor-default bg-black/40" />
      <div className="relative flex h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-2xl">
        <div className="flex items-start gap-2 border-b bg-emerald-50 px-4 py-3">
          <Mail size={16} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-emerald-900">Muhasebenin cevabı</div>
            <div className="text-[11px] text-emerald-800">
              {kayit.muhasebe_cevap_mail_gonderen}
              {kayit.muhasebe_cevap_mail_at
                ? ` · ${new Date(kayit.muhasebe_cevap_mail_at).toLocaleString("tr-TR")}` : ""}
            </div>
            {kayit.muhasebe_cevap_mail_konu
              ? <div className="mt-0.5 truncate text-[11px] text-emerald-700" title={kayit.muhasebe_cevap_mail_konu}>
                  {kayit.muhasebe_cevap_mail_konu}
                </div> : null}
          </div>
          <button type="button" onClick={kapat} aria-label="Kapat"
            className="shrink-0 rounded p-1 text-emerald-700 hover:bg-emerald-100"><X size={16} /></button>
        </div>

        {ekler.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-gray-50 px-4 py-2 text-[11px]">
            <span className="text-gray-500">Ekler:</span>
            {ekler.map((e) => (
              // ÖZEL KOVA: adres doğrudan açılmaz, dosyaUrl imzalı geçitten geçirir (AGENTS.md).
              <a key={e.yol} href={dosyaUrl(e.yol)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-100">
                <Paperclip size={10} /> {e.ad}
              </a>
            ))}
          </div>
        )}

        <iframe title="Muhasebe cevabı" sandbox=""
          srcDoc={`<!doctype html><html><head><meta charset="utf-8">`
            + `<style>body{margin:14px;font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937}`
            + `img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${govde}</body></html>`}
          className="min-h-0 flex-1 w-full bg-white" />
      </div>
    </div>
  );
}

/**
 * CEVAP ŞEKLİNİN ÜSTÜNDEKİ MUHASEBE ŞERİDİ — her iki defterin formunda aynı.
 *
 * NİYE CEVAP ŞEKLİNİN YANINDA: şekli (yazışma / havale / avukat; ödeme emrinde
 * ödendi / avukatta / kapandı) belirleyen muhasebenin bildirdiği borç durumu.
 * Bildirim başka pencerede dururken burada seçim yapmak tahmin olur.
 *
 * DÖRT HÂL: gönderilmedi · cevap bekleniyor · CEVAP MAİLİ GELDİ (tıklanınca
 * mesaj okunur) · cevap panele girildi. Üçüncüsü eksikti: mail gelmiş olsa bile
 * şerit "bekleniyor" diyordu, oysa beklenen şey artık okunmayı bekliyordu.
 */
export function MuhasebeBandi({ kayit, sirket }: {
  kayit: MuhasebeDurumu | null;
  sirket: boolean;
}) {
  const [acik, setAcik] = useState(false);
  if (!kayit) return null;
  const asama = muhasebeAsamasi(kayit);
  const mailVar = Boolean(kayit.muhasebe_cevap_mail_at);
  // CEVAP MAİLİ GELDİYSE ŞERİT YEŞİL: "bekleniyor" sarısı yanlış olurdu.
  const renk = asama === "cevaplandi" ? "border-sky-200 bg-sky-50 text-sky-900"
    : mailVar ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : asama === "bekleniyor" ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-red-200 bg-red-50 text-red-800";
  const anTR = (iso: string | null | undefined) => (iso
    ? `${new Date(iso).toLocaleDateString("tr-TR")} ${new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
    : "");

  return (
    <div className={`sm:col-span-2 lg:col-span-3 rounded-lg border px-3 py-2 text-[11px] ${renk}`}>
      {asama === "cevaplandi" ? (
        <>
          <strong>Muhasebe:</strong> {muhasebeBorcMetni(kayit, sirket)}
          {kayit.muhasebe_cevap_sekli ? <> → <strong>{kayit.muhasebe_cevap_sekli}</strong></> : null}
          {kayit.muhasebe_notu ? <div className="mt-0.5 whitespace-pre-wrap text-sky-800/90">{kayit.muhasebe_notu}</div> : null}
        </>
      ) : mailVar ? (
        <>
          <strong>Muhasebeden cevap maili geldi</strong> · {anTR(kayit.muhasebe_cevap_mail_at)}
          {kayit.muhasebe_cevap_mail_gonderen ? ` · ${kayit.muhasebe_cevap_mail_gonderen}` : ""}
        </>
      ) : asama === "bekleniyor" ? (
        <><strong>Muhasebe cevabı bekleniyor.</strong>{" "}
          {sirket ? "Borcun ödenip ödenmediğini muhasebe bildirecek." : "Cevap şekli, muhasebenin bildirdiği borç durumuna göre seçilir."}</>
      ) : (
        <><strong>Dosya muhasebeye gönderilmedi.</strong>{" "}
          {sirket ? "Borç durumunu muhasebe çıkarıyor" : "Borç durumunu ve hesap ekstresini muhasebe hazırlıyor"} — Muhasebe penceresinden gönderin.</>
      )}

      {/* MESAJ AYRI PENCEREDE AÇILIR.
          Önce şeridin altında açılıyordu: form aşağı kayıyor, Kaydet ekrandan
          çıkıyordu. Üste binen katman da dar kaldı, uzun yazışma okunmadı.
          Mail kendi penceresinde kendi boyunda okunuyor; cevap penceresi
          arkada olduğu gibi duruyor (doldurulan form kaybolmuyor). */}
      {mailVar && (
        <>
          <button type="button" onClick={() => setAcik(true)}
            className="mt-1 inline-flex items-center gap-1 font-semibold underline underline-offset-2">
            <Mail size={11} /> Muhasebenin mesajını oku
            {(kayit.muhasebe_cevap_mail_ekler ?? []).length > 0
              ? ` (${(kayit.muhasebe_cevap_mail_ekler as { ad: string }[]).length} ek)` : ""}
          </button>
          {acik && <MuhasebeMaili kayit={kayit} kapat={() => setAcik(false)} />}
        </>
      )}
    </div>
  );
}

export default function MuhasebeCevapDialog({ kayit, kaynak, sekiller, acik, kapat, kaydedildi }: {
  kayit: MuhasebeKaydi | null;
  kaynak: "icra" | "sirket";
  /** Muhasebenin belirlediği cevap şekli listesi (defterine göre çağıran verir). */
  sekiller: { kod: string; ad: string }[];
  acik: boolean;
  kapat: () => void;
  kaydedildi: (yama: Record<string, unknown>) => void;
}) {
  const { kullanici } = useAuth();
  const sirket = kaynak === "sirket";
  const [v, setV] = useState<Form>(BOS);
  const [baslangic, setBaslangic] = useState<Form>(BOS);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  // EKSİK ALAN BALONLA DEĞİL KIRMIZIYLA: kutular boyanıyor, kullanıcı nereye
  // bakacağını metinden değil ekrandan görüyor (panelin geri kalanıyla aynı).
  const [denendi, setDenendi] = useState(false);

  useEffect(() => {
    if (!acik || !kayit) return;
    const ilk: Form = {
      borc_durumu: kayit.muhasebe_borc_durumu ?? "",
      tutar: sayiToInput(kayit.muhasebe_borc_tutari),
      cevap_sekli: kayit.muhasebe_cevap_sekli ?? "",
      not: kayit.muhasebe_notu ?? "",
    };
    setV(ilk); setBaslangic(ilk); setDenendi(false);
  }, [acik, kayit]);

  if (!kayit) return null;

  const asama = muhasebeAsamasi(kayit);
  const sure = sirket ? kayit.itiraz_suresi_gun : (kayit.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI);
  const sonGun = sonGunHesapla(kayit.teblig_tarihi, sure ?? null);
  const tutarIstenir = sirket ? v.borc_durumu === "odendi" : v.borc_durumu === "var";

  // ZORUNLU ALANLAR: borç durumu ve cevap şekli — bu pencerenin tek işi bunları
  // kaydetmek. Tutar yalnız "ödenmiş / borcumuz var" denince isteniyor; ödenmemiş
  // bir borçta tutarı muhasebe bildirmiyorsa uydurulmaz.
  const eksikler = (): string[] => {
    const e: string[] = [];
    if (!v.borc_durumu) e.push("borc_durumu");
    if (!v.cevap_sekli) e.push("cevap_sekli");
    if (tutarIstenir && parseParaInput(v.tutar) <= 0) e.push("tutar");
    return e;
  };
  const hata = (alan: string) => denendi && eksikler().includes(alan)
    ? "border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500/30" : "border-gray-300";

  /** Alan değişince kırmızılıklar kalksın — düzeltilmiş alanı kırmızı tutmak yanıltır. */
  const degistir = (yama: Partial<Form>) => { setV((p) => ({ ...p, ...yama })); if (denendi) setDenendi(false); };

  async function gonder() {
    if (!kayit) return;
    setGonderiliyor(true);
    try {
      const c = await muhasebeyeGonder(kayit.id, kaynak, v.not);
      kaydedildi({
        muhasebe_mail_at: c.gonderildiAt, muhasebe_mail_ek: c.ek,
        muhasebe_mail_alici: c.alicilar.join(", "), muhasebe_mail_gonderen: c.gonderen,
        muhasebe_mail_sayisi: (kayit.muhasebe_mail_sayisi ?? 0) + 1,
      });
      toast.success(`Muhasebeye gönderildi (${c.alicilar.length} alıcı) · ek: ${c.ek}`);
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
    } catch (e) {
      // SESSİZ GEÇİLMEZ (AGENTS.md): ek inmediyse mail hiç gitmedi, dosya
      // muhasebeye gönderilmemiş sayılmaya devam ediyor.
      toast.error(e instanceof Error ? e.message : "Mail gönderilemedi.", { duration: 12000 });
    } finally { setGonderiliyor(false); }
  }

  async function kaydet() {
    if (!kayit) return;
    // CEVABI GERİ ALMA: kayıtlı cevap vardı, şimdi alanlar boş. Sessizce
    // silinmez — dosya yeniden "muhasebe cevabı bekleniyor"a döner.
    const bos = !v.borc_durumu && !v.cevap_sekli && !v.not.trim() && parseParaInput(v.tutar) <= 0;
    const geriAliniyor = bos && asama === "cevaplandi";
    if (geriAliniyor) {
      if (typeof window !== "undefined" && !window.confirm(
        "Muhasebe cevabı silinecek ve dosya yeniden MUHASEBE CEVABI BEKLENİYOR durumuna dönecek.\n\n"
        + "Gönderilmiş mailin kaydı silinmez — mail gerçekten gitti.\n\nDevam edilsin mi?")) return;
    } else if (eksikler().length) { setDenendi(true); return; }

    const t = (x: string) => (x.trim() === "" ? null : x.trim());
    const simdi = new Date().toISOString();
    const yama = geriAliniyor
      ? { muhasebe_cevap_at: null, muhasebe_borc_durumu: null, muhasebe_borc_tutari: null,
          muhasebe_cevap_sekli: null, muhasebe_notu: null,
          muhasebe_cevap_yazan: null, muhasebe_cevap_yazan_id: null }
      : { muhasebe_cevap_at: kayit.muhasebe_cevap_at ?? simdi,
          muhasebe_borc_durumu: v.borc_durumu,
          muhasebe_borc_tutari: parseParaInput(v.tutar) || null,
          muhasebe_cevap_sekli: t(v.cevap_sekli),
          muhasebe_notu: t(v.not),
          // KİM GİRDİ: cevabı panele geçiren kişi. Muhasebenin kendisi değil —
          // mailden okuyup giren kullanıcı; sorulduğunda ona dönülür.
          muhasebe_cevap_yazan: kullanici?.ad_soyad ?? null,
          muhasebe_cevap_yazan_id: kullanici?.id ?? null };

    setKaydediliyor(true);
    try {
      if (sirket) await updateIcraSirketTakip(kayit.id, yama);
      else await updateIcraKayit(kayit.id, yama);
      kaydedildi(yama);
      icraDegisti();
      toast.success(geriAliniyor ? "Muhasebe cevabı geri alındı." : "Muhasebe cevabı kaydedildi.");
      kapat();
    } catch (e) {
      // SEBEBİ YUTULMAZ: eksik sütun gibi tek komutla çözülecek sorunlar
      // "Kaydedilemedi." altında saatlerce gizleniyordu.
      const m = e instanceof Error ? e.message : String(e);
      toast.error(/muhasebe_/.test(m)
        ? `Eksik sütun — sql/icra_muhasebe.sql çalıştırılmalı: ${m}`
        : `Kaydedilemedi: ${m}`, { duration: 8000 });
    } finally { setKaydediliyor(false); }
  }

  const fLbl = "text-xs font-medium text-gray-600 mb-1 block";
  const fInp = "w-full h-9 px-2.5 text-sm rounded-lg border outline-none focus:ring-1 focus:border-[#1E3A5F] focus:ring-[#1E3A5F]/30";
  const salt = "text-sm text-gray-800";
  const borcSecenekleri = sirket
    ? [{ kod: "odendi", ad: "Borç ödenmiş" }, { kod: "odenmedi", ad: "Borç ödenmemiş" }]
    : [{ kod: "yok", ad: "Borcumuz yok" }, { kod: "var", ad: "Borcumuz var" }];

  return (
    // KAZARA KAPANMA: dışarı dokunmak ya da ESC, yazılanı sessizce siliyordu.
    <Dialog open={acik} onOpenChange={(a, d) => {
      if (a) return;
      if (!kapanabilir(d, !ayniMi(v, baslangic))) return;
      kapat();
    }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Muhasebe</DialogTitle></DialogHeader>

        {/* DOSYA SALT OKUNUR: hangi dosya için cevap girildiği görünmeden alan doldurulmamalı. */}
        <div className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1 text-sm divide-y divide-gray-200">
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Dosya</span>
            <span className={salt}>{kayit.dosya_esas_no ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">{sirket ? "Borçlu firma" : "Borçlu"}</span>
            <span className={`${salt} text-right font-semibold`}>{(sirket ? kayit.borclu_firma : kayit.borclu_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Alacaklı</span>
            <span className={`${salt} text-right`}>{kayit.alacakli_adi || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">{sirket ? "Son itiraz günü" : "Son cevap günü"}</span>
            {/* SÜRE KIRMIZI: muhasebe cevabı beklerken de işliyor. */}
            <span className={`${salt} font-semibold ${sonGun ? "text-red-600" : "text-gray-400"}`}>
              {sonGun ? gunTR(sonGun) : "belgede süre yazmıyor"}
            </span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">{sirket ? "Takip tutarı" : "Borç miktarı"}</span>
            <span className={`${salt} text-red-600 tabular-nums`}>
              {paraGoster(Number((sirket ? kayit.takip_tutari : kayit.borc_miktari) || 0))}
            </span>
          </div>
        </div>

        <div className="mt-3 min-h-0 overflow-y-auto pr-1 space-y-3">
          {/* ── GÖNDERİM İZİ ── */}
          {asama === "gonderilmedi" ? (
            // GÖNDERİLMEMİŞ DOSYA GİZLENMEZ: muhasebe yazıyı görmeden altlık
            // hazırlayamaz; eksikliğin kendisi uyarıdır.
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                <AlertTriangle size={13} /> Bu dosya muhasebeye gönderilmedi
              </div>
              Borç durumunu ve hesap ekstresini muhasebe çıkarıyor. Yazıyı ekiyle birlikte gönderin.
              <div className="mt-2">
                <Button size="sm" onClick={gonder} disabled={gonderiliyor}>
                  {gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Muhasebeye gönder
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              <div className="flex items-center gap-1.5 font-semibold mb-0.5">
                <Mail size={13} /> Muhasebeye gönderildi
                {(kayit.muhasebe_mail_sayisi ?? 0) > 1 ? ` · ${kayit.muhasebe_mail_sayisi} kez` : ""}
              </div>
              <div>{kayit.muhasebe_mail_at ? saatTR(kayit.muhasebe_mail_at) : ""}
                {kayit.muhasebe_mail_gonderen ? ` · ${kayit.muhasebe_mail_gonderen}` : ""}</div>
              {kayit.muhasebe_mail_alici ? <div className="text-emerald-800/80 break-all">{kayit.muhasebe_mail_alici}</div> : null}
              {kayit.muhasebe_mail_ek ? <div className="text-emerald-800/80">ek: {kayit.muhasebe_mail_ek}</div> : null}
              <div className="mt-2">
                <Button size="sm" variant="outline" onClick={gonder} disabled={gonderiliyor}>
                  {gonderiliyor ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  Tekrar gönder
                </Button>
              </div>
            </div>
          )}

          {/* ── MUHASEBENİN BİLDİRDİĞİ ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <span className={fLbl}>Borç durumu <span className="text-red-500">*</span></span>
              <select className={`${fInp} ${hata("borc_durumu")}`} value={v.borc_durumu}
                onChange={(e) => degistir({ borc_durumu: e.target.value })}>
                <option value="">Seçin…</option>
                {borcSecenekleri.map((o) => <option key={o.kod} value={o.kod}>{o.ad}</option>)}
              </select>
            </div>

            {/* TUTAR YALNIZ GEREKİNCE: "borcumuz yok" denmiş bir dosyada tutar
                sormak, boş bırakılacak bir alan koymak olur. */}
            {v.borc_durumu ? (
              <div>
                <span className={fLbl}>
                  {sirket ? "Ödenen tutar" : "Borcumuzun tutarı"}
                  {tutarIstenir ? <span className="text-red-500"> *</span> : null}
                </span>
                <input className={`${fInp} text-right tabular-nums ${hata("tutar")}`} value={v.tutar}
                  inputMode="decimal" placeholder="0,00"
                  onChange={(e) => degistir({ tutar: formatParaInput(e.target.value) })} />
              </div>
            ) : null}

            {v.borc_durumu ? (
              <div>
                <span className={fLbl}>Muhasebenin belirlediği cevap şekli <span className="text-red-500">*</span></span>
                <select className={`${fInp} ${hata("cevap_sekli")}`} value={v.cevap_sekli}
                  onChange={(e) => degistir({ cevap_sekli: e.target.value })}>
                  <option value="">Seçin…</option>
                  {sekiller.map((o) => <option key={o.kod} value={o.kod}>{o.ad}</option>)}
                </select>
              </div>
            ) : null}

            <div className="sm:col-span-2">
              <span className={fLbl}>Muhasebenin bildirdiği (not)</span>
              <textarea className="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30"
                rows={3} value={v.not} onChange={(e) => degistir({ not: e.target.value })}
                placeholder={asama === "gonderilmedi"
                  ? "Buraya yazdığınız not, muhasebeye giden mailin içine de eklenir."
                  : "Muhasebenin cevabından aktarılacak açıklama…"} />
            </div>
          </div>

          {kayit.muhasebe_cevap_at ? (
            <div className="text-[11px] text-gray-500">
              Cevap {saatTR(kayit.muhasebe_cevap_at)} tarihinde
              {kayit.muhasebe_cevap_yazan ? ` ${kayit.muhasebe_cevap_yazan} tarafından` : ""} girildi.
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={kapat}>İptal</Button>
          <Button onClick={kaydet} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
