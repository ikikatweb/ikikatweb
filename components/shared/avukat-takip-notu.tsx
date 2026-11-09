// AVUKATA MAİL GİTTİKTEN SONRAKİ İKİNCİ ADIM — ekranın ortasında, kapatılana
// kadar duran not.
//
// NİYE BİLDİRİM DEĞİL DE PENCERE: köşede beliren süreli bir bildirim, ekrana
// bakılmadığı anda kaçıyor ve hatırlatma hiç okunmamış oluyor. Burada iş
// "gönderdim, bitti" değil; takip edilmesi gereken bir şey başlıyor.
//
// NİYE GLOBAL: maili üç ekran gönderiyor (hızlı "Cevabı işle" penceresi, icra
// sayfasındaki tam form, "Tekrar gönder") ve ilk ikisi gönderimden sonra kendi
// penceresini KAPATIYOR. Not o pencerenin içinde olsaydı birlikte kapanırdı.
// Bu yüzden panel düzeninde bir kez asılı duruyor, olayla açılıyor.
//
// DIŞARI DOKUNMAK VE ESC KAPATMAZ: tek çıkış "Tamam". Kazayla kapanan bir
// hatırlatma, hiç gösterilmemiş sayılır.
"use client";

import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { AVUKAT_TAKIP_NOTU } from "@/lib/supabase/queries/icra-avukat-mail";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const AVUKAT_TAKIP_NOTU_OLAYI = "avukat-takip-notu";

/** Mail gittiğinde çağrılır — notu ekranın ortasında açar. */
export function avukatTakipNotuGoster() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AVUKAT_TAKIP_NOTU_OLAYI));
}

export default function AvukatTakipNotu() {
  const [acik, setAcik] = useState(false);

  useEffect(() => {
    const ac = () => setAcik(true);
    window.addEventListener(AVUKAT_TAKIP_NOTU_OLAYI, ac);
    return () => window.removeEventListener(AVUKAT_TAKIP_NOTU_OLAYI, ac);
  }, []);

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (a) setAcik(true); /* kapatma yalnız Tamam ile */ }}
      disablePointerDismissal>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#1E3A5F]">
            <Phone size={18} /> Dosya avukata gönderildi
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm leading-relaxed text-gray-800">{AVUKAT_TAKIP_NOTU}</p>
        <DialogFooter>
          <Button onClick={() => setAcik(false)}>Tamam</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
