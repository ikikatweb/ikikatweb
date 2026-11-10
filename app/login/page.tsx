// Login sayfası - Kullanıcı adı ve şifre ile giriş
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import toast from "react-hot-toast";
import LogoDonen from "@/components/shared/logo-donen";
import { hatirlamayiKaydet } from "@/lib/auth/beni-hatirla";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // AÇIK BAŞLAR: bugüne kadar kutuyu işaretlemeyen de girişli kalıyordu (eski
  // mantık tersine çalışıyordu, bkz. lib/auth/beni-hatirla.ts). Kapalı başlatmak
  // herkesi uygulamayı her kapattığında yeniden şifre yazmaya mahkûm ederdi.
  // İsteyen kutuyu kaldırır: o zaman uygulama kapanınca çıkış yapılır.
  const [rememberMe, setRememberMe] = useState(true);
  // Şifremi unuttum paneli
  // Kurumsal sayfadaki giriş kutusundan "Şifremi unuttum" ile gelinirse panel AÇIK başlar.
  const [unuttumAcik, setUnuttumAcik] = useState(false);
  const [unuttumKullanici, setUnuttumKullanici] = useState("");
  const [unuttumBekle, setUnuttumBekle] = useState(false);
  const [unuttumSonuc, setUnuttumSonuc] = useState("");

  async function sifreUnuttum() {
    const ad = unuttumKullanici.trim();
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
    } catch {
      toast.error("Bağlantı hatası, tekrar deneyin.");
    } finally { setUnuttumBekle(false); }
  }
  const [loading, setLoading] = useState(false);
  // URL'de ?oturum=bitti varsa uyarı göster. useSearchParams yerine doğrudan location
  // okunuyor: bu sayfa Suspense sınırı istemesin diye.
  const [oturumBitti, setOturumBitti] = useState(false);
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      setOturumBitti(sp.get("oturum") === "bitti");
      // Kurumsal sayfadaki giriş kutusundaki "Şifremi unuttum" buraya ?unuttum=1 ile getirir.
      if (sp.get("unuttum") === "1") setUnuttumAcik(true);
    } catch { /* önemsiz */ }
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast.error("Kullanıcı adı ve şifre alanları boş bırakılamaz.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      // Türkçe karakterleri temizle
      const normalize = (s: string) => s.trim().toLowerCase()
        .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i")
        .replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
        .replace(/[^a-z0-9]/g, "");
      const normalized = normalize(username);
      // Mevcut kullanıcılar için birden fazla domain dene
      const domains = ["@ikikat.local", "@gmail.com", "@ikikatweb.vercel.app", "@ikikat.com"];
      let error = null;
      for (const domain of domains) {
        const result = await supabase.auth.signInWithPassword({
          email: normalized + domain,
          password,
        });
        if (!result.error) { error = null; break; }
        error = result.error;
      }

      if (error) {
        toast.error("Kullanıcı adı veya şifre hatalı.");
      } else {
        hatirlamayiKaydet(rememberMe);
        toast.success("Giriş başarılı, yönlendiriliyorsunuz...");
        // ══ TAM SAYFA GEÇİŞİ — ŞİFRENİN TELEFONA KAYDEDİLMESİ İÇİN ══
        // Safari/Chrome "şifreyi kaydedeyim mi?" diye yalnız şifre alanı dolu bir
        // formdan sonra GERÇEK bir sayfa geçişi olursa sorar. router.push yalnız
        // React içinde gezindiği için tarayıcı girişin tamamlandığını hiç görmüyor,
        // kaydetme önerisi de hiç çıkmıyordu (iPhone'da şifre her açılışta elle
        // yazılıyordu). Tam geçiş ayrıca sunucuya taze çerezle gidilmesini sağlıyor.
        window.location.assign("/dashboard");
      }
    } catch {
      toast.error("Bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div className="w-full max-w-md">
        {/* Uygulama Başlığı */}
        <div className="text-center mb-8">
          {/* Grup birden çok firmadan oluşuyor: logolar sırayla dönüyor (bkz. logo-donen). */}
          <LogoDonen className="h-48 w-full mb-3" araSn={5} />
          <p className="text-sm text-gray-500 mt-1">
            Yönetim Sistemi
          </p>
        </div>

        {/* Login Kartı */}
        <Card className="border-0 shadow-lg">
          <CardHeader className="bg-[#1E3A5F] rounded-t-lg">
            <CardTitle className="text-white text-center text-lg">
              Giriş Yap
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {/* Oturumu düşen kullanıcı buraya "?oturum=bitti" ile gelir (bkz. auth-context).
                Neden çıkarıldığı yazmazsa kullanıcı kendini rastgele atılmış sanıyor. */}
            {oturumBitti && (
              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 leading-relaxed">
                <strong>Oturumunuz sona erdi.</strong> Güvenlik için bir süre sonra çıkış yapılıyor.
                Lütfen tekrar giriş yapın — verileriniz yerinde.
              </div>
            )}
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Kullanıcı Adı</Label>
                <Input
                  id="username"
                  // name: şifre yöneticileri alanı adıyla tanıyor — kaydetme ve
                  // sonraki otomatik doldurma bu ikiliye bakıyor.
                  name="username"
                  type="text"
                  placeholder="Kullanıcı adınızı girin"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Şifre</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Şifrenizi girin"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-gray-300" />
                  <span className="text-sm text-gray-600" title={
                    "İşaretli: bir daha şifre sorulmaz — uygulamayı kapatıp açsanız da girişli kalırsınız.\n"
                    + "İşaretsiz: uygulamayı kapattığınızda çıkış yapılır."
                  }>Beni hatırla</span>
                </label>
                <button type="button" onClick={() => { setUnuttumAcik(true); setUnuttumSonuc(""); }}
                  className="text-sm text-[#1E3A5F] hover:text-[#F97316] hover:underline">
                  Şifremi unuttum
                </button>
              </div>

              <Button
                type="submit"
                className="w-full bg-[#F97316] hover:bg-[#ea580c] text-white font-medium"
                disabled={loading}
              >
                {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
              </Button>
            </form>

            {/* ŞİFREMİ UNUTTUM — kullanıcı adı yazılır, kayıtlı e-postasına tek kullanımlık
                bağlantı gider. Yanıt her durumda AYNI: "kayıtlıysa gönderildi". Kullanıcının
                var olup olmadığı dışarı sızdırılmaz. */}
            {unuttumAcik && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <p className="text-[13px] font-semibold text-[#1E3A5F]">Şifre yenileme</p>
                <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                  Kullanıcı adınızı yazın; sistemde kayıtlı e-posta adresinize yenileme bağlantısı gönderelim.
                </p>
                {unuttumSonuc ? (
                  <p className="mt-2 text-xs text-emerald-700 leading-relaxed">{unuttumSonuc}</p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={unuttumKullanici}
                      onChange={(e) => setUnuttumKullanici(e.target.value)}
                      placeholder="Kullanıcı adı"
                      disabled={unuttumBekle}
                      className="h-9 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sifreUnuttum(); } }}
                    />
                    <Button type="button" onClick={sifreUnuttum} disabled={unuttumBekle}
                      className="h-9 shrink-0 bg-[#1E3A5F] hover:bg-[#162c47] text-white text-sm">
                      {unuttumBekle ? "Gönderiliyor…" : "Gönder"}
                    </Button>
                  </div>
                )}
                <button type="button" onClick={() => setUnuttumAcik(false)}
                  className="mt-2 text-[11px] text-gray-400 hover:text-gray-600">Kapat</button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
