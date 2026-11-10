// ANA SAYFADAN "Cevabı işle" — ŞİRKETE AÇILAN TAKİP için, sayfa değişmeden.
//
// İcra kartındaki pencerenin (icra-cevap-dialog) eşi: burada borçlu şirketin
// kendisidir, yapılan iş dosyayı avukata vermek / ödemek / kapatmaktır.
//
// CEVAP ŞEKLİNE GÖRE SORULAN ŞEY DEĞİŞİR — icra penceresindeki düzenin aynısı:
//   (Seçin…)  → hiçbir şey. Dosya ele alınmamış sayılır (durum="yeni").
//   Avukatta  → avukat · not          (Kaydet denince avukata mail gider)
//   Ödendi    → ödeme tarihi · tutar · hangi banka
//   Kapandı   → açıklama
//
// İTİRAZ ALANLARI KALDIRILDI (09.11.2026): "İtiraz edildi" bir cevap şekli
// olmaktan çıkınca itiraz tarihi/şekli ve evrak no'nun sorulacağı bir yer
// kalmadı. Kayıttaki değerler SİLİNMİYOR, yalnız bu pencerede sorulmuyor —
// zaten yedi kaydın hiçbirinde dolu değildi.
//
// DOĞRULAMA: ödeme tarihi tebliğ tarihinden önce olamaz.
"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { updateIcraSirketTakip } from "@/lib/supabase/queries/icra-sirket";
import { DURUMLAR, durumSecenekleri } from "@/components/shared/icra-sirket-tablosu";
import AvukatSecim from "@/components/shared/avukat-secim";
import { MuhasebeBandi } from "@/components/shared/muhasebe-cevap-dialog";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
import { icraDegisti } from "@/hooks";
import type { IcraSirketTakip, IcraSirketDurum } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { kapanabilir, ayniMi } from "@/lib/utils/pencere-kapanis";
import { formatBaslik } from "@/lib/utils/isim";
import { sonGunHesapla } from "@/lib/utils/icra-sure";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");
const paraGoster = (n: number) => (n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

export default function OdemeEmriIslemDialog({ kayit, acik, kapat, kaydedildi }: {
  kayit: IcraSirketTakip | null;
  acik: boolean;
  kapat: () => void;
  kaydedildi: (yama: Partial<IcraSirketTakip>) => void;
}) {
  const [odenen, setOdenen] = useState("");
  const [odemeTarihi, setOdemeTarihi] = useState("");
  const [bankaAdi, setBankaAdi] = useState("");
  const [avukatId, setAvukatId] = useState("");
  const [avukatAdi, setAvukatAdi] = useState("");
  const [avukatNotu, setAvukatNotu] = useState("");
  const [durum, setDurum] = useState<IcraSirketDurum>("yeni");
  const [aciklama, setAciklama] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  // KAYDET DENENDİ Mİ: eksik alanlar uyarı balonuyla değil, kutuları kırmızıya
  // boyayarak söyleniyor — icra penceresiyle aynı.
  const [denendi, setDenendi] = useState(false);
  // AÇILIŞTAKİ HALİ: kazara kapanışta "bir şey yazılmış mıydı" sorusunun cevabı.
  const [baslangic, setBaslangic] = useState("");
  const formRef = useRef<HTMLDivElement>(null);
  const simdiki = JSON.stringify([odenen, odemeTarihi, bankaAdi, avukatId, avukatNotu, durum, aciklama]);

  useEffect(() => {
    if (!acik || !kayit) return;
    const t = Number(kayit.odenen_tutar || 0);
    const tutar = t ? formatParaInput(t.toFixed(2).replace(/\.00$/, "").replace(".", ",")) : "";
    setOdenen(tutar);
    setOdemeTarihi(kayit.odeme_tarihi ?? "");
    setBankaAdi(kayit.banka_adi ?? "");
    setAvukatId(kayit.avukat_id ?? "");
    setAvukatAdi(kayit.avukat_adi ?? "");
    setAvukatNotu(kayit.avukat_notu ?? "");
    // MUHASEBENİN BELİRLEDİĞİ ŞEKİLLE AÇILIR: dosya ele alınmamışsa (durum
    // "yeni") ve muhasebe bir şekil bildirmişse o seçili gelir. Kayıtlı bir
    // durum varsa dokunulmaz — verilmiş cevabı değiştirmek olurdu.
    const ilkDurum = kayit.durum === "yeni" && kayit.muhasebe_cevap_sekli
      ? (kayit.muhasebe_cevap_sekli as IcraSirketDurum) : kayit.durum;
    setDurum(ilkDurum);
    setAciklama(kayit.aciklama ?? "");
    setDenendi(false);
    setBaslangic(JSON.stringify([tutar, kayit.odeme_tarihi ?? "", kayit.banka_adi ?? "",
      kayit.avukat_id ?? "", kayit.avukat_notu ?? "", ilkDurum, kayit.aciklama ?? ""]));
  }, [acik, kayit]);

  function formEnter(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
    e.preventDefault();
    const odak = Array.from(formRef.current?.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled])") ?? []);
    const i = odak.indexOf(el);
    if (i >= 0 && i + 1 < odak.length) odak[i + 1].focus();
  }

  /** Cevap şekli değişince o kipe ait OLMAYAN alanlar boşalır. */
  function sekilDegistir(k: IcraSirketDurum) {
    setDenendi(false);
    setDurum(k);
    // "Seçin…"E DÖNÜLÜNCE HEPSİ BOŞALIR: kaydedilince cevap geri alınmış olur.
    // Avukata gönderilmiş mailin KAYDI SİLİNMEZ (avukat_mail_*) — mail gerçekten
    // gitti, o iz kalmalı. Nota da dokunulmaz: mail günlüğünde kopyası yok.
    if (k === "yeni") { setOdenen(""); setOdemeTarihi(""); setBankaAdi(""); setAvukatId(""); setAvukatAdi(""); return; }
    if (k !== "odendi") { setOdenen(""); setOdemeTarihi(""); setBankaAdi(""); }
    if (k !== "avukatta") { setAvukatId(""); setAvukatAdi(""); }
  }

  /** Kipe göre boş kalan zorunlu alanlar. Boş dizi = tam. */
  function eksikler(): string[] {
    if (durum === "odendi") {
      return [!odemeTarihi && "odeme_tarihi", !(parseParaInput(odenen) > 0) && "odenen_tutar",
        !bankaAdi.trim() && "banka_adi"].filter(Boolean) as string[];
    }
    if (durum === "avukatta") return avukatId ? [] : ["avukat_id"];
    return [];
  }
  const hata = (alan: string) =>
    (denendi && eksikler().includes(alan) ? " border-red-500 ring-1 ring-red-300" : "");

  // MAİL GİDECEK Mİ? İcra penceresiyle aynı ölçü: aynı avukat + mail gitmiş +
  // dosya hâlâ avukatta. Biri bile eksikse bu YENİ bir gönderimdir.
  const avukatCevabiDuruyor = Boolean(kayit?.avukat_id) && kayit?.avukat_id === avukatId
    && Boolean(kayit?.avukat_mail_at) && kayit?.durum === "avukatta";
  const gonderilecek = durum === "avukatta" && Boolean(avukatId) && !avukatCevabiDuruyor;

  async function kaydet() {
    if (!kayit) return;
    // EKSİKSE BALON ÇIKMAZ: kutular kırmızıya boyanır.
    if (eksikler().length) { setDenendi(true); return; }
    setDenendi(false);
    if (odemeTarihi && kayit.teblig_tarihi && odemeTarihi < kayit.teblig_tarihi) {
      toast.error("Ödeme tarihi, tebliğ tarihinden önce olamaz."); return;
    }
    // CEVABI GERİ ALMA: işlenmiş bir takip "Seçin…"e çekilmiş. Sessizce
    // silinmez — dosya yeniden ele alınmamışlara döneceği için sorulur.
    const geriAliniyor = durum === "yeni" && kayit.durum !== "yeni";
    if (geriAliniyor && typeof window !== "undefined" && !window.confirm(
      "Bu takipteki cevap kaydı silinecek ve dosya yeniden ELE ALINMAMIŞ sayılacak.\n\n"
      + "Ödeme bilgileri ve avukat seçimi silinir. Avukata gönderilmiş mailin kaydı "
      + "silinmez — mail gerçekten gitti.\n\nDevam edilsin mi?")) return;

    const yama: Partial<IcraSirketTakip> = {
      odenen_tutar: parseParaInput(odenen),
      odeme_tarihi: odemeTarihi || null,
      banka_adi: bankaAdi.trim() || null,
      avukat_id: avukatId || null,
      avukat_adi: avukatAdi.trim() || null,
      avukat_notu: avukatNotu.trim() || null,
      durum,
      aciklama: aciklama.trim() || null,
    };
    setKaydediliyor(true);
    try {
      await updateIcraSirketTakip(kayit.id, yama);
      if (gonderilecek) {
        try {
          const c = await avukataGonder(kayit.id, avukatId, avukatNotu, "sirket");
          icraDegisti();
          kaydedildi({ ...yama, avukat_mail_ek: c.ek, avukat_mail_at: c.gonderildiAt });
          toast.success(`${c.alici} adresine gönderildi · ek: ${c.ek}`, { duration: 7000 });
          if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
          if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
          avukatTakipNotuGoster();
          kapat();
          return;
        } catch (e) {
          // SESSİZ GEÇİLMEZ: kayıt tutuldu ama MAİL GİTMEDİ.
          kaydedildi(yama);
          toast.error(`${e instanceof Error ? e.message : "Mail gönderilemedi."}\n\n`
            + `Avukat seçimi ve not kaydedildi, ama dosya avukata ULAŞMADI.`, { duration: 12000 });
          return;
        }
      }
      icraDegisti();           // menü rozeti ve süre uyarısı hemen tazelensin
      kaydedildi(yama);
      toast.success(geriAliniyor ? "Cevap geri alındı — takip yeniden ele alınmamış."
        : durum === "yeni" ? "Değişiklik yok — cevap bölümü boş." : "Dosya işlendi.");
      kapat();
    } catch (e) {
      // SEBEBİ YUTULMAZ: eksik sütun gibi tek komutla çözülecek bir sorunu gizlemesin.
      const m = e instanceof Error ? e.message : String(e);
      toast.error(/banka_adi|avukat_/.test(m)
        ? `Eksik sütun — sql/icra_sirket_avukat_banka.sql çalıştırılmalı: ${m}`
        : `Kaydedilemedi: ${m}`, { duration: 10000 });
    } finally { setKaydediliyor(false); }
  }

  if (!kayit) return null;
  const sonGun = sonGunHesapla(kayit.teblig_tarihi, kayit.itiraz_suresi_gun);
  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";
  const salt = "text-sm text-gray-800";
  const yildiz = <span className="text-red-600">*</span>;

  return (
    // KAZARA KAPANMA: dışarı dokunmak ya da ESC, yazılanı sessizce siliyordu.
    <Dialog open={acik} onOpenChange={(a, d) => {
      if (a) return;
      if (!kapanabilir(d, !ayniMi(simdiki, baslangic))) return;   // vazgeçildi → açık kalsın
      kapat();
    }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Cevabı İşle — Şirkete Açılan Takip</DialogTitle></DialogHeader>

        <div className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1 text-sm divide-y divide-gray-200">
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Dosya</span>
            <span className={`${salt} text-right`}>{kayit.dosya_esas_no} · {kayit.icra_dairesi}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Alacaklı</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.alacakli_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Borçlu firma</span>
            {/* BORÇLU KOYU — icra penceresiyle aynı. */}
            <span className={`${salt} text-right font-semibold`}>{kayit.borclu_firma ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Tebliğ tarihi</span>
            <span className={salt}>{tarihGoster(kayit.teblig_tarihi)}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Son itiraz günü</span>
            {/* Süre belgede yazmıyorsa gün UYDURULMAZ — ekranın her yerinde aynı kural. */}
            <span className={`${salt} font-medium`}>{sonGun ? tarihGoster(sonGun) : "belgede yok"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Takip tutarı</span>
            <span className={`${salt} text-red-600 tabular-nums`}>{paraGoster(Number(kayit.takip_tutari || 0))}</span>
          </div>
        </div>

        <div ref={formRef} onKeyDown={formEnter}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 h-[320px] min-h-0 overflow-y-auto pr-1 content-start">
          {/* CEVAP ŞEKLİ İLK VE TEK SATIR — icra penceresiyle aynı düzen: sorulan
              alanlar buna bağlı, insan önce bunu görmeli. "Seçin…" ele
              alınmamış demektir (durum="yeni"); işlenmiş bir takip buraya
              çekilerek geri alınabilir. */}
          {/* MUHASEBENİN BİLDİRDİĞİ, CEVAP ŞEKLİNİN ÜSTÜNDE: ödeme emrinde
              "borç ödenmiş mi, itiraz mı edilecek" cevabını muhasebe veriyor;
              cevap şekli ona bakılarak seçiliyor. */}
          <div className="sm:col-span-2"><MuhasebeBandi kayit={kayit} sirket /></div>
          <div className="sm:col-span-2">
            <label className={lbl}>Cevap şekli</label>
            <select className={inp} value={durum} onChange={(e) => sekilDegistir(e.target.value as IcraSirketDurum)}>
              <option value="yeni">Seçin…</option>
              {durumSecenekleri(durum).map((k) => (
                <option key={k} value={k}>{DURUMLAR.find((d) => d.kod === k)?.ad ?? k}</option>
              ))}
            </select>
          </div>

          {/* SEÇİM YAPILMADAN ALT ALANLAR GÖRÜNMEZ: hangi alanın sorulacağı
              cevap şekline bağlı; önce doldurulup sonra şekil seçilince yazılan
              şey boşa gidiyordu. */}
          {durum === "avukatta" && (
            <div className="sm:col-span-2">
              <AvukatSecim
                avukatId={avukatId} not_={avukatNotu} kaynak="sirket" kayitId={kayit.id}
                hatali={denendi && !avukatId}
                degistir={(y) => {
                  if (y.avukat_id !== undefined) setAvukatId(y.avukat_id);
                  if (y.avukat_adi !== undefined) setAvukatAdi(y.avukat_adi);
                  if (y.avukat_notu !== undefined) setAvukatNotu(y.avukat_notu);
                }}
                mailBilgisi={{
                  tarih: kayit.avukat_mail_at, ek: kayit.avukat_mail_ek,
                  gonderen: kayit.avukat_mail_gonderen, sayi: kayit.avukat_mail_sayisi,
                  gecerli: avukatCevabiDuruyor,
                }}
                tekrarGonderildi={(c) => kaydedildi({
                  avukat_mail_at: c.gonderildiAt, avukat_mail_ek: c.ek,
                  avukat_mail_gonderen: c.gonderen,
                  avukat_mail_sayisi: (kayit.avukat_mail_sayisi ?? 0) + 1,
                })}
              />
            </div>
          )}

          {durum === "odendi" && (
            <>
              <div>
                <label className={lbl}>Ödeme tarihi {yildiz}</label>
                <input type="date" className={`${inp}${hata("odeme_tarihi")}`} value={odemeTarihi}
                  min={kayit.teblig_tarihi || undefined}
                  onChange={(e) => setOdemeTarihi(e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Ödenen tutar {yildiz}</label>
                <input className={`${inp} text-right${hata("odenen_tutar")}`} value={odenen} inputMode="decimal"
                  placeholder="0" onChange={(e) => setOdenen(formatParaInput(e.target.value))} />
              </div>
              <div className="sm:col-span-2">
                <label className={lbl}>Hangi bankadan ödendi {yildiz}</label>
                <input className={`${inp}${hata("banka_adi")}`} value={bankaAdi}
                  placeholder="Ödemenin yapıldığı banka" onChange={(e) => setBankaAdi(e.target.value)} />
              </div>
            </>
          )}

          {durum !== "yeni" && (
            <div className="sm:col-span-2">
              <label className={lbl}>Açıklama</label>
              <input className={inp} value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
            </div>
          )}
        </div>

          {/* DÜĞMELER ALTTA SABİT: pencere içeriği uzayınca (avukat kipinde liste,
              not kutusu, gönderim bilgisi) İptal/Kaydet aşağı kayıp görünmez
              oluyordu — kullanıcı kaydetmek için kaydırmak zorunda kalıyordu.
              Gövde kendi içinde kayıyor, alt şerit yerinde duruyor. */}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={kapat}>İptal</Button>
          <Button onClick={kaydet} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
            {gonderilecek ? "Kaydet ve avukata gönder" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
