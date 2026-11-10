// AVUKAT SEÇİMİ, NOTU VE GÖNDERİM İZİ — İKİ DEFTER İÇİN TEK YER.
//
// NİYE ORTAK: aynı iş iki defterde var — üçüncü şahıs haciz dosyası (icra) ve
// şirkete açılan takip (ödeme emri). İkisinde de avukat LİSTEDEN seçiliyor, not
// mailin içine giriyor, mail bir kez gidiyor ve "tekrar gönder" ayrı bir karar.
// İki yerde ayrı yazılsaydı biri düzelir öbürü geride kalırdı.
//
// AD SERBEST METİN DEĞİL: aynı kişi üç farklı yazımla girilirse "hangi dosyaları
// kim takip ediyor" sorusu cevaplanamaz olur.
"use client";

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus, X, Loader2, Send, Paperclip } from "lucide-react";
import { getAktifAvukatlar, insertAvukat } from "@/lib/supabase/queries/avukatlar";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { telefonGoster } from "@/lib/utils/telefon";
import { uploadDosyaImzali } from "@/lib/supabase/queries/upload";
import { dosyaUrl } from "@/lib/utils/dosya-url";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
import type { Avukat } from "@/lib/supabase/types";

export type AvukatMailBilgisi = {
  tarih: string | null; ek: string | null; gonderen?: string | null; sayi?: number;
  /** Gönderim HÂLÂ bu kaydın cevabı mı? Değilse "Kaydet yeniden gönderir". */
  gecerli?: boolean;
};

export type AvukatEk = { ad: string; yol: string };

export default function AvukatSecim({
  avukatId, not_, degistir, kilitli = false, mailBilgisi, kayitId,
  kaynak = "icra", tekrarGonderildi, hatali = false, ekler = [], muhasebeEkleri = [],
}: {
  avukatId: string;
  not_: string;
  degistir: (y: { avukat_id?: string; avukat_adi?: string; avukat_notu?: string; avukat_ekler?: AvukatEk[] }) => void;
  kilitli?: boolean;
  mailBilgisi?: AvukatMailBilgisi;
  /** Kayıt id'si — "Tekrar gönder" için gerekli. Yeni (kaydedilmemiş) kayıtta boş. */
  kayitId?: string | null;
  kaynak?: "icra" | "sirket";
  tekrarGonderildi?: (c: { ek: string; gonderen: string; gonderildiAt: string }) => void;
  /** Kaydet denendi ama avukat seçilmemişti — kutu kırmızıya boyanır. */
  hatali?: boolean;
  /** Maile EK olarak gidecek dosyalar. Tebligat yazısı bu listede DEĞİL — o her mailde gider. */
  ekler?: AvukatEk[];
  /** Muhasebenin cevap mailiyle gelen dosyalar (hesap ekstresi) — tek tıkla eklenebilsin. */
  muhasebeEkleri?: AvukatEk[];
}) {
  const sirket = kaynak === "sirket";
  const [avukatlar, setAvukatlar] = useState<Avukat[]>([]);
  const [tabloYok, setTabloYok] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [yeni, setYeni] = useState({ ad_soyad: "", email: "", telefon: "" });
  const [ekleniyor, setEkleniyor] = useState(false);
  const [tekrarGidiyor, setTekrarGidiyor] = useState(false);
  const [yukleniyor, setYukleniyor] = useState(false);
  const dosyaRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getAktifAvukatlar().then(
      ({ liste, tabloYok }) => { setAvukatlar(liste); setTabloYok(tabloYok); },
      () => setAvukatlar([]));
  }, []);

  const secilen = avukatlar.find((a) => a.id === avukatId) ?? null;

  // ESKİ KAYITTA AD BOŞ KALMIŞ OLABİLİR (sütun sonradan eklendi): liste gelince
  // id'den çözülüp doldurulur, böylece bir dahaki kaydetmede kopya da yazılır.
  useEffect(() => {
    if (secilen) degistir({ avukat_adi: secilen.ad_soyad });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secilen?.id]);

  async function avukatEkle() {
    const ad = yeni.ad_soyad.trim();
    if (!ad) { toast.error("Ad soyad zorunlu."); return; }
    // E-POSTA KONTROL EDİLİR: yanlış adres, "avukata gönderdim" kaydının sessizce
    // boşa çıkması demek.
    if (yeni.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(yeni.email.trim())) {
      toast.error("E-posta adresi geçerli değil."); return;
    }
    setEkleniyor(true);
    try {
      const a = await insertAvukat({
        ad_soyad: ad, email: yeni.email.trim() || null, telefon: yeni.telefon.trim() || null,
        aktif: true, sira: avukatlar.reduce((m, x) => Math.max(m, x.sira), 0) + 1,
      });
      setAvukatlar((p) => [...p, a]);
      degistir({ avukat_id: a.id, avukat_adi: a.ad_soyad });   // eklenen hemen seçili gelsin
      setYeni({ ad_soyad: "", email: "", telefon: "" });
      setYeniAcik(false);
      toast.success("Avukat eklendi ve seçildi.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Eklenemedi.";
      toast.error(/duplicate|avukatlar_ad_uq/.test(m) ? "Bu avukat zaten kayıtlı." : m, { duration: 8000 });
    } finally { setEkleniyor(false); }
  }

  /**
   * TEKRAR GÖNDER — mail bir kez gider (Kaydet yeniden göndermez), ama bazen
   * gerekiyor: avukat maili bulamıyor, adres değişmiş, hatırlatma isteniyor.
   * Düğmeyle AÇIKÇA istenince gönderilir; her kaydetmede kendiliğinden değil.
   */
  async function tekrarGonder() {
    if (!kayitId || !avukatId) return;
    if (typeof window !== "undefined" && !window.confirm(
      `${secilen?.ad_soyad ?? "Avukata"} aynı dosya için mail yeniden gönderilsin mi?`)) return;
    setTekrarGidiyor(true);
    try {
      const c = await avukataGonder(kayitId, avukatId, not_, kaynak);
      tekrarGonderildi?.({ ek: c.ek, gonderen: c.gonderen, gonderildiAt: c.gonderildiAt });
      toast.success(`${c.alici} adresine yeniden gönderildi · ek: ${c.ek}`);
      avukatTakipNotuGoster();   // Tamam'a basılana kadar durur
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt tutulamadı: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gönderilemedi.", { duration: 10000 });
    } finally { setTekrarGidiyor(false); }
  }

  /**
   * EK DOSYA YÜKLE — maile konacak dosyalar ÖZEL kovaya (yazismalar) gidiyor.
   *
   * NİYE KAYDEDİLİYOR, NİYE DOĞRUDAN MAİLE EKLENMİYOR: dosya kayıtta durunca
   * "avukata neyi göndermiştik" sorusu cevaplanabiliyor ve tekrar gönderimde
   * aynı ekler gidiyor. Tarayıcıdan doğrudan maile eklenseydi izi kalmazdı.
   */
  async function dosyaEkle(secilenler: FileList | null) {
    const liste = Array.from(secilenler ?? []);
    if (liste.length === 0) return;
    setYukleniyor(true);
    const eklenen: AvukatEk[] = [];
    for (const f of liste) {
      try {
        const temizAd = f.name.replace(/[^\w.\-]+/g, "_");
        const yol = await uploadDosyaImzali(f, "yazismalar",
          `icra-avukat/${kayitId ?? "yeni"}/${Date.now()}-${temizAd}`);
        eklenen.push({ ad: f.name, yol });
      } catch (e) {
        // SESSİZ GEÇİLMEZ: yüklenemeyen dosya maile de giremez.
        toast.error(`${f.name} yüklenemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: 9000 });
      }
    }
    if (eklenen.length) degistir({ avukat_ekler: [...ekler, ...eklenen] });
    setYukleniyor(false);
    if (dosyaRef.current) dosyaRef.current.value = "";
  }

  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = `w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30${kilitli ? " bg-gray-100 text-gray-500" : ""}`;

  return (
        <div className="sm:col-span-2">
          <label className={lbl}>Avukat <span className="text-red-600">*</span></label>
          {tabloYok ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Avukat listesi kurulmamış — <code>sql/avukatlar.sql</code> çalıştırılmalı.
            </p>
          ) : (
            <>
              {avukatlar.length > 0 && (
                // EKLE DÜĞMESİ SEÇİM KUTUSUNUN YANINDA: altta ayrı bir satır
                // olarak dururken hem yer kaplıyor hem de seçim kutusuyla
                // ilişkisi görünmüyordu. Küçük "+" aynı hizada.
                <div className="flex items-center gap-1.5">
                  <select className={`${inp}${hatali && !avukatId ? " border-red-500 ring-1 ring-red-300" : ""}`} value={avukatId} disabled={kilitli}
                    onChange={(e) => degistir({
                      avukat_id: e.target.value,
                      avukat_adi: avukatlar.find((a) => a.id === e.target.value)?.ad_soyad ?? "",
                    })}>
                    <option value="">Seçin…</option>
                    {avukatlar.map((a) => <option key={a.id} value={a.id}>{a.ad_soyad}</option>)}
                  </select>
                  {!kilitli && !yeniAcik && (
                    <button type="button" onClick={() => setYeniAcik(true)}
                      title="Listede yok — yeni avukat ekle"
                      className="shrink-0 inline-flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-[#1E3A5F] hover:bg-gray-50">
                      <Plus size={14} /> Ekle
                    </button>
                  )}
                </div>
              )}
              {secilen && (
                <div className="mt-1 text-[11px] text-gray-500">
                  {secilen.email || "e-posta yok"} · {secilen.telefon ? telefonGoster(secilen.telefon) : "telefon yok"}
                </div>
              )}

              {!kilitli && (yeniAcik ? (
                <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className={`${inp} sm:col-span-2`} autoFocus value={yeni.ad_soyad}
                      placeholder="Ad soyad (ör. Av. Ali Veli)"
                      onChange={(e) => setYeni((f) => ({ ...f, ad_soyad: e.target.value }))} />
                    <input className={inp} value={yeni.email} placeholder="E-posta" inputMode="email"
                      onChange={(e) => setYeni((f) => ({ ...f, email: e.target.value }))} />
                    <input className={inp} value={yeni.telefon} placeholder="Cep telefonu" inputMode="tel"
                      onChange={(e) => setYeni((f) => ({ ...f, telefon: e.target.value }))} />
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" onClick={avukatEkle} disabled={ekleniyor || !yeni.ad_soyad.trim()}
                      className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50">
                      {ekleniyor ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Kaydet ve seç
                    </button>
                    <button type="button" onClick={() => setYeniAcik(false)}
                      className="inline-flex items-center gap-1 h-8 px-2.5 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-white">
                      <X size={13} /> Vazgeç
                    </button>
                  </div>
                </div>
              ) : avukatlar.length === 0 ? (
                // Liste boşken seçim kutusu yok; "+" tek başına ne yapacağını
                // anlatmaz, o yüzden burada yazılı düğme kalıyor.
                <button type="button" onClick={() => setYeniAcik(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:underline">
                  <Plus size={13} /> İlk avukatı ekle
                </button>
              ) : null)}

              {/* NOT MAİLİN İÇİNE GİRER ve kayda da yazılır: "avukata ne yazmışız"
                  sonradan sorulabiliyor, yalnız mailde kalsaydı izi olmazdı. */}
              <label className={`${lbl} mt-3`}>Avukata not (isteğe bağlı)</label>
              <textarea rows={3} value={not_} disabled={kilitli}
                onChange={(e) => degistir({ avukat_notu: e.target.value })}
                placeholder="Mailin içine eklenecek not"
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />

              {/* ── EK DOSYALAR ──
                  Avukata yalnız tebligat yazısı gidiyordu; oysa çoğu zaman
                  muhasebeden gelen hesap ekstresi, sözleşme ya da yazışma da
                  gitmeli. Dosya KAYDA yükleniyor (yazismalar kovası, ÖZEL):
                  tekrar gönderimde aynı ekler gidiyor ve "neyi göndermiştik"
                  sorusu cevaplanabiliyor. */}
              {!kilitli && (
                <>
                  <label className={`${lbl} mt-3`}>Maile eklenecek dosyalar (isteğe bağlı)</label>
                  <input ref={dosyaRef} type="file" multiple className="hidden"
                    onChange={(e) => void dosyaEkle(e.target.files)} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => dosyaRef.current?.click()} disabled={yukleniyor}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-[#1E3A5F] hover:bg-gray-50 disabled:opacity-50">
                      {yukleniyor ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} Dosya ekle
                    </button>
                    {/* MUHASEBEDEN GELENİ TEK TIKLA: ekstre zaten panelde duruyor,
                        indirip yeniden yüklemek gereksiz bir tur olurdu. */}
                    {muhasebeEkleri
                      .filter((m) => !ekler.some((e) => e.yol === m.yol))
                      .map((m) => (
                        <button key={m.yol} type="button"
                          onClick={() => degistir({ avukat_ekler: [...ekler, m] })}
                          title="Muhasebenin cevabıyla gelen dosya — maile ekle"
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100">
                          <Plus size={12} /> {m.ad}
                        </button>
                      ))}
                  </div>
                  {ekler.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {ekler.map((e) => (
                        <span key={e.yol} className="inline-flex items-center gap-1 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-700">
                          {/* ÖZEL KOVA: dosyaUrl imzalı geçitten geçirir (AGENTS.md). */}
                          <a href={dosyaUrl(e.yol)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 hover:underline">
                            <Paperclip size={10} /> {e.ad}
                          </a>
                          <button type="button" title="Ekten çıkar"
                            onClick={() => degistir({ avukat_ekler: ekler.filter((x) => x.yol !== e.yol) })}
                            className="text-gray-400 hover:text-red-600"><X size={11} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* MAİL BİR KEZ GİDER: daha önce gönderilmişse kaydet yeniden
                  göndermez — her düzenlemede avukata aynı mailin tekrar gitmesi
                  hem gereksiz hem de "hangisi geçerli" karışıklığı yaratır. */}
              {mailBilgisi?.tarih && mailBilgisi.gecerli ? (
                <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                  <div>
                    Avukata gönderildi · {new Date(mailBilgisi.tarih).toLocaleString("tr-TR")}
                    {mailBilgisi.gonderen ? ` · ${mailBilgisi.gonderen}` : ""}
                    {mailBilgisi.ek ? ` · ek: ${mailBilgisi.ek}` : ""}
                    {(mailBilgisi.sayi ?? 0) > 1 ? ` · ${mailBilgisi.sayi}. gönderim` : ""}
                  </div>
                  <div className="mt-1 text-emerald-700">Kaydet tekrar göndermez.</div>
                  {!kilitli && kayitId && avukatId && (
                    <button type="button" onClick={tekrarGonder} disabled={tekrarGidiyor}
                      title="Aynı dosyayı avukata yeniden gönderir. İlk gönderim geçerli kalır."
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      {tekrarGidiyor ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Tekrar gönder
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {/* GERİ ALINMIŞ GÖNDERİM: mail geçmişte gitti ama cevap geri
                      alındı (ya da başka avukat seçildi). Yeşil "gönderildi"
                      şeridi burada yanıltıcı olurdu — kaydetmek YENİDEN gönderir. */}
                  {mailBilgisi?.tarih && (
                    <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                      Bu dosya {new Date(mailBilgisi.tarih).toLocaleString("tr-TR")} tarihinde
                      {mailBilgisi.gonderen ? ` ${mailBilgisi.gonderen} tarafından` : ""} avukata
                      gönderilmişti; {sirket ? "sonra geri alındı" : "cevap sonradan geri alındı"}. <strong>Kaydet yeniden gönderir.</strong>
                    </div>
                  )}
                  {/* TEK SATIR: üç cümlelik açıklama pencereyi uzatıp Kaydet'i
                      ekrandan çıkarıyordu. Belge inmezse mail gitmiyor — bunu
                      zaten hata mesajı söylüyor, burada tekrarlamaya gerek yok. */}
                  <p className="mt-1 text-[11px] text-gray-500">
                    Kaydet denince dosya bilgileri,{" "}
                    <strong className="text-red-600">{sirket ? "son itiraz günü" : "son cevap günü"}</strong>,
                    bu not, {sirket ? "ödeme emri" : "tebligat"} belgesi
                    {ekler.length > 0 ? ` ve ${ekler.length} ek` : ""} avukata gider.
                  </p>
                </>
              )}
            </>
          )}
        </div>
  );
}
