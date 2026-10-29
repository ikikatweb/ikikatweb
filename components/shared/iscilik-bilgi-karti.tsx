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

export default function IscilikBilgiKarti({
  takip, sonHakedis, toplamYatan, yDuzenle, onTakipDegisti,
}: {
  takip: IscilikTakibiWithSantiye;
  /** Netsim son hakediş (tahmini fiyat farkı oranı buradan çıkar). */
  sonHakedis?: { kesif: number; fark: number; tarih: string | null };
  /** Aylık satırların yüklenici + alt yüklenici toplamı. */
  toplamYatan: number;
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
   * DEĞİŞTİRİLEBİLİR DEĞER. Kesik çerçeve + kalem simgesi: hangi satırların elle
   * girildiği bakınca anlaşılsın. Hesaplanan satırlar (yatacak prim, kalan, bitiş
   * tarihi vb.) düz metin kalır — onlara tıklanmaz.
   */
  function Tiklanabilir({ onAc, children }: { onAc: () => void; children: React.ReactNode }) {
    if (!yDuzenle) return <span className="text-xs font-semibold">{children}</span>;
    return (
      <button type="button" onClick={onAc}
        title="Değiştirmek için tıklayın"
        className="group inline-flex items-center gap-1 rounded border border-dashed border-gray-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-[#1E3A5F] transition-colors hover:border-[#F97316] hover:bg-orange-50 hover:text-[#F97316]">
        {children}
        <Pencil size={10} className="shrink-0 text-gray-300 transition-colors group-hover:text-[#F97316]" />
      </button>
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
  const kalanPrim = yatacakToplamPrim - toplamYatan;

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

  function headerField(label: string, field: string, value: number | null, editable = true) {
    const isEd = editingHeader === field;
    // Yetki: yDuzenle yoksa düzenleme tamamen kapalı
    const duzenlenebilir = editable && yDuzenle;
    return (
      <div className="flex items-center justify-between py-1 border-b border-gray-100">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        {isEd ? (
          <Input ref={inputRef} value={headerEditValue}
            onChange={(e) => setHeaderEditValue(e.target.value)}
            onBlur={saveHeaderEdit}
            onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
            className="h-6 text-xs w-32 text-right" />
        ) : duzenlenebilir ? (
          <Tiklanabilir onAc={() => { setEditingHeader(field); setHeaderEditValue(value != null ? formatPara(value) : ""); }}>
            {value != null ? formatPara(value) : "—"}
          </Tiklanabilir>
        ) : (
          <span className="text-xs font-semibold">{value != null ? formatPara(value) : "—"}</span>
        )}
      </div>
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
              <div className="flex items-center justify-between py-1 border-b border-gray-100">
                <span className="text-xs text-gray-500 font-medium">Sicil Numarası</span>
                {editingHeader === "sicil_no" ? (
                  <Input ref={inputRef} value={headerEditValue}
                    onChange={(e) => setHeaderEditValue(e.target.value)}
                    onBlur={saveHeaderEdit}
                    onKeyDown={(e) => { if (e.key === "Enter") saveHeaderEdit(); if (e.key === "Escape") setEditingHeader(null); }}
                    className="h-6 text-xs w-32 text-right" />
                ) : (
                  <Tiklanabilir onAc={() => { setEditingHeader("sicil_no"); setHeaderEditValue(takip.sicil_no ?? ""); }}>
                    {/* Bitişik girilmiş numara mevzuattaki bölümlere ayrılarak gösterilir;
                        kayıttaki değere dokunulmaz. */}
                    {sgkBicimle(takip.sicil_no) || "—"}
                  </Tiklanabilir>
                )}
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100">
                <span className="text-xs text-gray-500 font-medium">Sözleşme Bedeli</span>
                <span className="text-xs font-semibold">{formatPara(sozlesmeBedeli)}</span>
              </div>
              {headerField("Ek Sözleşme Bedeli", "kesif_artisi", takip.kesif_artisi, true)}
              {headerField("Fiyat Farkı", "fiyat_farki", takip.fiyat_farki, true)}
              {tahminiFiyatFarki > 0 && (
                <div className="flex items-center justify-between py-1 border-b border-gray-100"
                  title={`Kalan keşif: ${formatPara(kalanKesif)}\nOran: %${((sonHakedis!.fark / sonHakedis!.kesif) * 100).toFixed(2)} (Netsim'deki son hakediş)`}>
                  <span className="text-xs text-gray-400 font-medium">Tahmini Fiyat Farkı</span>
                  <span className="text-xs font-semibold text-gray-400">{formatPara(tahminiFiyatFarki)}</span>
                </div>
              )}
              {headerField("İşçilik Oranı %", "iscilik_orani", takip.iscilik_orani, true)}
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-[#F1F5F9] px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Yatacak Toplam Prim</span>
                <span className="text-xs font-bold text-[#1E3A5F]">{formatPara(yatacakToplamPrim)}</span>
              </div>
            </div>

            {/* Sağ: prim durumu ve takvim */}
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Prim durumu ve süre
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-green-50 px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Yatan</span>
                <span className="text-xs font-bold text-green-700">{formatPara(toplamYatan)}</span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-gray-100 bg-red-50 px-1 rounded">
                <span className="text-xs text-gray-500 font-medium">Kalan</span>
                <span className="text-xs font-bold text-red-700">{formatPara(kalanPrim)}</span>
              </div>
              {/* İş Yeri Teslim Tarihi - elle */}
              {(() => {
                const isEdBas = editingHeader === "baslangic_tarihi";
                return (
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">İş Yeri Teslim Tarihi</span>
                    {isEdBas ? (
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
                        className="h-6 text-xs w-36" />
                    ) : (
                      <Tiklanabilir onAc={() => { setEditingHeader("baslangic_tarihi"); setHeaderEditValue(takip.baslangic_tarihi ?? ""); }}>
                        {takip.baslangic_tarihi ? formatTarih(takip.baslangic_tarihi) : "—"}
                      </Tiklanabilir>
                    )}
                  </div>
                );
              })()}
              {/* Süre - + ile toplama */}
              {(() => {
                const isEdSure = editingHeader === "sure_text";
                const sureText = takip.sure_text ?? "";
                const sureToplam = sureText ? sureText.split("+").reduce((t, s) => t + (parseInt(s.trim()) || 0), 0) : 0;
                return (
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Süre</span>
                    {isEdSure ? (
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
                        className="h-6 text-xs w-40" />
                    ) : (
                      <Tiklanabilir onAc={() => { setEditingHeader("sure_text"); setHeaderEditValue(sureText); }}>
                        {sureText ? `${sureText} = ${sureToplam} gün` : "—"}
                      </Tiklanabilir>
                    )}
                  </div>
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
                  <div className="flex items-center justify-between py-1 border-b border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Bitiş Tarihi</span>
                    <span className="text-xs font-semibold">{bitisTarihi ? formatTarih(bitisTarihi) : "—"}</span>
                  </div>
                );
              })()}
            </div>
          </div>
    </>
  );
}
