// Kullanıcı kendi şifresini değiştirme dialog'u
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Eye, EyeOff } from "lucide-react";
import toast from "react-hot-toast";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function SifreDegistirDialog({ open, onOpenChange }: Props) {
  const [eski, setEski] = useState("");
  const [yeni, setYeni] = useState("");
  const [yeniTekrar, setYeniTekrar] = useState("");
  const [eskiGoster, setEskiGoster] = useState(false);
  const [yeniGoster, setYeniGoster] = useState(false);
  const [saving, setSaving] = useState(false);

  function reset() {
    setEski(""); setYeni(""); setYeniTekrar("");
    setEskiGoster(false); setYeniGoster(false);
  }

  async function handleKaydet() {
    if (!eski.trim()) { toast.error("Eski şifrenizi girin."); return; }
    if (!yeni.trim()) { toast.error("Yeni şifrenizi girin."); return; }
    if (yeni.length < 6) { toast.error("Yeni şifre en az 6 karakter olmalı."); return; }
    if (yeni !== yeniTekrar) { toast.error("Yeni şifre ile tekrarı eşleşmiyor."); return; }
    if (yeni === eski) { toast.error("Yeni şifre eski şifre ile aynı olamaz."); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/kullanicilar/sifre-degistir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eski_sifre: eski, yeni_sifre: yeni }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(result.error || "Şifre değiştirilemedi.");
        return;
      }
      toast.success("Şifreniz güncellendi.");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={18} /> Şifre Değiştir
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1">
            <Label className="text-xs">Eski Şifre <span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                type={eskiGoster ? "text" : "password"}
                value={eski}
                onChange={(e) => setEski(e.target.value)}
                placeholder="Mevcut şifreniz"
                autoComplete="current-password"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setEskiGoster((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {eskiGoster ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Yeni Şifre <span className="text-red-500">*</span></Label>
            <div className="relative">
              <Input
                type={yeniGoster ? "text" : "password"}
                value={yeni}
                onChange={(e) => setYeni(e.target.value)}
                placeholder="En az 6 karakter"
                autoComplete="new-password"
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setYeniGoster((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {yeniGoster ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Yeni Şifre (Tekrar) <span className="text-red-500">*</span></Label>
            <Input
              type={yeniGoster ? "text" : "password"}
              value={yeniTekrar}
              onChange={(e) => setYeniTekrar(e.target.value)}
              placeholder="Yeni şifrenizi tekrar girin"
              autoComplete="new-password"
              onKeyDown={(e) => { if (e.key === "Enter") handleKaydet(); }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={saving}>
            İptal
          </Button>
          <Button
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleKaydet}
            disabled={saving}
          >
            {saving ? "Kaydediliyor..." : "Şifreyi Değiştir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
