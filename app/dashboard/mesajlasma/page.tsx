// Mesajlaşma sayfası — kullanıcı arası 1-1 ve grup konuşmaları
"use client";

import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  getKonusmalar,
  getMesajlar,
  konusmaBaslat,
  mesajGonder,
  mesajOku,
  mesajSil,
  konusmaSil,
  konusmaYedekle,
  type KonusmaOzet,
} from "@/lib/supabase/queries/mesajlasma";
import { useAuth } from "@/hooks";
import type { Mesaj } from "@/lib/supabase/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare, Send, Plus, Paperclip, Image as ImageIcon, Trash2, FileText, FileType2, Users, X, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// PDF için Türkçe karakter temizleyici
function tr(s: string): string {
  return s.replace(/ğ/g,"g").replace(/Ğ/g,"G").replace(/ü/g,"u").replace(/Ü/g,"U")
    .replace(/ş/g,"s").replace(/Ş/g,"S").replace(/ö/g,"o").replace(/Ö/g,"O")
    .replace(/ç/g,"c").replace(/Ç/g,"C").replace(/ı/g,"i").replace(/İ/g,"I").replace(/—/g,"-");
}

type Kullanici = { id: string; ad_soyad: string };

export default function MesajlasmaPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">Yükleniyor...</div>}>
      <MesajlasmaContent />
    </Suspense>
  );
}

function MesajlasmaContent() {
  const searchParams = useSearchParams();
  const urlKonusmaId = searchParams.get("konusma");
  const { kullanici, isYonetici, isShantiyeAdmin } = useAuth();
  const yetkiliSilmek = isYonetici || isShantiyeAdmin;

  const [konusmalar, setKonusmalar] = useState<KonusmaOzet[]>([]);
  const [seciliKonusmaId, setSeciliKonusmaId] = useState<string | null>(null);
  const [mesajlar, setMesajlar] = useState<Mesaj[]>([]);
  const [yeniMesaj, setYeniMesaj] = useState("");
  const [yukleniyor, setYukleniyor] = useState(true);
  const [dosyaYukleniyor, setDosyaYukleniyor] = useState(false);
  const [yeniKonusmaDialog, setYeniKonusmaDialog] = useState(false);
  const [tumKullanicilar, setTumKullanicilar] = useState<Kullanici[]>([]);
  const [seciliKullanicilar, setSeciliKullanicilar] = useState<Set<string>>(new Set());
  const [grupBaslik, setGrupBaslik] = useState("");
  const mesajContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [adMap, setAdMap] = useState<Map<string, string>>(new Map());
  // Lightbox: resme tıklayınca uygulama içi modal'da göster (Supabase URL'i kullanıcıya gözükmez)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [lightboxAd, setLightboxAd] = useState<string>("");
  const [lightboxZoom, setLightboxZoom] = useState(1);

  // Konuşmaları yükle — yönetici ve şantiye yöneticisi tüm konuşmaları görür
  const tumunuGor = isYonetici || isShantiyeAdmin;
  const loadKonusmalar = useCallback(async () => {
    if (!kullanici?.id) return;
    try {
      const data = await getKonusmalar(kullanici.id, tumunuGor);
      setKonusmalar(data);
    } catch (err) {
      console.error("Konuşmalar yüklenemedi:", err);
    }
  }, [kullanici?.id, tumunuGor]);

  // Tüm kullanıcıları çek (yeni konuşma için)
  const loadKullanicilar = useCallback(async () => {
    try {
      const res = await fetch("/api/kullanicilar/adlar");
      if (res.ok) {
        const adlar = (await res.json()) as Kullanici[];
        setTumKullanicilar(adlar.filter((k) => k.id !== kullanici?.id));
        const m = new Map<string, string>();
        for (const k of adlar) m.set(k.id, k.ad_soyad);
        setAdMap(m);
      }
    } catch { /* sessiz */ }
  }, [kullanici?.id]);

  useEffect(() => {
    setYukleniyor(true);
    Promise.all([loadKonusmalar(), loadKullanicilar()]).finally(() => setYukleniyor(false));
  }, [loadKonusmalar, loadKullanicilar]);

  // URL'de ?konusma=<id> varsa o konuşmayı otomatik aç (bildirim tıklamasından gelen deep link)
  // Son işlenen ID takip edilir — service worker client.navigate ile farklı konuşma URL'i gelirse
  // yeni ID için tekrar tetiklenir.
  const sonIslenenKonusma = useRef<string>("");
  useEffect(() => {
    if (!urlKonusmaId || yukleniyor || konusmalar.length === 0) return;
    if (sonIslenenKonusma.current === urlKonusmaId) return;
    const varMi = konusmalar.some((k) => k.id === urlKonusmaId);
    if (varMi) {
      sonIslenenKonusma.current = urlKonusmaId;
      konusmaSec(urlKonusmaId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKonusmaId, konusmalar, yukleniyor]);

  // Lightbox açıkken Esc ile kapatma
  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxUrl]);

  // Textarea içerik değiştiğinde otomatik yüksekliği ayarla
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [yeniMesaj]);

  // Periyodik yenile (gerçek zamanlı yerine basit polling)
  useEffect(() => {
    if (!kullanici?.id) return;
    const interval = setInterval(() => {
      loadKonusmalar();
      if (seciliKonusmaId) loadMesajlar(seciliKonusmaId);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kullanici?.id, seciliKonusmaId]);

  async function loadMesajlar(konusmaId: string) {
    try {
      const data = await getMesajlar(konusmaId);
      setMesajlar(data);
      // Okundu işaretle
      if (kullanici?.id) await mesajOku(konusmaId, kullanici.id);
      // Scroll en alta
      setTimeout(() => {
        if (mesajContainerRef.current) {
          mesajContainerRef.current.scrollTop = mesajContainerRef.current.scrollHeight;
        }
      }, 50);
    } catch (err) {
      console.error("Mesajlar yüklenemedi:", err);
    }
  }

  // Konuşma seç
  async function konusmaSec(id: string) {
    setSeciliKonusmaId(id);
    // Mobilde klavyenin otomatik açılması için textarea'ya hemen focus ver.
    // iOS Safari focus()'u kullanıcı dokunma olayının yakın takibinde olmayı şart koşar
    // bu yüzden setSeciliKonusmaId'den sonra render'ı bekleyip rAF ile focus veriyoruz.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    });
    await loadMesajlar(id);
  }

  // Mesaj gönder
  async function mesajGonderHandle() {
    if (!kullanici?.id || !seciliKonusmaId || !yeniMesaj.trim()) return;
    try {
      await mesajGonder({
        konusma_id: seciliKonusmaId,
        gonderen_id: kullanici.id,
        icerik: yeniMesaj.trim(),
      });
      setYeniMesaj("");
      // Textarea yüksekliğini sıfırla (auto-grow useEffect zaten çalışacak ama anında sıfırlamak için)
      if (textareaRef.current) textareaRef.current.style.height = "40px";
      await loadMesajlar(seciliKonusmaId);
      await loadKonusmalar();
    } catch (err) {
      toast.error("Mesaj gönderilemedi: " + (err instanceof Error ? err.message : ""));
    }
  }

  // Dosya/resim yükle ve gönder
  async function dosyaSec(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files || e.target.files.length === 0 || !kullanici?.id || !seciliKonusmaId) return;
    const file = e.target.files[0];
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Dosya boyutu 10 MB'ı aşamaz.");
      return;
    }
    setDosyaYukleniyor(true);
    try {
      // Direkt Supabase Storage'a yükle — /api/upload üzerinden gitmek
      // Next.js body size limit'ine (4.5 MB) takılıyor. Client-side upload bunu bypass eder.
      // Path: timestamp + random + extension (Türkçe/parantez yok); orijinal isim dosya_adi'da
      const extRaw = file.name.includes(".") ? file.name.split(".").pop() ?? "" : "";
      const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
      const rand = Math.random().toString(36).slice(2, 8);
      const path = `${seciliKonusmaId}/${Date.now()}-${rand}${ext ? "." + ext : ""}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from("mesaj-dosya")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("mesaj-dosya").getPublicUrl(path);
      const url = publicUrl;
      const dosyaTipi = file.type.startsWith("image/") ? "image" : "file";
      await mesajGonder({
        konusma_id: seciliKonusmaId,
        gonderen_id: kullanici.id,
        dosya_url: url,
        dosya_adi: file.name,
        dosya_tipi: dosyaTipi,
      });
      await loadMesajlar(seciliKonusmaId);
      await loadKonusmalar();
    } catch (err) {
      toast.error("Dosya yüklenemedi: " + (err instanceof Error ? err.message : ""));
    } finally {
      setDosyaYukleniyor(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Yeni konuşma başlat
  async function yeniKonusmaBaslat() {
    if (!kullanici?.id || seciliKullanicilar.size === 0) {
      toast.error("En az bir kullanıcı seç.");
      return;
    }
    try {
      const k = await konusmaBaslat(
        kullanici.id,
        Array.from(seciliKullanicilar),
        seciliKullanicilar.size > 1 ? grupBaslik || "Grup Konuşması" : undefined,
      );
      setSeciliKullanicilar(new Set());
      setGrupBaslik("");
      setYeniKonusmaDialog(false);
      await loadKonusmalar();
      konusmaSec(k.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Konuşma başlatılamadı:", err);
      // SQL migration henüz çalışmadıysa anlamlı bilgi ver
      if (msg.includes("does not exist") || msg.includes("relation") || msg.includes("schema")) {
        toast.error("Mesajlaşma tabloları Supabase'de yok. SQL migration çalıştırılmalı.", { duration: 10000 });
      } else if (msg.includes("policy") || msg.includes("RLS") || msg.includes("row-level security")) {
        toast.error("RLS politikası izin vermiyor. Supabase'de policy ayarlarını kontrol et.", { duration: 10000 });
      } else {
        toast.error("Konuşma başlatılamadı: " + msg, { duration: 10000 });
      }
    }
  }

  // Mesaj sil (sahibi veya admin)
  async function mesajSilHandle(m: Mesaj) {
    if (!kullanici?.id) return;
    if (!confirm("Bu mesaj silinsin mi?")) return;
    try {
      await mesajSil(m.id, kullanici.id);
      await loadMesajlar(seciliKonusmaId!);
    } catch (err) {
      toast.error("Silinemedi: " + (err instanceof Error ? err.message : ""));
    }
  }

  // Konuşmayı tamamen sil
  async function konusmaSilHandle() {
    if (!seciliKonusmaId) return;
    if (!confirm("Bu konuşma ve tüm mesajları kalıcı olarak silinsin mi?")) return;
    try {
      await konusmaSil(seciliKonusmaId);
      setSeciliKonusmaId(null);
      setMesajlar([]);
      await loadKonusmalar();
      toast.success("Konuşma silindi.");
    } catch (err) {
      toast.error("Silinemedi: " + (err instanceof Error ? err.message : ""));
    }
  }

  // Konuşmayı PDF olarak indir (okunaklı, yazıcıdan çıktı alınabilir)
  async function konusmaIndirPDF() {
    if (!seciliKonusmaId || !seciliKonusma) return;
    try {
      const data = await konusmaYedekle(seciliKonusmaId);
      const mesajlarL = (data.mesajlar ?? []) as Mesaj[];
      const baslik = buildBaslik(seciliKonusma);
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      // Başlık bilgisi
      doc.setFontSize(14);
      doc.text(tr(`Mesajlasma Yedegi: ${baslik}`), 14, 15);
      doc.setFontSize(9);
      doc.setTextColor(120);
      const uyeMetni = seciliKonusma.uyeler.map((u) => u.ad_soyad).join(", ");
      doc.text(tr(`Uyeler: ${uyeMetni}`), 14, 21);
      doc.text(tr(`Toplam mesaj: ${mesajlarL.filter((m) => !m.silindi).length}`), 14, 26);
      doc.text(tr(`Indirme: ${new Date().toLocaleString("tr-TR")}`), 14, 31);

      // Tablo
      const rows = mesajlarL.map((m) => {
        const tarih = new Date(m.created_at).toLocaleString("tr-TR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        const gonderen = adMap.get(m.gonderen_id) ?? "—";
        let icerik = "";
        if (m.silindi) icerik = "[Silinmis mesaj]";
        else {
          if (m.icerik) icerik = m.icerik;
          if (m.dosya_url) icerik += (icerik ? "\n" : "") + `[Ek: ${m.dosya_adi || "Dosya"}]`;
        }
        return [tr(tarih), tr(gonderen), tr(icerik)];
      });

      autoTable(doc, {
        startY: 36,
        head: [[tr("Tarih"), tr("Gonderen"), tr("Mesaj")]],
        body: rows,
        styles: { fontSize: 8, cellPadding: 2, valign: "top", overflow: "linebreak" },
        headStyles: { fillColor: [30, 58, 95], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 30 },
          1: { cellWidth: 35 },
          2: { cellWidth: "auto" },
        },
        margin: { left: 14, right: 14 },
      });

      const tarihStr = new Date().toISOString().slice(0, 10);
      doc.save(`konusma-${baslik.replace(/[^a-zA-Z0-9]+/g, "_")}-${tarihStr}.pdf`);
      toast.success("PDF indirildi.");
    } catch (err) {
      toast.error("PDF olusturulamadi: " + (err instanceof Error ? err.message : ""));
    }
  }

  // Konuşmayı TXT olarak indir (WhatsApp tarzı)
  async function konusmaIndirTXT() {
    if (!seciliKonusmaId || !seciliKonusma) return;
    try {
      const data = await konusmaYedekle(seciliKonusmaId);
      const mesajlarL = (data.mesajlar ?? []) as Mesaj[];
      const baslik = buildBaslik(seciliKonusma);
      const uyeMetni = seciliKonusma.uyeler.map((u) => u.ad_soyad).join(", ");

      const satirlar: string[] = [];
      satirlar.push(`Mesajlaşma Yedeği: ${baslik}`);
      satirlar.push(`Üyeler: ${uyeMetni}`);
      satirlar.push(`İndirme: ${new Date().toLocaleString("tr-TR")}`);
      satirlar.push(`Toplam: ${mesajlarL.filter((m) => !m.silindi).length} mesaj`);
      satirlar.push("=".repeat(60));
      satirlar.push("");

      for (const m of mesajlarL) {
        const tarih = new Date(m.created_at).toLocaleString("tr-TR", {
          day: "2-digit", month: "2-digit", year: "numeric",
          hour: "2-digit", minute: "2-digit",
        });
        const gonderen = adMap.get(m.gonderen_id) ?? "—";
        if (m.silindi) {
          satirlar.push(`[${tarih}] ${gonderen}: [Silinmiş mesaj]`);
        } else {
          let satir = `[${tarih}] ${gonderen}: ${m.icerik ?? ""}`;
          if (m.dosya_url) satir += ` [Ek: ${m.dosya_adi || "Dosya"}]`;
          satirlar.push(satir);
        }
      }

      const metin = satirlar.join("\r\n");
      // BOM ekle ki Notepad UTF-8 olarak açabilsin (Türkçe karakterler bozulmasın)
      const blob = new Blob(["﻿" + metin], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `konusma-${baslik.replace(/[^a-zA-Z0-9]+/g, "_")}-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("TXT indirildi.");
    } catch (err) {
      toast.error("TXT olusturulamadi: " + (err instanceof Error ? err.message : ""));
    }
  }

  const seciliKonusma = konusmalar.find((k) => k.id === seciliKonusmaId);
  // Konuşma başlığı:
  // - Grup: başlık || "Grup"
  // - Tekil: kullanıcı üyeyse → karşı tarafın adı
  //          değilse (admin gözlem) → "A ↔ B" şeklinde her iki tarafın adı
  function buildBaslik(k: KonusmaOzet): string {
    if (k.tip === "grup") return k.baslik || "Grup";
    const benUyeMiyim = k.uyeler.some((u) => u.kullanici_id === kullanici?.id);
    if (benUyeMiyim) {
      return k.uyeler.find((u) => u.kullanici_id !== kullanici?.id)?.ad_soyad || "—";
    }
    // Admin gözlemci — her iki üyeyi de göster
    return k.uyeler.map((u) => u.ad_soyad).join(" ↔ ") || "—";
  }
  const konusmaBasligi = seciliKonusma ? buildBaslik(seciliKonusma) : "";
  // Konuşmadaki üye listesi (grup için ya da admin gözlem için yardımcı satır)
  const seciliKonusmaUyeMetni = seciliKonusma
    ? seciliKonusma.uyeler.map((u) => u.ad_soyad).join(", ")
    : "";

  if (!kullanici) return <div className="p-4 text-gray-500">Yükleniyor...</div>;

  return (
    <div className="fixed left-0 right-0 top-14 bottom-0 flex md:static md:h-[calc(100vh-120px)] md:m-0 gap-0 md:gap-3">
      {/* Sol panel: Konuşma listesi — mobilde sadece konuşma seçilmediyse görün */}
      <div className={`${seciliKonusmaId ? "hidden md:flex" : "flex"} w-full md:w-72 md:flex-shrink-0 bg-white md:rounded-lg md:border border-b flex-col overflow-hidden`}>
        <div className="p-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-[#1E3A5F]" />
            <h2 className="font-bold text-sm">Mesajlar</h2>
          </div>
          <Button size="sm" className="h-7 text-xs bg-[#F97316] hover:bg-[#ea580c]" onClick={() => setYeniKonusmaDialog(true)}>
            <Plus size={14} className="mr-1" /> Yeni
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {yukleniyor ? (
            <div className="p-4 text-center text-xs text-gray-400">Yükleniyor...</div>
          ) : konusmalar.length === 0 ? (
            <div className="p-4 text-center text-xs text-gray-400">
              Henüz konuşma yok. + ile yeni başlat.
            </div>
          ) : (
            konusmalar.map((k) => {
              const baslik = buildBaslik(k);
              const aktif = k.id === seciliKonusmaId;
              const benUyeMiyim = k.uyeler.some((u) => u.kullanici_id === kullanici?.id);
              // Üye satırı: grup için tüm üyeler, 1-1'de admin gözlemse zaten başlıkta var → tekrar gösterme
              const uyeSatiri = k.tip === "grup"
                ? k.uyeler.map((u) => u.ad_soyad).join(", ")
                : null;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => konusmaSec(k.id)}
                  className={`w-full text-left px-3 py-2.5 border-b hover:bg-blue-50 transition-colors ${aktif ? "bg-blue-50" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {k.tip === "grup" && <Users size={14} className="text-gray-400 flex-shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#1E3A5F] truncate">{baslik}</span>
                        {!benUyeMiyim && (
                          <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            Gözlem
                          </span>
                        )}
                        {k.okunmamisSayisi > 0 && (
                          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0">
                            {k.okunmamisSayisi}
                          </span>
                        )}
                      </div>
                      {uyeSatiri && (
                        <div className="text-[10px] text-gray-400 truncate mt-0.5">
                          {uyeSatiri}
                        </div>
                      )}
                      {k.sonMesaj && (
                        <div className="text-[11px] text-gray-500 truncate mt-0.5">
                          <span className="font-medium">{k.sonMesaj.gonderen_ad}:</span>{" "}
                          {k.sonMesaj.icerik || "📎 Dosya"}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Sağ panel: Seçili konuşma — mobilde sadece konuşma seçildiyse görün */}
      <div className={`${seciliKonusmaId ? "flex" : "hidden md:flex"} flex-1 bg-white md:rounded-lg md:border flex-col overflow-hidden min-w-0`}>
        {!seciliKonusmaId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <MessageSquare size={48} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm">Bir konuşma seç veya yeni başlat</p>
            </div>
          </div>
        ) : (
          <>
            {/* Başlık */}
            <div className="px-3 md:px-4 py-2.5 md:py-3 border-b flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {/* Geri butonu — sadece mobilde */}
                <button
                  type="button"
                  onClick={() => setSeciliKonusmaId(null)}
                  className="md:hidden p-1 -ml-1 text-[#1E3A5F] hover:bg-gray-100 rounded flex-shrink-0"
                  title="Geri"
                >
                  <ArrowLeft size={20} />
                </button>
                {seciliKonusma?.tip === "grup" && <Users size={16} className="text-gray-500 flex-shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm text-[#1E3A5F] truncate">{konusmaBasligi}</h3>
                    {seciliKonusma && !seciliKonusma.uyeler.some((u) => u.kullanici_id === kullanici?.id) && (
                      <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                        Gözlem
                      </span>
                    )}
                  </div>
                  {/* Grup için üye listesi (truncate) */}
                  {seciliKonusma?.tip === "grup" && (
                    <div className="text-[10px] text-gray-500 truncate">
                      {seciliKonusma.uyeler.length} üye: {seciliKonusmaUyeMetni}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={konusmaIndirPDF}
                  className="p-1.5 text-gray-400 hover:text-[#1E3A5F] rounded"
                  title="PDF olarak indir"
                >
                  <FileText size={16} />
                </button>
                <button
                  type="button"
                  onClick={konusmaIndirTXT}
                  className="p-1.5 text-gray-400 hover:text-[#1E3A5F] rounded"
                  title="TXT olarak indir"
                >
                  <FileType2 size={16} />
                </button>
                {yetkiliSilmek && (
                  <button
                    type="button"
                    onClick={konusmaSilHandle}
                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                    title="Konuşmayı sil"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>

            {/* Mesaj listesi */}
            <div ref={mesajContainerRef} className="flex-1 overflow-y-auto p-2 md:p-4 space-y-1.5 md:space-y-2 bg-gray-50">
              {mesajlar.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-8">
                  Henüz mesaj yok. İlk mesajı sen gönder!
                </div>
              ) : (
                mesajlar.map((m) => {
                  const benim = m.gonderen_id === kullanici?.id;
                  const ad = adMap.get(m.gonderen_id) ?? "—";
                  // Gözlem modu: kullanıcı bu konuşmanın üyesi değil (admin/şantiye yöneticisi gözlemde)
                  const gozlemModu = seciliKonusma
                    ? !seciliKonusma.uyeler.some((u) => u.kullanici_id === kullanici?.id)
                    : false;
                  // Gönderen adını göster:
                  // - Grup konuşmalarında karşı taraf mesajlarında
                  // - Gözlem modunda HER mesajda (admin kim yazdı görsün)
                  const adGoster = gozlemModu || (!benim && seciliKonusma?.tip === "grup");
                  return (
                    <div key={m.id} className={`flex ${benim ? "justify-end" : "justify-start"} group`}>
                      <div className={`max-w-[85%] md:max-w-[70%] ${benim ? "bg-[#1E3A5F] text-white" : "bg-white border"} rounded-2xl px-3 py-1.5 md:py-2 relative shadow-sm`}>
                        {adGoster && (
                          <div className={`text-[10px] font-semibold mb-0.5 ${benim ? "text-blue-200" : "text-blue-600"}`}>{ad}</div>
                        )}
                        {m.silindi ? (
                          <div className="text-xs italic opacity-60">— Mesaj silindi —</div>
                        ) : (
                          <>
                            {m.icerik && <div className="text-sm whitespace-pre-wrap break-words leading-snug">{m.icerik}</div>}
                            {m.dosya_url && (
                              <div className="mt-1">
                                {m.dosya_tipi === "image" ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={m.dosya_url}
                                    alt={m.dosya_adi ?? ""}
                                    className="w-full max-w-[220px] md:max-w-[300px] max-h-[220px] md:max-h-[300px] object-cover rounded-lg cursor-pointer"
                                    onClick={() => {
                                      setLightboxUrl(m.dosya_url!);
                                      setLightboxAd(m.dosya_adi ?? "Resim");
                                      setLightboxZoom(1);
                                    }}
                                  />
                                ) : (
                                  <a href={m.dosya_url} target="_blank" rel="noopener noreferrer" className={`flex items-center gap-1.5 text-xs ${benim ? "text-blue-200" : "text-blue-600"} underline break-all`}>
                                    <Paperclip size={12} className="flex-shrink-0" />
                                    <span className="truncate">{m.dosya_adi || "Dosya"}</span>
                                  </a>
                                )}
                              </div>
                            )}
                          </>
                        )}
                        <div className={`text-[9px] ${benim ? "text-blue-200" : "text-gray-400"} mt-0.5 text-right`}>
                          {new Date(m.created_at).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}
                        </div>
                        {/* Silme: sadece yönetici ve şantiye yöneticisi yapabilir, her zaman görünür */}
                        {!m.silindi && yetkiliSilmek && (
                          <button
                            type="button"
                            onClick={() => mesajSilHandle(m)}
                            className={`absolute ${benim ? "-left-2" : "-right-2"} -top-2 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 shadow-md`}
                            title="Mesajı sil"
                          >
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Mesaj yazma */}
            <div className="border-t p-3 flex items-end gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
                className="hidden"
                onChange={dosyaSec}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={dosyaYukleniyor}
                className="p-2 text-gray-500 hover:text-[#1E3A5F] disabled:opacity-50"
                title="Dosya/Resim ekle"
              >
                {dosyaYukleniyor ? <span className="text-xs">...</span> : <ImageIcon size={18} />}
              </button>
              <textarea
                ref={textareaRef}
                value={yeniMesaj}
                onChange={(e) => setYeniMesaj(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); mesajGonderHandle(); } }}
                placeholder="Mesaj yaz... (Enter ile gönder, Shift+Enter ile yeni satır)"
                rows={1}
                className="flex-1 text-sm border rounded-lg px-3 py-2 outline-none focus:border-[#1E3A5F] resize-none overflow-y-auto"
                style={{ minHeight: "40px", maxHeight: "200px" }}
              />
              <Button
                size="sm"
                className="bg-[#1E3A5F] hover:bg-[#2a4f7a] h-9"
                onClick={mesajGonderHandle}
                disabled={!yeniMesaj.trim()}
              >
                <Send size={14} />
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Yeni Konuşma Dialog */}
      <Dialog open={yeniKonusmaDialog} onOpenChange={setYeniKonusmaDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Yeni Konuşma Başlat</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {seciliKullanicilar.size > 1 && (
              <div>
                <label className="text-xs font-medium text-gray-600">Grup Adı (opsiyonel)</label>
                <Input
                  value={grupBaslik}
                  onChange={(e) => setGrupBaslik(e.target.value)}
                  placeholder="Grup Konuşması"
                  className="mt-1"
                />
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-gray-600 mb-2 block">
                Kullanıcı Seç ({seciliKullanicilar.size} seçili)
              </label>
              <div className="max-h-[300px] overflow-y-auto border rounded-md">
                {tumKullanicilar.map((k) => {
                  const isSelected = seciliKullanicilar.has(k.id);
                  return (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => {
                        const yeni = new Set(seciliKullanicilar);
                        if (isSelected) yeni.delete(k.id);
                        else yeni.add(k.id);
                        setSeciliKullanicilar(yeni);
                      }}
                      className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-blue-50 flex items-center gap-2 ${isSelected ? "bg-blue-50" : ""}`}
                    >
                      <input type="checkbox" checked={isSelected} onChange={() => {}} className="w-4 h-4" />
                      <span className="text-sm">{k.ad_soyad}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setYeniKonusmaDialog(false); setSeciliKullanicilar(new Set()); }}>
                İptal
              </Button>
              <Button className="bg-[#F97316] hover:bg-[#ea580c]" onClick={yeniKonusmaBaslat} disabled={seciliKullanicilar.size === 0}>
                Başlat ({seciliKullanicilar.size === 1 ? "1-1" : `${seciliKullanicilar.size + 1} kişilik grup`})
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Resim Lightbox — Supabase URL'i kullanıcıya gözükmesin diye uygulama içi modal */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center"
          onClick={() => setLightboxUrl(null)}
          onWheel={(e) => {
            e.preventDefault();
            setLightboxZoom((z) => {
              const next = e.deltaY < 0 ? z * 1.15 : z / 1.15;
              return Math.max(0.3, Math.min(5, next));
            });
          }}
        >
          {/* Üst toolbar */}
          <div className="absolute top-0 left-0 right-0 px-4 py-3 bg-gradient-to-b from-black/70 to-transparent flex items-center justify-between gap-2 text-white" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-medium truncate flex-1">{lightboxAd}</div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.max(0.3, z / 1.2))}
                className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-sm font-bold"
                title="Uzaklaştır"
              >
                −
              </button>
              <span className="text-xs tabular-nums w-12 text-center">{Math.round(lightboxZoom * 100)}%</span>
              <button
                type="button"
                onClick={() => setLightboxZoom((z) => Math.min(5, z * 1.2))}
                className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-sm font-bold"
                title="Yakınlaştır"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setLightboxZoom(1)}
                className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs"
                title="Sıfırla"
              >
                1:1
              </button>
              <button
                type="button"
                onClick={() => setLightboxUrl(null)}
                className="p-1.5 bg-white/10 hover:bg-white/20 rounded ml-2"
                title="Kapat (Esc)"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Resim */}
          <div className="overflow-auto w-full h-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxUrl}
              alt={lightboxAd}
              draggable={false}
              style={{ transform: `scale(${lightboxZoom})`, transformOrigin: "center", transition: "transform 0.05s linear" }}
              className="max-w-[95vw] max-h-[95vh] object-contain select-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
