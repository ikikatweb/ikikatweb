// SİCİL BİLGİLERİ PENCERESİ — Bordro Takibi'nde karta sağ tık → "Sicil Bilgileri".
//
// İşçilik Takibi detay sayfasındaki bilgi kartının AYNISI (IscilikBilgiKarti), ama
// pencerede: kullanıcı bordro listesinden kopmadan sicil numarasını, bedelleri, işçilik
// oranını ve süreyi görüp düzeltebilsin. Aylık prim satırları burada YOK — onlar detay
// sayfasında; pencerenin altındaki bağlantı oraya götürür.
//
// Veriyi kendisi çeker (açıldığında, iş başına bir kez): Bordro Takibi ham işçilik
// kayıtlarını saklamıyor, yalnız hesaplanmış özetini tutuyor.
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getIscilikTakibi, getSonHakedisMap } from "@/lib/supabase/queries/iscilik-takibi";
import { getAylikVeriler } from "@/lib/supabase/queries/iscilik-aylik";
import type { IscilikTakibiWithSantiye } from "@/lib/supabase/types";
import IscilikBilgiKarti, { gerceklesmeOraniHesapla, formatYuzde } from "@/components/shared/iscilik-bilgi-karti";
import { FileText, ExternalLink } from "lucide-react";
import { NetsimRozet } from "@/components/shared/netsim-rozet";

type Props = {
  /** Açıksa şantiye; null → pencere kapalı. */
  hedef: { santiyeId: string; santiyeAd: string } | null;
  onKapat: () => void;
  yDuzenle: boolean;
  /** Bordro Takibi'nde kartta görünen bordro tahmini — aynı rakam burada da yazsın. */
  tahminiBordro?: number;
  /** Bir alan kaydedildi — çağıran listesini tazelesin. */
  onKaydedildi?: () => void;
};

export default function SicilBilgileriDialog({ hedef, onKapat, yDuzenle, tahminiBordro, onKaydedildi }: Props) {
  const [takip, setTakip] = useState<IscilikTakibiWithSantiye | null>(null);
  const [toplamYatan, setToplamYatan] = useState(0);
  const [sonHakedis, setSonHakedis] = useState<{ kesif: number; fark: number; tarih: string | null } | undefined>();
  const [durum, setDurum] = useState<"yukleniyor" | "hazir" | "kayitYok" | "hata">("yukleniyor");

  const santiyeId = hedef?.santiyeId ?? null;
  const tamamlanma = takip ? gerceklesmeOraniHesapla(takip) : null;

  const yukle = useCallback(async () => {
    if (!santiyeId) return;
    setDurum("yukleniyor");
    try {
      const [tumu, hakedisler] = await Promise.all([
        getIscilikTakibi(),
        getSonHakedisMap().catch(() => new Map<string, { kesif: number; fark: number; tarih: string | null }>()),
      ]);
      const bulunan = (tumu as IscilikTakibiWithSantiye[]).find((t) => t.santiye_id === santiyeId) ?? null;
      if (!bulunan) { setTakip(null); setDurum("kayitYok"); return; }
      setTakip(bulunan);
      setSonHakedis(hakedisler.get(santiyeId));
      // Yatan = aylık satırların yüklenici + alt yüklenici toplamı (detay sayfasıyla aynı).
      const ayliklar = await getAylikVeriler(bulunan.id).catch(() => []);
      setToplamYatan(ayliklar.reduce((t, a) => t + (a.yuklenici_tutar ?? 0) + (a.alt_yuklenici_tutar ?? 0), 0));
      setDurum("hazir");
    } catch {
      setDurum("hata");
    }
  }, [santiyeId]);

  useEffect(() => { void yukle(); }, [yukle]);

  return (
    <Dialog open={!!hedef} onOpenChange={(o) => { if (!o) onKapat(); }}>
      <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileText size={17} /> Sicil Bilgileri
          </DialogTitle>
        </DialogHeader>

        {/* İŞİN TAMAMLANMA ORANI — başlığın BİR SATIR ALTINDA, sağda: başlık satırında
            kapatma çarpısının dibine geliyordu. Tamamlanan keşif ÷ sözleşme bedeli
            (Bordro kartındaki yüzdenin aynısı). */}
        {tamamlanma != null && (
          <div className="-mt-2 flex justify-end">
            <span className="flex items-baseline gap-1.5 whitespace-nowrap"
              title="İşin tamamlanma oranı: tamamlanan keşif ÷ sözleşme bedeli (Netsim verisiyle hesaplanır).">
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">Tamamlanma</span>
              <span className="text-lg font-bold leading-none tabular-nums text-emerald-700">{formatYuzde(tamamlanma)}</span>
            </span>
          </div>
        )}

        <div className="pb-1">
          {durum !== "hazir" && (
            <div className="mb-3 border-b border-gray-200 pb-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400">İşin Adı</span>
              <h2 className="text-base font-bold leading-snug text-[#1E3A5F]">{hedef?.santiyeAd ?? "—"}</h2>
            </div>
          )}
          {durum === "yukleniyor" && <p className="py-6 text-center text-sm text-gray-400">Bilgiler yükleniyor…</p>}
          {durum === "hata" && <p className="py-6 text-center text-sm text-red-600">Bilgiler okunamadı. Pencereyi kapatıp yeniden deneyin.</p>}
          {durum === "kayitYok" && (
            <p className="py-6 text-center text-sm text-gray-500">
              Bu işin işçilik takibi kaydı yok — sicil bilgisi girilebilmesi için önce
              İşçilik Takibi sayfasından eklenmeli.
            </p>
          )}

          {durum === "hazir" && takip && (
            <>
              {/* Bilgi kartı detay sayfasıyla ORTAK bileşen: alanlar, kaydetme ve süre
                  uzatımı hesabı iki ekranda birebir aynı çalışır. */}
              <IscilikBilgiKarti
                takip={takip}
                sonHakedis={sonHakedis}
                toplamYatan={toplamYatan}
                tahminiBordro={tahminiBordro}
                yDuzenle={yDuzenle}
                onTakipDegisti={(y) => { setTakip(y); onKaydedildi?.(); }}
              />
              <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
                <span className="text-[11px] text-gray-400">
                  {yDuzenle
                    ? "Gri zeminli alanlar elle girilir — değiştirmek için tıklayın. Diğerleri hesaplanır."
                    : "Düzenleme yetkiniz yok."}
                  <span className="ml-2 inline-flex items-center gap-1">
                    <NetsimRozet /> Netsim&apos;den geldi
                  </span>
                  <span className="ml-2 inline-flex items-center gap-1">
                    <NetsimRozet hesaplanan /> Netsim verisiyle hesaplandı
                  </span>
                </span>
                <Link href={`/dashboard/iscilik-takibi/${takip.id}`}
                  className="flex items-center gap-1 text-xs font-medium text-[#1E3A5F] hover:text-[#F97316]">
                  Aylık prim satırları <ExternalLink size={13} />
                </Link>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
