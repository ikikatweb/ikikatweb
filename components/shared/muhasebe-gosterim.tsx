// MUHASEBE AŞAMASININ EKRANDAKİ İZLERİ — işaretler, şerit ve mail okuyucu.
//
// ELLE GİRİLECEK BİR ŞEY YOK (10.11.2026): gönderim dosya cevap bekleyenlere
// düşünce kendiliğinden yapılıyor, cevap maili posta kutusundan yakalanıyor.
// Önce bir "Muhasebe" penceresi vardı (borç durumu, tutar, cevap şekli elle
// giriliyordu); muhasebenin cevabı zaten panelde okunabildiği için aynı bilgiyi
// ikinci kez işlemek boş emekti ve kaldırıldı.
//
// BURADA KALAN ÜÇ ŞEY:
//   MuhasebeIkon  — kart satırında: yazı gitti mi, cevap geldi mi
//   MuhasebeBandi — cevap şeklinin üstünde: aşama + mesajı açan bağlantı
//   MuhasebeMaili — mailin aslını gösteren katman (sandbox'lı)
"use client";

import { useState } from "react";
import { Mail, MailCheck, MailX, Paperclip, Send, X } from "lucide-react";
import { muhasebeAsamasi, type MuhasebeDurumu } from "@/lib/supabase/queries/icra-muhasebe";
import { dosyaUrl } from "@/lib/utils/dosya-url";

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
    ? "Muhasebe cevabı işlendi"
      + (kayit.muhasebe_cevap_sekli ? ` → ${kayit.muhasebe_cevap_sekli}` : "")
      + (kayit.muhasebe_notu ? ` · ${kayit.muhasebe_notu}` : "")
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
    // SPAN YALNIZ İKİ SÜTUN: üç sütunluk formlarda (şirket defteri, ödeme emri)
    // şerit zaten col-span-3'lü bir kutunun içinde duruyor. Buraya lg:col-span-3
    // yazıldığında İKİ sütunluk icra formunda ÜÇÜNCÜ BİR SÜTUN doğuruyor ve
    // bütün form kayıyordu: bölüm başlıkları yarım kalıyor, alanlar yan yana
    // dağılıyordu (10.11.2026).
    <div className={`sm:col-span-2 rounded-lg border px-3 py-2 text-[11px] ${renk}`}>
      {asama === "cevaplandi" ? (
        <>
          <strong>Muhasebe cevabı işlendi.</strong>
          {kayit.muhasebe_cevap_sekli ? <> Belirlenen cevap şekli: <strong>{kayit.muhasebe_cevap_sekli}</strong></> : null}
          {kayit.muhasebe_notu ? <div className="mt-0.5 whitespace-pre-wrap text-sky-800/90">{kayit.muhasebe_notu}</div> : null}
        </>
      ) : mailVar ? (
        <>
          <strong>Muhasebeden cevap maili geldi</strong> · {anTR(kayit.muhasebe_cevap_mail_at)}
          {kayit.muhasebe_cevap_mail_gonderen ? ` · ${kayit.muhasebe_cevap_mail_gonderen}` : ""}
        </>
      ) : asama === "bekleniyor" ? (
        <><strong>Muhasebe cevabı bekleniyor.</strong>{" "}
          {sirket ? "Borcun ödenip ödenmediğini muhasebe bildirecek." : "Cevap şekli, muhasebenin bildirdiğine göre seçilir."}</>
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
