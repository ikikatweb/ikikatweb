// KONUM AYDINLATMASI VE ONAYI — yakıt kaydı girmeden önce bir kez.
//
// NİYE: yakıt kaydında konum zorunlu. Çalışanın konumu kişisel veri; ne
// topladığımız, niçin topladığımız ve nasıl kullandığımız kişiye SÖYLENMİŞ
// olmalı. Tarayıcının "konumunuza erişmek istiyor" penceresi bunu karşılamaz —
// o yalnız teknik izin.
//
// ══ "KONUMU AÇ" DÜĞMESİ ══
// Tarayıcının izin penceresini kullanıcılar beceremiyordu: uyarı çıkıyor,
// anlamadan kapatıyorlar, sonra kayıt yapılamıyordu. Buradaki düğme izni
// AÇIKÇA ister ve sonucu ekranda söyler: verildiyse yeşil, reddedildiyse ne
// yapılacağı yazılı. Reddedilmiş izni tarayıcı bir daha sormaz; o yüzden
// telefon ayarlarından açma yolu da metinde duruyor.
//
// ══ ONAY SAKLANIR ══
// Kim, ne zaman, hangi metin sürümünü, hangi cihazdan onayladı (konum_onaylari).
// Metin değişirse sürüm değişir ve onay yeniden istenir.
"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MapPin, ShieldCheck, Loader2, Check, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { konumAl, KonumHatasi } from "@/lib/utils/konum";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * METNİN SÜRÜMÜ — metin her değiştiğinde BURASI DA DEĞİŞMELİ.
 * Kayıtta bu sürüm yoksa onay ekranı yeniden çıkar; böylece "hangi metni
 * onayladı" sorusu her zaman cevaplanabilir.
 */
export const KONUM_METIN_SURUM = "2026-11-10";

/**
 * Kullanıcı yürürlükteki metni onaylamış VE konum iznini vermiş mi?
 *
 * İZİN DE ARANIYOR: yalnız "okudum" beyanı yeterli değil. İzni vermeden
 * onaylayan kişi kayıt ekranına girip kaydedemiyor ve çıkmaza düşüyordu
 * (10.11.2026'da yaşandı: onay kaydı var, konum_izni boş). Kayıtta izin
 * görünmüyorsa pencere yeniden açılır ve "Konumu aç" adımı tamamlanır.
 *
 * Tablo okunamazsa (sql çalıştırılmadıysa) ekran kilitlenmez — eski davranış.
 */
export async function konumOnayiVarMi(kullaniciId: string): Promise<boolean> {
  try {
    const { data, error } = await createClient()
      .from("konum_onaylari").select("id, konum_izni")
      .eq("kullanici_id", kullaniciId).eq("metin_surum", KONUM_METIN_SURUM).maybeSingle();
    if (error) {
      // Tablo kurulmamışsa (sql çalıştırılmadıysa) ekranı kilitleme: sebep
      // konsola düşer, yakıt kaydı eskisi gibi girilebilir.
      console.warn("[konum onayı] okunamadı:", error.message);
      return true;
    }
    return Boolean(data && (data as { konum_izni?: boolean | null }).konum_izni === true);
  } catch { return true; }
}

export default function KonumOnayDialog({ acik, kullaniciId, kapat, onaylandi }: {
  acik: boolean;
  kullaniciId: string | null;
  /** Vazgeçildi — yakıt kaydı açılmaz. */
  kapat: () => void;
  /** Onay kaydedildi; çağıran yakıt formunu açar. */
  onaylandi: () => void;
}) {
  const [izin, setIzin] = useState<"bilinmiyor" | "aliniyor" | "verildi" | "reddedildi">("bilinmiyor");
  const [izinHata, setIzinHata] = useState<string | null>(null);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  useEffect(() => { if (acik) { setIzin("bilinmiyor"); setIzinHata(null); } }, [acik]);

  /** Tarayıcı izin penceresini AÇIKÇA aç ve sonucu söyle. */
  async function konumuAc() {
    setIzin("aliniyor"); setIzinHata(null);
    try {
      await konumAl(25);
      setIzin("verildi");
    } catch (e) {
      setIzin("reddedildi");
      setIzinHata(e instanceof KonumHatasi ? e.message : "Konum alınamadı.");
    }
  }

  async function onayla() {
    if (!kullaniciId) { toast.error("Oturum bulunamadı."); return; }
    setKaydediliyor(true);
    try {
      // UPSERT: aynı sürüm için ikinci onay satır AÇMAZ, var olanı günceller.
      // Önce izinsiz onaylayıp sonra izni veren kullanıcıda satır tazelenir —
      // yoksa unique kısıtına takılıp "onay kaydedilemedi" derdi.
      const { error } = await createClient().from("konum_onaylari").upsert({
        kullanici_id: kullaniciId,
        metin_surum: KONUM_METIN_SURUM,
        onay_at: new Date().toISOString(),
        cihaz: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
        konum_izni: izin === "verildi" ? true : izin === "reddedildi" ? false : null,
      }, { onConflict: "kullanici_id,metin_surum" });
      if (error) throw new Error(error.message);
      onaylandi();
    } catch (e) {
      // SESSİZ GEÇİLMEZ: onay kaydedilmediyse ekran bir dahakine yine çıkar,
      // kullanıcı sebebini bilmeli.
      toast.error(`Onay kaydedilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: 9000 });
    } finally { setKaydediliyor(false); }
  }

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      {/* BOY SABİT (panel kuralı): izin sonucu belirince pencere zıplamasın —
          düğmeler farenin altından kaymasın. */}
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#1E3A5F]" /> Konum bilgisi hakkında
          </DialogTitle>
        </DialogHeader>

        {/* ── OKUMA KUTUSU ──
            Metin çerçeveli bir kutunun içinde kendi kaydırma çubuğuyla iniyor;
            kutunun dışında kalan şey "yapılacak iş" (konumu aç → onayla).
            Böylece aşağı kaydırmayan kullanıcı da düğmeleri görüyor.

            ODAK KUTUDA: pencere açılınca ilk TABLANABİLİR öğeye odaklanıyor;
            kutu tabIndex={0} olmasaydı odak "Konumu aç" düğmesine gider ve
            tarayıcı onu görünüme kaydırıp metni ortasından açardı. */}
        <div tabIndex={0}
          className="h-[240px] max-h-[40vh] min-h-0 overflow-y-auto rounded-lg border border-gray-200
            bg-gray-50/70 px-3 py-2.5 text-sm leading-relaxed text-gray-700 space-y-2.5 outline-none
            focus-visible:border-[#1E3A5F]/40">
          <p>
            Yakıt kaydı girerken telefonunuzun <strong>konumu alınır</strong> ve kayda eklenir.
            Kaydı okuyan kişi, yakıtın verildiği yer ile aracın o andaki yerinin birbirini
            tutup tutmadığını görür.
          </p>
          <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
            <div className="mb-1 text-xs font-semibold text-gray-600">Alınan bilgiler</div>
            <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
              <li>Enlem ve boylam (konum)</li>
              <li>Ölçümün sapma payı ve ölçüm anı</li>
              <li>Kaydı giren kullanıcı ve araç</li>
            </ul>
          </div>
          <p>
            <strong>Yalnız kaydı girdiğiniz anda</strong> ölçülür. Uygulama kapalıyken ya da
            başka bir ekrandayken konumunuz alınmaz; arka planda takip yapılmaz, yapılamaz.
          </p>
          <p>
            <strong>Niçin:</strong> yakıt kayıtlarının doğruluğunu denetlemek ve yakıt kaybını
            önlemek. Konum, yakıt kaydının bir parçası olarak kaydın kendisiyle birlikte
            saklanır ve yalnız bu amaçla kullanılır.
          </p>
          <p className="text-[13px] text-gray-600">
            Kişisel verilerinizle ilgili 6698 sayılı KVKK&apos;nın 11. maddesindeki haklarınızı
            (bilgi talep etme, düzeltme, silme vb.) şirket yönetimine başvurarak
            kullanabilirsiniz.
          </p>
        </div>

        {/* ── 1. ADIM: KONUM İZNİ ── Kaydırma alanının DIŞINDA; metni okumaya
            erinen kullanıcı da görür. İzin verilmeden onay düğmesi açılmıyor:
            önce onaylayıp sonra izni reddeden kişi, kayıt ekranına girip
            kaydedememe çıkmazına düşüyordu. */}
        <div className={`mt-3 shrink-0 rounded-lg border px-3 py-2.5 transition-colors ${
          izin === "verildi" ? "border-emerald-300 bg-emerald-50"
            : izin === "reddedildi" ? "border-red-300 bg-red-50" : "border-[#1E3A5F]/30 bg-[#1E3A5F]/[0.04]"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              izin === "verildi" ? "bg-emerald-600" : "bg-[#1E3A5F]"}`}>1</span>
            <span className="text-xs font-semibold text-[#1E3A5F]">
              {izin === "verildi" ? "Konum izni alındı" : "Konumu açın"}
            </span>
            <Button size="sm" className={`ml-auto ${izin === "verildi" ? "bg-emerald-600 hover:bg-emerald-600" : ""}`}
              onClick={() => void konumuAc()} disabled={izin === "aliniyor" || izin === "verildi"}>
              {izin === "aliniyor" ? <Loader2 size={14} className="animate-spin" />
                : izin === "verildi" ? <Check size={14} /> : <MapPin size={14} />}
              {izin === "verildi" ? "Konum açık" : "Konumu aç"}
            </Button>
          </div>
          {izin === "bilinmiyor" && (
            <p className="mt-1.5 text-[11px] text-gray-600">
              Düğmeye basınca telefonunuz &quot;konumunuza erişsin mi?&quot; diye soracak;
              <strong> İzin Ver</strong> deyin.
            </p>
          )}
          {izin === "reddedildi" && (
            <p className="mt-1.5 flex items-start gap-1 text-[11px] text-red-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>{izinHata}</span>
            </p>
          )}
        </div>

        {/* ── 2. ADIM: ONAY ── Ayakta; izin alınmadan kapalı ve sebebi yanında. */}
        <DialogFooter className="mt-3 shrink-0 items-center border-t pt-3">
          <span className="mr-auto flex items-center gap-2">
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              izin === "verildi" ? "bg-[#1E3A5F]" : "bg-gray-300"}`}>2</span>
            <span className={`text-[11px] ${izin === "verildi" ? "font-semibold text-[#1E3A5F]" : "text-gray-500"}`}>
              {izin === "verildi" ? "Metni okuyup onaylayın" : "Önce konumu açın"}
            </span>
          </span>
          <Button variant="outline" onClick={kapat} disabled={kaydediliyor}>Vazgeç</Button>
          <Button onClick={() => void onayla()} disabled={kaydediliyor || izin !== "verildi"}
            title={izin !== "verildi" ? "Önce konum izni verilmeli" : "Onayınız kaydedilir"}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Okudum, anladım
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
