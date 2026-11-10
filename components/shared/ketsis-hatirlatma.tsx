"use client";

// Ana ekran uyarısı: VERGİ DAİRESİ TEBLİGATI (GİB · KETSİS).
//
// UETS uyarısının (components/shared/tebligat-hatirlatma) kardeşi ama ayrı duruyor,
// çünkü iki ayrı sistemden konuşuyorlar ve yapılacak iş farklı:
//   UETS   → tebligat panelden açılabiliyor.
//   KETSİS → açılamıyor. Alıcı tarafı için API yok; belge yalnız Dijital Vergi
//            Dairesi ekranından görülür. Buradaki tek iş: "git bak".
//
// İKİ SEBEPLE ÇIKAR:
//   1) GİB'in bilgilendirme maili yakalandı, kimse bakmadı.
//   2) Mail hiç gelmedi ama HAFTADIR kimse bakmadı. Bilgilendirme maili hukuken
//      tebligatın parçası değil; gelmemesi süreyi durdurmaz (VUK 107/A). Sessizlik
//      "tebligat yok" demek değil — bu yüzden mail olmasa da hatırlatma çıkar.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Check, Landmark } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth, tebligatDegisti } from "@/hooks";
import { toastSuresi } from "@/lib/utils/toast-sure";
import { hataMetni } from "@/lib/utils/hata-metni";
import {
  getKetsisBildirimler, getSonKetsisKontrol, kontrolYasiGun,
  GIB_GIRIS, KONTROL_ARALIGI_GUN, type KetsisBildirim,
} from "@/lib/supabase/queries/ketsis";

export default function KetsisHatirlatma() {
  const { hasPermission, isYonetici } = useAuth();
  const yetkili = isYonetici || hasPermission("yazismalar-e-tebligat", "goruntule");

  const [bekleyen, setBekleyen] = useState<KetsisBildirim[]>([]);
  const [sonKontrol, setSonKontrol] = useState<string | null>(null);
  const [hicKontrol, setHicKontrol] = useState(false);   // sorgu döndü, kayıt yok
  const [kaydediliyor, setKaydediliyor] = useState(false);
  // İLK SORGU BİTMEDEN HİÇBİR ŞEY ÇİZİLMEZ. Başlangıçta sonKontrol null olduğu için
  // kontrolYasiGun da null dönüyor, "kontrolGerekli" true çıkıyor ve ana sayfa her
  // açıldığında sarı "hiç kontrol edilmedi" kutusu bir an parlayıp veri gelince
  // kayboluyordu. Olmayan bir eksiği bildiren uyarı, gerçek uyarıya olan güveni yer.
  const [yukleniyor, setYukleniyor] = useState(true);
  // Sorgu patlarsa bunu SÖYLERİZ. Eskiden hata yalnız konsola düşüyordu; ekranda ise
  // boş durumlar "vergi dairesi hiç kontrol edilmedi" diye yorumlanıyordu — yani
  // okunamayan veri, yanlış bir iddiaya dönüşüyordu.
  const [hata, setHata] = useState<string | null>(null);

  const kontrol = useCallback(async () => {
    try {
      const [b, k] = await Promise.all([getKetsisBildirimler(), getSonKetsisKontrol()]);
      setBekleyen(b.filter((x) => x.durum === "yeni"));
      setSonKontrol(k?.kontrol_at ?? null);
      setHicKontrol(!k);
      setHata(null);
    } catch (e) {
      // Ana ekranı kilitlemez ama YUTULMAZ: sebep hem konsola hem ekrana düşer.
      // hataMetni ŞART: Supabase hataları Error değil düz nesne; String(e) onlara
      // "[object Object]" diyor ve ekranda sebep yerine bu çıkıyordu.
      const m = hataMetni(e);
      console.warn("GİB tebligat uyarısı okunamadı:", m);
      setHata(m);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => {
    if (!yetkili) { setBekleyen([]); setYukleniyor(false); return; }
    void (async () => { await kontrol(); })();
    const onFocus = () => void kontrol();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [yetkili, kontrol]);

  const yas = kontrolYasiGun(sonKontrol);
  const kontrolGerekli = hicKontrol || yas === null || yas >= KONTROL_ARALIGI_GUN;

  async function kontrolEttim() {
    setKaydediliyor(true);
    try {
      const r = await fetch("/api/ketsis/kontrol", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ islem: "kontrol-kaydi", bulgu: "temiz" }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      toast.success("Kontrol kaydedildi.", { duration: toastSuresi() });
      await kontrol();
      tebligatDegisti();
    } catch (e) {
      toast.error(`Kaydedilemedi: ${e instanceof Error ? e.message : e}`, { duration: 14000 });
    } finally {
      setKaydediliyor(false);
    }
  }

  if (!yetkili) return null;
  // Veri gelmeden karar verilmez (yukarıdaki nota bak).
  if (yukleniyor) return null;

  // OKUNAMADIYSA "hiç kontrol edilmedi" DENMEZ: bilmediğimiz şeyi eksiklik diye
  // bildirmek yanlış olur. Ne olduğu söylenir, kullanıcı yine de daireye gidebilsin
  // diye bağlantı durur.
  if (hata) {
    return (
      <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 shadow-sm">
        <div className="flex items-center gap-3">
          <AlertTriangle size={22} className="shrink-0 text-amber-600" />
          <div className="flex-1">
            <div className="font-semibold">Vergi dairesi tebligat durumu okunamadı</div>
            <div className="text-xs text-amber-700">
              Bekleyen tebligat var mı, bilinmiyor — &quot;yok&quot; anlamına gelmez. ({hata})
            </div>
          </div>
          <a href={GIB_GIRIS} target="_blank" rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white">
            Dijital Vergi Dairesi <ExternalLink size={13} />
          </a>
        </div>
      </div>
    );
  }

  if (bekleyen.length === 0 && !kontrolGerekli) return null;

  // Yakalanmış bildirim varsa kırmızı (tebligat gelmiş olabilir); yalnız "süre geçti,
  // bakılmadı" durumunda sarı (hatırlatma).
  const kirmizi = bekleyen.length > 0;
  const kutu = kirmizi
    ? "border-red-300 bg-red-50 text-red-900"
    : "border-amber-300 bg-amber-50 text-amber-900";

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 shadow-sm ${kutu}`}>
      <div className="flex items-center gap-3">
        <Landmark size={22} className={`shrink-0 ${kirmizi ? "text-red-600" : "text-amber-600"}`} />
        <div className="flex-1">
          <div className="font-semibold">
            🏛️ {kirmizi
              ? `Vergi dairesinden ${bekleyen.length} tebligat bildirimi`
              : yas === null
                ? "Vergi dairesi tebligatı hiç kontrol edilmedi"
                : `Vergi dairesi ${yas} gündür kontrol edilmedi`}
          </div>
          <div className={`text-xs ${kirmizi ? "text-red-700" : "text-amber-700"}`}>
            {kirmizi
              ? <>GİB bildirim maili geldi. <b>Belge panele inmez</b> — tebligat yalnız Dijital
                  Vergi Dairesi&apos;nden okunur.</>
              : <>Bilgilendirme maili gelmese de tebligat gelmiş olabilir; <b>mailin gelmemesi
                  süreyi durdurmaz</b> (VUK 107/A).</>}
          </div>
        </div>
        <a href={GIB_GIRIS} target="_blank" rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3 py-1.5 text-xs font-medium hover:bg-white">
          Dijital Vergi Dairesi <ExternalLink size={13} />
        </a>
      </div>

      {bekleyen.length > 0 && (
        <ul className="mt-2 space-y-1.5 pl-9 text-sm">
          {bekleyen.slice(0, 5).map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-gray-300"
                style={{ backgroundColor: b.firmalar?.renk ?? "#9ca3af" }}
                title={b.firmalar?.firma_adi ?? b.kutu} />
              <b>{b.firmalar?.kisa_adi || b.firmalar?.firma_adi || "firma belirsiz"}</b>
              {/* Belge no: Dijital Vergi Dairesi'nde hangi satıra bakılacağını söyler. */}
              {b.belge_no && <span className="font-mono text-xs">belge {b.belge_no}</span>}
              <span className="truncate max-w-[22rem]" title={b.konu ?? ""}>{b.konu ?? "konu yok"}</span>
              {/* Gönderen tanıdık değilse bunu SÖYLERİZ: kesin diye göstermek yanlış güven verir. */}
              {b.guven === "aday" && (
                <span className="rounded bg-white/80 px-1.5 py-0.5 text-xs font-semibold" title={b.gonderen_adres ?? ""}>
                  doğrulanmalı
                </span>
              )}
            </li>
          ))}
          {bekleyen.length > 5 && <li className="text-xs">… ve {bekleyen.length - 5} tane daha</li>}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3 pl-9">
        <Link href="/dashboard/yazismalar/e-tebligat" className="text-xs font-medium underline underline-offset-2">
          Tümünü gör →
        </Link>
        {/* Bakıldığının kaydı: hatırlatma ancak bu kayıtla susar, kapatma düğmesi yok. */}
        <button type="button" disabled={kaydediliyor} onClick={kontrolEttim}
          className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-0.5 text-xs font-medium hover:bg-white disabled:opacity-60">
          <Check size={12} /> Kontrol ettim
        </button>
        {bekleyen.length > 0 && (
          <span className="text-[11px] opacity-80">
            <AlertTriangle size={11} className="mr-1 inline" />
            Bildirimi &quot;baktım&quot; diye işaretlemek E-Tebligat düzenleme yetkisi ister.
          </span>
        )}
      </div>
    </div>
  );
}
