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
import { Loader2, Send, Mail, AlertTriangle } from "lucide-react";
import { useAuth, icraDegisti } from "@/hooks";
import { updateIcraKayit } from "@/lib/supabase/queries/icra";
import { updateIcraSirketTakip } from "@/lib/supabase/queries/icra-sirket";
import { muhasebeyeGonder, muhasebeAsamasi, muhasebeBorcMetni, type MuhasebeDurumu } from "@/lib/supabase/queries/icra-muhasebe";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
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
 * CEVAP ŞEKLİNİN ÜSTÜNDEKİ MUHASEBE ŞERİDİ — her iki defterin formunda aynı.
 *
 * NİYE CEVAP ŞEKLİNİN YANINDA: şekli (yazışma / havale / avukat; ödeme emrinde
 * ödendi / avukatta / kapandı) belirleyen muhasebenin bildirdiği borç durumu.
 * Bildirim başka pencerede dururken burada seçim yapmak tahmin olur.
 */
export function MuhasebeBandi({ kayit, sirket }: { kayit: MuhasebeDurumu | null; sirket: boolean }) {
  if (!kayit) return null;
  const asama = muhasebeAsamasi(kayit);
  return (
    <div className={`sm:col-span-2 lg:col-span-3 rounded-lg border px-3 py-2 text-[11px] ${
      asama === "cevaplandi" ? "border-sky-200 bg-sky-50 text-sky-900"
        : asama === "bekleniyor" ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-red-200 bg-red-50 text-red-800"}`}>
      {asama === "cevaplandi" ? (
        <>
          <strong>Muhasebe:</strong> {muhasebeBorcMetni(kayit, sirket)}
          {kayit.muhasebe_cevap_sekli ? <> → <strong>{kayit.muhasebe_cevap_sekli}</strong></> : null}
          {kayit.muhasebe_notu ? <div className="mt-0.5 whitespace-pre-wrap text-sky-800/90">{kayit.muhasebe_notu}</div> : null}
        </>
      ) : asama === "bekleniyor" ? (
        <><strong>Muhasebe cevabı bekleniyor.</strong>{" "}
          {sirket ? "Borcun ödenip ödenmediğini muhasebe bildirecek." : "Cevap şekli, muhasebenin bildirdiği borç durumuna göre seçilir."}</>
      ) : (
        <><strong>Dosya muhasebeye gönderilmedi.</strong>{" "}
          {sirket ? "Borç durumunu muhasebe çıkarıyor" : "Cevabın altlığını ve borç durumunu muhasebe hazırlıyor"} — Muhasebe penceresinden gönderin.</>
      )}
    </div>
  );
}

/**
 * TABLODAKİ MUHASEBE ROZETİ — üç hâli bir bakışta gösterir ve pencereyi açar.
 *
 * GÖNDERİLMEMİŞ DOSYA KIRMIZI: olmaması gereken hâl o. "Bekleniyor" sarı çünkü
 * süre işliyor; cevap gelmişse yeşil ve ne dediği yazıyor — tabloda asıl aranan
 * bilgi "muhasebe ne dedi".
 */
export function MuhasebeRozet({ kayit, sirket, gerekli, ac }: {
  kayit: MuhasebeDurumu;
  sirket: boolean;
  /** Süresi geçmiş eski dosyalarda "gönderilmedi" kırmızısı anlamsız — gri durur. */
  gerekli: boolean;
  ac: () => void;
}) {
  const asama = muhasebeAsamasi(kayit);
  const borc = muhasebeBorcMetni(kayit, sirket);
  const sinif = asama === "cevaplandi" ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
    : asama === "bekleniyor" ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
      : gerekli ? "bg-red-100 text-red-700 hover:bg-red-200"
        : "bg-gray-100 text-gray-500 hover:bg-gray-200";
  // SÜRESİ GEÇMİŞ ESKİ DOSYADA YALNIZ ÇİZGİ: defterdeki 100 küsur devredilmiş
  // kayıtta "Gönderilmedi" yazmak sütunu gürültüye boğuyordu — orada yapılacak
  // bir iş yok. Sebebi ipucunda duruyor.
  const metin = asama === "cevaplandi" ? borc
    : asama === "bekleniyor" ? "Bekleniyor"
      : gerekli ? "Gönderilmedi" : "—";
  const ipucu = asama === "cevaplandi"
    ? [borc, kayit.muhasebe_cevap_sekli, kayit.muhasebe_notu].filter(Boolean).join(" · ")
    : asama === "bekleniyor" ? "Muhasebeye gönderildi, cevabı bekleniyor"
      : gerekli ? "Bu dosya muhasebeye gönderilmedi — cevabın altlığı muhasebeden geliyor"
        : "Muhasebeye gönderilmedi (süresi geçmiş dosya)";
  return (
    <button type="button" onClick={ac} title={ipucu}
      className={`w-full truncate rounded px-1.5 py-0.5 text-[10px] font-medium ${sinif}`}>
      {metin}
    </button>
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
      toast.success(`Muhasebeye gönderildi (${c.alicilar.length} alıcı) · ek: ${c.ek}`, { duration: 7000 });
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
              Cevabın altlığı ve borç durumu muhasebeden geliyor. Yazıyı ekiyle birlikte gönderin.
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
