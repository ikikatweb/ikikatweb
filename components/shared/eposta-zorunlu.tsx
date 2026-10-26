"use client";

// E-POSTA ZORUNLU KUTUSU — adresi olmayan kullanıcı panele giremeden önce doldurur.
//
// Neden zorunlu: "şifremi unuttum" akışı kayıtlı bir adrese bağlı. Adres yoksa kullanıcı
// şifresini unuttuğunda hiçbir şey yapamıyor; açık metin şifre kopyası da kaldırıldığı için
// yönetici de eskisi gibi "şifren şu" diyemiyor. Bu yüzden adres bir kereye mahsus istenir.
//
// KAPATILAMAZ: çarpı yok, Esc yok, dışarı tıklama yok — kullanıcı adresi kaydedene kadar
// panelde işlem yapamaz (kullanıcı kararı). Kaydedince pencere kapanır ve bir daha çıkmaz.
//
// Adresi olmayan biri gerçekten mahsur kalırsa yönetici Kullanıcılar ekranından onun adına
// girebilir; kullanıcı bir sonraki açılışta kutuyu görmez.

import { useState } from "react";
import { useAuth } from "@/hooks";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import toast from "react-hot-toast";

const GECERLI = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function EpostaZorunlu() {
  const { kullanici, loading } = useAuth();
  const [eposta, setEposta] = useState("");
  const [bekle, setBekle] = useState(false);
  // Kaydettikten sonra profil yeniden okunmadan da kapansın diye yerel bayrak.
  const [kaydedildi, setKaydedildi] = useState(false);

  const gerekli = !loading && !!kullanici && !String(kullanici.eposta ?? "").trim() && !kaydedildi;
  if (!gerekli) return null;

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    const v = eposta.trim();
    if (!GECERLI.test(v)) { toast.error("Geçerli bir e-posta adresi girin."); return; }
    setBekle(true);
    try {
      const r = await fetch("/api/eposta", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eposta: v }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Kaydedilemedi."); return; }
      setKaydedildi(true);
      toast.success(d.mailGitti
        ? "Adresiniz kaydedildi — doğrulama bağlantısı gönderildi."
        : "Adresiniz kaydedildi.");
    } catch {
      toast.error("Bağlantı hatası, tekrar deneyin.");
    } finally { setBekle(false); }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
        <div className="mb-2 flex items-center gap-2 text-[#1E3A5F]">
          <Mail size={20} />
          <h2 className="text-base font-bold">E-posta adresinizi girin</h2>
        </div>
        <p className="mb-3 text-[13px] leading-relaxed text-gray-600">
          Merhaba <b>{kullanici?.ad_soyad}</b>, devam etmeden önce bir e-posta adresi tanımlamanız
          gerekiyor. Şifrenizi unutursanız <b>yeni şifre oluşturma bağlantısı</b> bu adrese gönderilecek.
        </p>
        <form onSubmit={kaydet} className="space-y-2.5">
          <Input
            type="email"
            value={eposta}
            onChange={(e) => setEposta(e.target.value)}
            placeholder="ornek@firma.com"
            disabled={bekle}
            autoFocus
            autoComplete="email"
          />
          <Button type="submit" disabled={bekle}
            className="w-full bg-[#F97316] font-semibold text-white hover:bg-[#ea580c]">
            {bekle ? "Kaydediliyor…" : "Kaydet ve Devam Et"}
          </Button>
        </form>
        <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
          Bu adres girişte kullanılmaz — girişi kullanıcı adınızla yapmaya devam edersiniz.
          Adresinizi sonradan Şifre Değiştir penceresinden değiştirebilirsiniz.
        </p>
      </div>
    </div>
  );
}
