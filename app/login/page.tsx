// Login sayfası - Kullanıcı adı ve şifre ile giriş
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import toast from "react-hot-toast";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    if (!username.trim() || !password.trim()) {
      toast.error("Kullanıcı adı ve şifre alanları boş bırakılamaz.");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const email = `${username.trim().toLowerCase()}@ikikat.com`;
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast.error("Kullanıcı adı veya şifre hatalı.");
      } else {
        // Beni hatırla: localStorage'a kaydet
        if (rememberMe) {
          localStorage.setItem("rememberMe", "true");
          localStorage.setItem("rememberExpiry", String(Date.now() + 7 * 24 * 60 * 60 * 1000)); // 7 gün
        } else {
          localStorage.removeItem("rememberMe");
          localStorage.removeItem("rememberExpiry");
        }
        toast.success("Giriş başarılı, yönlendiriliyorsunuz...");
        router.push("/dashboard");
        router.refresh();
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="KAD-TEM" className="h-16 object-contain mx-auto mb-2" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          <h1 className="text-3xl font-bold text-[#1E3A5F]">KAD-TEM A.Ş.</h1>
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
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Kullanıcı Adı</Label>
                <Input
                  id="username"
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
                  type="password"
                  placeholder="Şifrenizi girin"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-gray-300" />
                <span className="text-sm text-gray-600">Beni hatırla</span>
              </label>

              <Button
                type="submit"
                className="w-full bg-[#F97316] hover:bg-[#ea580c] text-white font-medium"
                disabled={loading}
              >
                {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
