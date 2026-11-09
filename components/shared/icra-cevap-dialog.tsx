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
import { icraDegisti } from "@/hooks";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import IcraCevapAlanlari, {
  BOS_CEVAP, cevapKipi, cevapDogrula, type CevapAlanlari,
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
  const [sekiller, setSekiller] = useState<string[]>(CEVAP_VARSAYILAN);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const degistir = (yama: Partial<CevapAlanlari>) => setV((p) => ({ ...p, ...yama }));

  useEffect(() => {
    getDegerler("icra_cevap_sekli")
      .then((d) => { if (d.length) setSekiller(d); })
      .catch(() => { /* tanımlama okunamazsa varsayılan liste kalır */ });
  }, []);

  // Pencere her açıldığında alanlar kaydın kendi değerleriyle başlar.
  useEffect(() => {
    if (!acik || !kayit) return;
    setV({
      cevap_sekli: kayit.cevap_sekli ?? "",
      cevap_tarihi: kayit.cevap_tarihi ?? "",
      evrak_no: kayit.evrak_no ?? "",
      odenen_tutar: sayiToInput(Number(kayit.odenen_tutar || 0)),
      banka_adi: kayit.banka_adi ?? "",
      avukat_id: kayit.avukat_id ?? "",
      avukat_notu: kayit.avukat_notu ?? "",
    });
  }, [acik, kayit]);

  const kip = cevapKipi(v.cevap_sekli);

  async function kaydet() {
    if (!kayit) return;
    if (!v.cevap_sekli.trim()) { toast.error("Cevap şekli seçilmeli."); return; }
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
      toast.success("Cevap işlendi.");
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
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Cevabı İşle</DialogTitle></DialogHeader>

        {/* DOSYANIN KENDİSİ SALT OKUNUR: burada değiştirilecek bir şey yok, ama hangi
            dosyaya cevap girildiği görünmeden alan doldurulmamalı. */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Dosya</span>
            <span className={salt}>{kayit.dosya_esas_no ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Üçüncü şahıs</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.ucuncu_sahis) || "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Borçlu</span>
            <span className={`${salt} text-right`}>{formatBuyukHarf(kayit.borclu_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Alacaklı</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.alacakli_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Tebliğ tarihi</span>
            <span className={salt}>{tarihGoster(kayit.teblig_tarihi)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Borç</span>
            <span className={`${salt} text-red-600 tabular-nums`}>{paraGoster(Number(kayit.borc_miktari || 0))}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
          <IcraCevapAlanlari
            deger={v} degistir={degistir} sekiller={sekiller}
            tebligTarihi={kayit.teblig_tarihi ?? ""} zorunlu icraId={kayit.id}
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
          <Button onClick={kaydet} disabled={kaydediliyor || !v.cevap_sekli.trim() || (kip.avukat && !v.avukat_id)}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
            {kip.avukat && !kayit.avukat_mail_at ? "Kaydet ve avukata gönder" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
