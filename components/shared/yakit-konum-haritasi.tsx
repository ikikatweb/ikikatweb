// YAKIT KAYDI KONUM HARİTASI — küçük pencerede Google Haritalar.
//
// NİYE GOOGLE: rota kalitesi. Panel içinde kendi haritamız (Leaflet + OSM)
// denendi; ikonları biz seçebiliyorduk ama rota OpenStreetMap yol ağından
// çiziliyordu ve köy/tarla yolları eksik olduğu için çizgi aracın yanına kadar
// gelmiyordu (10.11.2026: rota araçtan 550 m uzaktaki ana yoldan başladı,
// Google aynı mesafeyi aracın kapısına kadar çiziyordu). Karar: ikon önemli
// değil, DOĞRU ROTA önemli.
//
// NİYE PENCEREDE: yeni sekmede açmak paneli bırakıp gitmek demekti. Pencere
// kapanınca liste olduğu yerde duruyor.
//
// ANAHTAR GEREKTİRMEZ: klasik gömme adresi (output=embed) kullanılıyor; Google
// Cloud anahtarı ve faturalandırma istemiyor. Rota, mesafe ve süre Google'ın
// kendi hesabı — panel ayrıca bir mesafe hesaplamıyor ki iki ayrı sayı çıkmasın.
"use client";

import { MapPin, Truck, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type YakitKonumNokta = {
  konum_lat: number;
  konum_lng: number;
  konum_dogruluk_m?: number | null;
  arac_lat?: number | null;
  arac_lng?: number | null;
  arac_konum_at?: string | null;
  arac_mesafe_m?: number | null;
  plaka?: string | null;
  baslik?: string | null;
};

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace(".", ",")} km` : `${Math.round(m)} m`);

export default function YakitKonumHaritasi({ kayit, acik, kapat }: {
  kayit: YakitKonumNokta | null;
  acik: boolean;
  kapat: () => void;
}) {
  if (!kayit) return null;
  const aracVar = kayit.arac_lat != null && kayit.arac_lng != null;
  const kayitNokta = `${kayit.konum_lat},${kayit.konum_lng}`;
  const aracNokta = `${kayit.arac_lat},${kayit.arac_lng}`;

  // İKİ NOKTA VARSA YOL TARİFİ, YOKSA TEK NOKTA: araçta cihaz yoksa çizilecek
  // rota da yok; o zaman yalnız kaydın girildiği yer gösterilir.
  const gomme = aracVar
    ? `https://maps.google.com/maps?saddr=${aracNokta}&daddr=${kayitNokta}&hl=tr&output=embed`
    : `https://maps.google.com/maps?q=${kayitNokta}&z=16&hl=tr&output=embed`;
  const disHarita = aracVar
    ? `https://www.google.com/maps/dir/?api=1&origin=${aracNokta}&destination=${kayitNokta}&travelmode=driving`
    : `https://www.google.com/maps?q=${kayitNokta}`;

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      {/* BOY SABİT (panel kuralı): harita yüklenirken pencere zıplamasın. */}
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
            <MapPin size={17} className="text-sky-600" />
            Yakıt kaydı konumu
            {kayit.baslik ? <span className="text-xs font-normal text-gray-500">{kayit.baslik}</span> : null}
          </DialogTitle>
        </DialogHeader>

        {/* ÜSTTEKİ ÖZET: haritada görünmeyen iki şey burada — telefonun sapma
            payı ve kuşbakışı mesafe. Şüphe eşiği kuşbakışına göre işliyor;
            yol mesafesini Google kendi panelinde zaten yazıyor. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-2 py-1 text-sky-800">
            <MapPin size={12} /> Kaydın yeri
            {kayit.konum_dogruluk_m ? ` (±${kayit.konum_dogruluk_m} m)` : ""}
          </span>
          {aracVar && (
            <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-amber-800">
              <Truck size={12} /> {kayit.plaka ?? "Araç"}
              {kayit.arac_konum_at
                ? ` · ${new Date(kayit.arac_konum_at).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
            </span>
          )}
          {kayit.arac_mesafe_m != null && (
            <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">
              kuşbakışı <strong>{km(kayit.arac_mesafe_m)}</strong>
            </span>
          )}
        </div>

        <iframe
          title="Yakıt kaydı konumu"
          src={gomme}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          className="mt-2 h-[460px] max-h-[55vh] w-full shrink-0 rounded-lg border"
        />

        <DialogFooter className="mt-3 shrink-0 items-center border-t pt-3">
          {/* BÜYÜK HARİTA SEÇENEĞİ KALIYOR: yol tarifini telefonda uygulamada
              açıp sürmek isteyen olur. */}
          <a href={disHarita} target="_blank" rel="noopener noreferrer"
            className="mr-auto inline-flex items-center gap-1 text-[11px] font-medium text-[#1E3A5F] underline underline-offset-2">
            Google Haritalar&apos;da aç <ExternalLink size={11} />
          </a>
          <Button variant="outline" onClick={kapat}>Kapat</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
