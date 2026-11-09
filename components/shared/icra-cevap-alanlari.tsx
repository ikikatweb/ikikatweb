// İCRA "CEVAP / ÖDEME" ALANLARI — TEK YERDE.
//
// NİYE ORTAK BİLEŞEN: aynı alanlar iki ekranda var — ana sayfadaki hızlı "Cevabı
// işle" penceresi ve icra sayfasındaki tam düzenleme formu. Kurallar da basit
// değil (cevap şekline göre sorulan alanlar değişiyor). İki yerde ayrı yazılsaydı
// biri değişip öbürü geride kalırdı; kullanıcı aynı işi iki ekranda farklı
// yapmak zorunda kalırdı.
//
// CEVAP ŞEKLİNE GÖRE SORULAN ŞEY DEĞİŞİR:
//   KEP            → tarih* · evrak no*          (KEP yazışmadır, ödeme değil)
//   Banka Havalesi → dekont tarihi* · dekont no* · hangi banka* · ödenen tutar
//   Avukat         → avukat*· not                (tarih mailin gittiği gün,
//                                                 evrak mailin kendisi)
//   İadeli Taah.   → cevap yazısı*               (giden evraktan gelir)
//   diğerleri      → tarih* · evrak no*          (ödenen tutar SORULMAZ)
// (* = zorunlu — ekranda da yıldızlı görünür, iki kural tek yerden gelir)
"use client";

import IcraIadeliEvrak from "@/components/shared/icra-iadeli-evrak";
import AvukatSecim, { type AvukatMailBilgisi } from "@/components/shared/avukat-secim";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";

export type CevapAlanlari = {
  cevap_sekli: string;
  cevap_tarihi: string;
  evrak_no: string;
  odenen_tutar: string;   // metin (para girişi biçimli)
  banka_adi: string;
  avukat_id: string;
  /** Avukatın ADININ ANLIK KOPYASI — avukat silinse/adı değişse de kalır. */
  avukat_adi: string;
  avukat_notu: string;
};

export const BOS_CEVAP: CevapAlanlari = {
  cevap_sekli: "", cevap_tarihi: "", evrak_no: "", odenen_tutar: "",
  banka_adi: "", avukat_id: "", avukat_adi: "", avukat_notu: "",
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
    // İADELİ TAAHHÜTLÜ: cevap yazısı panelde zaten var olan bir giden evraktır.
    // Tarih ve numara elle değil, o evraktan gelir (bkz. icra-iadeli-evrak).
    iadeli: k.includes("iadeli") || k.includes("taahh"),
  };
}

/**
 * İCRA KAYDININ ZORUNLU ALANLARI — tam formdaki yıldızlı alanlarla birebir aynı.
 * Hızlı "Cevabı işle" penceresi bu alanları DÜZENLEMİYOR ama eksikse cevap da
 * işlenmemeli: eksik bir deftere "cevap verildi" yazmak, satırı tamamlanmış
 * gibi gösterip gözden kaçırır. Eksikse pencere ne eksik olduğunu söyler ve
 * tam forma yönlendirir — kapalı kapı bırakmaz.
 */
export const KAYIT_ZORUNLU: { alan: string; etiket: string }[] = [
  { alan: "ucuncu_sahis", etiket: "Üçüncü şahıs" },
  { alan: "dosya_esas_no", etiket: "Dosya esas no" },
  { alan: "gelen_yazi_tarihi", etiket: "Gelen icra yazısı tarihi" },
  { alan: "teblig_tarihi", etiket: "Tebliğ tarihi" },
  { alan: "alacakli_adi", etiket: "Alacaklı adı" },
  { alan: "borclu_adi", etiket: "Borçlu adı" },
  { alan: "borclu_tc_no", etiket: "Borçlu vergi / TC no" },
  { alan: "borc_miktari", etiket: "Borç miktarı" },
];

/** Kayıtta eksik olan zorunlu alanların etiketleri. Boş dizi = tam. */
export function eksikZorunluAlanlar(kayit: Record<string, unknown>): string[] {
  return KAYIT_ZORUNLU.filter(({ alan }) => {
    const v = kayit[alan];
    if (alan === "borc_miktari") return !Number(v);
    return v === null || v === undefined || String(v).trim() === "";
  }).map((x) => x.etiket);
}

/**
 * Cevap/ödeme bölümünde CEVABI BELGELEYEN bir alan dolu mu?
 *
 * AVUKAT NOTU SAYILMAZ: not, cevabın kendisi değil, maile eklenen bir cümle.
 * Sayıldığında cevabı geri almak imkânsız hâle geliyordu — kullanıcı cevap
 * şeklini "Seçin…"e çeker, alanlar boşalır ama not kayıtta kalır, bölüm "dolu"
 * sayılır ve kaydetme sessizce engellenirdi. Not kayıtta duruyor (silinmiyor),
 * yalnız "cevap verildi" ölçüsüne girmiyor.
 */
function cevapDolduMu(v: CevapAlanlari): boolean {
  return Boolean(v.cevap_tarihi || v.evrak_no.trim() || v.banka_adi.trim()
    || v.avukat_id || parseParaInput(v.odenen_tutar) > 0);
}

/**
 * CEVAP ŞEKLİNE GÖRE ZORUNLU ALANLAR İSTENİYOR MU?
 *   hızlı pencere  → her zaman (orada yapılan iş zaten "cevabı işlemek")
 *   tam form       → bölüme bir şey yazıldıysa
 * Ekrandaki yıldız da, kaydetmedeki kontrol de BUNU kullanır: işaretlenip
 * istenmeyen ya da istenip işaretlenmeyen alan kalmasın.
 */
export function cevapZorunluMu(v: CevapAlanlari, zorunlu: boolean): boolean {
  return zorunlu || cevapDolduMu(v);
}

export type CevapAlan = "cevap_sekli" | "cevap_tarihi" | "evrak_no" | "banka_adi" | "avukat_id";

/**
 * CEVAP ŞEKLİNE GÖRE BOŞ KALAN ZORUNLU ALANLAR — adlarıyla.
 *
 * NİYE LİSTE, NİYE METİN DEĞİL: eksik alanı uyarı balonunda saymak, kullanıcıyı
 * metni okuyup alanı gözüyle aramaya zorluyordu. Ad döndürülünce ekran o
 * kutuların kendisini kırmızıya boyuyor — nerede olduğu bakışta görünüyor.
 */
export function eksikCevapAlanlari(v: CevapAlanlari, zorunlu: boolean): CevapAlan[] {
  // CEVABI GERİ ALMA: bölümün tamamı boşsa hiçbir şey istenmez — hızlı
  // pencerede bile. Avukat dosyayı reddedebiliyor, karşı taraf cevabı geri
  // çevirebiliyor; işlenmiş bir cevabı geri almanın yolu kapalı kalmamalı.
  // Boş kaydetmek "cevap verilmedi" demektir ve dosya yeniden listeye girer.
  if (!cevapDolduMu(v) && !v.cevap_sekli.trim()) return [];
  // Bölüm opsiyonel: tam formda hiç doldurulmamışsa hiçbir şey istenmez.
  if (!cevapZorunluMu(v, zorunlu)) return [];
  // CEVAP ŞEKLİ olmadan hangi alanın sorulacağı belli değil — önce o.
  if (!v.cevap_sekli.trim()) return ["cevap_sekli"];
  const kip = cevapKipi(v.cevap_sekli);
  if (kip.avukat) return v.avukat_id ? [] : ["avukat_id"];   // tarih/evrak sorulmuyor
  const eksik: CevapAlan[] = [];
  if (!v.cevap_tarihi) eksik.push("cevap_tarihi");
  if (!v.evrak_no.trim()) eksik.push("evrak_no");
  // ÖDENEN TUTAR İSTENMİYOR: dekontun kendisi tutarın belgesi.
  if (kip.banka && !v.banka_adi.trim()) eksik.push("banka_adi");
  return eksik;
}

/**
 * Eksik alan DIŞINDAKİ kurallar — iki ekranda da aynı. Sorun yoksa null döner.
 * Eksik alanlar burada DEĞİL: onlar kırmızıya boyanıyor (bkz. eksikCevapAlanlari).
 */
export function cevapDogrula(v: CevapAlanlari, tebligTarihi: string): string | null {
  const kip = cevapKipi(v.cevap_sekli);
  if (v.cevap_tarihi && tebligTarihi && v.cevap_tarihi < tebligTarihi) {
    return kip.banka
      ? "Dekont tarihi, tebliğ tarihinden önce olamaz."
      : "İcraya cevap tarihi, tebliğ tarihinden önce olamaz.";
  }
  return null;
}

export default function IcraCevapAlanlari({
  deger, degistir, sekiller, tebligTarihi, zorunlu = false, kilitli = false, mailBilgisi,
  icraId, tekrarGonderildi, denendi = false, denendiSifirla,
}: {
  deger: CevapAlanlari;
  degistir: (yama: Partial<CevapAlanlari>) => void;
  sekiller: string[];
  tebligTarihi: string;
  /** Hızlı pencerede cevap şekli zorunlu; tam formda "Cevap / Ödeme" bölümü opsiyonel. */
  zorunlu?: boolean;
  kilitli?: boolean;
  /**
   * Avukata mail daha önce gittiyse: ne zaman, kim, hangi ekle, kaç kez.
   * `gecerli`: o gönderim HÂLÂ dosyanın cevabı mı? Cevap geri alındıysa (ya da
   * başka bir avukat seçildiyse) mail geçmişte kalmıştır; kaydetmek YENİDEN
   * gönderir ve ekran bunu söylemelidir.
   */
  mailBilgisi?: AvukatMailBilgisi;
  /** Kayıt id'si — "Tekrar gönder" için gerekli. Yeni (kaydedilmemiş) kayıtta boş. */
  icraId?: string | null;
  /** Tekrar gönderim sonrası üst ekranın tazelenmesi için. */
  tekrarGonderildi?: (c: { ek: string; gonderen: string; gonderildiAt: string }) => void;
  /** Kaydet denendi ve eksik alan vardı — boş zorunlu kutular kırmızıya boyanır. */
  denendi?: boolean;
  /** Cevap şekli değişince kırmızılar silinir: istenen alanlar da değişti. */
  denendiSifirla?: () => void;
}) {

  const kip = cevapKipi(deger.cevap_sekli);
  // YILDIZ VE KURAL AYNI KAPIDAN: ekranda işaretli olup kaydetmede sorulmayan
  // (ya da tersi) alan kalmasın.
  const yildiz = cevapZorunluMu(deger, zorunlu);
  // CEVAP ŞEKLİ SEÇİLMEDEN ALT ALANLAR GÖRÜNMEZ: hangi alanın sorulacağı
  // şekle bağlı (KEP'te evrak no, havalede dekont no, avukatta hiçbiri).
  // Şekil seçilmeden gösterilen tarih/evrak no kutusu, sonra şekil seçilince
  // yerini başka alana bırakıyor ve girilen şey boşa gidiyordu.
  //
  // AMA ESKİ KAYITTA VERİ VARSA GİZLENMEZ: cevap şekli alanı sonradan eklendi,
  // 17 dosyada tarih/evrak no dolu ama şekil boş. Gizleseydik o veriler
  // ekrandan sessizce kaybolurdu — kayıtta duruyor, görünmüyor olurdu.
  // KIRMIZI KUTULAR — uyarı balonu yerine. Her çizimde yeniden hesaplanır:
  // kullanıcı alanı doldurunca kırmızı kendiliğinden kalkar.
  const kirmizi = new Set<CevapAlan>(denendi ? eksikCevapAlanlari(deger, zorunlu) : []);
  const hata = (a: CevapAlan) => (kirmizi.has(a) ? " border-red-500 ring-1 ring-red-300" : "");
  const sekilSecildi = Boolean(deger.cevap_sekli.trim());
  const eskiCevapVerisi = Boolean(deger.cevap_tarihi || deger.evrak_no.trim());





  const lbl = "text-xs font-medium text-gray-600 mb-1 block";
  const inp = `w-full h-9 px-2.5 text-sm rounded-lg border border-gray-300 outline-none focus:border-[#1E3A5F] focus:ring-1 focus:ring-[#1E3A5F]/30${kilitli ? " bg-gray-100 text-gray-500" : ""}`;

  return (
    <>
      {/* CEVAP ŞEKLİ İLK VE TEK SATIR: formun geri kalanı buna bağlı. Tarih başta
          dururken insan önce onu dolduruyor, cevap şeklini en sonda görüp boş
          bırakıyordu. */}
      <div className="sm:col-span-2">
        <label className={lbl}>
          Cevap şekli {(zorunlu || cevapDolduMu(deger)) && <span className="text-red-600">*</span>}
        </label>
        {/* ŞEKİL DEĞİŞİNCE KIRMIZILAR SİLİNİR: başka kipin alanları geliyor,
            eski kipten kalan işaretler yanlış yeri gösterirdi. */}
        <select className={`${inp}${hata("cevap_sekli")}`} value={deger.cevap_sekli} disabled={kilitli}
          onChange={(e) => {
            denendiSifirla?.();
            // "Seçin…"E DÖNÜLÜNCE ALANLAR BOŞALIR: kaydedilince cevap geri
            // alınmış olur. Eski kipin tarihi/evrakı ekranda kalsaydı hem
            // kaydetme engellenirdi hem de "hangi cevap geçerli" belirsizleşirdi.
            // Avukata gönderilmiş mailin KAYDI SİLİNMEZ (avukat_mail_*): mail
            // gerçekten gitti, o iz kalmalı. Nota da dokunulmaz.
            if (!e.target.value.trim()) {
              degistir({ cevap_sekli: "", cevap_tarihi: "", evrak_no: "", odenen_tutar: "",
                banka_adi: "", avukat_id: "", avukat_adi: "" });
              return;
            }
            degistir({ cevap_sekli: e.target.value });
          }}>
          <option value="">Seçin…</option>
          {/* Kayıtta duran ama listeden kaldırılmış bir değer varsa KAYBOLMASIN. */}
          {(deger.cevap_sekli && !sekiller.includes(deger.cevap_sekli)
            ? [deger.cevap_sekli, ...sekiller] : sekiller).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      {/* AVUKAT KİPİNDE TARİH VE EVRAK NO SORULMAZ: cevap, mailin gittiği gün
          verilmiş sayılıyor (tarihi sunucu yazar), evrak da mailin kendisi. */}
      {kip.iadeli && (
        <IcraIadeliEvrak
          evrakNo={deger.evrak_no} cevapTarihi={deger.cevap_tarihi}
          degistir={degistir} kilitli={kilitli} zorunlu={yildiz}
          hatali={kirmizi.has("evrak_no") || kirmizi.has("cevap_tarihi")}
        />
      )}

      {!kip.avukat && !kip.iadeli && (sekilSecildi || eskiCevapVerisi) && (
        <>
          {!sekilSecildi && (
            <div className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              Bu dosyada cevap bilgisi var ama <strong>cevap şekli yazılmamış</strong> — kaydetmeden önce seçin.
            </div>
          )}
          <div>
            <label className={lbl}>
              {kip.banka ? "Dekont tarihi" : "İcraya cevap tarihi"} {yildiz && <span className="text-red-600">*</span>}
            </label>
            <input type="date" className={`${inp}${hata("cevap_tarihi")}`} value={deger.cevap_tarihi} disabled={kilitli}
              min={tebligTarihi || undefined}
              onChange={(e) => degistir({ cevap_tarihi: e.target.value })} />
          </div>
          <div>
            <label className={lbl}>
              {kip.banka ? "Dekont no" : "Evrak no"} {yildiz && <span className="text-red-600">*</span>}
            </label>
            <input className={`${inp}${hata("evrak_no")}`}
              value={deger.evrak_no} disabled={kilitli}
              placeholder={kip.banka ? "Dekont numarası" : "Gönderilen evrak no"}
              onChange={(e) => degistir({ evrak_no: e.target.value })} />
          </div>
        </>
      )}

      {kip.banka && (
        <div className="sm:col-span-2">
          <label className={lbl}>
            Hangi bankadan ödendi {yildiz && <span className="text-red-600">*</span>}
          </label>
          <input className={`${inp}${hata("banka_adi")}`} value={deger.banka_adi} disabled={kilitli}
            placeholder="Ödemenin yapıldığı banka"
            onChange={(e) => degistir({ banka_adi: e.target.value })} />
        </div>
      )}

      {/* AVUKAT: ad serbest metin değil, LİSTEDEN. Aynı kişi üç farklı yazımla
          girilirse "hangi dosyaları kim takip ediyor" sorusu cevaplanamaz olur. */}
      {/* AVUKAT SEÇİMİ, NOTU VE GÖNDERİM İZİ ORTAK BİLEŞENDE: aynı iş şirkete
          açılan takip penceresinde de var (bkz. avukat-secim). */}
      {kip.avukat && (
        <div className="sm:col-span-2">
          <AvukatSecim
            avukatId={deger.avukat_id} not_={deger.avukat_notu}
            degistir={degistir} kilitli={kilitli} kayitId={icraId}
            mailBilgisi={mailBilgisi} tekrarGonderildi={tekrarGonderildi}
            hatali={kirmizi.has("avukat_id")}
          />
        </div>
      )}

      {/* ÖDENEN TUTAR YALNIZ BANKA HAVALESİNDE SORULUR: KEP, avukat, iadeli
          taahhütlü ve Dijital Vergi Dairesi birer YAZIŞMA — para oradan geçmiyor.
          KAYITLI TUTAR SİLİNMEZ: alan gizlenince değer olduğu gibi kaydedilir;
          dolu bir tutar varken görünmez kalmasın diye yazıyla söylenir. */}
      {kip.banka ? (
        <div className="sm:col-span-2">
          <label className={lbl}>Ödenen tutar</label>
          <input className={`${inp} text-right`} value={deger.odenen_tutar} inputMode="decimal" disabled={kilitli}
            placeholder="0"
            onChange={(e) => degistir({ odenen_tutar: formatParaInput(e.target.value) })} />
        </div>
      ) : parseParaInput(deger.odenen_tutar) > 0 ? (
        <div className="sm:col-span-2 text-[11px] text-gray-500">
          Kayıtlı ödenen tutar {deger.odenen_tutar} — bu cevap şeklinde sorulmuyor, silinmiyor.
        </div>
      ) : null}
    </>
  );
}
