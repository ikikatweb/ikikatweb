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
import { Loader2, Plus, X } from "lucide-react";
import { updateIcraKayit } from "@/lib/supabase/queries/icra";
import { getDegerler } from "@/lib/supabase/queries/tanimlamalar";
import { getAktifAvukatlar, insertAvukat } from "@/lib/supabase/queries/avukatlar";
import { telefonGoster } from "@/lib/utils/telefon";
import { icraDegisti } from "@/hooks";
import type { IcraKayit, Avukat } from "@/lib/supabase/types";
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
  const [avukatId, setAvukatId] = useState("");
  const [avukatlar, setAvukatlar] = useState<Avukat[]>([]);
  const [avukatTabloYok, setAvukatTabloYok] = useState(false);
  // PENCEREDEN AVUKAT EKLEME: cevabı işlerken avukat listede yoksa kullanıcı
  // pencereyi kapatıp Tanımlamalar'a gitmek zorunda kalıyordu — girdiği cevap
  // bilgileri de kayboluyordu. Yeni avukat burada açılıp hemen seçiliyor.
  const [yeniAvukatAcik, setYeniAvukatAcik] = useState(false);
  const [yeniAvukat, setYeniAvukat] = useState({ ad_soyad: "", email: "", telefon: "" });
  const [avukatEkleniyor, setAvukatEkleniyor] = useState(false);
  const [avukatNotu, setAvukatNotu] = useState("");
  const [sekiller, setSekiller] = useState<string[]>(CEVAP_VARSAYILAN);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Liste okunamazsa pencere yine açılır; sebebi ekranda ayrı ayrı yazar.
    getAktifAvukatlar().then(
      ({ liste, tabloYok }) => { setAvukatlar(liste); setAvukatTabloYok(tabloYok); },
      () => setAvukatlar([]));
  }, []);

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
    setAvukatId(kayit.avukat_id ?? "");
    setAvukatNotu(kayit.avukat_notu ?? "");
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
  // AVUKAT ARACILIĞI: cevabı avukat gönderdiyse kim olduğu kayda geçmeli —
  // "avukat gönderdi" tek başına bir şey anlatmıyor, sonradan kime soracağımız
  // belli olmuyor. Liste İcra > Tanımlamalar'dan yönetiliyor.
  const avukatMi = cevapSekli.toLocaleLowerCase("tr").includes("avukat");
  const secilenAvukat = avukatlar.find((a) => a.id === avukatId) ?? null;

  async function avukatEkle() {
    const ad = yeniAvukat.ad_soyad.trim();
    if (!ad) { toast.error("Ad soyad zorunlu."); return; }
    // E-POSTA KONTROL EDİLİR: yanlış yazılmış adres, "avukata gönderdim"
    // kaydının sessizce boşa çıkması demek. Boş bırakılabilir, hatalı yazılamaz.
    if (yeniAvukat.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(yeniAvukat.email.trim())) {
      toast.error("E-posta adresi geçerli değil."); return;
    }
    setAvukatEkleniyor(true);
    try {
      const a = await insertAvukat({
        ad_soyad: ad,
        email: yeniAvukat.email.trim() || null,
        telefon: yeniAvukat.telefon.trim() || null,
        aktif: true,
        sira: avukatlar.reduce((m, x) => Math.max(m, x.sira), 0) + 1,
      });
      setAvukatlar((p) => [...p, a]);
      setAvukatId(a.id);                 // eklenen avukat hemen seçili gelsin
      setYeniAvukat({ ad_soyad: "", email: "", telefon: "" });
      setYeniAvukatAcik(false);
      toast.success("Avukat eklendi ve seçildi.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Eklenemedi.";
      toast.error(/duplicate|avukatlar_ad_uq/.test(m) ? "Bu avukat zaten kayıtlı." : m, { duration: 8000 });
    } finally { setAvukatEkleniyor(false); }
  }

  /**
   * Avukat aracılığıyla cevap: dosya bilgileri + son cevap günü + not avukata
   * maillenir, ekine tebligat belgesi konur. Sunucu EK İNMEDEN MAİL GÖNDERMEZ
   * (AGENTS.md) ve cevap tarihini ancak mail gidince yazar.
   */
  async function avukatlaGonder() {
    if (!kayit) return;
    setKaydediliyor(true);
    try {
      // Not ve avukat seçimi mailden BAĞIMSIZ olarak kaydedilir: mail gitmese de
      // "kimi seçmiştik, ne yazmıştık" kaybolmasın.
      await updateIcraKayit(kayit.id, {
        cevap_sekli: cevapSekli.trim() || null,
        avukat_id: avukatId || null,
        avukat_adi: secilenAvukat?.ad_soyad ?? null,
        avukat_notu: avukatNotu.trim() || null,
      });
      const res = await fetch("/api/icra/avukata-gonder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icraId: kayit.id, avukatId, not: avukatNotu }),
      });
      const c = await res.json();
      if (!res.ok) {
        // SESSİZ GEÇİLMEZ: kayıt tutuldu ama MAİL GİTMEDİ. Dosya hâlâ cevapsız;
        // kullanıcı bunu bilmezse süre işlemeye devam eder.
        toast.error(`${c.error ?? "Mail gönderilemedi."}

Avukat seçimi ve not kaydedildi, `
          + `ama dosya cevapsız sayılmaya devam ediyor.`, { duration: 12000 });
        kaydedildi({ cevap_sekli: cevapSekli.trim() || null, avukat_id: avukatId || null,
          avukat_adi: secilenAvukat?.ad_soyad ?? null, avukat_notu: avukatNotu.trim() || null });
        return;
      }
      icraDegisti();
      kaydedildi({
        cevap_sekli: cevapSekli.trim() || null, cevap_tarihi: c.cevap_tarihi,
        avukat_id: avukatId || null, avukat_adi: secilenAvukat?.ad_soyad ?? null,
        avukat_notu: avukatNotu.trim() || null, avukat_mail_ek: c.ek,
      });
      toast.success(`${c.alici} adresine gönderildi · ek: ${c.ek}`, { duration: 7000 });
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt güncellenemedi: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
      kapat();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gönderilemedi.", { duration: 9000 });
    } finally { setKaydediliyor(false); }
  }

  async function kaydet() {
    if (!kayit) return;
    if (!cevapSekli.trim()) { toast.error("Cevap şekli seçilmeli."); return; }
    if (cevapTarihi && kayit.teblig_tarihi && cevapTarihi < kayit.teblig_tarihi) {
      toast.error("İcraya cevap tarihi, tebliğ tarihinden önce olamaz."); return;
    }
    if (avukatMi && !avukatId) { toast.error("Avukat seçilmeli."); return; }
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
    // AVUKAT KİPİ SUNUCUDA: kayıt + mail + cevap tarihi tek yerde yapılır.
    // Mail gitmezse cevap_tarihi YAZILMAZ ve dosya "Cevap Bekleyen"de kalır —
    // gitmemiş bir cevabı cevaplanmış göstermek süre kaçırtır.
    if (avukatMi) { await avukatlaGonder(); return; }

    const yama: Partial<IcraKayit> = {
      cevap_tarihi: cevapTarihi || null,
      cevap_sekli: cevapSekli.trim() || null,
      evrak_no: evrakNo.trim() || null,
      odenen_tutar: parseParaInput(odenen),
      // Banka dışı cevap şekillerinde banka adı SORULMUYOR ama SİLİNMİYOR:
      // kullanıcı yanlışlıkla şekli değiştirip geri aldığında veri kaybolmasın.
      banka_adi: bankaAdi.trim() || null,
      avukat_id: avukatId || null,
      // ANLIK KOPYA: avukat listeden silinse ya da adı değişse de "o tarihte
      // kiminle cevap verdik" sorusunun cevabı kayıtta kalsın.
      avukat_adi: secilenAvukat?.ad_soyad ?? (avukatId ? null : kayit.avukat_adi),
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
          {/* AVUKAT KİPİNDE TARİH VE EVRAK NO SORULMAZ: cevap, mailin gittiği gün
              verilmiş sayılıyor ve o tarihi sunucu yazıyor; evrak da mailin
              kendisi. İkisini ayrıca sormak, kullanıcıya aynı bilgiyi elle
              uydurtmak olurdu. */}
          {!avukatMi && (
            <>
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
            </>
          )}
          {bankaMi && (
            <div className="sm:col-span-2">
              <label className={lbl}>Hangi bankadan ödendi</label>
              <input className={inp} value={bankaAdi} onChange={(e) => setBankaAdi(e.target.value)}
                placeholder="Ödemenin yapıldığı banka" />
            </div>
          )}

          {/* AVUKAT: ad soyad LİSTEDEN seçilir, serbest metin değil — aynı kişi
              üç farklı yazımla girilirse "hangi dosyaları kim takip ediyor"
              sorusu cevaplanamaz hale gelir. İletişim bilgisi seçilince altında
              görünür; ayrıca yazılmaz, çünkü tek doğru kaynağı avukat kaydıdır. */}
          {avukatMi && (
            <div className="sm:col-span-2">
              <label className={lbl}>Avukat <span className="text-red-600">*</span></label>
              {/* TABLO YOK ile AVUKAT YOK AYRI: ikisi tek bir "avukat yok"
                  mesajına indirgenince kullanıcı eklemeye çalışıyor ve
                  anlamadığı bir hata alıyordu. Kurulum eksikse ne yapılacağı
                  doğrudan yazıyor. */}
              {avukatTabloYok ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Avukat listesi kurulmamış — <code>sql/avukatlar.sql</code> çalıştırılmalı.
                </p>
              ) : (
                <>
                  {avukatlar.length > 0 && (
                    <select className={inp} value={avukatId} onChange={(e) => setAvukatId(e.target.value)}>
                      <option value="">Seçin…</option>
                      {avukatlar.map((a) => <option key={a.id} value={a.id}>{a.ad_soyad}</option>)}
                    </select>
                  )}
                  {secilenAvukat && (
                    <div className="mt-1 text-[11px] text-gray-500">
                      {secilenAvukat.email || "e-posta yok"} · {secilenAvukat.telefon ? telefonGoster(secilenAvukat.telefon) : "telefon yok"}
                    </div>
                  )}

                  {/* BURADAN DA EKLENİR: avukat listede yoksa pencereyi kapatıp
                      Tanımlamalar'a gitmek gerekiyordu — girilen cevap bilgileri
                      de kayboluyordu. Eklenen avukat hemen seçili geliyor. */}
                  {yeniAvukatAcik ? (
                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input className={`${inp} sm:col-span-2`} autoFocus value={yeniAvukat.ad_soyad}
                          placeholder="Ad soyad (ör. Av. Ali Veli)"
                          onChange={(e) => setYeniAvukat((f) => ({ ...f, ad_soyad: e.target.value }))} />
                        <input className={inp} value={yeniAvukat.email} placeholder="E-posta" inputMode="email"
                          onChange={(e) => setYeniAvukat((f) => ({ ...f, email: e.target.value }))} />
                        <input className={inp} value={yeniAvukat.telefon} placeholder="Cep telefonu" inputMode="tel"
                          onChange={(e) => setYeniAvukat((f) => ({ ...f, telefon: e.target.value }))} />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" onClick={avukatEkle} disabled={avukatEkleniyor || !yeniAvukat.ad_soyad.trim()}
                          className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                          {avukatEkleniyor ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Kaydet ve seç
                        </button>
                        <button type="button" onClick={() => setYeniAvukatAcik(false)}
                          className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-white">
                          <X size={13} /> Vazgeç
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setYeniAvukatAcik(true)}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:underline">
                      <Plus size={13} /> {avukatlar.length === 0 ? "İlk avukatı ekle" : "Listede yok, yeni avukat ekle"}
                    </button>
                  )}

                  {/* NOT MAİLİN İÇİNE GİRER ve kayda da yazılır: "avukata ne
                      yazmışız" sonradan sorulabiliyor, yalnız mailde kalsaydı
                      panelde hiç izi olmazdı. */}
                  <label className={`${lbl} mt-3`}>Avukata not (isteğe bağlı)</label>
                  <textarea rows={3} value={avukatNotu} onChange={(e) => setAvukatNotu(e.target.value)}
                    placeholder="Mailin içine eklenecek not"
                    className="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />
                  <p className="mt-1 text-[11px] text-gray-500">
                    Kaydet denince dosya bilgileri, <strong className="text-red-600">son cevap günü</strong>,
                    bu not ve tebligat belgesi avukata mail ile gider. Belge indirilemezse mail
                    gönderilmez ve dosya cevapsız kalır.
                  </p>
                </>
              )}
            </div>
          )}
          {/* KEP'TE ÖDENEN TUTAR SORULMAZ: KEP bir yazışma kanalı, ödeme değil.
              Alan orada durunca "doldurmam mı gerekiyor" sorusu doğuyordu.
              KAYITLI TUTAR SİLİNMEZ: alan gizlenince state'teki değer olduğu gibi
              kaydediliyor. Dolu bir tutar varken gizlemek onu görünmez kılardı —
              o yüzden varsa yazıyla söyleniyor. */}
          {kepMi || avukatMi ? (
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
          <Button onClick={kaydet} disabled={kaydediliyor || !cevapSekli.trim() || (avukatMi && !avukatId)}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : null}
            {avukatMi ? "Kaydet ve avukata gönder" : "Kaydet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
