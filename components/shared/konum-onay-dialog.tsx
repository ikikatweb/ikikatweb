// KONUM AYDINLATMASI VE ONAYI — yakıt kaydı girmeden önce.
//
// NİYE: yakıt kaydında konum zorunlu. Çalışanın konumu kişisel veri; ne
// topladığımız, niçin topladığımız ve nasıl kullandığımız kişiye SÖYLENMİŞ
// olmalı. Tarayıcının "konumunuza erişmek istiyor" penceresi bunu karşılamaz —
// o yalnız teknik izin.
//
// ══ SIRA ZORUNLU: ÖNCE İZİN, SONRA ONAY ══
// İzni vermeden onaylayan kullanıcı kayıt ekranına girip kaydedemiyor ve
// çıkmaza düşüyordu (10.11.2026'da yaşandı). "Konumu aç" kaydırma alanının
// DIŞINDA duruyor — metni okumaya erinen kişi de görüyor.
//
// ══ ONAY SAVUNMA BELGESİDİR ══
// Metnin TAMAMI, kişinin adı, cihazı, IP'si ve izin durumu kaydediliyor; kayıt
// SUNUCUDA yazılıyor (/api/konum-onay). Metin ekranda veriden üretiliyor
// (AYDINLATMA dizisi) — saklanan metin ile gösterilen metin böylece birebir
// aynı oluyor. İkisi ayrı yazılsaydı zamanla ayrışır, kayıt dayanak olmaktan
// çıkardı.
"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MapPin, ShieldCheck, Loader2, Check, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { konumAl, KonumHatasi, izinDurumu, konumAcmaAdimlari } from "@/lib/utils/konum";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * METNİN SÜRÜMÜ — metin her değiştiğinde BURASI DA DEĞİŞMELİ.
 * Kayıtta bu sürüm yoksa onay ekranı yeniden çıkar.
 */
export const KONUM_METIN_SURUM = "2026-11-10";

/** Aydınlatma metni — ekranda da buradan çizilir, kayda da bu yazılır. */
type Bolum = { p: string } | { baslik: string; maddeler: string[] };
export const AYDINLATMA: Bolum[] = [
  { p: "Yakıt kaydı girerken telefonunuzun konumu alınır ve kayda eklenir. Kaydı okuyan kişi, "
     + "yakıtın verildiği yer ile aracın o andaki yerinin birbirini tutup tutmadığını görür." },
  { baslik: "Alınan bilgiler", maddeler: [
    "Enlem ve boylam (konum)",
    "Ölçümün sapma payı ve ölçüm anı",
    "Kaydı giren kullanıcı ve araç",
  ] },
  { p: "Yalnız kaydı girdiğiniz anda ölçülür. Uygulama kapalıyken ya da başka bir ekrandayken "
     + "konumunuz alınmaz; arka planda takip yapılmaz, yapılamaz." },
  { p: "Niçin: yakıt kayıtlarının doğruluğunu denetlemek ve yakıt kaybını önlemek. Konum, yakıt "
     + "kaydının bir parçası olarak kaydın kendisiyle birlikte saklanır ve yalnız bu amaçla kullanılır." },
  { p: "Kişisel verilerinizle ilgili 6698 sayılı KVKK'nın 11. maddesindeki haklarınızı "
     + "(bilgi talep etme, düzeltme, silme vb.) şirket yönetimine başvurarak kullanabilirsiniz." },
];

/** Kayda yazılan düz metin — ekrandakiyle birebir aynı (ikisi de AYDINLATMA'dan). */
export const aydinlatmaMetni = (): string => AYDINLATMA.map((b) =>
  ("p" in b ? b.p : `${b.baslik}:\n` + b.maddeler.map((m) => `- ${m}`).join("\n"))).join("\n\n");

/**
 * Kullanıcı yürürlükteki metni onaylamış VE konum iznini vermiş mi?
 *
 * İZİN DE ARANIYOR: yalnız "okudum" beyanı yeterli değil — izni vermeden
 * onaylayan kişi kayıt ekranına girip kaydedemiyor ve çıkmaza düşüyordu.
 * Tablo okunamazsa (sql çalıştırılmadıysa) ekran kilitlenmez.
 */
export async function konumOnayiVarMi(kullaniciId: string): Promise<boolean> {
  try {
    const { data, error } = await createClient()
      .from("konum_onaylari").select("id, konum_izni, metin")
      .eq("kullanici_id", kullaniciId).eq("metin_surum", KONUM_METIN_SURUM).maybeSingle();
    if (error) { console.warn("[konum onayı] okunamadı:", error.message); return true; }
    // METİN DE ARANIYOR: eski onaylar (sunucu kaydı gelmeden önce verilenler)
    // metni, adı ve IP'yi taşımıyor — savunma belgesi olarak eksik. O kayıtlarda
    // pencere yeniden açılır ve onay tam hâliyle tazelenir (upsert).
    const k = data as { konum_izni?: boolean | null; metin?: string | null } | null;
    return Boolean(k && k.konum_izni === true && (k.metin ?? "").length > 0);
  } catch { return true; }
}

export default function KonumOnayDialog({ acik, kapat, onaylandi }: {
  acik: boolean;
  /** Vazgeçildi — yakıt kaydı açılmaz. */
  kapat: () => void;
  /** Onay kaydedildi; çağıran yakıt formunu açar. */
  onaylandi: () => void;
}) {
  const [izin, setIzin] = useState<"bilinmiyor" | "aliniyor" | "verildi" | "reddedildi">("bilinmiyor");
  const [izinHata, setIzinHata] = useState<string | null>(null);
  // Site izni mi reddedilmiş, telefonun konum servisi mi kapalı? İkisi aynı
  // hata koduyla geliyor; ayırt edilebiliyorsa doğru yere yönlendirilsin.
  const [izinKaynagi, setIzinKaynagi] = useState<"site" | "cihaz" | "bilinmiyor">("bilinmiyor");
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
      // Tarayıcı "reddedildi" diyorsa site izni kapalı; "sorulacak" diyorsa
      // izin hiç reddedilmemiş demektir → sorun telefonun konum servisinde.
      const d = await izinDurumu();
      setIzinKaynagi(d === "reddedildi" ? "site" : d === "sorulacak" ? "cihaz" : "bilinmiyor");
    }
  }

  async function onayla() {
    setKaydediliyor(true);
    try {
      // KAYIT SUNUCUDA: kullanıcı oturumdan çözülür, IP başlıktan okunur.
      const res = await fetch("/api/konum-onay", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metin_surum: KONUM_METIN_SURUM,
          metin: aydinlatmaMetni(),
          konum_izni: izin === "verildi",
          cihaz: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      });
      const c = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(c.error ?? "Onay kaydedilemedi.");
      onaylandi();
    } catch (e) {
      // SESSİZ GEÇİLMEZ: kaydedilemediyse "onayınız alındı" denmez.
      toast.error(`Onay kaydedilemedi: ${e instanceof Error ? e.message : "bilinmeyen hata"}`, { duration: 9000 });
    } finally { setKaydediliyor(false); }
  }

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a) kapat(); }}>
      {/* BOY SABİT (panel kuralı): izin sonucu belirince pencere zıplamasın. */}
      <DialogContent className="w-[95vw] sm:max-w-lg max-h-[95vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[#1E3A5F]" /> Konum bilgisi hakkında
          </DialogTitle>
        </DialogHeader>

        {/* ── OKUMA KUTUSU ──
            Metin çerçeveli kutunun içinde kendi kaydırma çubuğuyla iniyor;
            kutunun dışında kalan şey "yapılacak iş" (konumu aç → onayla).
            ODAK KUTUDA (tabIndex=0): ilk tablanabilir öğe düğme olsaydı pencere
            onu görünüme kaydırır, metin ortasından açılırdı. */}
        <div tabIndex={0}
          className="h-[240px] max-h-[40vh] min-h-0 space-y-2.5 overflow-y-auto rounded-lg border
            border-gray-200 bg-gray-50/70 px-3 py-2.5 text-sm leading-relaxed text-gray-700
            outline-none focus-visible:border-[#1E3A5F]/40">
          {AYDINLATMA.map((b, i) => ("p" in b ? (
            <p key={i}>{b.p}</p>
          ) : (
            <div key={i} className="rounded-md border border-gray-200 bg-white px-3 py-2">
              <div className="mb-1 text-xs font-semibold text-gray-600">{b.baslik}</div>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
                {b.maddeler.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )))}
        </div>

        {/* ── 1. ADIM: KONUM İZNİ ── Kaydırma alanının DIŞINDA. */}
        <div className={`mt-3 shrink-0 rounded-lg border px-3 py-2.5 transition-colors ${
          izin === "verildi" ? "border-emerald-300 bg-emerald-50"
            : izin === "reddedildi" ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              izin === "verildi" ? "bg-emerald-600" : "bg-amber-500"}`}>1</span>
            <span className="text-xs font-semibold text-[#1E3A5F]">
              {izin === "verildi" ? "Konum izni alındı" : "Konumu açın"}
            </span>
            {/* TURUNCU: yapılmayı bekleyen adım. Yapılınca yeşile döner —
                kullanıcı nerede olduğunu renkten anlıyor. */}
            <Button size="sm" onClick={() => void konumuAc()} disabled={izin === "aliniyor" || izin === "verildi"}
              className={`ml-auto text-white ${izin === "verildi"
                ? "bg-emerald-600 hover:bg-emerald-600" : "bg-amber-500 hover:bg-amber-600"}`}>
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
            <div className="mt-1.5 text-[11px] text-red-700">
              <p className="flex items-start gap-1">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>
                  {izinKaynagi === "cihaz"
                    ? "Bu siteye konum izni REDDEDİLMİŞ DEĞİL — telefonun konum servisi kapalı görünüyor."
                    : izinKaynagi === "site"
                      ? "Bu siteye konum izni kapalı."
                      : izinHata}
                </span>
              </p>
              {/* ADIMLAR CİHAZA GÖRE: "ayarlardan açın" demek yetmiyor, kullanıcı
                  menüyü bulamıyor. iPhone ve Android yolu ayrı. */}
              <div className="mt-1.5 rounded-md border border-red-200 bg-white px-2.5 py-2 text-gray-700">
                <div className="mb-1 text-[11px] font-semibold text-gray-800">{konumAcmaAdimlari().baslik}</div>
                <ol className="list-decimal space-y-0.5 pl-4">
                  {konumAcmaAdimlari().adimlar.map((a) => <li key={a}>{a}</li>)}
                </ol>
              </div>
            </div>
          )}
        </div>

        {/* ── 2. ADIM: ONAY ── İzin alınmadan kapalı, sebebi yanında.
            MOBİL DÜZEN: ayak varsayılan olarak alt alta diziliyor ve düğmeler
            ters sırada çıkıyordu (onay üstte, vazgeç altta, adım yazısı en
            altta) — telefonda okunmuyordu. Adım yazısı üstte, düğmeler yan yana. */}
        <DialogFooter className="mt-3 shrink-0 flex-col items-stretch gap-2 border-t pt-3 sm:flex-row sm:items-center">
          <span className="flex items-center gap-2 sm:mr-auto">
            <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
              izin === "verildi" ? "bg-emerald-600" : "bg-gray-300"}`}>2</span>
            <span className={`text-[11px] ${izin === "verildi" ? "font-semibold text-[#1E3A5F]" : "text-gray-500"}`}>
              {izin === "verildi" ? "Metni okuyup onaylayın" : "Önce konumu açın"}
            </span>
          </span>
          <div className="flex items-center justify-end gap-2">
            {/* VAZGEÇ KIRMIZI ÇERÇEVELİ: dolgu kırmızı olsaydı onayla aynı
                ağırlıkta görünür, göz asıl yapılacak işi aramak zorunda kalırdı. */}
            <Button variant="outline" onClick={kapat} disabled={kaydediliyor}
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800">
              Vazgeç
            </Button>
            <Button onClick={() => void onayla()} disabled={kaydediliyor || izin !== "verildi"}
              title={izin !== "verildi" ? "Önce konum izni verilmeli" : "Onayınız kaydedilir"}
              className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none">
              {kaydediliyor ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
              Okudum, onaylıyorum
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
