// ANA SAYFADAN "Cevabı işle" — ŞİRKETE AÇILAN TAKİP için, sayfa değişmeden.
//
// İcra kartındaki pencerenin (icra-cevap-dialog) eşi, ama alanlar BAŞKA: burada
// borçlu şirketin kendisidir, yapılan iş cevap yazmak değil itiraz etmek / ödemek /
// dosyayı avukata vermektir. O yüzden "cevap tarihi / cevap şekli" yerine
// itiraz, ödeme ve DURUM alınır.
//
// Düğmenin adı yine "Cevabı işle": iki kart yan yana duruyor ve farklı fiil görmek
// "bunlar başka başka şeyler mi" sorusunu doğuruyordu. Pencerenin başlığı ve
// alanları ne istendiğini zaten anlatıyor.
//
// DOĞRULAMA: itiraz ve ödeme tarihi tebliğ tarihinden önce olamaz (tablodakiyle aynı).
"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { updateIcraSirketTakip } from "@/lib/supabase/queries/icra-sirket";
import { DURUMLAR } from "@/components/shared/icra-sirket-tablosu";
import { icraDegisti } from "@/hooks";
import type { IcraSirketTakip, IcraSirketDurum } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
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
  const [itirazTarihi, setItirazTarihi] = useState("");
  const [itirazSekli, setItirazSekli] = useState("");
  const [evrakNo, setEvrakNo] = useState("");
  const [odenen, setOdenen] = useState("");
  const [odemeTarihi, setOdemeTarihi] = useState("");
  const [durum, setDurum] = useState<IcraSirketDurum>("yeni");
  const [aciklama, setAciklama] = useState("");
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acik || !kayit) return;
    setItirazTarihi(kayit.itiraz_tarihi ?? "");
    setItirazSekli(kayit.itiraz_sekli ?? "");
    setEvrakNo(kayit.evrak_no ?? "");
    setOdemeTarihi(kayit.odeme_tarihi ?? "");
    setDurum(kayit.durum);
    setAciklama(kayit.aciklama ?? "");
    const t = Number(kayit.odenen_tutar || 0);
    setOdenen(t ? formatParaInput(t.toFixed(2).replace(/\.00$/, "").replace(".", ",")) : "");
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

  async function kaydet() {
    if (!kayit) return;
    if (itirazTarihi && kayit.teblig_tarihi && itirazTarihi < kayit.teblig_tarihi) {
      toast.error("İtiraz tarihi, tebliğ tarihinden önce olamaz."); return;
    }
    if (odemeTarihi && kayit.teblig_tarihi && odemeTarihi < kayit.teblig_tarihi) {
      toast.error("Ödeme tarihi, tebliğ tarihinden önce olamaz."); return;
    }
    const yama: Partial<IcraSirketTakip> = {
      itiraz_tarihi: itirazTarihi || null,
      itiraz_sekli: itirazSekli.trim() || null,
      evrak_no: evrakNo.trim() || null,
      odenen_tutar: parseParaInput(odenen),
      odeme_tarihi: odemeTarihi || null,
      durum,
      aciklama: aciklama.trim() || null,
    };
    setKaydediliyor(true);
    try {
      await updateIcraSirketTakip(kayit.id, yama);
      icraDegisti();           // menü rozeti ve süre uyarısı hemen tazelensin
      kaydedildi(yama);
      toast.success("Dosya işlendi.");
      kapat();
    } catch { toast.error("Kaydedilemedi."); }
    finally { setKaydediliyor(false); }
  }

  if (!kayit) return null;
  const sonGun = sonGunHesapla(kayit.teblig_tarihi, kayit.itiraz_suresi_gun);
  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";
  const salt = "text-sm text-gray-800";

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader><DialogTitle>Cevabı İşle — Şirkete Açılan Takip</DialogTitle></DialogHeader>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1">
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Dosya</span>
            <span className={`${salt} text-right`}>{kayit.dosya_esas_no} · {kayit.icra_dairesi}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Alacaklı</span>
            <span className={`${salt} text-right`}>{formatBaslik(kayit.alacakli_adi) || "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Borçlu firma</span>
            <span className={`${salt} text-right`}>{kayit.borclu_firma ?? "—"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Tebliğ tarihi</span>
            <span className={salt}>{tarihGoster(kayit.teblig_tarihi)}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Son itiraz günü</span>
            {/* Süre belgede yazmıyorsa gün UYDURULMAZ — ekranın her yerinde aynı kural. */}
            <span className={`${salt} font-medium`}>{sonGun ? tarihGoster(sonGun) : "belgede yok"}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">Takip tutarı</span>
            <span className={`${salt} text-red-600 tabular-nums`}>{paraGoster(Number(kayit.takip_tutari || 0))}</span>
          </div>
        </div>

        <div ref={formRef} onKeyDown={formEnter}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-h-0 overflow-y-auto pr-1">
          <div>
            <label className={lbl}>Durum</label>
            <select className={inp} value={durum} onChange={(e) => setDurum(e.target.value as IcraSirketDurum)}>
              {DURUMLAR.map((d) => <option key={d.kod} value={d.kod}>{d.ad}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>İtiraz tarihi</label>
            <input type="date" className={inp} value={itirazTarihi} onChange={(e) => setItirazTarihi(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>İtiraz şekli</label>
            <input className={inp} value={itirazSekli} onChange={(e) => setItirazSekli(e.target.value)}
              placeholder="İcra dairesine dilekçe / UYAP" />
          </div>
          <div>
            <label className={lbl}>Evrak no</label>
            <input className={inp} value={evrakNo} onChange={(e) => setEvrakNo(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Ödenen tutar</label>
            <input className={`${inp} text-right`} value={odenen} inputMode="decimal"
              onChange={(e) => setOdenen(formatParaInput(e.target.value))} />
          </div>
          <div>
            <label className={lbl}>Ödeme tarihi</label>
            <input type="date" className={inp} value={odemeTarihi} onChange={(e) => setOdemeTarihi(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className={lbl}>Açıklama</label>
            <input className={inp} value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
          </div>
        </div>

          {/* DÜĞMELER ALTTA SABİT: pencere içeriği uzayınca (avukat kipinde liste,
              not kutusu, gönderim bilgisi) İptal/Kaydet aşağı kayıp görünmez
              oluyordu — kullanıcı kaydetmek için kaydırmak zorunda kalıyordu.
              Gövde kendi içinde kayıyor, alt şerit yerinde duruyor. */}
        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={kapat}>İptal</Button>
          <Button onClick={kaydet} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
