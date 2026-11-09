// ANA SAYFADAN "Cevabı işle" — SAYFA DEĞİŞMEDEN açılan cevap/ödeme penceresi.
//
// NİYE AYRI PENCERE: düğme eskiden /dashboard/icra?duzenle=…&kilit=1 adresine
// gidiyordu; ana sayfa kapanıyor, icra sayfası açılıyor ve pencere orada beliriyordu.
// Cevap girip kapatınca kullanıcı ana sayfaya elle dönmek zorunda kalıyordu. Oysa
// yapılan iş dört alan doldurmak: pencere geldiği yerde açılmalı.
//
// İCRA TABLOSUNDAKİ BÜYÜK FORMUN KOPYASI DEĞİL: orası dosyanın TAMAMINI düzenler
// (üçüncü şahıs, alacaklı, borçlu, tutar…). Burası yalnız CEVAP/ÖDEME alanlarını
// alır; dosyanın geri kalanı salt okunur gösterilir — kilitli modun yaptığı işin
// aynısı, ama kendi başına ayakta duran küçük bir pencere olarak.
//
// DOĞRULAMA KURALLARI TABLOYLA AYNI TUTULUR:
//   · cevap tarihi, tebliğ tarihinden önce olamaz
//   · cevap tarihi girildiyse evrak no ZORUNLU (hangi evrakla cevap verildiği
//     yazılmazsa kayıt "cevap verildi" der ama ispatı olmaz)
"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";
import { updateIcraKayit } from "@/lib/supabase/queries/icra";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { icraDegisti } from "@/hooks";
import type { IcraKayit } from "@/lib/supabase/types";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Cevap Şekli varsayılanları (Tanımlamalar boşsa). Tablodakiyle aynı liste. */
const CEVAP_VARSAYILAN = ["KEP", "İadeli Taahütlü", "Banka", "Dijital Vergi Dairesi"];

const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");
const paraGoster = (n: number) => (n ? n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

export default function IcraCevapDialog({ kayit, acik, kapat, kaydedildi }: {
  kayit: IcraKayit | null;
  acik: boolean;
  kapat: () => void;
  kaydedildi: (yama: Partial<IcraKayit>) => void;
}) {
  const [cevapTarihi, setCevapTarihi] = useState("");
  const [cevapSekli, setCevapSekli] = useState("");
  const [evrakNo, setEvrakNo] = useState("");
  const [odenen, setOdenen] = useState("");
  const [bankaAdi, setBankaAdi] = useState("");
  const [sekiller, setSekiller] = useState<string[]>(CEVAP_VARSAYILAN);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getDegerler("icra_cevap_sekli")
      .then((d) => { if (d.length) setSekiller(d); })
      .catch(() => { /* tanımlama okunamazsa varsayılan liste kalır */ });
  }, []);

  // Pencere her açıldığında alanlar kaydın kendi değerleriyle başlar.
  useEffect(() => {
    if (!acik || !kayit) return;
    setCevapTarihi(kayit.cevap_tarihi ?? "");
    setCevapSekli(kayit.cevap_sekli ?? "");
    setEvrakNo(kayit.evrak_no ?? "");
    setBankaAdi(kayit.banka_adi ?? "");
    const t = Number(kayit.odenen_tutar || 0);
    setOdenen(t ? formatParaInput(t.toFixed(2).replace(/\.00$/, "").replace(".", ",")) : "");
  }, [acik, kayit]);

  // Enter → sonraki alan (submit etmez).
  function formEnter(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    const el = e.target as HTMLElement;
    if (el.tagName !== "INPUT" && el.tagName !== "SELECT") return;
    e.preventDefault();
    const odak = Array.from(formRef.current?.querySelectorAll<HTMLElement>("input:not([disabled]), select:not([disabled])") ?? []);
    const i = odak.indexOf(el);
    if (i >= 0 && i + 1 < odak.length) odak[i + 1].focus();
  }

  // KEP ile cevap verildiyse ödeme yoktur — tutar alanı sorulmaz (aşağıya bak).
  // Değer Tanımlamalar'dan geldiği için metin karşılaştırılıyor; Türkçe büyük harf
  // kuralıyla ("i" → "İ") çünkü liste elle düzenlenebiliyor.
  const kepMi = cevapSekli.trim().toLocaleUpperCase("tr") === "KEP";
  // BANKA HAVALESİ: cevap bir yazı değil, ödemedir. Sorulan şeyler başka —
  // dekont tarihi/numarası, tutar ve ÖDEMENİN YAPILDIĞI BANKA. "İcraya cevap
  // tarihi" diye sorulan alan burada dekontun tarihidir; aynı sütuna yazılır
  // (cevap_tarihi), çünkü dosyayı "cevaplandı" yapan şey odur — ayrı bir sütuna
  // yazılsaydı dosya "Cevap Bekleyen" listesinde sonsuza kadar kalırdı.
  // "banka" geçen her seçeneği yakalar: liste Tanımlamalar'dan düzenlenebiliyor
  // ("Banka", "Banka Havalesi", "Banka EFT" hepsi aynı kip).
  const bankaMi = cevapSekli.toLocaleLowerCase("tr").includes("banka");

  async function kaydet() {
    if (!kayit) return;
    if (!cevapSekli.trim()) { toast.error("Cevap şekli seçilmeli."); return; }
    if (cevapTarihi && kayit.teblig_tarihi && cevapTarihi < kayit.teblig_tarihi) {
      toast.error("İcraya cevap tarihi, tebliğ tarihinden önce olamaz."); return;
    }
    if (bankaMi) {
      // ÜÇÜ BİRLİKTE: biri girildiyse diğer ikisi de gerekli. Tarih olmadan dosya
      // "cevaplandı" sayılmaz ve listede kalır; kullanıcı niye kalktığını anlamaz.
      const dolu = [cevapTarihi, evrakNo.trim(), parseParaInput(odenen) > 0 ? "x" : ""].filter(Boolean).length;
      if (dolu > 0 && dolu < 3) {
        toast.error("Banka havalesinde dekont tarihi, dekont no ve ödenen tutar birlikte girilir."); return;
      }
    } else if (cevapTarihi && !evrakNo.trim()) {
      toast.error("Cevap tarihi girildi — evrak no zorunludur."); return;
    }
    const yama: Partial<IcraKayit> = {
      cevap_tarihi: cevapTarihi || null,
      cevap_sekli: cevapSekli.trim() || null,
      evrak_no: evrakNo.trim() || null,
      odenen_tutar: parseParaInput(odenen),
      // Banka dışı cevap şekillerinde banka adı SORULMUYOR ama SİLİNMİYOR:
      // kullanıcı yanlışlıkla şekli değiştirip geri aldığında veri kaybolmasın.
      banka_adi: bankaAdi.trim() || null,
    };
    setKaydediliyor(true);
    try {
      await updateIcraKayit(kayit.id, yama);
      icraDegisti();           // menü rozeti ve süre uyarısı hemen tazelensin
      kaydedildi(yama);
      toast.success("Cevap işlendi.");
      kapat();
    } catch (e) {
      // SEBEBİ YUTULMAZ: "Kaydedilemedi." deyip geçmek, eksik sütun gibi tek
      // komutla çözülecek bir sorunu saatlerce gizler. sql/icra_banka_adi.sql
      // çalıştırılmadıysa mesaj bunu doğrudan söyler.
      const m = e instanceof Error ? e.message : String(e);
      toast.error(/banka_adi/.test(m)
        ? "banka_adi sütunu yok — sql/icra_banka_adi.sql çalıştırılmalı."
        : `Kaydedilemedi: ${m}`, { duration: 8000 });
    }
    finally { setKaydediliyor(false); }
  }

  if (!kayit) return null;
  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = "w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30";
  const salt = "text-sm text-gray-800";

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      <DialogContent className="max-w-lg">
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

        <div ref={formRef} onKeyDown={formEnter} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* CEVAP ŞEKLİ İLK SIRADA: iş sırası böyle — önce "nasıl cevap verdim"
              (KEP / iadeli taahütlü / banka), sonra o gönderinin tarihi ve evrak
              numarası. Tarih başta dururken insan önce onu dolduruyor, cevap şeklini
              en sonda görüp boş bırakıyordu. Enter ile geçiş de bu sırayı izler. */}
          {/* TEK SATIR VE ZORUNLU: formun geri kalanı buna bağlı (KEP seçilince
              ödenen tutar hiç sorulmuyor), o yüzden önce ve tek başına duruyor.
              Zorunlu, çünkü "cevap verildi" kaydının hangi kanaldan verildiği
              yazılmazsa kayıt ispat değeri taşımıyor. */}
          <div className="sm:col-span-2">
            <label className={lbl}>Cevap şekli <span className="text-red-600">*</span></label>
            <select className={inp} value={cevapSekli} onChange={(e) => setCevapSekli(e.target.value)} autoFocus>
              <option value="">Seçin…</option>
              {sekiller.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          {/* BANKA HAVALESİNDE ETİKETLER DEĞİŞİR, SÜTUN DEĞİŞMEZ.
              "İcraya cevap tarihi" → "Dekont tarihi", "Evrak no" → "Dekont no".
              İkisi de aynı sütuna yazılıyor (cevap_tarihi / evrak_no): dosyayı
              "cevaplandı" yapan alan cevap_tarihi, ayrı bir yere yazılsaydı dosya
              Cevap Bekleyen listesinde kalırdı. Sorulan soru değişti, kaydın anlamı
              değil — ödeme de icraya verilmiş bir cevaptır. */}
          <div>
            <label className={lbl}>{bankaMi ? "Dekont tarihi" : "İcraya cevap tarihi"}</label>
            <input type="date" className={inp} value={cevapTarihi} onChange={(e) => setCevapTarihi(e.target.value)} />
          </div>
          <div>
            <label className={lbl}>
              {bankaMi ? "Dekont no" : "Evrak no"} {cevapTarihi && <span className="text-red-600">*</span>}
            </label>
            <input className={inp} value={evrakNo} onChange={(e) => setEvrakNo(e.target.value)}
              placeholder={bankaMi ? "Dekont numarası" : "Gönderilen evrak no"} />
          </div>
          {bankaMi && (
            <div className="sm:col-span-2">
              <label className={lbl}>Hangi bankadan ödendi</label>
              <input className={inp} value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)}
                placeholder="Ödemenin yapıldığı banka" />
            </div>
          )}
          {/* KEP'TE ÖDENEN TUTAR SORULMAZ: KEP bir yazışma kanalı, ödeme değil.
              Alan orada durunca "doldurmam mı gerekiyor" sorusu doğuyordu.
              KAYITLI TUTAR SİLİNMEZ: alan gizlenince state'teki değer olduğu gibi
              kaydediliyor. Dolu bir tutar varken gizlemek onu görünmez kılardı —
              o yüzden varsa yazıyla söyleniyor. */}
          {kepMi ? (
            parseParaInput(odenen) > 0 ? (
              <div className="self-end text-[11px] text-gray-500">
                Kayıtlı ödenen tutar {odenen} — KEP seçiliyken sorulmuyor, silinmiyor.
              </div>
            ) : null
          ) : (
            <div>
              <label className={lbl}>
                Ödenen tutar {bankaMi && cevapTarihi && <span className="text-red-600">*</span>}
              </label>
              <input className={`${inp} text-right`} value={odenen} inputMode="decimal"
                onChange={(e) => setOdenen(formatParaInput(e.target.value))} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={kapat}>İptal</Button>
          <Button onClick={kaydet} disabled={kaydediliyor || !cevapSekli.trim()}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null} Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
