"use client";

// E-POSTA DOĞRULAMA — maildeki bağlantı buraya düşer (/eposta-dogrula?t=...).
// Sayfa açılır açılmaz jetonu sunucuya gönderir; kullanıcıdan bir şey istemez.
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";

function Durum() {
  const token = useSearchParams().get("t") ?? "";
  const [durum, setDurum] = useState<"bekliyor" | "tamam" | "hata">("bekliyor");
  const [mesaj, setMesaj] = useState("");

  useEffect(() => {
    if (!token) { setDurum("hata"); setMesaj("Bağlantı eksik."); return; }
    (async () => {
      try {
        const r = await fetch("/api/eposta/dogrula", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const d = await r.json();
        if (r.ok) { setDurum("tamam"); setMesaj(d.eposta ?? ""); }
        else { setDurum("hata"); setMesaj(d.error ?? "Doğrulanamadı."); }
      } catch { setDurum("hata"); setMesaj("Bağlantı hatası."); }
    })();
  }, [token]);

  if (durum === "bekliyor") return <p className="text-sm text-gray-500">Doğrulanıyor…</p>;
  if (durum === "hata") return <p className="text-sm text-red-600">{mesaj}</p>;
  return (
    <div>
      <p className="text-sm font-medium text-emerald-700">Adresiniz doğrulandı.</p>
      <p className="mt-1 text-xs text-gray-500">{mesaj}</p>
      <p className="mt-3 text-xs text-gray-500">Şifrenizi unutursanız yenileme bağlantısı bu adrese gönderilecek.</p>
      <a href="/login" className="mt-4 inline-block text-sm font-semibold text-[#F97316] hover:underline">Giriş ekranına dön</a>
    </div>
  );
}

export default function EpostaDogrulaPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-2 text-[#1E3A5F]">
          <MailCheck size={20} />
          <h1 className="text-lg font-bold">E-posta Doğrulama</h1>
        </div>
        <Suspense fallback={<p className="text-sm text-gray-400">Yükleniyor…</p>}>
          <Durum />
        </Suspense>
      </div>
    </div>
  );
}
