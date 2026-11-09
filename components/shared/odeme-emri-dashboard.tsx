// Dashboard — ŞİRKETE AÇILAN TAKİPLER widget'ı. Durumu hâlâ "yeni" olan, yani henüz
// hiç ele alınmamış ödeme emirlerini listeler.
//
// NİYE AYRI KART: İcra kartı (icra-dashboard) "üçüncü şahıs" dosyalarını gösteriyor —
// borçlu bir başkası, şirket işveren sıfatıyla cevap veriyor. Burada rol TERS:
// BORÇLU ŞİRKETİN KENDİSİ. Aynı kartta göstermek, şirketten para istenmesini rutin
// bir maaş haczi gibi gösterirdi.
//
// NİYE TAM GENİŞLİK: bu kaydın icra kartından fazla alanı var (icra dairesi, dosya no,
// son itiraz günü) ve üçlü satıra dördüncü kart olarak sıkıştırılınca hepsi kırpılıyordu.
//
// SON İTİRAZ GÜNÜ UYDURULMAZ: tebliğ + belgede YAZAN süre. Belgede süre yoksa gün de
// gösterilmez ("belgede yok" yazar). Varsayılan bir süreye düşmek, insanın güvendiği
// bir tarihi uydurmak olurdu — İcra kartındaki varsayılan yalnız ESKİ kayıtlar için
// var, bu defter en baştan belgeden doluyor.
"use client";

import { useEffect, useMemo, useState } from "react";
import { Scale, Check } from "lucide-react";
import { useAuth } from "@/hooks";
import { getIcraSirketTakipler } from "@/lib/supabase/queries/icra-sirket";
import { createClient } from "@/lib/supabase/client";
import type { IcraSirketTakip } from "@/lib/supabase/types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import OdemeEmriIslemDialog from "@/components/shared/odeme-emri-islem-dialog";
import { sonGunHesapla, gunFarki, bugunISO, hatirlatmaZamaniMi } from "@/lib/utils/icra-sure";
import { formatBaslik } from "@/lib/utils/isim";

const fmt = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const tarihGoster = (v: string | null) => (v ? v.split("-").reverse().join(".") : "—");
// Ünvanlar çok uzun ("ICA İÇTAŞ ALTYAPI YAVUZ SULTAN SELİM KÖPRÜSÜ VE KUZEY ÇEVRE
// OTOYOLU YATIRIM VE İŞLETME ANONİM ŞİRKETİ"). CSS kırpması sütunun genişliğine göre
// değişiyordu; sabit sınır daha dengeli duruyor. Tamamı title'da (üstüne gelince).
const KISALT = 30;
const kisalt = (v: string | null) => {
  // Biçim ÖNCE uygulanır, kırpma sonra: önce kırpsaydık "…" içeren metin
  // biçimlendiriciye girer ve son sözcük yarım büyük harfle kalırdı.
  const t = formatBaslik(v).trim();
  return t.length > KISALT ? t.slice(0, KISALT).trimEnd() + "…" : t;
};

/**
 * "dosya no · icra dairesi" — 50 karakterde kırpılır.
 * NİYE: Niğde dosyasında daire adı barkod numarasıyla birlikte geliyor
 * ("Niğde İcra Dairesi-4005390295742-0-2022/2072") ve satır kartı aşıp altta
 * sağ-sol kaydırma çubuğu çıkarıyordu. Tamamı title'da (üstüne gelince).
 */
const DOSYA_KISALT = 50;
const dosyaKisalt = (dosya: string | null, daire: string | null) => {
  const t = [dosya, daire].filter(Boolean).join(" · ");
  return t.length > DOSYA_KISALT ? t.slice(0, DOSYA_KISALT).trimEnd() + "…" : t;
};

/** Son itiraz günü (ISO) — tebliğ + belgede yazan süre. Süre yoksa null. */
const sonGun = (s: IcraSirketTakip) => sonGunHesapla(s.teblig_tarihi, s.itiraz_suresi_gun);
/** Son güne kaç gün kaldı? Negatif = geçti. Süre bilinmiyorsa null. */
function kalanGun(s: IcraSirketTakip): number | null {
  const g = sonGun(s);
  return g ? gunFarki(bugunISO(), g) : null;
}

export default function OdemeEmriDashboard() {
  const { isYonetici, hasPermission } = useAuth();
  const canDuzenle = isYonetici || hasPermission("icra", "duzenle");
  const [satirlar, setSatirlar] = useState<IcraSirketTakip[]>([]);
  const [loading, setLoading] = useState(true);
  // Borçlu firmanın tanımlı rengi. BORÇLU FİRMA SÜTUNU YERİNE RENK: ünvanlar uzun
  // ("Kad-Tem Müh. Müt. İnş. Oto. Turz. Tic. Ve San. A.Ş.") ve dar sütunda hepsi aynı
  // yere kadar kırpılıp ayırt edilemiyordu. Renk şeridi aynı bilgiyi yer kaplamadan
  // veriyor; firma adı yine title'da (üstüne gelince) okunuyor.
  const [renkler, setRenkler] = useState<Map<string, string>>(new Map());
  // SAYFA DEĞİŞMEDEN İŞLE: düğme eskiden icra sayfasına gidiyordu (bkz. icra kartı).
  const [islemKayit, setIslemKayit] = useState<IcraSirketTakip | null>(null);

  useEffect(() => {
    let iptal = false;
    getIcraSirketTakipler()
      .then((r) => { if (!iptal) setSatirlar(r); })
      .catch(() => { /* tablo yoksa sessiz — kart "yok" der, ana sayfa çalışmaya devam eder */ })
      .finally(() => { if (!iptal) setLoading(false); });
    createClient().from("firmalar").select("firma_adi, renk")
      .then(({ data }) => {
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

  // "Yeni" = henüz hiçbir şey yapılmamış. Avukata verilen / itiraz edilen / ödenen
  // dosya burada görünmez: iş görülmüştür, kart her gün aynı şeyi bağırmasın.
  const bekleyen = useMemo(
    () => satirlar.filter((s) => s.durum === "yeni")
      // EN YENİ ÜSTTE (tebliğ tarihine göre). Önce "en acil üste" (süresi en çok
      // dolmuş önce) denendi; kullanıcı en yenisini üstte istiyor — defterlerin
      // tamamında sıralama böyle ve ekranlar arasında aynı olması gerekiyor.
      // Süre uyarısı zaten satırın kendisinde kırmızı duruyor, sıralamaya gerek yok.
      .sort((a, b) => (b.teblig_tarihi ?? "").localeCompare(a.teblig_tarihi ?? "")
        || (b.dosya_esas_no ?? "").localeCompare(a.dosya_esas_no ?? "", "tr")),
    [satirlar],
  );
  const toplam = useMemo(() => bekleyen.reduce((t, s) => t + Number(s.takip_tutari || 0), 0), [bekleyen]);

  if (!loading && bekleyen.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-3 flex flex-col h-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale size={16} className="text-[#1E3A5F]" />
            <h3 className="font-bold text-xs text-[#1E3A5F]">Şirkete Açılan Takipler</h3>
          </div>
          <a href="/dashboard/icra?sekme=sirket" className="text-[11px] text-blue-600 hover:underline">Tümü →</a>
        </div>
        <p className="text-sm text-gray-400 mt-2">Ele alınmamış ödeme emri yok</p>
      </div>
    );
  }

  return (
    // KOMŞUSUYLA AYNI BOYDA: İcra kartıyla yan yana duruyor ve ikisinin aynı yerde
    // bitmesi isteniyor. Yapı da onunkiyle birebir — flex sütun + mutlak konumlu iç
    // liste. Mutlak öğe üst öğenin boyuna katkı vermediği için kart kendi içeriğiyle
    // uzamaz; satırdan aldığı boyun tamamını kaplar, taşan kısım scroll olur.
    <div className="bg-white rounded-lg border border-red-300 p-3 flex flex-col h-full">
      <div className="flex items-center justify-between mb-2 pb-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Scale size={16} className="text-red-600" />
          <div>
            <h3 className="font-bold text-xs text-red-600 flex items-center gap-1.5">
              Şirkete Açılan Takipler — Ele Alınmamış
              {bekleyen.length > 0 && <span className="bg-red-600 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5">{bekleyen.length}</span>}
            </h3>
            <p className="text-[10px] text-gray-400">
              Borçlu şirketin kendisi — ödeme emirleri. İtiraz süresi tebliğden işler.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {toplam > 0 && <span className="text-[11px] font-semibold text-red-600 tabular-nums">₺{fmt(toplam)}</span>}
          <a href="/dashboard/icra?sekme=sirket" className="text-[11px] text-blue-600 hover:underline">Tümü →</a>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 animate-pulse">Yükleniyor...</p>
      ) : (
        <div className="relative flex-1 min-h-[220px]">
          {/* YATAY ÇUBUĞU GİZLEMİYORUZ: overflow-x-hidden dar pencerede en sağdaki
              Takip Tutarı sütununu görünmez yapıyor. Çubuğun sebebi uzun daire adıydı
              (barkodla birlikte geliyor); o 50 karakterde kesiliyor. */}
          <div className="absolute inset-0 overflow-y-auto">
          <Table noWrapper className="text-xs text-gray-900">
            <TableHeader><TableRow className="bg-white">
              <TableHead className="px-2 text-[10px]">Alacaklı / Dosya</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Tebliğ</TableHead>
              <TableHead className="px-2 text-[10px] text-center">Son İtiraz Günü</TableHead>
              <TableHead className="px-2 text-[10px] text-center">İşlem</TableHead>
              <TableHead className="px-2 text-[10px] text-right">Takip Tutarı</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {bekleyen.map((s) => {
                const kalan = kalanGun(s);
                const gecti = kalan != null && kalan < 0;
                // RENK İCRA KARTIYLA AYNI KURAL: sarı, son günden bir gün önce
                // başlar ve o gün hafta sonuna denk gelirse CUMAYA çekilir.
                // "2 gün kala" gibi ayrı bir eşik iki kartı farklı davrandırıyordu.
                const yaklasti = !gecti && hatirlatmaZamaniMi(sonGun(s));
                return (
                  <TableRow key={s.id} className={gecti ? "bg-red-100 hover:bg-red-200"
                    : yaklasti ? "bg-amber-100 hover:bg-amber-200" : "hover:bg-gray-50"}>
                    {/* SOL ŞERİT: borçlu firmanın tanımlı rengi. Hücre kenarlığı değil,
                        "Eksik Evrak" kartındaki ince dikey çubuğun aynısı — panelde
                        firma rengi her yerde bu biçimde gösteriliyor. */}
                    <TableCell className="px-2 py-1">
                      <div className="flex items-stretch gap-2">
                        <span className="inline-block w-1 self-stretch rounded-full flex-shrink-0"
                          style={{ backgroundColor: firmaRengi(s.borclu_firma) ?? "#e5e7eb", minHeight: "1.25rem" }}
                          title={s.borclu_firma ? `Borçlu firma: ${s.borclu_firma}` : "Firma rengi tanımlı değil"} />
                        <div className="min-w-0">
                          {/* Etiket başında — İcra kartıyla aynı, satır yüksekliği düşük. */}
                          <div className={`whitespace-nowrap ${gecti ? "text-red-700" : yaklasti ? "text-amber-800" : "text-[#1E3A5F]"}`}
                            title={s.alacakli_adi ?? ""}>
                            <span className="text-[9px] text-gray-400">Alacaklı: </span>
                            <span className="font-medium">{kisalt(s.alacakli_adi) || "—"}</span>
                          </div>
                          {/* İKİNCİ SATIR İCRA KARTIYLA AYNI BİÇİMDE: orada
                              "Alacaklı: …" satırı normal punto, burada dosya satırı
                              10px'ti; iki kart yan yana duruyor ve satır yükseklikleri
                              tutmuyordu (38px / 41px). Etiket başta, metin normal punto. */}
                          <div className="text-gray-700 whitespace-nowrap"
                            title={`${s.icra_dairesi ?? ""} · ${s.dosya_esas_no ?? ""}`}>
                            <span className="text-[9px] text-gray-400">Dosya: </span>
                            <span className="font-medium">{dosyaKisalt(s.dosya_esas_no, s.icra_dairesi)}</span>
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1 text-center whitespace-nowrap text-gray-600">{tarihGoster(s.teblig_tarihi)}</TableCell>
                    <TableCell className="px-2 py-1 text-center whitespace-nowrap">
                      {kalan == null ? (
                        <span className="text-gray-400" title="Belgede itiraz süresi yazmıyor — gün uydurulmadı">belgede yok</span>
                      ) : (
                        <>
                          <div className={gecti ? "text-red-700 font-semibold" : yaklasti ? "text-amber-700 font-semibold" : "text-gray-600"}>
                            {tarihGoster(sonGun(s))}
                          </div>
                          <div className={`text-[9px] ${gecti ? "text-red-600 font-semibold" : yaklasti ? "text-amber-700" : "text-gray-400"}`}
                            title={`Süre tebligat belgesinde yazıyor: ${s.itiraz_suresi_gun} gün.`}>
                            {gecti ? `⚠ ${-kalan} gün geçti` : kalan === 0 ? "⚠ bugün son gün" : `${kalan} gün kaldı`}
                          </div>
                        </>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-center">
                      {canDuzenle ? (
                        <button type="button"
                          onClick={() => setIslemKayit(s)}
                          // DÜĞME ADI "CEVABI İŞLE" — İCRA KARTIYLA AYNI (09.11.2026 kullanıcı isteği).
                          // Önce "Dosyayı işle" yazılmıştı: buradaki form cevap değil
                          // itiraz/ödeme/durum istiyor. Kullanıcı iki kartta aynı sözcüğü
                          // yeğledi; title alanı formun gerçekte ne istediğini söylüyor.
                          title="İtiraz, ödeme ve durum bilgilerini girmek için formu açar"
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 hover:bg-red-100">
                          <Check size={11} /> Cevabı işle
                        </button>
                      ) : (
                        <span className="text-[11px] text-gray-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-2 py-1 text-right tabular-nums text-red-600 whitespace-nowrap">{fmt(Number(s.takip_tutari || 0))}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        </div>
      )}

      <OdemeEmriIslemDialog
        kayit={islemKayit} acik={!!islemKayit} kapat={() => setIslemKayit(null)}
        kaydedildi={(yama) => setSatirlar((p) => p.map((x) => (x.id === islemKayit?.id ? { ...x, ...yama } : x)))}
      />
    </div>
  );
}
