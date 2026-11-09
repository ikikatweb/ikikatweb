// ANA SAYFADAN "Cevabı işle" — SAYFA DEĞİŞMEDEN açılan cevap/ödeme penceresi.
//
// NİYE AYRI PENCERE: düğme eskiden /dashboard/icra?duzenle=…&kilit=1 adresine
// gidiyordu; ana sayfa kapanıyor, icra sayfası açılıyor ve pencere orada beliriyordu.
// Cevap girip kapatınca kullanıcı ana sayfaya elle dönmek zorunda kalıyordu. Oysa
// yapılan iş birkaç alan doldurmak: pencere geldiği yerde açılmalı.
//
// ALANLAR VE KURALLAR BURADA DEĞİL, ORTAK BİLEŞENDE (icra-cevap-alanlari):
// aynı alanlar icra sayfasındaki tam düzenleme formunda da var. İki yerde ayrı
// yazılsaydı biri değişip öbürü geride kalırdı. Burası yalnız pencereyi, dosyanın
// salt okunur özetini ve kaydetmeyi yapıyor.
"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { updateIcraKayit } from "@/lib/supabase/queries/icra";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
import { icraDegisti } from "@/hooks";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { kapanabilir, ayniMi } from "@/lib/utils/pencere-kapanis";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import IcraCevapAlanlari, {
  BOS_CEVAP, cevapKipi, cevapDogrula, eksikCevapAlanlari, eksikZorunluAlanlar, type CevapAlanlari,
} from "@/components/shared/icra-cevap-alanlari";

/** Cevap Şekli varsayılanları (Tanımlamalar boşsa). Tablodakiyle aynı liste. */
const CEVAP_VARSAYILAN = ["KEP", "İadeli Taahütlü", "Banka", "Dijital Vergi Dairesi"];

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");
const paraGoster = (n: number) => (n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");
const sayiToInput = (n: number) =>
  (n ? formatParaInput(Number(n).toFixed(2).replace(/\.00$/, "").replace(".", ",")) : "");

export default function IcraCevapDialog({ kayit, acik, kapat, kaydedildi }: {
  kayit: IcraKayit | null;
  acik: boolean;
  kapat: () => void;
  kaydedildi: (yama: Partial<IcraKayit>) => void;
}) {
  const [v, setV] = useState<CevapAlanlari>(BOS_CEVAP);
  // AÇILIŞTAKİ HALİ: kazara kapanışta "bir şey yazılmış mıydı" sorusunun cevabı.
  const [baslangic, setBaslangic] = useState<CevapAlanlari>(BOS_CEVAP);
  const [sekiller, setSekiller] = useState<string[]>(CEVAP_VARSAYILAN);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  // KAYDET DENENDİ Mİ: eksik alanlar uyarı balonuyla değil, kutuları kırmızıya
  // boyayarak söyleniyor — balondaki alan adını ekranda aramak gerekiyordu.
  const [denendi, setDenendi] = useState(false);
  const degistir = (yama: Partial<CevapAlanlari>) => setV((p) => ({ ...p, ...yama }));

  useEffect(() => {
    getDegerler("icra_cevap_sekli")
      .then((d) => { if (d.length) setSekiller(d); })
      .catch(() => { /* tanımlama okunamazsa varsayılan liste kalır */ });
  }, []);

  // Pencere her açıldığında alanlar kaydın kendi değerleriyle başlar.
  useEffect(() => {
    if (!acik || !kayit) return;
    setDenendi(false);
    const ilk: CevapAlanlari = {
      cevap_sekli: kayit.cevap_sekli ?? "",
      cevap_tarihi: kayit.cevap_tarihi ?? "",
      evrak_no: kayit.evrak_no ?? "",
      odenen_tutar: sayiToInput(Number(kayit.odenen_tutar || 0)),
      banka_adi: kayit.banka_adi ?? "",
      avukat_id: kayit.avukat_id ?? "",
      avukat_adi: kayit.avukat_adi ?? "",
      avukat_notu: kayit.avukat_notu ?? "",
    };
    setV(ilk);
    setBaslangic(ilk);
  }, [acik, kayit]);

  const kip = cevapKipi(v.cevap_sekli);
  // DEFTERDEKİ ZORUNLU ALANLAR TAM FORMLA AYNI: bu pencere onları düzenlemiyor
  // ama eksikken cevap da işlenmemeli — eksik bir satıra "cevap verildi" yazmak
  // onu tamamlanmış gibi gösterip gözden kaçırır.
  const eksikler = kayit ? eksikZorunluAlanlar(kayit as unknown as Record<string, unknown>) : [];

  async function kaydet() {
    if (!kayit) return;
    if (eksikler.length) {
      toast.error(`Dosyada eksik zorunlu alan var: ${eksikler.join(", ")}. `
        + `İcra Dosyaları sayfasından tamamlayın.`, { duration: 10000 });
      return;
    }
    // ZORUNLU KİP: bu pencerede yapılan iş zaten "cevabı işlemek" — cevap
    // şekline göre istenen alanlar yıldızlı görünüyor, kaydetme de onları arıyor.
    // EKSİKSE BALON ÇIKMAZ: kutular kırmızıya boyanır, kullanıcı nereye
    // bakacağını metinden değil ekrandan görür.
    if (eksikCevapAlanlari(v, true).length) { setDenendi(true); return; }
    setDenendi(false);
    // CEVABI GERİ ALMA: kayıtlı bir cevap vardı, şimdi bölüm boş. Sessizce
    // silinmez — dosya yeniden cevap bekleyenlere döneceği için sorulur.
    const bosBirakildi = !v.cevap_sekli.trim() && !v.cevap_tarihi && !v.evrak_no.trim() && !v.avukat_id;
    const geriAliniyor = bosBirakildi && Boolean(kayit.cevap_sekli || kayit.cevap_tarihi);
    if (geriAliniyor && typeof window !== "undefined" && !window.confirm(
      "Bu dosyadaki cevap kaydı silinecek ve dosya yeniden CEVAP BEKLEYENLER listesine girecek.\n\n"
      + "Cevap tarihi, evrak no ve ödenen tutar da silinir. Avukata gönderilmiş mailin kaydı "
      + "silinmez — mail gerçekten gitti.\n\nDevam edilsin mi?")) return;
    const sorun = cevapDogrula(v, kayit.teblig_tarihi ?? "");
    if (sorun) { toast.error(sorun); return; }

    const t = (x: string) => (x.trim() === "" ? null : x.trim());
    // AVUKAT KİPİNDE CEVAP TARİHİ YAZILMAZ: mail gidince sunucu yazar. Mail
    // gitmezse dosya cevapsız kalmalı — gitmemiş bir cevabı cevaplanmış
    // göstermek süre kaçırtan türden bir yanlış olurdu.
    const yama: Partial<IcraKayit> = {
      cevap_sekli: t(v.cevap_sekli),
      banka_adi: t(v.banka_adi),
      avukat_id: v.avukat_id || null,
      avukat_adi: t(v.avukat_adi),
      avukat_notu: t(v.avukat_notu),
      ...(kip.avukat ? {} : {
        cevap_tarihi: v.cevap_tarihi || null,
        evrak_no: t(v.evrak_no),
        odenen_tutar: parseParaInput(v.odenen_tutar),
      }),
    };

    setKaydediliyor(true);
    try {
      await updateIcraKayit(kayit.id, yama);
      // MAİL BİR KEZ GİDER: daha önce gönderilmişse tekrar gönderilmez.
      if (kip.avukat && v.avukat_id && !kayit.avukat_mail_at) {
        try {
          const c = await avukataGonder(kayit.id, v.avukat_id, v.avukat_notu);
          icraDegisti();
          kaydedildi({ ...yama, cevap_tarihi: c.cevap_tarihi, avukat_mail_ek: c.ek });
          toast.success(`${c.alici} adresine gönderildi · ek: ${c.ek}`, { duration: 7000 });
          avukatTakipNotuGoster();   // Tamam'a basılana kadar durur
          if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
          if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
          kapat();
          return;
        } catch (e) {
          // SESSİZ GEÇİLMEZ: kayıt tutuldu ama MAİL GİTMEDİ. Dosya hâlâ cevapsız;
          // kullanıcı bunu bilmezse süre işlemeye devam eder.
          kaydedildi(yama);
          toast.error(`${e instanceof Error ? e.message : "Mail gönderilemedi."}\n\n`
            + `Avukat seçimi ve not kaydedildi, ama dosya cevapsız sayılmaya devam ediyor.`,
            { duration: 12000 });
          return;
        }
      }
      icraDegisti();
      kaydedildi(yama);
      toast.success(geriAliniyor ? "Cevap geri alındı — dosya yeniden cevap bekliyor."
        : bosBirakildi ? "Değişiklik yok — cevap bölümü boş." : "Cevap işlendi.");
      kapat();
    } catch (e) {
      // SEBEBİ YUTULMAZ: "Kaydedilemedi." deyip geçmek, eksik sütun gibi tek
      // komutla çözülecek bir sorunu saatlerce gizler.
      const m = e instanceof Error ? e.message : String(e);
      toast.error(/banka_adi|avukat_/.test(m)
        ? `Eksik sütun — ilgili sql dosyası çalıştırılmalı: ${m}`
        : `Kaydedilemedi: ${m}`, { duration: 8000 });
    } finally { setKaydediliyor(false); }
  }

  if (!kayit) return null;
  const salt = "text-sm text-gray-800";

  return (
    // KAZARA KAPANMA: dışarı dokunmak ya da ESC, yazılanı sessizce siliyordu.
    <Dialog open={acik} onOpenChange={(a, d) => {
      if (a) return;
      if (!kapanabilir(d, !ayniMi(v, baslangic))) return;   // vazgeçildi → açık kalsın
      kapat();
    }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Cevabı İşle</DialogTitle></DialogHeader>

        {/* DOSYANIN KENDİSİ SALT OKUNUR: burada değiştirilecek bir şey yok, ama hangi
            dosyaya cevap girildiği görünmeden alan doldurulmamalı. */}
        <div className="shrink-0 rounded-lg border border-gray-200 bg-gray-50 px-3 py-1 text-sm divide-y divide-gray-200">
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Dosya</span>
            <span className={salt}>{kayit.dosya_esas_no ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Üçüncü şahıs</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.ucuncu_sahis) || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Borçlu</span>
            {/* BORÇLU KOYU: özetin içinde asıl aranan satır o — dosya hangi
                kişi için açılmış, bakışta ayrılsın. */}
            <span className={`${salt} text-right font-semibold`}>{formatBuyukHarf(kayit.borclu_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Alacaklı</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.alacakli_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Tebliğ tarihi</span>
            <span className={salt}>{tarihGoster(kayit.teblig_tarihi)}</span>
          </div>
          <div className="flex justify-between gap-4 py-1.5">
            <span className="shrink-0 text-gray-500">Borç</span>
            <span className={`${salt} text-red-600 tabular-nums`}>{paraGoster(Number(kayit.borc_miktari || 0))}</span>
          </div>
        </div>

        {/* EKSİK ALAN VARSA SÖYLENİR: Kaydet kapalı ama sebebini bilmeden kapalı
            bir düğme "bozuk" diye okunur. Düzeltme yeri de yazıyor. */}
        {eksikler.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            <strong>Dosya eksik:</strong> {eksikler.join(", ")}.<br />
            Cevap işlenmeden önce <a href={`/dashboard/icra?duzenle=${kayit.id}`} className="underline font-medium">İcra Dosyaları</a> sayfasından tamamlanmalı.
          </div>
        )}

        {/* GÖVDE SABİT YÜKSEKLİKTE: cevap şekli değişince sorulan alanlar değişiyor
            (avukat kipi en uzunu, KEP en kısası) ve pencere her seçimde zıplıyordu —
            İptal/Kaydet ayağının altından kayıyor, fare yanlış yere düşüyordu.
            Ölçülen en uzun kip 316px; 320 verildi, taşan içerik kendi içinde kayar.
            Kısa ekranda max-h-[90vh] devreye girip bu kutuyu daraltır. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 h-[320px] min-h-0 overflow-y-auto pr-1 content-start">
          <IcraCevapAlanlari
            deger={v} degistir={degistir} sekiller={sekiller}
            tebligTarihi={kayit.teblig_tarihi ?? ""} zorunlu icraId={kayit.id} denendi={denendi} denendiSifirla={() => setDenendi(false)}
            mailBilgisi={{
              tarih: kayit.avukat_mail_at, ek: kayit.avukat_mail_ek,
              gonderen: kayit.avukat_mail_gonderen, sayi: kayit.avukat_mail_sayisi,
            }}
            tekrarGonderildi={(c) => kaydedildi({
              avukat_mail_at: c.gonderildiAt, avukat_mail_ek: c.ek,
              avukat_mail_gonderen: c.gonderen,
              avukat_mail_sayisi: (kayit.avukat_mail_sayisi ?? 0) + 1,
            })}
          />
        </div>

          {/* DÜĞMELER ALTTA SABİT: pencere içeriği uzayınca (avukat kipinde liste,
              not kutusu, gönderim bilgisi) İptal/Kaydet aşağı kayıp görünmez
              oluyordu — kullanıcı kaydetmek için kaydırmak zorunda kalıyordu.
              Gövde kendi içinde kayıyor, alt şerit yerinde duruyor. */}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={kapat}>İptal</Button>
          {/* KAYDET KAPATILMIYOR (dosyanın kendisi eksik değilse): basılmadan
              kırmızı işaret çıkmaz, kapalı düğme de sebebini söylemez. */}
          <Button onClick={kaydet} disabled={kaydediliyor || eksikler.length > 0}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
            {kip.avukat && !kayit.avukat_mail_at ? "Kaydet ve avukata gönder" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
