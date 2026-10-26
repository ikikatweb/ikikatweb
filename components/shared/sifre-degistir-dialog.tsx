// Kullanıcı kendi şifresini değiştirme dialog'u
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Eye, EyeOff, Mail, MailCheck } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/hooks";

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
  // E-POSTA — şifresini unuttuğunda yenileme bağlantısının gideceği adres.
  // Burada duruyor çünkü kullanıcının kendi hesap bilgilerine baktığı tek yer burası.
  const { kullanici } = useAuth();
  const [eposta, setEposta] = useState(kullanici?.eposta ?? "");
  const [epostaKaydediyor, setEpostaKaydediyor] = useState(false);
  const [epostaKaydedildi, setEpostaKaydedildi] = useState(false);
  const dogrulandi = !!kullanici?.eposta_dogrulandi && (kullanici?.eposta ?? "") === eposta.trim();

  async function epostaKaydet() {
    const v = eposta.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { toast.error("Geçerli bir e-posta adresi girin."); return; }
    setEpostaKaydediyor(true);
    try {
      const r = await fetch("/api/eposta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eposta: v }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Kaydedilemedi."); return; }
      setEpostaKaydedildi(true);
      toast.success(d.mailGitti
        ? "Adres kaydedildi — doğrulama bağlantısı gönderildi."
        : "Adres kaydedildi, ancak doğrulama maili gönderilemedi.");
    } catch { toast.error("Bağlantı hatası."); }
    finally { setEpostaKaydediyor(false); }
  }

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
          {/* E-POSTA bölümü — şifre alanlarından önce: "şifremi unuttum" bunu gerektiriyor. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              {dogrulandi ? <MailCheck size={13} className="text-emerald-600" /> : <Mail size={13} className="text-gray-500" />}
              E-posta adresim
              {dogrulandi
                ? <span className="text-[10px] font-normal text-emerald-600">doğrulandı</span>
                : kullanici?.eposta ? <span className="text-[10px] font-normal text-amber-600">doğrulanmadı</span> : null}
            </Label>
            <div className="flex gap-1.5">
              <Input type="email" value={eposta} onChange={(e) => { setEposta(e.target.value); setEpostaKaydedildi(false); }}
                placeholder="ornek@firma.com" className="h-8 text-sm" />
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-xs"
                onClick={epostaKaydet} disabled={epostaKaydediyor || epostaKaydedildi || !eposta.trim()}>
                {epostaKaydediyor ? "…" : epostaKaydedildi ? "Kaydedildi" : "Kaydet"}
              </Button>
            </div>
            <p className="text-[10px] text-gray-400 leading-relaxed">
              Şifrenizi unutursanız yenileme bağlantısı bu adrese gönderilir. Girişte kullanılmaz.
            </p>
          </div>

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
