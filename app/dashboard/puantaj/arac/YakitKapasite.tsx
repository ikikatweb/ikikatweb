// ARAÇ PUANTAJ → YAKIT KAPASİTESİ SEKMESİ
//
// "Bu mesafeyi tek depoyla gidemez" tespiti: iki dolum arasındaki sayaç farkı aracın
// 1 depo kapasitesini aşıyorsa arada ya kayda geçmemiş bir dolum vardır ya da sayaç
// yanlış girilmiştir. Hesabın tamamı lib/supabase/queries/yakit-kapasite.ts başındadır.
//
// Düzen: firma → araç iki kademeli akordiyon. Araç satırına tıklanınca altında o aracın
// rakamları ve kapasiteyi aşan dolum aralıkları açılır.
"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Fuel, AlertTriangle, Check, Info } from "lucide-react";
import SantiyeSelect from "@/components/shared/santiye-select";
import { useOturumFiltresi } from "@/hooks";
import {
  getYakitKapasiteAnalizi,
  TOLERANS_ORAN,
  type KapasiteSatiri,
} from "@/lib/supabase/queries/yakit-kapasite";

const TOLERANS_YUZDE = Math.round(TOLERANS_ORAN * 100);

const FIRMA_RENK = ["#1E3A5F", "#7C3AED", "#DC2626", "#059669", "#EA580C", "#0891B2", "#BE185D", "#65A30D"];

const sayi = (n: number | null | undefined, hane = 2) =>
  n == null ? "—" : n.toLocaleString("tr-TR", { minimumFractionDigits: hane, maximumFractionDigits: hane });
const tamsayi = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("tr-TR"));
const trTarih = (d: string) => d.split("-").reverse().join(".");
// Çalışma günü yarım günlerle kesirli olabilir: 15 → "15", 15,5 → "15,5"
const gunSayisi = (n: number) =>
  n % 1 === 0 ? n.toLocaleString("tr-TR") : n.toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

type SantiyeItem = { id: string; is_adi: string; durum?: string };

export default function YakitKapasite({
  santiyeId: varsayilanSantiye,
  santiyeler,
}: {
  santiyeId: string;
  santiyeler: SantiyeItem[];
}) {
  // Sekmenin KENDİ şantiye seçimi — puantaj sekmesindeki seçimle başlar, sonra bağımsız.
  // Boş = tüm şantiyeler.
  const [santiyeId, setSantiyeId] = useState(varsayilanSantiye);
  const [satirlar, setSatirlar] = useState<KapasiteSatiri[]>([]);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [acikFirma, setAcikFirma] = useState<Set<string>>(new Set());
  const [acikArac, setAcikArac] = useState<string | null>(null);
  const [sadeceAsim, setSadeceAsim] = useState(true);
  // Cins süzgeci — çoklu seçim. Sekme değişse de oturum boyunca korunur.
  // Varsayılan olarak BİNEK kapalı: çoğu akaryakıt kartıyla besleniyor, depo kaydı
  // eksik olduğu için hesap anlamsız çıkıyor. Kullanıcı isterse açabilir.
  const [kapaliCinsler, setKapaliCinsler] = useOturumFiltresi<string[]>(
    "puantaj-arac:kapasite-kapali-cins", ["Binek"],
  );

  const yukle = useCallback(async () => {
    if (!santiyeId) { setSatirlar([]); return; }
    setYukleniyor(true);
    setHata(null);
    try {
      setSatirlar(await getYakitKapasiteAnalizi(santiyeId));
    } catch (e) {
      setHata(e instanceof Error ? e.message : "Veriler alınamadı.");
    } finally {
      setYukleniyor(false);
    }
  }, [santiyeId]);

  useEffect(() => { void yukle(); }, [yukle]);

  // Şantiye seçimi her durumda görünür — "tüm şantiyeler" de geçerli bir seçim.
  const secici = (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1 min-w-[240px] flex-1 max-w-md">
        <label className="block text-[10px] text-gray-400">
          Şantiye <span className="text-gray-300">(aracın orada çalıştığı dönem denetlenir)</span>
        </label>
        <SantiyeSelect
          santiyeler={santiyeler}
          value={santiyeId}
          onChange={setSantiyeId}
          showAll
          placeholder="Tüm şantiyeler"
          className="w-full border border-gray-300 rounded-md h-9 text-sm px-2"
        />
      </div>
    </div>
  );

  if (yukleniyor) {
    return (
      <div className="space-y-3">
        {secici}
        <div className="space-y-2 py-2">
          {[...Array(5)].map((_, i) => <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }
  if (hata) {
    return (
      <div className="space-y-3">
        {secici}
        <div className="border border-red-200 bg-red-50 rounded-lg p-4 text-sm text-red-700">{hata}</div>
      </div>
    );
  }

  // Cins listesi süzgeçten ÖNCEKİ tam listeden çıkar — kapatılan cins de çipte kalsın.
  const cinsAdet = new Map<string, number>();
  for (const s of satirlar) cinsAdet.set(s.cinsi, (cinsAdet.get(s.cinsi) ?? 0) + 1);
  const cinsler = [...cinsAdet.keys()].sort((a, b) => a.localeCompare(b, "tr"));
  const kapali = new Set(kapaliCinsler);

  const secili = satirlar.filter((s) => !kapali.has(s.cinsi));
  const asimliAraclar = secili.filter((s) => s.asimlar.length > 0);
  const gosterilecek = sadeceAsim ? asimliAraclar : secili;
  const hesaplanamayan = secili.filter((s) => s.kapasite == null).length;
  const toplamAsim = secili.reduce((t, s) => t + s.asimlar.length, 0);

  const cinsToggle = (c: string) =>
    setKapaliCinsler((onceki) => (onceki.includes(c) ? onceki.filter((x) => x !== c) : [...onceki, c]));

  const firmalar = new Map<string, KapasiteSatiri[]>();
  for (const s of gosterilecek) {
    if (!firmalar.has(s.firmaAdi)) firmalar.set(s.firmaAdi, []);
    firmalar.get(s.firmaAdi)!.push(s);
  }
  const firmaListe = [...firmalar.entries()].sort((a, b) => {
    const aA = a[1].filter((x) => x.asimlar.length > 0).length;
    const bA = b[1].filter((x) => x.asimlar.length > 0).length;
    return bA - aA || a[0].localeCompare(b[0], "tr");
  });

  return (
    <div className="space-y-3">
      {secici}

      {/* Cins süzgeci — çoklu seçim. Kapalı cinsler listeye hiç girmez. */}
      {cinsler.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] text-gray-400 mr-0.5">Cins:</span>
          {cinsler.map((c) => {
            const acik = !kapali.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={acik}
                onClick={() => cinsToggle(c)}
                className={`text-[11px] px-2 py-0.5 rounded-full border font-medium transition-colors ${
                  acik
                    ? "bg-[#1E3A5F] border-[#1E3A5F] text-white"
                    : "bg-white border-gray-300 text-gray-400 line-through hover:border-[#1E3A5F]"
                }`}
                title={acik ? "Listeden çıkar" : "Listeye ekle"}
              >
                {c}
                <span className={`ml-1 font-normal ${acik ? "text-white/60" : "text-gray-300"}`}>
                  {cinsAdet.get(c)}
                </span>
              </button>
            );
          })}
          {kapaliCinsler.length > 0 && (
            <button
              type="button"
              onClick={() => setKapaliCinsler([])}
              className="text-[11px] px-2 py-0.5 rounded-full border border-gray-300 bg-white text-gray-600 hover:border-[#1E3A5F] font-medium"
            >
              Tümünü göster
            </button>
          )}
        </div>
      )}

      {/* Özet + süzgeç */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Fuel size={16} className="text-[#1E3A5F]" />
          <span><span className="font-semibold text-[#1E3A5F]">{satirlar.length}</span> <span className="text-gray-500">araç incelendi</span></span>
          {asimliAraclar.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5 text-xs font-semibold">
              <AlertTriangle size={12} /> {asimliAraclar.length} araçta {toplamAsim} aralık kapasiteyi aşıyor
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5 text-xs font-semibold">
              <Check size={12} /> Kapasiteyi aşan aralık yok
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSadeceAsim((v) => !v)}
          className={`ml-auto text-xs px-2.5 py-1 rounded border font-medium ${
            sadeceAsim ? "bg-red-600 border-red-600 text-white" : "bg-white border-gray-300 text-gray-600 hover:border-red-400"
          }`}
        >
          {sadeceAsim ? "Sadece uyarı verenler" : "Tüm araçlar"}
        </button>
      </div>

      {hesaplanamayan > 0 && (
        <div className="flex items-start gap-2 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded p-2">
          <Info size={13} className="mt-0.5 flex-shrink-0 text-gray-400" />
          <span>
            {hesaplanamayan} araç için kapasite hesaplanamadı — sayaç değeri girilmiş en az iki dolum gerekiyor.
            Araç formundaki <strong>1 depo menzili</strong> doldurulursa hesaba gerek kalmadan o kullanılır.
          </span>
        </div>
      )}

      {firmaListe.length === 0 ? (
        <p className="text-sm text-gray-500 py-8 text-center">
          {sadeceAsim
            ? "Kapasitesini aşan araç yok."
            : santiyeId ? "Bu şantiyede puantajı olan araç yok." : "İncelenecek araç bulunamadı."}
        </p>
      ) : (
        <div className="space-y-2">
          {firmaListe.map(([firma, araclar], fi) => {
            const renk = FIRMA_RENK[fi % FIRMA_RENK.length];
            const acik = acikFirma.has(firma);
            const firmaAsim = araclar.reduce((t, x) => t + x.asimlar.length, 0);
            return (
              <div key={firma} className="rounded-lg overflow-hidden border border-gray-200">
                <button
                  type="button"
                  onClick={() => setAcikFirma((p) => {
                    const n = new Set(p);
                    if (n.has(firma)) n.delete(firma); else n.add(firma);
                    return n;
                  })}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-white"
                  style={{ backgroundColor: renk }}
                >
                  {acik ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
                  <span className="font-bold text-sm truncate">{firma}</span>
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {firmaAsim > 0 && (
                      <span className="text-[11px] bg-white text-red-700 px-2 py-0.5 rounded-full font-bold">
                        {firmaAsim} uyarı
                      </span>
                    )}
                    <span className="text-[11px] bg-white/20 backdrop-blur px-2 py-0.5 rounded-full font-semibold">
                      {araclar.length} araç
                    </span>
                  </span>
                </button>

                {acik && (
                  <div className="bg-gray-50 border-t divide-y divide-gray-200">
                    {araclar.map((s) => {
                      const aracAcik = acikArac === s.aracId;
                      const birim = s.sayacTipi === "saat" ? "saat" : "km";
                      return (
                        <div key={s.aracId}>
                          {/* ARAÇ SATIRI — tıklayınca aşağı açılır */}
                          <button
                            type="button"
                            onClick={() => setAcikArac(aracAcik ? null : s.aracId)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white transition-colors"
                          >
                            {aracAcik ? <ChevronDown size={14} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-400 flex-shrink-0" />}
                            <span className="min-w-0 flex-1">
                              <span className="block font-bold text-xs text-[#1E3A5F] truncate">{s.plaka}</span>
                              <span className="block text-[10px] text-gray-500 truncate">{s.ad || "—"} · {s.cinsi}</span>
                            </span>
                            <span className="hidden sm:block text-[10px] text-gray-500 font-mono text-right flex-shrink-0 leading-tight">
                              <span className="block">{sayi(s.genelOrt)} {birim === "saat" ? "L/saat" : "L/100km"}</span>
                              <span className="block">1 depo ≈ {s.kapasite == null ? "—" : `${tamsayi(s.kapasite)} ${birim}`}</span>
                            </span>
                            {s.asimlar.length > 0 ? (
                              <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded font-bold flex-shrink-0 whitespace-nowrap">
                                {s.asimlar.length} uyarı · en büyüğü +{tamsayi(s.enBuyukAsim)} {birim}
                              </span>
                            ) : s.kapasite == null ? (
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-semibold flex-shrink-0 whitespace-nowrap">
                                hesaplanamadı
                              </span>
                            ) : (
                              <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-semibold flex-shrink-0 whitespace-nowrap">
                                uygun
                              </span>
                            )}
                          </button>

                          {/* AÇILAN DETAY */}
                          {aracAcik && (
                            <div className="bg-white border-t border-gray-200 px-3 py-3 space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                <Kutu
                                  etiket="Genel Ortalama"
                                  deger={`${sayi(s.genelOrt)} ${birim === "saat" ? "L/saat" : "L/100km"}`}
                                  ipucu="Dış-yakıt aralıkları hariç toplam litre ÷ toplam mesafe. Yakıt sayfasındaki değerle aynıdır."
                                />
                                <Kutu
                                  etiket="Depo Kapasitesi"
                                  deger={s.depoKapasite == null ? "—" : `${tamsayi(s.depoKapasite)} lt`}
                                  ipucu="Aracın TÜM ŞANTİYELERDEKİ dolumları içinde tek seferde aldığı en yüksek yakıt — sadece bu şantiye değil"
                                  altNot="tüm şantiyeler"
                                />
                                <Kutu
                                  etiket={`Yakıtsız Çalışma Kapasitesi`}
                                  deger={s.kapasite == null ? "—" : `${tamsayi(s.kapasite)} ${birim}`}
                                  ipucu={(s.kapasiteKaynak === "menzil"
                                    ? "Araç formundaki '1 depo menzili' alanından geliyor"
                                    : "Depo kapasitesi ÷ genel ortalama")
                                    + `. Uyarı eşiği %${TOLERANS_YUZDE} tolerans eklenmiş hâli: ${tamsayi(s.esik)} ${birim}`}
                                  altNot={s.esik == null ? undefined
                                    : `%${TOLERANS_YUZDE} tolerans → ${tamsayi(s.esik)} ${birim}`}
                                  vurgu
                                />
                                <Kutu
                                  etiket="Toplam Dolum"
                                  deger={`${tamsayi(s.dolumAdet)} kayıt`}
                                  ipucu="Aracın tüm şantiyelerdeki toplam yakıt kaydı sayısı"
                                  altNot="tüm şantiyeler"
                                />
                              </div>

                              {s.isaretliAsim > 0 && (
                                <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                                  {s.isaretliAsim} aralık kapasiteyi aşıyor ama &quot;dışarıdan yakıt alındı&quot; işaretli olduğu
                                  için uyarıya girmedi.
                                </div>
                              )}

                              {s.asimlar.length > 0 ? (
                                <div>
                                  <div className="text-[11px] font-semibold text-red-700 mb-1">
                                    Tek depoyla gidilemeyecek {s.asimlar.length} aralık
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-[11px] border-collapse">
                                      <thead>
                                        <tr className="bg-gray-100 text-gray-600">
                                          <th className="text-left px-2 py-1 font-semibold whitespace-nowrap">Dolumlar arası</th>
                                          <th className="text-right px-2 py-1 font-semibold whitespace-nowrap">Sayaç</th>
                                          <th className="text-right px-2 py-1 font-semibold whitespace-nowrap">Kapasite (+tolerans)</th>
                                          <th className="text-right px-2 py-1 font-semibold whitespace-nowrap">Yapılan</th>
                                          <th className="text-right px-2 py-1 font-semibold whitespace-nowrap">Aşım</th>
                                          <th className="text-right px-2 py-1 font-semibold whitespace-nowrap">Puantaj</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {s.asimlar.map((x) => (
                                          <tr key={x.basTarih + x.bitTarih} className="border-b border-gray-100">
                                            <td className="px-2 py-1 font-mono whitespace-nowrap">
                                              {trTarih(x.basTarih)} → {trTarih(x.bitTarih)}
                                              <span className="text-gray-400"> · {x.gun} gün</span>
                                            </td>
                                            <td className="px-2 py-1 text-right font-mono text-gray-500 whitespace-nowrap">
                                              {tamsayi(x.basSayac)} → {tamsayi(x.bitSayac)}
                                            </td>
                                            <td className="px-2 py-1 text-right font-mono text-gray-500 whitespace-nowrap">
                                              {tamsayi(s.kapasite)} {birim}
                                              <span className="text-gray-400"> → {tamsayi(s.esik)}</span>
                                            </td>
                                            <td className="px-2 py-1 text-right font-mono font-semibold whitespace-nowrap">
                                              {tamsayi(x.mesafe)} {birim}
                                            </td>
                                            <td className="px-2 py-1 text-right font-mono font-bold text-red-600 whitespace-nowrap">
                                              +{tamsayi(x.asim)}
                                              <span className="ml-1 text-[9px] font-semibold text-red-400">{sayi(x.kat, 1)}× depo</span>
                                            </td>
                                            <td className="px-2 py-1 text-right font-mono text-gray-500 whitespace-nowrap">
                                              {gunSayisi(x.calismaGun)} gün çalıştı
                                              {santiyeId && x.santiyeGun > x.calismaGun && (
                                                <span className="text-gray-400"> / {x.santiyeGun} gün şantiyede</span>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-[11px] text-gray-500">
                                  {s.kapasite == null
                                    ? "Kapasite hesaplanamadığı için karşılaştırma yapılamadı."
                                    : "Dolumlar arası mesafelerin hepsi kapasitenin altında."}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[10px] text-gray-400 leading-relaxed pt-1">
        Uyarı ölçütü: iki dolum arasındaki sayaç farkı, aracın 1 depo kapasitesini <strong>%{TOLERANS_YUZDE} toleransla</strong>
        aşıyorsa. Kapasite kesin bir sayı değil — depo kapasitesi en yüksek tek dolumdan, ortalama geçmiş
        tüketimden tahmin ediliyor; yükte/boşta ve mevsime göre tüketim bu kadar oynayabildiği için sınırda
        kalan normal aralıklar uyarıya girmesin diye pay bırakılıyor. Tablodaki &quot;Aşım&quot; sütunu tolerans
        eklenmemiş gerçek fazlalığı gösterir. Yakıt kayıtları
        <strong> tüm şantiyelerden</strong> alınır (araç başka işte doldurduysa aralık kırılır), puantaj yalnız
        seçili şantiyeden. Cins süzgeci varsayılan olarak <strong>Binek</strong> kapalı gelir — çoğu akaryakıt
        kartıyla besleniyor, depo kayıtları eksik olduğu için hesap anlamsız çıkıyor; çipe tıklayıp geri
        açabilirsiniz. Bir şantiye seçiliyse yalnız aracın <strong>o şantiyede fiilen çalıştığı</strong> aralıklar
        denetlenir; çalışma günü olmayan aralık ya araç başka işte olduğu ya da o döneme puantaj girilmediği
        için elenir, aşım bu şantiyenin hanesine yazılmaz. &quot;Tüm şantiyeler&quot;
        seçilirse pasif olmayan bütün araçların tüm aralıkları incelenir. Sayaç değeri girilmemiş dolumlar ve düzeltme kayıtları hesaba katılmaz;
        &quot;dışarıdan yakıt alındı&quot; işaretli aralıklar açıklanmış sayılır.
      </p>
    </div>
  );
}

function Kutu({ etiket, deger, ipucu, altNot, vurgu }: {
  etiket: string; deger: string; ipucu?: string; altNot?: string; vurgu?: boolean;
}) {
  return (
    <div className={`border rounded p-2 ${vurgu ? "border-[#1E3A5F]/30 bg-[#1E3A5F]/5" : "border-gray-200 bg-gray-50"}`} title={ipucu}>
      <div className="text-[10px] text-gray-500 font-medium leading-tight">{etiket}</div>
      <div className={`text-sm font-bold mt-0.5 ${vurgu ? "text-[#1E3A5F]" : "text-gray-700"}`}>{deger}</div>
      {altNot && <div className="text-[9px] text-gray-400 mt-0.5">{altNot}</div>}
    </div>
  );
}
