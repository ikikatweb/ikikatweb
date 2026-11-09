// E-TEBLİGAT — UETS'ten gelen resmî tebligatlar.
//
// Bu ekranın bir işi var: SÜRENİN NE ZAMAN DOLDUĞUNU göstermek. Tebligatın geldiğini
// göstermek yetmez; e-tebligatta kritik olan "ne zamana kadar cevap verilmeli".
//
// 7201 sayılı Tebligat Kanunu 7/a: tebligat, adrese ulaştığı tarihi izleyen BEŞİNCİ
// GÜNÜN SONUNDA yapılmış sayılır — açılsa da açılmasa da. O yüzden liste "kalan gün"e
// göre renkleniyor ve süresi yaklaşanlar en üstte.
//
// AÇMA İŞİ OTOMATİK YAPILMAZ: UETS'te tebligatı indirmek onu açmak demektir
// (taahhütname md. 7). Robot indirmiyor. Ama kullanıcı "Aç ve oku" düğmesiyle buradan
// açabiliyor: UETS'te tıklamakla hukuken aynı şey, geri dönüşü yok. Bu yüzden onay
// soruluyor ve KİMİN açtığı kayda geçiyor ("... tarafından ... tarihinde okundu").
"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth, useOturumFiltresi } from "@/hooks";
import { getTebligatlar, kalanGun, type Tebligat } from "@/lib/supabase/queries/tebligat";
import { Scale, ExternalLink, AlertTriangle, FileText, Loader2, Download } from "lucide-react";
import toast from "react-hot-toast";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { dosyaUrl } from "@/lib/utils/dosya-url";
import { tebligatDegisti } from "@/hooks";
import KetsisTablosu from "@/components/shared/ketsis-tablosu";

const UETS_GIRIS = "https://ptt.etebligat.gov.tr/login";

/**
 * Tebligat UETS'te AÇILMIŞ MI? "read" = biri açmış (biz ya da PTT sitesinden başkası),
 * "readtimeout" = 5 gün açılmadığı için otomatik okundu sayılmış. İkisinde de indirmek
 * yeni bir şey başlatmıyor; "delivered" ise henüz açılmamış demektir ve indirmek
 * onu AÇAR (taahhütname md. 7, geri alınamaz).
 */
const acikMi = (t: Tebligat) => t.durum === "read" || t.durum === "readtimeout";

const gun = (t: string | null) =>
  t ? new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

/** "05.11.2026 saat 18:32" — kimin ne zaman açtığını yazarken kullanılır. */
const gunSaat = (t: string | null) =>
  t ? new Date(t).toLocaleString("tr-TR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).replace(" ", " saat ") : "—";

// FİRMA RENGİ UYDURULMAZ: sistemde zaten tanımlı (firmalar.renk) ve araç formunda da
// o kullanılıyor. Tebligat da aynı rengi kullanır ki "bu hangi şirketin" sorusu
// ekrandan ekrana aynı renkle cevaplansın.
//
// Firma eşleşmemişse (firma_id boş) renk yok — uydurma renk vermektense nötr rozet,
// çünkü yanlış renk "yanlış şirket" diye okunur.
const NOTR = "#9ca3af";

const DURUM: Record<string, { ad: string; sinif: string }> = {
  delivered: { ad: "Açılmadı", sinif: "bg-amber-100 text-amber-800" },
  read: { ad: "Açıldı", sinif: "bg-gray-100 text-gray-700" },
  // 5 gün açılmayan tebligatı UETS otomatik okundu sayıyor — kanunun kuralının aynısı.
  readtimeout: { ad: "Süre doldu", sinif: "bg-red-100 text-red-800" },
};

/** Kalan güne göre satır vurgusu. Renk süs değil: hangisine bugün bakılacağını söyler. */
function aciliyet(t: Tebligat) {
  if (t.durum !== "delivered") return { satir: "", rozet: "text-gray-500", metin: "" };
  const k = kalanGun(t.teblig_tarihi);
  if (k < 0) return { satir: "bg-red-50", rozet: "text-red-700 font-semibold", metin: `${-k} gün geçti` };
  if (k === 0) return { satir: "bg-red-50", rozet: "text-red-700 font-semibold", metin: "BUGÜN son gün" };
  if (k <= 2) return { satir: "bg-amber-50", rozet: "text-amber-700 font-semibold", metin: `${k} gün kaldı` };
  return { satir: "", rozet: "text-gray-600", metin: `${k} gün kaldı` };
}

export default function ETebligatPage() {
  const { hasPermission, isYonetici, loading } = useAuth();
  const gor = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");
  // AÇMA AYRI YETKİ: tebligatı açmak geri alınamaz ve o kişinin adına kaydedilir.
  // Listeyi görebilen herkesin açabilmesi doğru değil — "düzenle" izni olan açar.
  const acabilir = isYonetici || hasPermission("yazismalar-e-tebligat", "duzenle");

  const [satirlar, setSatirlar] = useState<Tebligat[]>([]);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [suzgec, setSuzgec] = useOturumFiltresi<"acilmamis" | "hepsi">("e-tebligat:suzgec", "acilmamis");
  // Firma süzgeci: birden çok şirketin tebligatı aynı listede akıyor.
  const [firma, setFirma] = useOturumFiltresi<string>("e-tebligat:firma", "hepsi");
  // Hangi tebligat şu an açılıyor? Aynı satıra iki kez basılmasın — her basış
  // UETS'te bir indirme, yani geri alınamaz bir "okundu" demek.
  const [aciliyor, setAciliyor] = useState<number | null>(null);

  // İLK YÜKLEME. Hata SESSİZ GEÇMEZ: boş tablo "tebligat yok" diye okunur, oysa
  // sorgu patlamıştır.
  useEffect(() => {
    if (!gor) return;
    let iptal = false;
    (async () => {
      try {
        const d = await getTebligatlar();
        if (!iptal) { setSatirlar(d); setHata(null); }
      } catch (e) {
        if (!iptal) setHata(e instanceof Error ? e.message : String(e));
      } finally {
        if (!iptal) setYukleniyor(false);
      }
    })();
    return () => { iptal = true; };
  }, [gor]);

  /**
   * Tebligatın AÇILMASINI İSTER. İndirme burada olmuyor: UETS yalnız ofisteki statik
   * IP'den çalıştığı için (Vercel'den "fetch failed") istek kuyruğa yazılıyor, indirmeyi
   * ofisteki görev yapıyor. Açmak GERİ ALINAMAZ (taahhütname md. 7) — onay bu yüzden.
   */
  async function ac(t: Tebligat) {
    // ZATEN AÇIK OLANDA KORKUTUCU UYARI ÇIKMAZ: tebligat UETS'te okunmuş durumda
    // (biri PTT sitesinden açmış). İndirmek yeni bir şey başlatmıyor, yalnız belgeleri
    // panele getiriyor. Her iki durumda aynı sert uyarıyı göstermek, uyarıyı
    // değersizleştirir — insan okumadan "tamam"a basmayı öğrenir.
    const uyari = acikMi(t)
      ? `"${t.konu ?? "konu yok"}" tebligatının BELGELERİ indirilecek.

`
        + `Bu tebligat UETS'te zaten açılmış durumda; indirmek yeni bir şey başlatmaz, `
        + `yalnız belgeleri panele getirir.

`
        + `Tebliğ sayılacağı gün: ${gun(t.teblig_tarihi + "T00:00:00")}

İndirilsin mi?`
      : `"${t.konu ?? "konu yok"}" tebligatı AÇILACAK.

`
        + `UETS'te tebligatı indirmek onu okumak sayılır; bu işlem GERİ ALINAMAZ ve `
        + `kayda sizin adınıza okundu diye geçer.

`
        + `Tebliğ sayılacağı gün: ${gun(t.teblig_tarihi + "T00:00:00")}

Açılsın mı?`;
    if (!confirm(uyari)) return;
    setAciliyor(t.id);
    try {
      const r = await fetch("/api/tebligat/ac", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if (j.durum === "zaten-acik") toast.success("Tebligat zaten açık.", { duration: toastSuresi() });
      else toast.success("Açılma isteği alındı. Ofisteki görev birkaç dakika içinde indirecek.", { duration: 8000 });
      setSatirlar(await getTebligatlar());
      tebligatDegisti();
    } catch (e) {
      toast.error(`İstek gönderilemedi: ${e instanceof Error ? e.message : e}`, { duration: 14000 });
    } finally {
      setAciliyor(null);
    }
  }

  // Bekleyen istek varsa liste kendi kendine tazelensin: indirme ofiste yapılıyor,
  // sonuç bu sekmeye haber vermeden geliyor.
  const bekleyenVar = satirlar.some((t) => t.acilma_durumu === "bekliyor" || t.acilma_durumu === "islemde");
  useEffect(() => {
    if (!bekleyenVar) return;
    const z = setInterval(() => { void (async () => {
      try { setSatirlar(await getTebligatlar()); } catch { /* bir sonraki turda yine denenir */ }
    })(); }, 15000);
    return () => clearInterval(z);
  }, [bekleyenVar]);

  const liste = useMemo(() => {
    let l = suzgec === "acilmamis" ? satirlar.filter((t) => t.durum === "delivered") : satirlar;
    if (firma !== "hepsi") l = l.filter((t) => t.hesap === firma);
    // Süresi yaklaşan/geçen en üstte: en acil olan ilk sırada olsun.
    return [...l].sort((a, b) => {
      if (a.durum === "delivered" && b.durum === "delivered") return a.teblig_tarihi.localeCompare(b.teblig_tarihi);
      if (a.durum === "delivered") return -1;
      if (b.durum === "delivered") return 1;
      return b.ulasma_tarihi.localeCompare(a.ulasma_tarihi);
    });
  }, [satirlar, suzgec, firma]);

  // Hangi firmalar var? Renk sırası sabit kalsın diye alfabetik.
  const firmalar = useMemo(
    () => [...new Set(satirlar.map((t) => t.hesap))].sort(),
    [satirlar],
  );
  // Hesap kodu → firma bilgisi (renk + unvan). Firma eşleşmemişse unvan UETS'in
  // verdiği alıcı adından gösterilir; renk verilmez.
  const firmaBilgi = useMemo(() => {
    const m = new Map<string, { ad: string; renk: string | null }>();
    for (const t of satirlar) {
      if (m.has(t.hesap)) continue;
      m.set(t.hesap, {
        ad: t.firmalar?.kisa_adi || t.firmalar?.firma_adi || t.alici_ad || t.hesap,
        renk: t.firmalar?.renk ?? null,
      });
    }
    return m;
  }, [satirlar]);

  const acilmamis = satirlar.filter((t) => t.durum === "delivered").length;
  const suresiGecen = satirlar.filter((t) => t.durum === "delivered" && kalanGun(t.teblig_tarihi) < 0).length;

  if (loading) return <div className="text-center py-16 text-gray-500">Yükleniyor...</div>;
  if (!gor) return <div className="text-center py-16 text-gray-500">Bu sayfayı görüntüleme yetkiniz yok.</div>;

  return (
    <div>
      {/* SAYFA BAŞLIĞI YALNIZ AD: süzgeçler buradan alınıp aşağıdaki PTT şeridine
          taşındı. Başlığın yanında dururken "Açılmamış / Hepsi" sayfanın TAMAMINI,
          yani vergi dairesi bölümünü de süzdürüyormuş gibi okunuyordu; oysa yalnız
          PTT UETS tablosuna etki ediyor. */}
      <h1 className="mb-4 flex items-center gap-2.5 text-lg font-semibold text-[#1E3A5F]">
        <Scale size={20} /> Tebligatlar
      </h1>

      {/* ---- BÖLÜM 1: PTT UETS ----
          İki bölümün de kendi renkli başlık şeridi var. Önceden düz alt alta duruyorlardı
          ve ikinci tablo birincinin devamı gibi okunuyordu; oysa biri mahkeme/icra
          (PTT UETS, panelden açılabilir), diğeri vergi dairesi (GİB KETSİS, yalnız
          Dijital Vergi Dairesi'nde okunur). Süzgeçler de bu şeridin içinde: hangi tabloyu
          süzdükleri bakışta belli olsun. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-r-lg border-l-4 border-[#00A3CC] bg-[#00A3CC]/5 px-3 py-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ptt-uets.png" alt="PTT UETS" title="Ulusal Elektronik Tebligat Sistemi"
          className="h-5 w-auto" />
        <span className="text-sm font-semibold text-[#1E3A5F]">Mahkeme, icra ve kurum tebligatları</span>
        <span className="text-xs text-gray-500">· PTT UETS — panelden açılabilir</span>

        {/* Süzgeçler küçük: şeridin içinde duruyorlar, başlığı bastırmasınlar. */}
        <div className="ml-auto inline-flex items-center rounded-lg border border-gray-200 bg-white/70 p-0.5">
          {([["acilmamis", `Açılmamış${acilmamis ? ` (${acilmamis})` : ""}`], ["hepsi", "Hepsi"]] as const).map(([id, et]) => (
            <button key={id} type="button" onClick={() => setSuzgec(id)}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                suzgec === id ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
              {et}
            </button>
          ))}
        </div>
        {firmalar.length > 1 && (
          <div className="inline-flex items-center rounded-lg border border-gray-200 bg-white/70 p-0.5">
            <button type="button" onClick={() => setFirma("hepsi")}
              className={`px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                firma === "hepsi" ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
              Tüm firmalar
            </button>
            {firmalar.map((f) => (
              <button key={f} type="button" onClick={() => setFirma(f)}
                title={firmaBilgi.get(f)?.ad ?? f}
                className={`inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-xs font-medium transition-colors ${
                  firma === f ? "bg-[#1E3A5F] text-white shadow-sm" : "text-gray-600 hover:bg-gray-200"}`}>
                <span className="inline-block h-2 w-2 rounded-full border border-gray-300"
                  style={{ backgroundColor: firmaBilgi.get(f)?.renk ?? NOTR }} />
                {firmaBilgi.get(f)?.ad ?? f}
              </button>
            ))}
          </div>
        )}
        <a href={UETS_GIRIS} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white/70 px-2.5 h-7 text-xs hover:bg-gray-50">
          UETS&apos;te aç <ExternalLink size={12} />
        </a>
      </div>

      {suresiGecen > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            <b>{suresiGecen} tebligatın süresi geçti.</b> Elektronik tebligat, adrese ulaştığı
            tarihi izleyen beşinci günün sonunda tebliğ edilmiş sayılır (7201 s. K. 7/a) —
            açılmamış olması süreyi durdurmaz.
          </span>
        </div>
      )}

      {hata && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Tebligatlar alınamadı: {hata}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Firma</th>
              <th className="px-3 py-2 font-medium">Gönderen</th>
              <th className="px-3 py-2 font-medium">Konu</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Ulaşma</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Tebliğ sayılacağı gün</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Kalan</th>
              <th className="px-3 py-2 font-medium">Durum</th>
              <th className="px-3 py-2 font-medium">Belge</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {liste.map((t) => {
              const a = aciliyet(t);
              const d = DURUM[t.durum] ?? { ad: t.durum, sinif: "bg-gray-100 text-gray-700" };
              return (
                <tr key={t.id} className={a.satir}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5" title={t.firmalar?.firma_adi ?? t.alici_ad ?? t.hesap}>
                      <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-gray-300"
                        style={{ backgroundColor: t.firmalar?.renk ?? NOTR }} />
                      <span className="font-medium">
                        {t.firmalar?.kisa_adi || t.firmalar?.firma_adi || t.hesap}
                      </span>
                    </span>
                    {!t.firma_id && t.alici_ad && (
                      <div className="mt-0.5 max-w-[14rem] truncate text-[11px] text-gray-500" title={t.alici_ad}>
                        {t.alici_ad}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">{t.gonderen_ad ?? t.gonderen_adres ?? "—"}</td>
                  <td className="px-3 py-2">{t.konu ?? "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{gun(t.ulasma_tarihi)}</td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums font-medium">{gun(t.teblig_tarihi + "T00:00:00")}</td>
                  <td className={`px-3 py-2 whitespace-nowrap ${a.rozet}`}>{a.metin || "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block rounded px-2 py-0.5 text-xs ${d.sinif}`}>{d.ad}</span>
                    {/* NEREDEN AÇILDI (09.11.2026): "Açıldı" iki ayrı şey olabiliyor —
                        panelden biz açtık (kim açtı kayıtlı, belgeler burada) ya da biri
                        doğrudan PTT UETS sitesinden açtı (panel yalnız durumu öğrendi,
                        belgeler burada yok). Defterdeki 95 "Açıldı" kaydının 94'ü ikinci
                        türden. Ayrımı YAZMAK gerekiyor: "açıldı" deyip geçmek, belgeleri
                        panelde arayıp bulamayan insana arıza gibi görünüyor.
                        ÖLÇÜ: okuyan_ad — İLK AÇANI tutuyor ve yalnız tebligat o ana
                        kadar açılmamışken yazılıyor (uets-ac-isle). Daha sonra "Belgeleri
                        getir" denirse DEĞİŞMİYOR, çünkü ikinci indirme yeni bir açma
                        değil. acilma_isteyen_ad'a bakmak yanlış olurdu: o alan düğmeye
                        son basanla doluyor, PTT'den açılmış bir tebligatta bile. */}
                    {t.durum === "read" && (
                      <div className="mt-0.5 text-[11px] text-gray-500">
                        {t.okuyan_ad
                          ? <>panelden · {t.okuyan_ad}</>
                          : <span title="Bu tebligat panel dışında, doğrudan PTT UETS sitesinden açılmış. Belgeleri panele getirmek için 'Belgeleri getir' düğmesini kullanabilirsiniz.">
                              PTT UETS sitesinden
                            </span>}
                      </div>
                    )}
                    {t.indirme_hatasi && (
                      <span className="ml-2 text-xs text-red-700" title={t.indirme_hatasi}>· ek inmedi</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {/* "OKUDU" DEMİYORUZ (09.11.2026 düzeltmesi): burada "X tarafından
                        … okundu" yazıyordu, ama bu YANLIŞ BİR İDDİAYDI. Alan
                        (okuyan_ad) açma İSTEĞİNİ veren kişiyle doldruluyor
                        (uets-ac-isle.mjs: okuyan_ad = acilma_isteyen_ad); indirmeyi
                        ofisteki görev yapıyor, çoğu zaman saatler sonra. Kişi düğmeye
                        bastı diye belgeyi okumuş olmuyor — bugün tam bu oldu, istek
                        08:03'te verildi, indirme 11:41'de yapıldı.
                        Doğrusu: tebligat UETS'te açılmış sayılır (hukuken okunmuş),
                        açılmasını isteyen de bu kişidir. İkisi ayrı cümle. */}
                    {t.okuyan_ad && (
                      <div className="text-[11px] text-gray-500"
                        title="Açma isteğini bu kişi verdi; indirmeyi ofisteki görev yaptı. UETS'te indirmek hukuken okumak sayılır — bu kişinin belgeyi okuduğu anlamına gelmez.">
                        {t.okuyan_ad} isteğiyle açıldı · {gunSaat(t.okuma_tarihi)}
                      </div>
                    )}
                    {/* Paketten çıkan belgeler. Bağlantı dosyaUrl()'den geçer: kovalar
                        özel, doğrudan adrese gidilirse 400 döner. */}
                    {(t.ekler ?? []).length > 0 ? (
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {(t.ekler ?? []).map((e) => (
                          <a key={e.yol} href={dosyaUrl(e.yol)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-[#1E3A5F] hover:underline">
                            <FileText size={12} /> {e.ad}
                          </a>
                        ))}
                        {t.paket_yolu && (
                          <a href={dosyaUrl(t.paket_yolu)} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:underline"
                            title="İmzalı EYP paketinin aslı">
                            <Download size={11} /> EYP paketi
                          </a>
                        )}
                      </div>
                    ) : t.paket_yolu ? (
                      <a href={dosyaUrl(t.paket_yolu)} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-[#1E3A5F] hover:underline">
                        <Download size={12} /> EYP paketi
                      </a>
                    ) : t.acilma_durumu === "bekliyor" || t.acilma_durumu === "islemde" ? (
                      // İstek ofisteki görevde sırada. Kullanıcı neyi beklediğini bilsin.
                      //
                      // SONSUZA KADAR DÖNMEZ (09.11.2026): "Aç ve oku"ya basılan bir istek
                      // 3,5 saat "sırada…" yazıp döndü, çünkü onu işleyecek zamanlanmış
                      // görev hiç kurulmamıştı. Dönen çark "çalışıyor" diye okunuyor ve
                      // kimse bakmıyor; tebligatta süre 5 gün, asılı kalan istek gün
                      // kaybettirir. Makul süreyi aşarsa çark durur ve UYARIYA döner.
                      // Eşik 20 dk: işleyici 5 dakikada bir dönüyor, 4 turu kaçırmışsa
                      // ortada geçici bir gecikme değil arıza vardır.
                      (() => {
                        const gecenDk = t.acilma_istegi_at
                          ? Math.floor((Date.now() - new Date(t.acilma_istegi_at).getTime()) / 60000)
                          : 0;
                        if (gecenDk >= 20) {
                          return (
                            <span className="inline-flex flex-col items-start gap-0.5 text-xs text-red-700"
                              title="İndirmeyi ofisteki zamanlanmış görev yapıyor. Bu kadar beklemiş bir istek, görevin çalışmadığını gösterir.">
                              <span className="inline-flex items-center gap-1 font-medium">
                                <AlertTriangle size={12} /> {gecenDk} dakikadır beklemede
                              </span>
                              <span className="text-[11px] font-normal text-red-600">
                                ofisteki açma görevi çalışmıyor olabilir
                              </span>
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
                            <Loader2 size={12} className="animate-spin" />
                            {t.acilma_durumu === "islemde" ? "indiriliyor…" : "sırada…"}
                            {t.acilma_isteyen_ad && <span className="text-gray-400">({t.acilma_isteyen_ad})</span>}
                          </span>
                        );
                      })()
                    ) : (
                      acabilir ? (
                      <div className="flex flex-col items-start gap-1">
                        {/* Önceki deneme hata verdiyse SESSİZ GEÇİLMEZ: sebebi burada yazar. */}
                        {t.acilma_hatasi && (
                          <span className="text-[11px] text-red-700" title={t.acilma_hatasi}>
                            açılamadı: {t.acilma_hatasi.slice(0, 60)}
                          </span>
                        )}
                        <button type="button" disabled={aciliyor === t.id} onClick={() => ac(t)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#1E3A5F] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#162c47] disabled:opacity-60">
                          {aciliyor === t.id ? <Loader2 size={12} className="animate-spin" /> : <Scale size={12} />}
                          {/* ZATEN AÇILMIŞSA "BELGELERİ GETİR" (09.11.2026): defterdeki
                              95 kaydın 94'ünde durum "read" ama paket bizde yok — biri
                              PTT sitesinden açmış, panel yalnız durumu öğrenmiş. O
                              satırlarda düğme tebligatı AÇMIYOR, sadece belgeleri
                              indiriyor. İkisine de "Aç ve oku" demek, geri alınamaz bir
                              işlemle zararsız bir indirmeyi aynı gösteriyordu. */}
                          {t.acilma_hatasi ? "Tekrar dene" : (acikMi(t) ? "Belgeleri getir" : "Aç ve oku")}
                        </button>
                      </div>
                      ) : (
                        <span className="text-xs text-gray-400">Açılmadı</span>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
            {!yukleniyor && liste.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-500">
                {suzgec === "acilmamis" ? "Açılmamış tebligat yok." : "Henüz tebligat yok."}
              </td></tr>
            )}
            {yukleniyor && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-500">Yükleniyor…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Tebligatlar UETS&apos;ten iki saatte bir otomatik çekilir. <b>Açma işlemi otomatik
        yapılmaz</b> — UETS&apos;te tebligatı indirmek onu açmak sayıldığı için (taahhütname
        md. 7), açma kararı size bırakılmıştır. <b>Aç ve oku</b> düğmesi tebligatı indirir,
        belgeleri buraya çıkarır ve <b>kimin açtığını kaydeder</b>; işlem geri alınamaz.
        İndirme ofisteki sunucudan yapılır (UETS yalnız kayıtlı IP&apos;den çalışıyor),
        bu yüzden belgeler birkaç dakika içinde görünür.
      </p>

      {/* VERGİ DAİRESİ TEBLİGATI AYNI EKRANDA, AMA AYRI TABLODA.
          Aynı ekranda: kullanıcı "tebligatım var mı" sorusunu tek yerde sorsun.
          Ayrı tabloda: yukarıdaki satırların hepsi PTT UETS'ten gelen ve panelden
          açılabilen tebligatlar; aşağıdakiler GİB'in KETSİS'inden gelen ve yalnız
          Dijital Vergi Dairesi'nde okunabilen bildirimler. İkisini tek listeye
          karıştırmak "niye bu açılmıyor" sorusunu doğurur. */}
      <KetsisTablosu />
    </div>
  );
}
