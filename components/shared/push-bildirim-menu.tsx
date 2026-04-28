// Birleşik Bildirim Menüsü — tek buton + dropdown
// Üst: Bildirimleri Aç/Kapat (master switch)
// Alt: Kategori bazlı aç/kapat toggle'ları
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, BellOff, History, Settings } from "lucide-react";
import toast from "react-hot-toast";

type BildirimKayit = {
  id: string;
  baslik: string;
  govde: string;
  url: string | null;
  tag: string | null;
  tarih: string;
  saat: string;
  okundu: boolean;
  created_at: string;
};

// Base64 URL-safe → ArrayBuffer
function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i);
  return buffer;
}

// Kategori tanımları
const KATEGORILER: { tag: string; label: string; emoji: string; desc: string }[] = [
  { tag: "santiye", label: "İş Deneyim Belgeleri", emoji: "🏗️", desc: "Yeni iş / güncelleme" },
  { tag: "personel", label: "Personeller", emoji: "👤", desc: "Yeni personel / güncelleme" },
  { tag: "arac", label: "Araçlar", emoji: "🚗", desc: "Yeni araç / güncelleme" },
  { tag: "gelen-evrak", label: "Gelen Evrak", emoji: "📥", desc: "Yeni gelen evrak" },
  { tag: "giden-evrak", label: "Giden Evrak", emoji: "📤", desc: "Yeni giden evrak" },
  { tag: "banka-yazismalari", label: "Banka Yazışması", emoji: "🏦", desc: "Yeni yazışma / hızlı talimat" },
  { tag: "yaklasan-sigorta", label: "Sigorta & Muayene", emoji: "📋", desc: "Yaklaşan/geçen — sabah özeti" },
  { tag: "arac-bakim", label: "Araç Bakım & Tamirat", emoji: "🛠️", desc: "Yeni bakım/tamirat" },
  { tag: "yaklasan-bakim", label: "Yaklaşan Araç Bakımı", emoji: "🛠️", desc: "Sabah 08:00 özeti" },
  { tag: "personel-puantaj", label: "Personel Puantaj", emoji: "👷", desc: "Her 10 girişte 1" },
  { tag: "arac-puantaj", label: "Araç Puantaj", emoji: "🚚", desc: "Her 10 girişte 1" },
  { tag: "iscilik-takibi", label: "İşçilik Takibi", emoji: "📊", desc: "Her veri girişi / güncellemede" },
  { tag: "yakit", label: "Yakıt", emoji: "⛽", desc: "Yeni yakıt alımı" },
  { tag: "kasa", label: "Kasa Defteri", emoji: "💰", desc: "Yeni gelir/gider" },
  { tag: "santiye-defteri", label: "Şantiye Defteri", emoji: "📓", desc: "Yeni günlük defter açılışı" },
  { tag: "ihale", label: "İhale", emoji: "🏛️", desc: "Yeni ihale kaydı" },
];

type Durum = "yukleniyor" | "desteklenmiyor" | "reddedilmis" | "kapali" | "acik";

export default function PushBildirimMenu() {
  const [durum, setDurum] = useState<Durum>("yukleniyor");
  const [islemYapiliyor, setIslemYapiliyor] = useState(false);
  const [acik, setAcik] = useState(false);
  const [ayarlar, setAyarlar] = useState<Record<string, boolean>>({});
  const [ayarlarYuklendi, setAyarlarYuklendi] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Geçmiş bildirimler
  const [aktifSekme, setAktifSekme] = useState<"gecmis" | "ayarlar">("gecmis");
  const [seciliTarih, setSeciliTarih] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [bildirimler, setBildirimler] = useState<BildirimKayit[]>([]);
  const [okunmamisSayisi, setOkunmamisSayisi] = useState<number>(0);
  const [gecmisYukleniyor, setGecmisYukleniyor] = useState(false);

  // Bildirim geçmişini yükle
  const gecmisYukle = useCallback(async (tarih: string) => {
    setGecmisYukleniyor(true);
    try {
      const res = await fetch(`/api/bildirim-gecmisi?tarih=${tarih}`);
      if (res.ok) {
        const data = await res.json() as { bildirimler: BildirimKayit[]; okunmamisSayisi: number };
        setBildirimler(data.bildirimler ?? []);
        setOkunmamisSayisi(data.okunmamisSayisi ?? 0);
      }
    } catch { /* sessiz */ }
    finally { setGecmisYukleniyor(false); }
  }, []);

  // Sayfada açıldığında ve periyodik olarak okunmamış sayısını çek (badge için)
  useEffect(() => {
    if (durum !== "acik" && durum !== "kapali") return;
    const cek = async () => {
      try {
        const res = await fetch(`/api/bildirim-gecmisi?tarih=${seciliTarih}`);
        if (res.ok) {
          const data = await res.json() as { okunmamisSayisi: number };
          setOkunmamisSayisi(data.okunmamisSayisi ?? 0);
        }
      } catch { /* sessiz */ }
    };
    cek();
    const interval = setInterval(cek, 30_000); // 30 sn'de bir badge güncelle
    return () => clearInterval(interval);
  }, [durum, seciliTarih]);

  // İlk kontrol: tarayıcı desteği + izin + mevcut abonelik
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setDurum("desteklenmiyor");
      return;
    }
    if (Notification.permission === "denied") {
      setDurum("reddedilmis");
      return;
    }
    navigator.serviceWorker.getRegistration()
      .then(async (reg) => {
        if (!reg) { setDurum("kapali"); return; }
        const sub = await reg.pushManager.getSubscription();
        setDurum(sub ? "acik" : "kapali");
      })
      .catch(() => setDurum("kapali"));
  }, []);

  // Menü açıldığında ayarları yükle (bir kez)
  useEffect(() => {
    if (!acik || ayarlarYuklendi) return;
    fetch("/api/push/settings")
      .then((r) => r.json())
      .then((data) => {
        setAyarlar((data.ayarlar as Record<string, boolean>) ?? {});
        setAyarlarYuklendi(true);
      })
      .catch(() => { /* sessiz */ });
  }, [acik, ayarlarYuklendi]);

  // Menü açıldığında veya tarih değişince geçmişi yükle
  // VE menü açıldığında okunmamış sayıyı otomatik sıfırla (kullanıcı görmüş sayılır)
  useEffect(() => {
    if (!acik) return;
    if (aktifSekme !== "gecmis") return;
    gecmisYukle(seciliTarih);
    // Menü "Geçmiş" sekmesinde açıldıysa: okunmamışları gördü kabul et
    // Backend'e tumu=true gönder → tüm tarihlerdeki okunmamışlar okundu olarak işaretlenir
    if (okunmamisSayisi > 0) {
      fetch("/api/bildirim-gecmisi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tumu: true }),
      })
        .then((r) => r.ok && setOkunmamisSayisi(0))
        .catch(() => { /* sessiz */ });
    }
    // okunmamisSayisi'yi deps'e koymuyoruz — sadece menü açıldığında bir kez çalışsın
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acik, aktifSekme, seciliTarih, gecmisYukle]);

  // Tek bildirimi okundu işaretle
  async function bildirimOkundu(id: string) {
    try {
      const res = await fetch("/api/bildirim-gecmisi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setBildirimler((prev) => prev.map((b) => b.id === id ? { ...b, okundu: true } : b));
        setOkunmamisSayisi((c) => Math.max(0, c - 1));
      }
    } catch { /* sessiz */ }
  }

  // Tüm bildirimleri okundu işaretle
  async function tumunuOku() {
    try {
      const res = await fetch("/api/bildirim-gecmisi", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tumu: true }),
      });
      if (res.ok) {
        setBildirimler((prev) => prev.map((b) => ({ ...b, okundu: true })));
        setOkunmamisSayisi(0);
      }
    } catch { /* sessiz */ }
  }

  // Dışarı tıklayınca kapat
  useEffect(() => {
    if (!acik) return;
    function kapat(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setAcik(false);
    }
    document.addEventListener("mousedown", kapat);
    return () => document.removeEventListener("mousedown", kapat);
  }, [acik]);

  // Ana bildirim aç
  async function bildirimAc() {
    setIslemYapiliyor(true);
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const izin = await Notification.requestPermission();
      if (izin !== "granted") {
        toast.error("Bildirim izni reddedildi.");
        setDurum(izin === "denied" ? "reddedilmis" : "kapali");
        return;
      }
      const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublic) {
        toast.error("VAPID key yapılandırılmamış.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToArrayBuffer(vapidPublic),
      });
      const subJson = sub.toJSON();
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          p256dh: subJson.keys?.p256dh,
          auth: subJson.keys?.auth,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Kayıt başarısız");
      setDurum("acik");
      toast.success("Bildirimler açıldı!");
    } catch (err) {
      toast.error(`Bildirim açılamadı: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  // Ana bildirim kapat
  async function bildirimKapat() {
    setIslemYapiliyor(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setDurum("kapali");
      toast.success("Bildirimler kapatıldı.");
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setIslemYapiliyor(false);
    }
  }

  // Kategori toggle — anında server'a kaydet
  async function kategoriToggle(tag: string) {
    const yeniDurum = isAcikKat(ayarlar, tag) ? false : true;
    const yeniAyarlar = { ...ayarlar, [tag]: yeniDurum };
    setAyarlar(yeniAyarlar);
    try {
      const res = await fetch("/api/push/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ayarlar: yeniAyarlar }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Kayıt başarısız");
    } catch (err) {
      // Rollback
      setAyarlar(ayarlar);
      toast.error(`Hata: ${err instanceof Error ? err.message : ""}`);
    }
  }

  async function kategoriHepsi(aktif: boolean) {
    const yeni: Record<string, boolean> = {};
    for (const k of KATEGORILER) yeni[k.tag] = aktif;
    setAyarlar(yeni);
    try {
      const res = await fetch("/api/push/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ayarlar: yeni }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Kayıt başarısız");
      toast.success(aktif ? "Tüm kategoriler açıldı." : "Tüm kategoriler kapatıldı.");
    } catch (err) {
      setAyarlar(ayarlar);
      toast.error(`Hata: ${err instanceof Error ? err.message : ""}`);
    }
  }

  function isAcikKat(a: Record<string, boolean>, tag: string) {
    return a[tag] !== false; // varsayılan açık
  }

  if (durum === "yukleniyor") return null;

  if (durum === "desteklenmiyor") {
    return (
      <div className="text-xs text-gray-400 flex items-center gap-1">
        <BellOff size={14} /> Desteklenmiyor
      </div>
    );
  }

  if (durum === "reddedilmis") {
    return (
      <div className="text-xs text-red-500 flex items-center gap-1" title="Tarayıcı ayarlarından izin vermen gerekiyor">
        <BellOff size={14} /> Bildirim izni reddedildi
      </div>
    );
  }

  // Aç/Kapat butonu + Dropdown
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setAcik((v) => !v)}
        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
          durum === "acik"
            ? "bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200"
            : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200"
        }`}
        title={durum === "acik" ? "Bildirimler açık" : "Bildirimler kapalı"}
      >
        {durum === "acik" ? <Bell size={14} /> : <BellOff size={14} />}
        <span className="hidden sm:inline">Bildirimler</span>
        <span className={`text-[10px] font-bold ${durum === "acik" ? "text-emerald-700" : "text-gray-400"}`}>
          {durum === "acik" ? "AÇIK" : "KAPALI"}
        </span>
        {/* Okunmamış bildirim sayısı badge */}
        {okunmamisSayisi > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full ring-2 ring-white">
            {okunmamisSayisi > 99 ? "99+" : okunmamisSayisi}
          </span>
        )}
      </button>

      {/* Dropdown — mobilde tam viewport'a sığsın diye fixed konumlandırma kullanılır */}
      {acik && (
        <div
          className="fixed sm:absolute right-2 sm:right-0 left-2 sm:left-auto top-14 sm:top-auto sm:mt-2 sm:w-[360px] bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden"
        >
          {/* Sekme başlıkları */}
          <div className="flex border-b bg-gray-50">
            <button
              type="button"
              onClick={() => setAktifSekme("gecmis")}
              className={`flex-1 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                aktifSekme === "gecmis" ? "bg-white text-[#1E3A5F] border-b-2 border-[#1E3A5F]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <History size={14} /> Geçmiş
              {okunmamisSayisi > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {okunmamisSayisi > 99 ? "99+" : okunmamisSayisi}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setAktifSekme("ayarlar")}
              className={`flex-1 px-3 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                aktifSekme === "ayarlar" ? "bg-white text-[#1E3A5F] border-b-2 border-[#1E3A5F]" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <Settings size={14} /> Ayarlar
            </button>
          </div>

          {/* GEÇMİŞ SEKMESİ */}
          {aktifSekme === "gecmis" && (
            <div className="flex flex-col">
              {/* Tarih seçimi + Tümünü Oku */}
              <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between gap-2">
                <input
                  type="date"
                  value={seciliTarih}
                  onChange={(e) => setSeciliTarih(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-2 py-1 outline-none focus:border-[#1E3A5F] flex-1"
                />
                {okunmamisSayisi > 0 && (
                  <button
                    type="button"
                    onClick={tumunuOku}
                    className="text-[10px] text-blue-600 hover:underline whitespace-nowrap"
                    title="Tüm bildirimleri okundu işaretle"
                  >
                    Tümünü Oku
                  </button>
                )}
              </div>
              {/* Bildirim listesi */}
              <div className="max-h-[400px] overflow-y-auto">
                {gecmisYukleniyor ? (
                  <div className="p-6 text-center text-xs text-gray-400">Yükleniyor...</div>
                ) : bildirimler.length === 0 ? (
                  <div className="p-6 text-center text-xs text-gray-400">
                    Bu tarihte bildirim yok
                  </div>
                ) : (
                  bildirimler.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        if (!b.okundu) bildirimOkundu(b.id);
                        if (b.url) window.location.href = b.url;
                      }}
                      className={`w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-blue-50 transition-colors ${
                        !b.okundu ? "bg-blue-50/50" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!b.okundu && (
                          <span className="mt-1 w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Okunmadı" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className={`text-xs ${!b.okundu ? "font-bold text-[#1E3A5F]" : "font-medium text-gray-700"} truncate`}>
                              {b.baslik}
                            </div>
                            <div className="text-[10px] text-gray-400 tabular-nums flex-shrink-0">
                              {b.saat?.slice(0, 5)}
                            </div>
                          </div>
                          <div className="text-[11px] text-gray-600 whitespace-pre-wrap break-words leading-tight">
                            {b.govde}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* AYARLAR SEKMESİ */}
          {aktifSekme === "ayarlar" && (
            <>
          {/* Ana aç/kapat */}
          <div className={`p-3 border-b ${durum === "acik" ? "bg-emerald-50 border-emerald-100" : "bg-gray-50"}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-900">Bildirimler</div>
                <div className="text-[11px] text-gray-500">
                  {durum === "acik" ? "Bu cihazda açık" : "Bu cihazda kapalı"}
                </div>
              </div>
              {durum === "kapali" ? (
                <button
                  type="button"
                  onClick={bildirimAc}
                  disabled={islemYapiliyor}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-md disabled:opacity-50"
                >
                  {islemYapiliyor ? "..." : "Aç"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={bildirimKapat}
                  disabled={islemYapiliyor}
                  className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-md disabled:opacity-50"
                >
                  {islemYapiliyor ? "..." : "Kapat"}
                </button>
              )}
            </div>
          </div>

          {/* Kategori alt-bildirimleri (sadece ana açıksa aktif) */}
          <div className={`px-3 py-2 ${durum !== "acik" ? "opacity-50 pointer-events-none" : ""}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] text-gray-500 font-semibold uppercase tracking-wide">Kategoriler</div>
              <div className="flex gap-1">
                <button type="button" onClick={() => kategoriHepsi(true)} className="text-[10px] text-emerald-700 hover:underline">Hepsi Açık</button>
                <span className="text-gray-300">·</span>
                <button type="button" onClick={() => kategoriHepsi(false)} className="text-[10px] text-gray-600 hover:underline">Hepsi Kapalı</button>
              </div>
            </div>

            <div className="max-h-[360px] overflow-y-auto space-y-0.5">
              {KATEGORILER.map((k) => {
                const katAcik = isAcikKat(ayarlar, k.tag);
                return (
                  <button
                    key={k.tag}
                    type="button"
                    onClick={() => kategoriToggle(k.tag)}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-gray-50 text-left transition-colors"
                  >
                    <span className="text-base flex-shrink-0">{k.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-gray-900 truncate">{k.label}</div>
                      <div className="text-[10px] text-gray-400 truncate">{k.desc}</div>
                    </div>
                    {/* Basit toggle switch */}
                    <div className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${katAcik ? "bg-emerald-500" : "bg-gray-300"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${katAcik ? "left-4" : "left-0.5"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
