// İŞÇİLİK TAKİBİ — İŞ BİLGİ KARTI (sicil bilgileri)
//
// Sicil numarası, sözleşme/ek sözleşme bedeli, fiyat farkı, işçilik oranı, yatacak-yatan-kalan
// prim, teslim tarihi ve süre. TEK YERDE durur çünkü iki ekran gösteriyor:
//   • İşçilik Takibi detay sayfası (/dashboard/iscilik-takibi/<id>)
//   • Bordro Takibi'nde karta sağ tık → "Sicil Bilgileri" penceresi
// Süre alanının şantiyeye yansıması (ana süre + uzatımlar + bitim tarihleri) buradaki
// tek kopyadan yürür; ayrı yazılsaydı iki ekran farklı tarih hesaplardı.
"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { upsertIscilikTakibi } from "@/lib/supabase/queries/iscilik-takibi";
import { updateSantiye } from "@/lib/supabase/queries/santiyeler";
import type { IscilikTakibiWithSantiye } from "@/lib/supabase/types";
import { sgkBicimle } from "@/lib/sgk-sicil";
import { NetsimRozet, netsimKaynakli } from "@/components/shared/netsim-rozet";
import { Pencil } from "lucide-react";
import toast from "react-hot-toast";

export function formatPara(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function formatTarih(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d + (d.length === 10 ? "T00:00:00" : ""));
  return `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.${dt.getFullYear()}`;
}

// Değer kutusu: tüm satırlarda aynı genişlik + sağa yaslı rakam → sütun hâlinde hizalı.
// tabular-nums: rakamlar eşit genişlikte, binlik ayraçları alt alta oturur.
const DEGER_KUTU = "inline-flex min-w-[9.5rem] items-center justify-end px-2 py-1 text-right text-xs tabular-nums";

export default function IscilikBilgiKarti({
  takip, sonHakedis, toplamYatan, tahminiBordro, yDuzenle, onTakipDegisti,
}: {
  takip: IscilikTakibiWithSantiye;
  /** Netsim son hakediş (tahmini fiyat farkı oranı buradan çıkar). */
  sonHakedis?: { kesif: number; fark: number; tarih: string | null };
  /** Aylık satırların yüklenici + alt yüklenici toplamı. */
  toplamYatan: number;
  /** Henüz girilmemiş aylar için bordro tahmini (atama günü × günlük/brüt ücret).
   *  Verilmezse satır çıkmaz ve KALAN hesabına girmez. */
  tahminiBordro?: number;
  yDuzenle: boolean;
  /** Bir alan kaydedilince güncel kaydı geri verir — çağıran ekranını tazeler. */
  onTakipDegisti: (yeni: IscilikTakibiWithSantiye) => void;
}) {
  const [editingHeader, setEditingHeader] = useState<string | null>(null);
  const [headerEditValue, setHeaderEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingHeader && inputRef.current) inputRef.current.focus(); }, [editingHeader]);

  const setTakip = (f: (p: IscilikTakibiWithSantiye) => IscilikTakibiWithSantiye) => onTakipDegisti(f(takip));

  /**
   * DEĞİŞTİRİLEBİLİR DEĞER. Hafif gri zemin + ince iç çerçeve: alan bir giriş kutusu
   * gibi okunur, ama satırı yormaz. Kalem simgesi yalnız üzerine gelince belirir —
   * sürekli durduğunda altı satır üst üste "kalem kalem" görünüyordu.
   * Hesaplanan satırlar (yatacak prim, kalan, bitiş tarihi) düz metin kalır.
   */
  function Tiklanabilir({ onAc, children }: { onAc: () => void; children: React.ReactNode }) {
    if (!yDuzenle) return <span className={`${DEGER_KUTU} font-semibold`}>{children}</span>;
    return (
      <button type="button" onClick={onAc}
        title="Değiştirmek için tıklayın"
        className={`group ${DEGER_KUTU} font-semibold text-[#1E3A5F] rounded-md bg-gray-50 ring-1 ring-inset ring-gray-200 transition-colors hover:bg-white hover:text-[#F97316] hover:ring-[#F97316] focus-visible:bg-white focus-visible:ring-[#F97316] focus-visible:outline-none`}>
        {/* Kalem SOLDA (mr-auto): sağda dursaydı rakamı içeri iter, kutular arasında
            sağ kenar kayardı. Yalnız üzerine gelince belirir. */}
        <Pencil size={10} className="mr-auto shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        {children}
      </button>
    );
  }

  /** Satır: etiket solda, değer sağda sabit yuvada, rozet değerin DIŞINDA. */
  function Satir({ etiket, deger, netsim = false, netsimRozet, vurgu = "", etiketSinif = "text-gray-500" }: {
    etiket: string; deger: React.ReactNode; netsim?: boolean;
    /** Farklı açıklamalı rozet gerekiyorsa (ör. hesaplanan ama oranı Netsim'den gelen tutar). */
    netsimRozet?: React.ReactNode;
    vurgu?: string; etiketSinif?: string;
  }) {
    return (
      <div className={`flex items-center justify-between gap-2 border-b border-gray-100 py-1 ${vurgu}`}>
        <span className={`text-xs font-medium ${etiketSinif}`}>{etiket}</span>
        <span className="flex items-center">
          {deger}
          {/* ROZET YUVASI sabit genişlikte: rozeti olan ve olmayan satırların
              rakamları aynı dikey hizada kalsın. */}
          <span className="flex w-4 shrink-0 justify-center">{netsimRozet ?? (netsim && <NetsimRozet />)}</span>
        </span>
      </div>
    );
  }

  const sozlesmeBedeli = takip.santiyeler?.sozlesme_bedeli ?? 0;
  const kesifArtisi = takip.kesif_artisi ?? 0;
  const fiyatFarki = takip.fiyat_farki ?? 0;
  const iscilikOrani = takip.iscilik_orani ?? 0;
  // Kalan keşfin alacağı tahmini fiyat farkı — İşçilik Durum Raporu, Bordro kartı ve
  // geçici kabul kontrolüyle AYNI formül, dört ekran aynı rakamı göstersin diye.
  const kalanKesif = sozlesmeBedeli + kesifArtisi - (takip.santiyeler?.sozlesme_fiyatlariyla_gerceklesen ?? 0);
  const tahminiFiyatFarki = sonHakedis && sonHakedis.kesif > 0 && sonHakedis.fark > 0 && kalanKesif > 0
    ? kalanKesif * (sonHakedis.fark / sonHakedis.kesif)
    : 0;
  // Yatacak Toplam Prim = (Sözleşme Bedeli + Ek Sözleşme Bedeli + Fiyat Farkı + Tahmini Fiyat Farkı) × İşçilik Oranı / 100
  const yatacakToplamPrim = (sozlesmeBedeli + kesifArtisi + fiyatFarki + tahminiFiyatFarki) * iscilikOrani / 100;
  // KALAN = yatacak − yatan − TAHMİNİ BORDRO. Bordro kartındaki "sonuç" rakamıyla aynı
  // formül: girilmemiş ayların beklenen primi de hesaba katılır, yoksa iki ekran farklı
  // rakam gösteriyordu (Bilecik'te −1.675.282,09 kartta, −1.611.424,09 pencerede).
  // Tahmin verilmeyen ekranlarda (detay sayfası) 0 sayılır → davranış değişmez.
  const kalanPrim = yatacakToplamPrim - toplamYatan - (tahminiBordro ?? 0);

  // NETSİM ROZETİ: değer, senkronun en son yazdığı gölge alanla birebir aynıysa çıkar
  // (bkz. components/shared/netsim-rozet). "Bu rakama kimse elle dokunmadı" demektir.
  const gerceklesen = takip.santiyeler?.sozlesme_fiyatlariyla_gerceklesen ?? null;
  const ffNetsim = netsimKaynakli(takip.fiyat_farki, takip.netsim_fiyat_farki);
  const gerceklesenNetsim = netsimKaynakli(gerceklesen, takip.santiyeler?.netsim_gerceklesen);

  async function saveHeaderEdit() {
    if (!editingHeader) return;
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    // Metin alanları (sicil_no) için raw string, para alanları için parse et
    const metinAlanlari = new Set(["sicil_no"]);
    let value: string | number | null;
    if (metinAlanlari.has(editingHeader)) {
      value = headerEditValue.trim() || null;
    } else {
      const cleaned = headerEditValue.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      value = cleaned ? parseFloat(cleaned) : null;
    }
    try {
      await upsertIscilikTakibi(takip.santiye_id, { [editingHeader]: value });
      setTakip((p) => ({ ...p, [editingHeader]: value }) as IscilikTakibiWithSantiye);
    } catch (err) {
      console.error("Header güncelleme hatası:", err);
      toast.error(`Güncelleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    }
    setEditingHeader(null);
  }

  function headerField(label: string, field: string, value: number | null, editable = true, netsim = false) {
    const isEd = editingHeader === field;
    // Yetki: yDuzenle yoksa düzenleme tamamen kapalı
    const duzenlenebilir = editable && yDuzenle;
    return (
      <Satir etiket={label} netsim={netsim} deger={
        isEd ? (
          <Input ref={inputRef} value={headerEditValue}
            onChange={(e) => setHeaderEditValue(e.target.value)}
            onBlur={saveHeaderEdit}
            onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
            className="h-7 min-w-[9.5rem] text-xs text-right" />
        ) : duzenlenebilir ? (
          <Tiklanabilir onAc={() => { setEditingHeader(field); setHeaderEditValue(value != null ? formatPara(value) : ""); }}>
            {value != null ? formatPara(value) : "—"}
          </Tiklanabilir>
        ) : (
          <span className={`${DEGER_KUTU} font-semibold`}>{value != null ? formatPara(value) : "—"}</span>
        )
      } />
    );
  }

  return (
    <>
          {/* İşin Adı */}
          <div className="border-b border-gray-200 pb-3 mb-3">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">İşin Adı</span>
            <h2 className="text-lg font-bold text-[#1E3A5F]">{takip.santiyeler?.is_adi ?? "—"}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 md:gap-y-0">
            {/* Sol: sözleşmeden gelen tutarlar ve oran */}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Sözleşme ve oran
              </div>
              {/* Sicil Numarası — metin, düzenlenebilir */}
              <Satir etiket="Sicil Numarası" deger={
                editingHeader === "sicil_no" ? (
                  <Input ref={inputRef} value={headerEditValue}
                    onChange={(e) => setHeaderEditValue(e.target.value)}
                    onBlur={saveHeaderEdit}
                    onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
                    className="h-7 min-w-[9.5rem] text-xs text-right" />
                ) : (
                  <Tiklanabilir onAc={() => { setEditingHeader("sicil_no"); setHeaderEditValue(takip.sicil_no ?? ""); }}>
                    {/* Bitişik girilmiş numara mevzuattaki bölümlere ayrılarak gösterilir;
                        kayıttaki değere dokunulmaz. */}
                    {sgkBicimle(takip.sicil_no) || "—"}
                  </Tiklanabilir>
                )
              } />
              <Satir etiket="Sözleşme Bedeli" deger={
                <span className={`${DEGER_KUTU} font-semibold`}>{formatPara(sozlesmeBedeli)}</span>} />
              {headerField("Ek Sözleşme Bedeli", "kesif_artisi", takip.kesif_artisi, true)}
              {headerField("Fiyat Farkı", "fiyat_farki", takip.fiyat_farki, true, ffNetsim)}
              {/* TAMAMLANAN KEŞİF: elle girilmez, Netsim senkronu yazar. Tahmini fiyat
                  farkının tabanı bu olduğu için burada görünmesi hesabı okunur kılıyor
                  (kalan keşif = sözleşme + ek sözleşme − tamamlanan). */}
              {gerceklesen != null && gerceklesen > 0 && (
                <Satir etiket="Tamamlanan Keşif" netsim={gerceklesenNetsim} etiketSinif="text-gray-400" deger={
                  <span className={`${DEGER_KUTU} font-semibold text-gray-400`}>{formatPara(gerceklesen)}</span>} />
              )}
              {tahminiFiyatFarki > 0 && (
                <div title={`Kalan keşif: ${formatPara(kalanKesif)}
Oran: %${((sonHakedis!.fark / sonHakedis!.kesif) * 100).toFixed(2)} (Netsim'deki son hakediş)`}>
                  {/* Hesaplanan bir tutar ama ORANI Netsim'in son hakedişinden geliyor. */}
                  <Satir etiket="Tahmini Fiyat Farkı" etiketSinif="text-gray-400"
                    netsimRozet={<NetsimRozet hesaplanan title="Netsim'den GELMEZ, burada hesaplanır: kalan keşif × (Netsim'deki son hakedişin fiyat farkı ÷ keşif bedeli). İçi boş rozet = Netsim verisiyle hesaplandı." />}
                    deger={<span className={`${DEGER_KUTU} font-semibold text-gray-400`}>{formatPara(tahminiFiyatFarki)}</span>} />
                </div>
              )}
              {headerField("İşçilik Oranı %", "iscilik_orani", takip.iscilik_orani, true)}
            </div>

            {/* Sağ: prim durumu ve takvim */}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Prim durumu ve süre
              </div>
              {/* YATACAK → YATAN → KALAN sırası: hedef, ödenen, açık. Yatacak tutar
                  eskiden sol sütunun en altındaydı, karşılaştırması gözle yapılamıyordu. */}
              <Satir etiket="Yatacak Toplam Prim" vurgu="bg-[#F1F5F9] px-1 rounded" deger={
                <span className={`${DEGER_KUTU} font-bold text-[#1E3A5F]`}>{formatPara(yatacakToplamPrim)}</span>} />
              <Satir etiket="Yatan" vurgu="bg-green-50 px-1 rounded" deger={
                <span className={`${DEGER_KUTU} font-bold text-green-700`}>{formatPara(toplamYatan)}</span>} />
              {/* TAHMİNİ BORDRO: veri girilmemiş aylar için beklenen prim. KALAN'dan
                  düşülür — Bordro kartındaki sonuç rakamıyla aynı formül. */}
              {tahminiBordro != null && tahminiBordro > 0 && (
                <Satir etiket="Tahmini Bordro" etiketSinif="text-gray-400" deger={
                  <span className={`${DEGER_KUTU} font-semibold text-gray-400`}
                    title="Veri girilmemiş aylar için bordro tahmini: atama günü × günlük/brüt ücret. Kalan tutardan düşülmüştür.">
                    {formatPara(tahminiBordro)}
                  </span>} />
              )}
              <Satir etiket="Kalan" vurgu="bg-red-50 px-1 rounded" deger={
                <span className={`${DEGER_KUTU} font-bold text-red-700`}>{formatPara(kalanPrim)}</span>} />
              {/* İş Yeri Teslim Tarihi - elle */}
              {(() => {
                const isEdBas = editingHeader === "baslangic_tarihi";
                return (
                  <Satir etiket="İş Yeri Teslim Tarihi" deger={
                    isEdBas ? (
                      <Input ref={inputRef} type="date" value={headerEditValue}
                        onChange={(e) => setHeaderEditValue(e.target.value)}
                        onBlur={async () => {
                          if (!yDuzenle) { setEditingHeader(null); return; }
                          try {
                            const yeniDeger = headerEditValue || null;
                            await upsertIscilikTakibi(takip.santiye_id, { baslangic_tarihi: yeniDeger });
                            // SYNC: santiyeler tablosuna da yansıt (isyeri_teslim_tarihi)
                            try {
                              await updateSantiye(takip.santiye_id, { isyeri_teslim_tarihi: yeniDeger });
                            } catch (e) { console.warn("santiye sync hatası:", e); }
                            setTakip((p) => p ? { ...p, baslangic_tarihi: yeniDeger } : p);
                          } catch { toast.error("Güncelleme hatası."); }
                          setEditingHeader(null);
                        }}
                        onKeyDown={(e) => e.key === "Escape" && setEditingHeader(null)}
                        className="h-7 min-w-[9.5rem] text-xs text-right" />
                    ) : (
                      <Tiklanabilir onAc={() => { setEditingHeader("baslangic_tarihi"); setHeaderEditValue(takip.baslangic_tarihi ?? ""); }}>
                        {takip.baslangic_tarihi ? formatTarih(takip.baslangic_tarihi) : "—"}
                      </Tiklanabilir>
                    )
                  } />
                );
              })()}
              {/* Süre - + ile toplama */}
              {(() => {
                const isEdSure = editingHeader === "sure_text";
                const sureText = takip.sure_text ?? "";
                const sureToplam = sureText ? sureText.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0) : 0;
                return (
                  <Satir etiket="Süre" deger={
                    isEdSure ? (
                      <Input ref={inputRef} value={headerEditValue} placeholder="100 + 200 + 300"
                        onChange={(e) => setHeaderEditValue(e.target.value)}
                        onBlur={async () => {
                          if (!yDuzenle) { setEditingHeader(null); return; }
                          try {
                            const yeniDeger = headerEditValue || null;
                            await upsertIscilikTakibi(takip.santiye_id, { sure_text: yeniDeger });
                            // SYNC → şantiye: "420 + 27 + 45" biçiminde İLK sayı ana iş süresi,
                            // KALANLAR süre uzatımlarıdır. Böylece buraya "+27" eklemek, İş Deneyim
                            // ekranındaki "Süre Uzatımı" alanına da 27 olarak işlenir.
                            // (Eskiden tüm parçaların TOPLAMI is_suresi'ne yazılıyordu → uzatım
                            //  ana süreye gömülüyor, şantiyedeki uzatım alanı boş kalıyordu.)
                            const parcalar = yeniDeger
                              ? yeniDeger.split("+").map((s) => parseInt(s.trim()) || 0).filter((n) => n > 0)
                              : [];
                            const anaSure = parcalar.length > 0 ? parcalar[0] : null;
                            const uzatimlar = parcalar.slice(1);
                            const toplamUzatim = uzatimlar.reduce((t, n) => t + n, 0);
                            // Tarihler şantiye formundaki formülle BİREBİR aynı hesaplanır:
                            //   iş bitim      = işyeri teslim + ana süre
                            //   uzatımlı tarih = iş bitim + toplam uzatım
                            const gunEkle = (tarih: string, gun: number) => {
                              const d = new Date(tarih); d.setDate(d.getDate() + gun);
                              return d.toISOString().split("T")[0];
                            };
                            const teslim = takip.baslangic_tarihi;
                            const isBitim = teslim && anaSure ? gunEkle(teslim, anaSure) : null;
                            try {
                              await updateSantiye(takip.santiye_id, {
                                is_suresi: anaSure,
                                sure_uzatimlari: uzatimlar,
                                sure_uzatimi: toplamUzatim > 0 ? toplamUzatim : null,
                                is_bitim_tarihi: isBitim,
                                sure_uzatimli_tarih: isBitim && toplamUzatim > 0 ? gunEkle(isBitim, toplamUzatim) : null,
                              });
                            } catch (e) { console.warn("santiye sync hatası:", e); }
                            setTakip((p) => p ? { ...p, sure_text: yeniDeger } : p);
                          } catch { toast.error("Güncelleme hatası."); }
                          setEditingHeader(null);
                        }}
                        onKeyDown={(e) => e.key === "Escape" && setEditingHeader(null)}
                        className="h-7 min-w-[9.5rem] text-xs text-right" />
                    ) : (
                      <Tiklanabilir onAc={() => { setEditingHeader("sure_text"); setHeaderEditValue(sureText); }}>
                        {sureText ? `${sureText} = ${sureToplam} gün` : "—"}
                      </Tiklanabilir>
                    )
                  } />
                );
              })()}
              {/* Bitiş Tarihi = Başlangıç + Süre toplamı - 1 gün (başlangıç günü dahil) */}
              {(() => {
                const sureText = takip.sure_text ?? "";
                const sureToplam = sureText ? sureText.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0) : 0;
                let bitisTarihi: string | null = null;
                if (takip.baslangic_tarihi && sureToplam > 0) {
                  const d = new Date(takip.baslangic_tarihi);
                  d.setDate(d.getDate() + sureToplam - 1);
                  bitisTarihi = d.toISOString().split("T")[0];
                }
                return (
                  <Satir etiket="Bitiş Tarihi" deger={
                    <span className={`${DEGER_KUTU} font-semibold`}>{bitisTarihi ? formatTarih(bitisTarihi) : "—"}</span>} />
                );
              })()}
            </div>
          </div>
    </>
  );
}
