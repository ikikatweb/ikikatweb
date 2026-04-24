// Kullanıcının bildirim kategorilerini açıp kapatma dialog'u
"use client";

import { useState, useEffect } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import toast from "react-hot-toast";

// Kategori tanımları — tag, etiket, açıklama
const KATEGORILER: { tag: string; label: string; emoji: string; desc: string }[] = [
  { tag: "kasa", label: "Kasa Hareketi", emoji: "💰", desc: "Yeni gelir/gider eklenince" },
  { tag: "arac-bakim", label: "Araç Bakım & Tamirat", emoji: "🛠️", desc: "Yeni bakım veya tamirat eklenince" },
  { tag: "personel-puantaj", label: "Personel Puantaj", emoji: "👷", desc: "Yeni personel puantaj kaydı" },
  { tag: "arac-puantaj", label: "Araç Puantaj", emoji: "🚚", desc: "Yeni araç puantaj kaydı" },
  { tag: "yakit", label: "Yakıt Alımı", emoji: "⛽", desc: "Yeni yakıt alımı eklenince" },
  { tag: "gelen-evrak", label: "Gelen Evrak", emoji: "📥", desc: "Yeni gelen evrak kaydı" },
  { tag: "giden-evrak", label: "Giden Evrak", emoji: "📤", desc: "Yeni giden evrak kaydı" },
  { tag: "banka-yazismalari", label: "Banka Yazışması", emoji: "🏦", desc: "Yeni banka yazışması / hızlı talimat" },
  { tag: "yaklasan-sigorta", label: "Yaklaşan Sigorta & Muayene", emoji: "📋", desc: "Günlük sabah özeti (08:00)" },
  { tag: "yaklasan-bakim", label: "Yaklaşan Araç Bakımı", emoji: "🛠️", desc: "Günlük sabah özeti (08:00)" },
];

export default function PushBildirimAyarlari() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ayarlar, setAyarlar] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/push/settings")
      .then((r) => r.json())
      .then((data) => setAyarlar((data.ayarlar as Record<string, boolean>) ?? {}))
      .catch(() => toast.error("Ayarlar yüklenemedi"))
      .finally(() => setLoading(false));
  }, [open]);

  async function kaydet() {
    setSaving(true);
    try {
      const res = await fetch("/api/push/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ayarlar }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kayıt başarısız");
      toast.success("Bildirim tercihleri kaydedildi.");
      setOpen(false);
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : ""}`);
    } finally {
      setSaving(false);
    }
  }

  function toggle(tag: string) {
    setAyarlar((a) => ({ ...a, [tag]: !isAcik(a, tag) }));
  }

  function isAcik(a: Record<string, boolean>, tag: string) {
    // Varsayılan: açık (true). Sadece açıkça false olarak işaretlenmişse kapalı.
    return a[tag] !== false;
  }

  function hepsiniKapat() {
    const yeni: Record<string, boolean> = {};
    for (const k of KATEGORILER) yeni[k.tag] = false;
    setAyarlar(yeni);
  }
  function hepsiniAc() {
    const yeni: Record<string, boolean> = {};
    for (const k of KATEGORILER) yeni[k.tag] = true;
    setAyarlar(yeni);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-2 rounded-md text-gray-500 hover:text-[#1E3A5F] hover:bg-gray-100 transition-colors"
        title="Bildirim Ayarları"
      >
        <Settings size={18} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings size={18} /> Bildirim Ayarları
            </DialogTitle>
          </DialogHeader>

          <p className="text-xs text-gray-500 mb-2">
            Hangi olaylar için bildirim almak istediğini seç. Kapattığın kategoriler için artık bildirim almayacaksın.
          </p>

          <div className="flex gap-2 mb-3">
            <Button type="button" size="sm" variant="outline" onClick={hepsiniAc}>Hepsini Aç</Button>
            <Button type="button" size="sm" variant="outline" onClick={hepsiniKapat}>Hepsini Kapat</Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {KATEGORILER.map((k) => {
                const acik = isAcik(ayarlar, k.tag);
                return (
                  <label
                    key={k.tag}
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      acik ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={acik}
                      onChange={() => toggle(k.tag)}
                      className="h-4 w-4 accent-emerald-600"
                    />
                    <span className="text-xl">{k.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900">{k.label}</div>
                      <div className="text-[10px] text-gray-500 truncate">{k.desc}</div>
                    </div>
                    <span className={`text-[10px] font-bold ${acik ? "text-emerald-700" : "text-gray-400"}`}>
                      {acik ? "AÇIK" : "KAPALI"}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <DialogFooter className="gap-2 mt-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>İptal</Button>
            <Button
              className="bg-[#1E3A5F] hover:bg-[#15293f] text-white"
              onClick={kaydet}
              disabled={saving || loading}
            >
              {saving ? "Kaydediliyor..." : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
