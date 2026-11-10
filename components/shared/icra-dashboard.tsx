// Dashboard İcra Takibi widget'ı — İCRAYA CEVABI VERİLMEMİŞ (İcraya Cevap Tarihi boş) dosyaları listeler.
// "Cevap" sütunundaki "Cevabı işle" butonu icra düzenleme formunu açar: cevap tarihi,
// cevap şekli, evrak no ve ödenen tutar birlikte girilir. Cevap tarihi dolunca satır düşer.
// SÜRE: tebliğ tarihinden itibaren 7 gün içinde cevap verilmeli. Cevap yoksa 6. günden itibaren (son 2 gün:
// 6. ve 7. gün ve sonrası) satır KIRMIZI vurgulanır (süre doluyor uyarısı).
"use client";

import { useEffect, useMemo, useState } from "react";
import { Gavel, Check } from "lucide-react";
import { useAuth } from "@/hooks";
import {
  getIcraKayitlar, getIcraBorcluBaglamlari, icraBorcluAnahtar,
  type IcraBorcluBaglam,
} from "@/lib/supabase/queries/icra";
import type { IcraKayit } from "@/lib/supabase/types";
import { createClient } from "@/lib/supabase/client";
import { sonGunHesapla, gunFarki, bugunISO, hatirlatmaZamaniMi, VARSAYILAN_CEVAP_SURESI } from "@/lib/utils/icra-sure";
// YAZIM BİÇİMİ: borçlu kişi adı TÜMÜ BÜYÜK (defterde öne çıksın), alacaklı ünvanı
// Başlık Biçimi. Kayıt değişmiyor, yalnız gösterim — veritabanında ne yazıldıysa o duruyor.
import { formatBaslik, formatBuyukHarf } from "@/lib/utils/isim";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import IcraCevapDialog from "@/components/shared/icra-cevap-dialog";
import { MuhasebeIkon } from "@/components/shared/muhasebe-gosterim";

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");
// Tebliğ tarihinden bugüne kaç TAM gün geçti (null = tarih yok/geçersiz). 7 günlük cevap süresi bundan sayılır.
// SÜRE BELGEDEN OKUNUR, BU SABİT YALNIZ YEDEKTİR (09.11.2026).
// Elimizdeki 25 tebligat belgesinin 18'inde süre açıkça yazıyor ve hepsinde 7 gün —
// yani sabit doğruydu. Yine de belgeden okunanı kullanmak gerekiyor: görmediğimiz bir
// türde farklı süre çıkarsa sabit yanlış tarih gösterir ve insan ona güvenir.
// Belge okunmamış eski kayıtlarda (cevap_suresi_gun boş) bu sabite düşülüyor.
/** Son 2 gün kırmızı: 7 günlük sürede 6. günden itibaren. */

export default function IcraDashboard() {
  const { isYonetici, hasPermission } = useAuth();
  const canDuzenle = isYonetici || hasPermission("icra", "duzenle");
  const [satirlar, setSatirlar] = useState<IcraKayit[]>([]);
  const [loading, setLoading] = useState(true);
  // Borçlu kendi personelimizse: hangi şantiyede ve o şantiyenin firması hangi renk.
  // Satırın solundaki renk şeridi buradan gelir.
  const [baglamlar, setBaglamlar] = useState<Map<string, IcraBorcluBaglam>>(new Map());
  // ÜÇÜNCÜ ŞAHIS FİRMASININ RENGİ — satırın solundaki şerit.
  // Eskiden şerit BORÇLUNUN çalıştığı şantiyenin firma rengiydi; borçlu personelimiz
  // değilse ya da aktif ataması yoksa şerit hiç çizilmiyordu, yani çoğu satır renksizdi.
  // Üçüncü şahıs (hangi firmamıza geldiği) her satırda dolu ve "Şirkete Açılan
  // Takipler" kartındaki şeritle aynı dili konuşuyor. Şantiye bilgisi kaybolmadı:
  // alttaki şantiye satırı kendi renk noktasını zaten taşıyor.
  const [renkler, setRenkler] = useState<Map<string, string>>(new Map());
  // SAYFA DEĞİŞMEDEN CEVAP: düğme eskiden icra sayfasına gidiyordu, ana sayfa
  // kapanıyordu. Artık pencere burada açılıyor ve kayıt sonrası satır listeden düşüyor.
  const [cevapKayit, setCevapKayit] = useState<IcraKayit | null>(null);

  useEffect(() => {
    let iptal = false;
    createClient().from("firmalar").select("firma_adi, renk").then(({ data }) => {
      if (iptal) return;
      const m = new Map<string, string>();
      for (const f of (data ?? []) as { firma_adi: string | null; renk: string | null }[]) {
        const ad = (f.firma_adi ?? "").trim().toLocaleUpperCase("tr");
        if (ad && f.renk) m.set(ad, f.renk);
      }
      setRenkler(m);
    }, () => { /* renk yoksa şeritsiz devam */ });
    return () => { iptal = true; };
  }, []);
  const firmaRengi = (ad: string | null) => renkler.get((ad ?? "").trim().toLocaleUpperCase("tr")) ?? null;

  useEffect(() => {
    let iptal = false;
    getIcraKayitlar()
      .then((r) => { if (!iptal) setSatirlar(r); })
      .catch(() => { /* tablo yoksa sessiz */ })
      .finally(() => { if (!iptal) setLoading(false); });
    return () => { iptal = true; };
  }, []);

  // Yalnız EKRANDA görünen borçlular için bağlam çekilir (genelde 1-5 satır).
  useEffect(() => {
    const bek = satirlar.filter((s) => !(s.cevap_tarihi ?? "").trim());
    if (bek.length === 0) { setBaglamlar(new Map()); return; }
    let iptal = false;
    getIcraBorcluBaglamlari(bek.map((s) => ({ tc: s.borclu_tc_no, ad: s.borclu_adi })))
      .then((m) => { if (!iptal) setBaglamlar(m); })
      .catch(() => { /* bağlam yoksa renksiz devam */ });
    return () => { iptal = true; };
  }, [satirlar]);

  const bekleyen = useMemo(
    () => satirlar
      .filter((s) => !(s.cevap_tarihi ?? "").trim())
      // EN SON GELEN EN ÜSTTE: panelin her yerinde liste böyle sıralı, kullanıcı
      // yeni gelen dosyayı listenin dibinde aramak zorunda kalmasın. (Süresi en
      // çok dolmuş olan kırmızı "… gün geçti" yazısıyla zaten ayırt ediliyor.)
      // Tebliğ yoksa gelen yazı tarihine düşülür.
      .sort((a, b) => (b.teblig_tarihi ?? b.gelen_yazi_tarihi ?? "").localeCompare(a.teblig_tarihi ?? a.gelen_yazi_tarihi ?? "")),
    [satirlar],
  );

  return (
    // KART KENDİ BOYUNU DOLDURUR (09.11.2026): bu kart komşularıyla (Kasa, Eksik
    // Evrak) aynı yüksekliğe geriliyor, ama içindeki liste 220px'de sabitti ve altta
    // boş alan kalıyordu — ekranda yer varken yalnız 2,5 satır görünüyordu.
    // flex sütun + liste flex-1: liste kartın kalan boyunu alır, kart uzadıkça daha
    // çok satır görünür. Sabit yükseklik yok, çünkü komşuların boyu içeriğe göre
    // değişiyor ve hangisinin uzun olacağı önceden bilinmiyor.
    <div className="bg-white rounded-lg border p-3 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 pb-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Gavel size={16} className="text-red-600" />
          <div>
            <h3 className="font-bold text-xs text-red-600 flex items-center gap-1.5">
              İcra — Cevap Bekleyen
              {bekleyen.length > 0 && <span className="bg-red-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">{bekleyen.length}</span>}
            </h3>
            <p className="text-[10px] text-gray-400">İcraya cevabı verilmemiş dosyalar</p>
          </div>
        </div>
        <a href="/dashboard/icra" className="text-[11px] text-blue-600 hover:underline">Tümü →</a>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse">Yükleniyor...</p>
      ) : bekleyen.length === 0 ? (
        <p className="text-sm text-gray-400">Cevap bekleyen icra dosyası yok</p>
      ) : (
        /* LİSTE KUTUYU UZATMAZ, KUTUYU DOLDURUR (09.11.2026).
           Önce "flex-1 + overflow-auto" denendi: liste kendi içeriği kadar yer istedi
           ve ÜÇ KARTI birden 355px'den 622px'e çıkardı — ölçüldü. Kullanıcı kutunun
           uzamasını istemiyor, listenin kutunun dibine inmesini istiyor.
           Çözüm: iç liste MUTLAK konumlu. Mutlak konumlu öğe üst öğenin yüksekliğine
           katkı vermez, yani kart kendi içeriğiyle uzamaz; ama inset-0 ile kartın
           komşularından aldığı boyun TAMAMINI kaplar ve taşan kısım scroll olur.
           min-h-[220px] taban: komşular kısa kalırsa liste iğne gibi incelmesin. */
        <div className="relative flex-1 min-h-[220px]">
          <div className="absolute inset-0 overflow-y-auto">
          <Table noWrapper className="text-xs text-gray-900">
            <TableHeader><TableRow className="bg-white">
              <TableHead className="px-2 text-[10px]">Borçlu / Alacaklı</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Tebliğ Tarihi</TableHead>
              {/* TEBLİĞDEN SONRAKİ İLK ADIM MUHASEBE: yazı ona gidiyor, cevap
                  şeklini onun bildirimi belirliyor. İki işaret: gitti mi, geldi mi. */}
              <TableHead className="px-2 text-[10px] text-center">Muhasebe</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Son Cevap Günü</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Cevap</TableHead>
              <TableHead className="px-2 text-[10px] text-right">Borç</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bekleyen.map((s) => {
                // Süre: belgede yazan. Yoksa varsayılan (yukarıdaki nota bak).
                const sure = s.cevap_suresi_gun ?? VARSAYILAN_CEVAP_SURESI;
                const belgedenMi = s.cevap_suresi_gun != null;
                const sonCevapGunu = sonGunHesapla(s.teblig_tarihi, sure);
                const kalan = sonCevapGunu ? gunFarki(bugunISO(), sonCevapGunu) : null;
                // RENK ANA SAYFADAKİ UYARIYLA AYNI KURAL: süre doluyorsa sarı,
                // geçtiyse kırmızı, daha vakit varsa renksiz. Sarının başladığı gün
                // hafta sonuna denk gelirse CUMAYA çekilir (hatirlatmaZamaniMi) —
                // cumartesi çıkan sarı uyarıya elden bir şey gelmiyor. Eskiden
                // bütün satırlar kırmızıydı; hepsi kırmızı olunca hiçbiri ayırt edilmiyordu.
                const gecti = kalan != null && kalan < 0;
                const yaklasti = !gecti && hatirlatmaZamaniMi(sonCevapGunu);
                const baglam = baglamlar.get(icraBorcluAnahtar(s.borclu_tc_no, s.borclu_adi));
                return (
                <TableRow key={s.id} className={gecti ? "bg-red-100 hover:bg-red-200"
                  : yaklasti ? "bg-amber-100 hover:bg-amber-200" : "hover:bg-gray-50"}>
                  {/* SOL ŞERİT: yazının geldiği ÜÇÜNCÜ ŞAHIS firmasının rengi
                      (yukarıdaki nota bakın). Hücre kenarlığı değil, "Eksik Evrak"
                      kartındaki ince dikey çubuğun aynısı — panelde firma rengi her
                      yerde bu biçimde gösteriliyor. */}
                  <TableCell className="px-2 py-1">
                    <div className="flex items-stretch gap-2">
                    <span className="inline-block w-1 self-stretch rounded-full flex-shrink-0"
                      style={{ backgroundColor: firmaRengi(s.ucuncu_sahis) ?? "#e5e7eb", minHeight: "1.25rem" }}
                      title={s.ucuncu_sahis ? `Üçüncü şahıs: ${s.ucuncu_sahis}` : "Firma rengi tanımlı değil"} />
                    <div className="min-w-0">
                    {/* ETİKET AYRI SATIRDA DEĞİL, BAŞINDA: "Borçlu" ve "Alacaklı" kendi
                        satırlarındayken her kayıt dört satır yer kaplıyordu; yan yana
                        yazılınca ikiye indi ve kutuya daha çok dosya sığıyor. */}
                    <div className={`truncate max-w-[180px] ${gecti ? "text-red-700" : yaklasti ? "text-amber-800" : "text-[#1E3A5F]"}`} title={s.borclu_adi ?? ""}>
                      <span className="text-[9px] text-gray-400">Borçlu: </span>
                      <span className="font-medium">{formatBuyukHarf(s.borclu_adi) || "—"}</span>
                    </div>
                    {s.alacakli_adi && (
                      <div className="truncate max-w-[180px] text-gray-700" title={s.alacakli_adi}>
                        <span className="text-[9px] text-gray-400">Alacaklı: </span>
                        <span className="font-medium">{formatBaslik(s.alacakli_adi)}</span>
                      </div>
                    )}
                    {baglam?.santiyeAd && (
                      <div className="mt-1 flex items-center gap-1 text-[9px] text-gray-500 truncate max-w-[150px]"
                        title={`${baglam.santiyeAd}${baglam.firmaKisa ? ` · ${baglam.firmaKisa}` : ""}`}>
                        {baglam.firmaRenk && (
                          <span className="inline-block h-1.5 w-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: baglam.firmaRenk }} />
                        )}
                        <span className="truncate">{baglam.santiyeAd}</span>
                      </div>
                    )}
                    </div>
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-1 text-center whitespace-nowrap text-gray-600">{tarihGoster(s.teblig_tarihi)}</TableCell>
                  <TableCell className="px-2 py-1 text-center whitespace-nowrap">
                    <MuhasebeIkon kayit={s} sirket={false} />
                  </TableCell>
                  {/* SON CEVAP GÜNÜ + KALAN GÜN — ödeme emri kartındaki sütunun eşi.
                      Önce bu bilgi ilk hücrede uzun bir cümleydi ("Tebliğden 1817. gün ·
                      7 günlük süre doldu"); sütun olunca iki kart aynı yerden okunuyor
                      ve tarihin kendisi de görünüyor. */}
                  <TableCell className="px-2 py-1 text-center whitespace-nowrap">
                    {sonCevapGunu ? (
                      <>
                        <div className={gecti ? "text-red-700 font-semibold" : yaklasti ? "text-amber-700 font-semibold" : "text-gray-600"}>
                          {tarihGoster(sonCevapGunu)}
                        </div>
                        <div className={`text-[9px] ${gecti ? "text-red-600 font-semibold" : yaklasti ? "text-amber-700" : "text-gray-400"}`}
                          title={belgedenMi
                            ? `Süre tebligat belgesinde yazıyor: ${sure} gün.`
                            : `Belge okunmadığı için varsayılan ${sure} gün kullanılıyor; gerçek süre belgede yazar.`}>
                          {gecti ? `⚠ ${-kalan!} gün geçti` : kalan === 0 ? "⚠ bugün son gün" : `${kalan} gün kaldı`}
                          {!belgedenMi && <span className="font-normal"> (varsayılan)</span>}
                        </div>
                      </>
                    ) : (
                      <span className="text-gray-400" title="Tebliğ tarihi yok — gün hesaplanamıyor">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-center">
                    {/* DÜĞME ADI "Tarih gir" DEĞİL (09.11.2026): açtığı form yalnız tarih
                        istemiyor — cevap tarihi, cevap şekli, evrak no ve ödenen tutar
                        birlikte giriliyor. "Tarih gir" yazınca insan sadece tarih
                        girilecek sanıyor ve formun kalanını boş bırakıyordu. */}
                    {canDuzenle ? (
                      <button type="button" onClick={() => setCevapKayit(s)}
                        title="Cevap tarihi, cevap şekli, evrak no ve ödenen tutarı girmek için formu açar"
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 hover:bg-red-100">
                        <Check size={11} /> Cevabı işle
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-2 py-1 text-right tabular-nums text-red-600">{fmt(Number(s.borc_miktari || 0))}</TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      <IcraCevapDialog
        kayit={cevapKayit} acik={!!cevapKayit} kapat={() => setCevapKayit(null)}
        kaydedildi={(yama) => setSatirlar((p) => p.map((x) => (x.id === cevapKayit?.id ? { ...x, ...yama } : x)))}
      />
    </div>
  );
}
