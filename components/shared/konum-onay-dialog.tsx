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

/** Kullanıcı yürürlükteki metni onaylamış mı? Tablo yoksa ekran çıkmaz (eski davranış). */
export async function konumOnayiVarMi(kullaniciId: string): Promise<boolean> {
  try {
    const { data, error } = await createClient()
      .from("konum_onaylari").select("id")
      .eq("kullanici_id", kullaniciId).eq("metin_surum", KONUM_METIN_SURUM).maybeSingle();
    if (error) {
      // Tablo kurulmamışsa (sql çalıştırılmadıysa) ekranı kilitleme: sebep
      // konsola düşer, yakıt kaydı eskisi gibi girilebilir.
      console.warn("[konum onayı] okunamadı:", error.message);
      return true;
    }
    return Boolean(data);
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
      const { error } = await createClient().from("konum_onaylari").insert({
        kullanici_id: kullaniciId,
        metin_surum: KONUM_METIN_SURUM,
        cihaz: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
        konum_izni: izin === "verildi" ? true : izin === "reddedildi" ? false : null,
      });
      // AYNI SÜRÜM İKİNCİ KEZ YAZILMAZ (unique): bu bir hata değil, onay zaten var.
      if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
      onaylandi();
    } catch (e) {
      // SESSİZ GEÇİLMEZ: onay kaydedilmediyse ekran bir dahakine yine çıkar,
      // kullanıcı sebebini bilmeli.
      toast.error(`Onay kaydedilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: 9000 });
    } finally { setKaydediliyor(false); }
  }

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      {/* BOY SABİT (panel kuralı): izin denemesi sonucu belirince pencere
          zıplamasın — düğmeler farenin altından kaymasın. */}
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#1E3A5F]" /> Konum bilgisi hakkında
          </DialogTitle>
        </DialogHeader>

        {/* ODAK METNİN BAŞINDA: pencere açılınca ilk odaklanabilir öğe "Konumu aç"
            düğmesiydi; pencere onu görünüme kaydırınca metin ORTASINDAN açılıyor,
            ilk paragraflar atlanıyordu. Kaydırma kutusu tabIndex={0} ile ilk
            odaklanabilir öğe oluyor — odak metnin başında kalıyor.
            (autoFocus tek başına yetmedi: pencerenin kendi odak yönetimi mount
            sonrası ilk TABLANABİLİR öğeye geçiyor, -1'li kutuyu atlıyordu.) */}
        <div tabIndex={0}
          className="h-[330px] max-h-[55vh] min-h-0 overflow-y-auto pr-1 text-sm leading-relaxed text-gray-700 space-y-3 outline-none">
          <p>
            Yakıt kaydı girerken telefonunuzun <strong>konumu alınır</strong> ve kayda eklenir.
            Kaydı okuyan kişi, yakıtın verildiği yer ile aracın o andaki yerinin
            birbirini tutup tutmadığını görür.
          </p>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="mb-1 text-xs font-semibold text-gray-600">Alınan bilgiler</div>
            <ul className="list-disc pl-5 text-[13px] space-y-0.5">
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
            <strong>Niçin:</strong> yakıt kayıtlarının doğruluğunu denetlemek ve yakıt
            kaybını önlemek. Konum, yakıt kaydının bir parçası olarak kaydın kendisiyle
            birlikte saklanır ve yalnız bu amaçla kullanılır.
          </p>
          <p className="text-[13px] text-gray-600">
            Kişisel verilerinizle ilgili 6698 sayılı KVKK&apos;nın 11. maddesindeki haklarınızı
            (bilgi talep etme, düzeltme, silme vb.) şirket yönetimine başvurarak
            kullanabilirsiniz.
          </p>

          {/* KONUMU AÇ — tarayıcının izin penceresini açıkça açar. */}
          <div className="rounded-lg border border-[#1E3A5F]/20 bg-[#1E3A5F]/[0.03] px-3 py-2.5">
            <div className="mb-1.5 text-xs font-semibold text-[#1E3A5F]">
              Konum izni — kayıt için gerekli
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void konumuAc()} disabled={izin === "aliniyor"}>
                {izin === "aliniyor" ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                {izin === "verildi" ? "Konum açık" : "Konumu aç"}
              </Button>
              {izin === "verildi" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <Check size={14} /> İzin verildi, hazır.
                </span>
              )}
              {izin === "reddedildi" && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
                  <AlertTriangle size={14} /> İzin alınamadı
                </span>
              )}
            </div>
            {izin === "reddedildi" && izinHata && (
              <p className="mt-1.5 text-[11px] text-red-700">{izinHata}</p>
            )}
            {izin === "bilinmiyor" && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Düğmeye basınca telefonunuz &quot;konumunuza erişsin mi?&quot; diye soracak;
                <strong> İzin Ver</strong> deyin.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" onClick={kapat} disabled={kaydediliyor}>Vazgeç</Button>
          {/* ONAY İZİNDEN BAĞIMSIZ: metni okuduğunu beyan etmek ayrı, tarayıcı
              iznini vermek ayrı. İzin verilmeden kayıt zaten yapılamıyor; burada
              onayı kilitlemek kullanıcıyı çıkışsız bırakırdı. */}
          <Button onClick={() => void onayla()} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Okudum, anladım
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
