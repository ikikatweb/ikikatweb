// Ana sayfa sağ üstteki "Giriş" butonu → küçük açılır kutu (popover) içinde kullanıcı adı/şifre.
// Giriş mantığı /login sayfasıyla BİREBİR (normalize + çoklu domain deneme + Supabase). Başarılıysa
// /dashboard'a gider. Dış tıklama / Esc ile kapanır.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, LogIn, X } from "lucide-react";
import toast from "react-hot-toast";

export default function GirisPopover() {
  const [acik, setAcik] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // ŞİFREMİ UNUTTUM — aynı kutuda, ayrı sayfaya GİTMEDEN. Kullanıcılar girişi buradan
  // yapıyor; yenileme için /login'e yollamak gereksiz bir adımdı.
  const [unuttumModu, setUnuttumModu] = useState(false);
  const [unuttumBekle, setUnuttumBekle] = useState(false);
  const [unuttumSonuc, setUnuttumSonuc] = useState("");
  const kutuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Dış tıklama / Esc ile kapat
  useEffect(() => {
    if (!acik) return;
    const disTik = (e: MouseEvent) => { if (kutuRef.current && !kutuRef.current.contains(e.target as Node)) setAcik(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAcik(false); };
    document.addEventListener("mousedown", disTik);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", disTik); document.removeEventListener("keydown", esc); };
  }, [acik]);

  async function girisYap(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) { toast.error("Kullanıcı adı ve şifre boş bırakılamaz."); return; }
    setLoading(true);
    try {
      const supabase = createClient();
      const normalize = (s: string) => s.trim().toLowerCase()
        .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
        .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
        .replace(/[^a-z0-9]/g, "");
      const normalized = normalize(username);
      const domains = ["@ikikat.local", "@gmail.com", "@ikikatweb.vercel.app", "@ikikat.com"];
      let error = null;
      for (const domain of domains) {
        const result = await supabase.auth.signInWithPassword({ email: normalized + domain, password });
        if (!result.error) { error = null; break; }
        error = result.error;
      }
      if (error) { toast.error("Kullanıcı adı veya şifre hatalı."); }
      else { toast.success("Giriş başarılı, yönlendiriliyorsunuz..."); router.push("/dashboard"); router.refresh(); }
    } catch { toast.error("Bir hata oluştu. Lütfen tekrar deneyin."); }
    finally { setLoading(false); }
  }

  async function sifreUnuttum(e: React.FormEvent) {
    e.preventDefault();
    const ad = username.trim();
    if (!ad) { toast.error("Kullanıcı adınızı yazın."); return; }
    setUnuttumBekle(true);
    try {
      const r = await fetch("/api/sifre-sifirlama/istek", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kullanici_adi: ad }),
      });
      const d = await r.json();
      // Yanıt bilerek genel: kullanıcı var/yok ayrımı sızdırılmaz.
      setUnuttumSonuc(d.mesaj ?? "İstek alındı. Kayıtlıysa e-postanıza bağlantı gönderildi.");
    } catch { toast.error("Bağlantı hatası, tekrar deneyin."); }
    finally { setUnuttumBekle(false); }
  }

  function girisEkraninaDon() {
    setUnuttumModu(false); setUnuttumSonuc(""); setPassword("");
  }

  return (
    <div className="relative" ref={kutuRef}>
      <button type="button" onClick={() => setAcik((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#F97316] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#ea580c]">
        <LogIn size={16} /> Giriş
      </button>
      {acik && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-[#1E3A5F]">
              {unuttumModu && (
                <button type="button" onClick={girisEkraninaDon} className="text-gray-400 hover:text-[#1E3A5F]" aria-label="Geri">
                  <ArrowLeft size={14} />
                </button>
              )}
              {unuttumModu ? "Şifre Yenileme" : "Yönetim Girişi"}
            </span>
            <button type="button" onClick={() => { setAcik(false); girisEkraninaDon(); }} className="text-gray-400 hover:text-gray-600" aria-label="Kapat"><X size={16} /></button>
          </div>

          {unuttumModu ? (
            unuttumSonuc ? (
              <div className="space-y-2.5">
                <p className="text-xs leading-relaxed text-emerald-700">{unuttumSonuc}</p>
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Mail birkaç dakika içinde gelmezse önemsiz/spam klasörünü kontrol edin.
                  Sistemde e-posta adresiniz tanımlı değilse yöneticinize başvurun.
                </p>
                <Button type="button" onClick={girisEkraninaDon}
                  className="w-full bg-[#1E3A5F] font-medium text-white hover:bg-[#16304f]">
                  Girişe dön
                </Button>
              </div>
            ) : (
              <form onSubmit={sifreUnuttum} className="space-y-2.5">
                <p className="text-[11px] leading-relaxed text-gray-500">
                  Kullanıcı adınızı yazın; kayıtlı e-posta adresinize yenileme bağlantısı gönderelim.
                </p>
                <Input type="text" placeholder="Kullanıcı adı" value={username} autoComplete="username"
                  onChange={(e) => setUsername(e.target.value)} disabled={unuttumBekle} autoFocus />
                <Button type="submit" disabled={unuttumBekle}
                  className="w-full bg-[#F97316] font-medium text-white hover:bg-[#ea580c]">
                  {unuttumBekle ? "Gönderiliyor..." : "Bağlantı Gönder"}
                </Button>
              </form>
            )
          ) : (
          <form onSubmit={girisYap} className="space-y-2.5">
            <Input type="text" placeholder="Kullanıcı adı" value={username} autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} disabled={loading} autoFocus />
            <Input type="password" placeholder="Şifre" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} disabled={loading} />
            <Button type="submit" disabled={loading}
              className="w-full bg-[#1E3A5F] font-medium text-white hover:bg-[#16304f]">
              {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
            </Button>
            <div className="pt-0.5 text-center">
              <button type="button" onClick={() => { setUnuttumModu(true); setUnuttumSonuc(""); }}
                className="text-xs text-gray-500 hover:text-[#F97316] hover:underline">
                Şifremi unuttum
              </button>
            </div>
          </form>
          )}
        </div>
      )}
    </div>
  );
}
