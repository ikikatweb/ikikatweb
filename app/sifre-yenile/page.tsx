"use client";

// YENİ ŞİFRE BELİRLEME — maildeki bağlantı buraya düşer (/sifre-yenile?t=...).
// Oturum YOK; yetki jetondan geliyor. Sayfa herkese açık (middleware yalnız /dashboard ve
// /login'i kapsıyor), jeton geçersizse hiçbir şey yapılamaz.
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import toast from "react-hot-toast";

function Form() {
  const router = useRouter();
  const token = useSearchParams().get("t") ?? "";
  const [sifre, setSifre] = useState("");
  const [tekrar, setTekrar] = useState("");
  const [goster, setGoster] = useState(false);
  const [bekle, setBekle] = useState(false);
  const [bitti, setBitti] = useState(false);

  async function kaydet(e: React.FormEvent) {
    e.preventDefault();
    if (sifre.trim().length < 6) { toast.error("Şifre en az 6 karakter olmalıdır."); return; }
    if (sifre !== tekrar) { toast.error("Şifreler aynı değil."); return; }
    setBekle(true);
    try {
      const r = await fetch("/api/sifre-sifirlama/tamamla", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, yeni_sifre: sifre }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Şifre güncellenemedi."); return; }
      setBitti(true);
      toast.success("Şifreniz güncellendi.");
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      toast.error("Bağlantı hatası.");
    } finally { setBekle(false); }
  }

  if (!token) {
    return <p className="text-sm text-red-600">Bağlantı eksik. Maildeki bağlantıyı tekrar açın.</p>;
  }
  if (bitti) {
    return (
      <div className="text-center">
        <p className="text-sm text-emerald-700 font-medium">Şifreniz güncellendi.</p>
        <p className="mt-1 text-xs text-gray-500">Giriş ekranına yönlendiriliyorsunuz…</p>
      </div>
    );
  }

  return (
    <form onSubmit={kaydet} className="space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-600">Yeni şifre</label>
        <div className="relative mt-1">
          <input type={goster ? "text" : "password"} value={sifre} onChange={(e) => setSifre(e.target.value)}
            disabled={bekle} autoFocus placeholder="En az 6 karakter"
            className="w-full h-10 rounded-lg border border-gray-300 px-3 pr-10 text-sm outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/20" />
          <button type="button" onClick={() => setGoster((g) => !g)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            {goster ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-gray-600">Yeni şifre (tekrar)</label>
        <input type={goster ? "text" : "password"} value={tekrar} onChange={(e) => setTekrar(e.target.value)}
          disabled={bekle} placeholder="Aynı şifreyi tekrar yazın"
          className="mt-1 w-full h-10 rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-[#1E3A5F] focus:ring-2 focus:ring-[#1E3A5F]/20" />
      </div>
      <button type="submit" disabled={bekle}
        className="w-full h-10 rounded-lg bg-[#F97316] font-semibold text-white hover:bg-[#ea580c] disabled:opacity-60">
        {bekle ? "Kaydediliyor…" : "Şifreyi Güncelle"}
      </button>
    </form>
  );
}

export default function SifreYenilePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-[#1E3A5F]">
          <KeyRound size={20} />
          <h1 className="text-lg font-bold">Yeni Şifre Belirle</h1>
        </div>
        <Suspense fallback={<p className="text-sm text-gray-400">Yükleniyor…</p>}>
          <Form />
        </Suspense>
      </div>
    </div>
  );
}
