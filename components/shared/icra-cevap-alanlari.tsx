// İCRA "CEVAP / ÖDEME" ALANLARI — TEK YERDE.
//
// NİYE ORTAK BİLEŞEN: aynı alanlar iki ekranda var — ana sayfadaki hızlı "Cevabı
// işle" penceresi ve icra sayfasındaki tam düzenleme formu. Kurallar da basit
// değil (cevap şekline göre sorulan alanlar değişiyor). İki yerde ayrı yazılsaydı
// biri değişip öbürü geride kalırdı; kullanıcı aynı işi iki ekranda farklı
// yapmak zorunda kalırdı.
//
// CEVAP ŞEKLİNE GÖRE SORULAN ŞEY DEĞİŞİR:
//   KEP            → tarih · evrak no            (KEP yazışmadır, ödeme değil)
//   Banka Havalesi → dekont tarihi · dekont no · hangi banka · ödenen tutar
//   Avukat         → avukat · not                (tarih mailin gittiği gün,
//                                                 evrak mailin kendisi)
//   diğerleri      → tarih · evrak no · ödenen tutar
"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, X, Loader2, Send } from "lucide-react";
import { getAktifAvukatlar, insertAvukat } from "@/lib/supabase/queries/avukatlar";
import { avukataGonder } from "@/lib/supabase/queries/icra-avukat-mail";
import { telefonGoster } from "@/lib/utils/telefon";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import type { Avukat } from "@/lib/supabase/types";

export type CevapAlanlari = {
  cevap_sekli: string;
  cevap_tarihi: string;
  evrak_no: string;
  odenen_tutar: string;   // metin (para girişi biçimli)
  banka_adi: string;
  avukat_id: string;
  avukat_notu: string;
};

export const BOS_CEVAP: CevapAlanlari = {
  cevap_sekli: "", cevap_tarihi: "", evrak_no: "", odenen_tutar: "",
  banka_adi: "", avukat_id: "", avukat_notu: "",
};

/**
 * Cevap şeklinden kip çıkarır. Liste Tanımlamalar'dan düzenlenebildiği için
 * metin içinde aranıyor: "Banka", "Banka Havalesi", "Banka EFT" hepsi aynı kip.
 * Türkçe locale ile küçültülüyor — /…/i kalıbı "İ" harfini bulmuyor.
 */
export function cevapKipi(cevapSekli: string) {
  const k = (cevapSekli ?? "").toLocaleLowerCase("tr");
  return {
    kep: k.trim() === "kep",
    banka: k.includes("banka"),
    avukat: k.includes("avukat"),
  };
}

/** Doğrulama — iki ekranda da aynı. Sorun yoksa null döner. */
export function cevapDogrula(v: CevapAlanlari, tebligTarihi: string): string | null {
  const kip = cevapKipi(v.cevap_sekli);
  if (kip.avukat) {
    if (!v.avukat_id) return "Avukat seçilmeli.";
    return null;   // tarih/evrak/tutar sorulmuyor
  }
  if (v.cevap_tarihi && tebligTarihi && v.cevap_tarihi < tebligTarihi) {
    return kip.banka
      ? "Dekont tarihi, tebliğ tarihinden önce olamaz."
      : "İcraya cevap tarihi, tebliğ tarihinden önce olamaz.";
  }
  if (kip.banka) {
    // ÜÇÜ BİRLİKTE: biri girilip diğeri boş kalırsa dosya kapanmaz ve kullanıcı
    // niye kapanmadığını anlayamaz.
    const dolu = [v.cevap_tarihi, v.evrak_no.trim(), parseParaInput(v.odenen_tutar) > 0 ? "x" : ""].filter(Boolean).length;
    if (dolu > 0 && dolu < 3) return "Banka havalesinde dekont tarihi, dekont no ve ödenen tutar birlikte girilir.";
    return null;
  }
  if (v.cevap_tarihi && !v.evrak_no.trim()) return "Cevap tarihi girildi — evrak no zorunludur.";
  return null;
}

export default function IcraCevapAlanlari({
  deger, degistir, sekiller, tebligTarihi, zorunlu = false, kilitli = false, mailBilgisi,
  icraId, tekrarGonderildi,
}: {
  deger: CevapAlanlari;
  degistir: (yama: Partial<CevapAlanlari>) => void;
  sekiller: string[];
  tebligTarihi: string;
  /** Hızlı pencerede cevap şekli zorunlu; tam formda "Cevap / Ödeme" bölümü opsiyonel. */
  zorunlu?: boolean;
  kilitli?: boolean;
  /** Avukata mail daha önce gittiyse: ne zaman, kim, hangi ekle, kaç kez. */
  mailBilgisi?: { tarih: string | null; ek: string | null; gonderen?: string | null; sayi?: number };
  /** Kayıt id'si — "Tekrar gönder" için gerekli. Yeni (kaydedilmemiş) kayıtta boş. */
  icraId?: string | null;
  /** Tekrar gönderim sonrası üst ekranın tazelenmesi için. */
  tekrarGonderildi?: (c: { ek: string; gonderen: string; gonderildiAt: string }) => void;
}) {
  const [avukatlar, setAvukatlar] = useState<Avukat[]>([]);
  const [tabloYok, setTabloYok] = useState(false);
  const [yeniAcik, setYeniAcik] = useState(false);
  const [yeni, setYeni] = useState({ ad_soyad: "", email: "", telefon: "" });
  const [ekleniyor, setEkleniyor] = useState(false);
  const [tekrarGidiyor, setTekrarGidiyor] = useState(false);

  const kip = cevapKipi(deger.cevap_sekli);

  useEffect(() => {
    if (!kip.avukat) return;        // listeyi yalnız gerekince çek
    getAktifAvukatlar().then(
      ({ liste, tabloYok }) => { setAvukatlar(liste); setTabloYok(tabloYok); },
      () => setAvukatlar([]));
  }, [kip.avukat]);

  const secilen = avukatlar.find((a) => a.id === deger.avukat_id) ?? null;

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
      degistir({ avukat_id: a.id });          // eklenen hemen seçili gelsin
      setYeni({ ad_soyad: "", email: "", telefon: "" });
      setYeniAcik(false);
      toast.success("Avukat eklendi ve seçildi.");
    } catch (e) {
      const m = e instanceof Error ? e.message : "Eklenemedi.";
      toast.error(/duplicate|avukatlar_ad_uq/.test(m) ? "Bu avukat zaten kayıtlı." : m, { duration: 8000 });
    } finally { setEkleniyor(false); }
  }

  /**
   * TEKRAR GÖNDER — avukat maili bir kez gider (Kaydet yeniden göndermez), ama
   * bazen gerekiyor: avukat maili bulamıyor, adres değişmiş, hatırlatma isteniyor.
   * Düğmeyle AÇIKÇA istenince gönderilir; her kaydetmede kendiliğinden değil.
   *
   * CEVAP TARİHİ DEĞİŞMEZ: sunucu ilk gönderimin tarihini koruyor — yeniden
   * gönderme bir hatırlatmadır, yeni bir cevap değil.
   */
  async function tekrarGonder() {
    if (!icraId || !deger.avukat_id) return;
    if (typeof window !== "undefined" && !window.confirm(
      `${secilen?.ad_soyad ?? "Avukata"} aynı dosya için mail yeniden gönderilsin mi?`)) return;
    setTekrarGidiyor(true);
    try {
      const c = await avukataGonder(icraId, deger.avukat_id, deger.avukat_notu);
      tekrarGonderildi?.({ ek: c.ek, gonderen: c.gonderen, gonderildiAt: c.gonderildiAt });
      toast.success(`${c.alici} adresine yeniden gönderildi · ek: ${c.ek}`, { duration: 7000 });
      if (c.kayitHatasi) toast.error(`Mail gitti ama kayıt tutulamadı: ${c.kayitHatasi}`, { duration: 10000 });
      if (c.antetInemedi) toast.error("Mail ANTETSİZ gitti — firma anteti indirilemedi.", { duration: 9000 });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Gönderilemedi.", { duration: 10000 });
    } finally { setTekrarGidiyor(false); }
  }

  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = `w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30${kilitli ? " bg-gray-100 text-gray-500" : ""}`;

  return (
    <>
      {/* CEVAP ŞEKLİ İLK VE TEK SATIR: formun geri kalanı buna bağlı. Tarih başta
          dururken insan önce onu dolduruyor, cevap şeklini en sonda görüp boş
          bırakıyordu. */}
      <div className="sm:col-span-2">
        <label className={lbl}>Cevap şekli {zorunlu && <span className="text-red-600">*</span>}</label>
        <select className={inp} value={deger.cevap_sekli} disabled={kilitli}
          onChange={(e) => degistir({ cevap_sekli: e.target.value })}>
          <option value="">Seçin…</option>
          {/* Kayıtta duran ama listeden kaldırılmış bir değer varsa KAYBOLMASIN. */}
          {(deger.cevap_sekli && !sekiller.includes(deger.cevap_sekli)
            ? [deger.cevap_sekli, ...sekiller] : sekiller).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {/* AVUKAT KİPİNDE TARİH VE EVRAK NO SORULMAZ: cevap, mailin gittiği gün
          verilmiş sayılıyor (tarihi sunucu yazar), evrak da mailin kendisi. */}
      {!kip.avukat && (
        <>
          <div>
            <label className={lbl}>{kip.banka ? "Dekont tarihi" : "İcraya cevap tarihi"}</label>
            <input type="date" className={inp} value={deger.cevap_tarihi} disabled={kilitli}
              min={tebligTarihi || undefined}
              onChange={(e) => degistir({ cevap_tarihi: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>
              {kip.banka ? "Dekont no" : "Evrak no"} {deger.cevap_tarihi && <span className="text-red-600">*</span>}
            </label>
            <input className={`${inp} ${deger.cevap_tarihi && !deger.evrak_no.trim() ? "border-red-400 ring-1 ring-red-300" : ""}`}
              value={deger.evrak_no} disabled={kilitli}
              placeholder={kip.banka ? "Dekont numarası" : "Gönderilen evrak no"}
              onChange={(e) => degistir({ evrak_no: e.target.value })} />
          </div>
        </>
      )}

      {kip.banka && (
        <div className="sm:col-span-2">
          <label className={lbl}>Hangi bankadan ödendi</label>
          <input className={inp} value={deger.banka_adi} disabled={kilitli}
            placeholder="Ödemenin yapıldığı banka"
            onChange={(e) => degistir({ banka_adi: e.target.value })} />
        </div>
      )}

      {/* AVUKAT: ad serbest metin değil, LİSTEDEN. Aynı kişi üç farklı yazımla
          girilirse "hangi dosyaları kim takip ediyor" sorusu cevaplanamaz olur. */}
      {kip.avukat && (
        <div className="sm:col-span-2">
          <label className={lbl}>Avukat <span className="text-red-600">*</span></label>
          {tabloYok ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Avukat listesi kurulmamış — <code>sql/avukatlar.sql</code> çalıştırılmalı.
            </p>
          ) : (
            <>
              {avukatlar.length > 0 && (
                <select className={inp} value={deger.avukat_id} disabled={kilitli}
                  onChange={(e) => degistir({ avukat_id: e.target.value })}>
                  <option value="">Seçin…</option>
                  {avukatlar.map((a) => <option key={a.id} value={a.id}>{a.ad_soyad}</option>)}
                </select>
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
              ) : (
                <button type="button" onClick={() => setYeniAcik(true)}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:underline">
                  <Plus size={13} /> {avukatlar.length === 0 ? "İlk avukatı ekle" : "Listede yok, yeni avukat ekle"}
                </button>
              ))}

              {/* NOT MAİLİN İÇİNE GİRER ve kayda da yazılır: "avukata ne yazmışız"
                  sonradan sorulabiliyor, yalnız mailde kalsaydı izi olmazdı. */}
              <label className={`${lbl} mt-3`}>Avukata not (isteğe bağlı)</label>
              <textarea rows={3} value={deger.avukat_notu} disabled={kilitli}
                onChange={(e) => degistir({ avukat_notu: e.target.value })}
                placeholder="Mailin içine eklenecek not"
                className="w-full px-2.5 py-2 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30" />

              {/* MAİL BİR KEZ GİDER: daha önce gönderilmişse kaydet yeniden
                  göndermez — her düzenlemede avukata aynı mailin tekrar gitmesi
                  hem gereksiz hem de "hangisi geçerli" karışıklığı yaratır. */}
              {mailBilgisi?.tarih ? (
                <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                  <div>
                    Avukata gönderildi · {new Date(mailBilgisi.tarih).toLocaleString("tr-TR")}
                    {mailBilgisi.gonderen ? ` · ${mailBilgisi.gonderen}` : ""}
                    {mailBilgisi.ek ? ` · ek: ${mailBilgisi.ek}` : ""}
                    {(mailBilgisi.sayi ?? 0) > 1 ? ` · ${mailBilgisi.sayi}. gönderim` : ""}
                  </div>
                  <div className="mt-1 text-emerald-700">Kaydet tekrar göndermez.</div>
                  {!kilitli && icraId && deger.avukat_id && (
                    <button type="button" onClick={tekrarGonder} disabled={tekrarGidiyor}
                      title="Aynı dosyayı avukata yeniden gönderir. Cevap tarihi DEĞİŞMEZ — ilk gönderim geçerlidir."
                      className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-emerald-600 bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      {tekrarGidiyor ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Tekrar gönder
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[11px] text-gray-500">
                  Kaydet denince dosya bilgileri, <strong className="text-red-600">son cevap günü</strong>,
                  bu not ve tebligat belgesi avukata mail ile gider. Belge indirilemezse mail
                  gönderilmez ve dosya cevapsız kalır.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* KEP ve AVUKATTA ÖDENEN TUTAR SORULMAZ: ikisi de yazışma, ödeme değil.
          KAYITLI TUTAR SİLİNMEZ — alan gizlenince değer olduğu gibi kaydedilir;
          dolu bir tutar varken görünmez kalmasın diye yazıyla söylenir. */}
      {kip.kep || kip.avukat ? (
        parseParaInput(deger.odenen_tutar) > 0 ? (
          <div className="sm:col-span-2 text-[11px] text-gray-500">
            Kayıtlı ödenen tutar {deger.odenen_tutar} — bu cevap şeklinde sorulmuyor, silinmiyor.
          </div>
        ) : null
      ) : (
        <div>
          <label className={lbl}>
            Ödenen tutar {kip.banka && deger.cevap_tarihi && <span className="text-red-600">*</span>}
          </label>
          <input className={`${inp} text-right`} value={deger.odenen_tutar} inputMode="decimal" disabled={kilitli}
            placeholder="0"
            onChange={(e) => degistir({ odenen_tutar: formatParaInput(e.target.value) })} />
        </div>
      )}
    </>
  );
}
