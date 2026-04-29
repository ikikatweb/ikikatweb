// Mesajlaşma sayfası — kullanıcı arası 1-1 ve grup konuşmaları
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import { MessageSquare, Send, Plus, Paperclip, Image as ImageIcon, Trash2, Download, Users, X, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import { createClient } from "@/lib/supabase/client";

type Kullanici = { id: string; ad_soyad: string };

export default function MesajlasmaPage() {
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
  const [adMap, setAdMap] = useState<Map<string, string>>(new Map());

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

  // Konuşmayı yedekle (JSON indir)
  async function konusmaYedekleHandle() {
    if (!seciliKonusmaId) return;
    try {
      const data = await konusmaYedekle(seciliKonusmaId);
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `konusma-${seciliKonusmaId}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Yedek indirildi.");
    } catch (err) {
      toast.error("Yedeklenemedi: " + (err instanceof Error ? err.message : ""));
    }
  }

  const seciliKonusma = konusmalar.find((k) => k.id === seciliKonusmaId);
  const konusmaBasligi = seciliKonusma
    ? seciliKonusma.tip === "grup"
      ? seciliKonusma.baslik || "Grup"
      : seciliKonusma.uyeler.find((u) => u.kullanici_id !== kullanici?.id)?.ad_soyad || "—"
    : "";

  if (!kullanici) return <div className="p-4 text-gray-500">Yükleniyor...</div>;

  return (
    <div className="flex h-[calc(100dvh-56px)] md:h-[calc(100vh-120px)] gap-0 md:gap-3 -m-4 md:m-0">
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
              const baslik = k.tip === "grup"
                ? k.baslik || "Grup"
                : k.uyeler.find((u) => u.kullanici_id !== kullanici?.id)?.ad_soyad || "—";
              const aktif = k.id === seciliKonusmaId;
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
                        {k.okunmamisSayisi > 0 && (
                          <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0">
                            {k.okunmamisSayisi}
                          </span>
                        )}
                      </div>
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
                <h3 className="font-bold text-sm text-[#1E3A5F] truncate">{konusmaBasligi}</h3>
                {seciliKonusma?.tip === "grup" && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">
                    {seciliKonusma.uyeler.length} üye
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={konusmaYedekleHandle}
                  className="p-1.5 text-gray-400 hover:text-[#1E3A5F] rounded"
                  title="Yedekle (JSON indir)"
                >
                  <Download size={16} />
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
                  return (
                    <div key={m.id} className={`flex ${benim ? "justify-end" : "justify-start"} group`}>
                      <div className={`max-w-[85%] md:max-w-[70%] ${benim ? "bg-[#1E3A5F] text-white" : "bg-white border"} rounded-2xl px-3 py-1.5 md:py-2 relative shadow-sm`}>
                        {!benim && seciliKonusma?.tip === "grup" && (
                          <div className="text-[10px] font-semibold text-blue-600 mb-0.5">{ad}</div>
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
                                    onClick={() => window.open(m.dosya_url!, "_blank")}
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
                        {!m.silindi && (benim || yetkiliSilmek) && (
                          <button
                            type="button"
                            onClick={() => mesajSilHandle(m)}
                            className={`absolute ${benim ? "left-1" : "right-1"} -top-2 opacity-0 group-hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-red-500 text-white rounded-full p-1 transition-opacity`}
                            title="Mesajı sil"
                          >
                            <X size={10} />
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
                value={yeniMesaj}
                onChange={(e) => setYeniMesaj(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); mesajGonderHandle(); } }}
                placeholder="Mesaj yaz... (Enter ile gönder, Shift+Enter ile yeni satır)"
                rows={1}
                className="flex-1 text-sm border rounded-lg px-3 py-2 outline-none focus:border-[#1E3A5F] resize-none max-h-32"
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
    </div>
  );
}
