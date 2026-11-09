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

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, X, Loader2, Send } from "lucide-react";
import { getAktifAvukatlar, insertAvukat } from "@/lib/supabase/queries/avukatlar";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { telefonGoster } from "@/lib/utils/telefon";
import { avukatTakipNotuGoster } from "@/components/shared/avukat-takip-notu";
import type { Avukat } from "@/lib/supabase/types";

export type AvukatMailBilgisi = {
  tarih: string | null; ek: string | null; gonderen?: string | null; sayi?: number;
  /** Gönderim HÂLÂ bu kaydın cevabı mı? Değilse "Kaydet yeniden gönderir". */
  gecerli?: boolean;
};

export default function AvukatSecim({
  avukatId, not_, degistir, kilitli = false, mailBilgisi, kayitId,
  kaynak = "icra", tekrarGonderildi, hatali = false,
}: {
  avukatId: string;
  not_: string;
  degistir: (y: { avukat_id?: string; avukat_adi?: string; avukat_notu?: string }) => void;
  kilitli?: boolean;
  mailBilgisi?: AvukatMailBilgisi;
  /** Kayıt id'si — "Tekrar gönder" için gerekli. Yeni (kaydedilmemiş) kayıtta boş. */
  kayitId?: string | null;
  kaynak?: "icra" | "sirket";
  tekrarGonderildi?: (c: { ek: string; gonderen: string; gonderildiAt: string }) => void;
  /** Kaydet denendi ama avukat seçilmemişti — kutu kırmızıya boyanır. */
  hatali?: boolean;
}) {
  const sirket = kaynak === "sirket";
  const [avukatlar, setAvukatlar] = useState<Avukat[]>([]);
  const [tabloYok, setTabloYok] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [yeni, setYeni] = useState({ ad_soyad: "", email: "", telefon: "" });
  const [ekleniyor, setEkleniyor] = useState(false);
  const [tekrarGidiyor, setTekrarGidiyor] = useState(false);

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
      toast.success(`${c.alici} adresine yeniden gönderildi · ek: ${c.ek}`, { duration: 7000 });
      avukatTakipNotuGoster();   // Tamam'a basılana kadar durur
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt tutulamadı: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gönderilemedi.", { duration: 10000 });
    } finally { setTekrarGidiyor(false); }
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
                  <p className="mt-1 text-[11px] text-gray-500">
                    Kaydet denince dosya bilgileri,{" "}
                    <strong className="text-red-600">{sirket ? "son itiraz günü" : "son cevap günü"}</strong>,
                    bu not ve {sirket ? "ödeme emri" : "tebligat"} belgesi avukata mail ile gider.
                    Belge indirilemezse mail gönderilmez ve
                    {sirket ? " takip ele alınmamış sayılmaya devam eder." : " dosya cevapsız kalır."}
                  </p>
                </>
              )}
            </>
          )}
        </div>
  );
}
