// 3-segmentli tarih girişi: [gg] . [aa] . [yyyy]
// Herhangi bir segmenti silince o kısım ".." (veya "....") olarak gösterim stringine yazılır
// Örn:
//   gün=24, ay=04, yıl=2026 → gosterim="24.04.2026", tarih="2026-04-24"
//   gün=boş, ay=04, yıl=2026 → gosterim="..04.2026", tarih=null (partial)
//   gün=boş, ay=boş, yıl=2026 → gosterim="....2026", tarih=null
"use client";

import { useEffect, useState } from "react";

type Props = {
  value: string | null;      // "YYYY-MM-DD" (tam tarih) veya null
  gosterim: string | null;   // Kısmi gösterim "dd.MM.yyyy" formatında
  onChange: (degerler: { tarih: string | null; gosterim: string | null }) => void;
  disabled?: boolean;
};

// ISO "YYYY-MM-DD" → { gun, ay, yil }
function isoParcala(iso: string | null): { gun: string; ay: string; yil: string } {
  if (!iso) return { gun: "", ay: "", yil: "" };
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return { gun: "", ay: "", yil: "" };
  return { gun: m[3], ay: m[2], yil: m[1] };
}

// Gösterim stringinden parçaları çıkar:
//   "24/04/2026"       → { gun: "24",   ay: "04",   yil: "2026" }
//   "..../04/2026"     → { gun: "",     ay: "04",   yil: "2026" }
//   "..../..../2026"   → { gun: "",     ay: "",     yil: "2026" }
//   "..../..../2"      → { gun: "",     ay: "",     yil: "2"    } (kullanıcı yıl yazıyor)
//   "24.04.2026"       → (eski format) desteklenir
function gosterimParcala(gs: string | null): { gun: string; ay: string; yil: string } | null {
  if (!gs) return null;
  // "...." (4+ nokta) → marker, sonra / veya . ile bölünür
  const s = gs.replace(/\.{4,}/g, "§EMPTY§");
  const parcalar = s.split(/[\/.]/);
  if (parcalar.length !== 3) return null;
  const [g, a, y] = parcalar.map((p) => p === "§EMPTY§" ? "" : p);
  return {
    // Partial digits korunur (kullanıcı yazarken state reset olmasın)
    gun: /^\d{1,2}$/.test(g) ? g : "",
    ay: /^\d{1,2}$/.test(a) ? a : "",
    yil: /^\d{1,4}$/.test(y) ? y : "",
  };
}

export default function TarihInput({ value, gosterim, onChange, disabled }: Props) {
  // Başlangıç: gosterim varsa onu kullan, yoksa value
  const ilk = gosterimParcala(gosterim) ?? isoParcala(value);
  const [gun, setGun] = useState(ilk.gun);
  const [ay, setAy] = useState(ilk.ay);
  const [yil, setYil] = useState(ilk.yil);

  // Dış value/gosterim değişince (düzenleme modu vs.) local state güncelle
  useEffect(() => {
    const yeni = gosterimParcala(gosterim) ?? isoParcala(value);
    setGun(yeni.gun);
    setAy(yeni.ay);
    setYil(yeni.yil);
  }, [value, gosterim]);

  // Değişiklikleri dışarı gönder
  function bildir(g: string, a: string, y: string) {
    const gOk = /^\d{2}$/.test(g);
    const aOk = /^\d{2}$/.test(a);
    const yOk = /^\d{4}$/.test(y);

    // Tamamen boşsa
    if (!g && !a && !y) {
      onChange({ tarih: null, gosterim: null });
      return;
    }

    // Tam ve geçerli tarih → ISO olarak kaydet
    if (gOk && aOk && yOk) {
      const gi = parseInt(g, 10), ai = parseInt(a, 10);
      if (ai >= 1 && ai <= 12 && gi >= 1 && gi <= 31) {
        onChange({ tarih: `${y}-${a}-${g}`, gosterim: null });
        return;
      }
    }

    // Kısmi — boş segmentler "...." olarak gösterilir, ayırıcı "/"
    // Padding YAPMA — kullanıcı yazarken state'i bozmasın
    // (örn. "1" yazınca "01" yapılırsa, sonra "5" yazıldığında slice ile "5" kaybolur)
    const PLACEHOLDER = "....";
    const gsGun = g || PLACEHOLDER;
    const gsAy = a || PLACEHOLDER;
    const gsYil = y || PLACEHOLDER;
    onChange({ tarih: null, gosterim: `${gsGun}/${gsAy}/${gsYil}` });
  }

  // Input handler — numeric only
  function h(setter: (v: string) => void, maxLen: number, otherA: string, otherB: string, alan: "g" | "a" | "y") {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value.replace(/\D/g, "").slice(0, maxLen);
      setter(v);
      if (alan === "g") bildir(v, otherA, otherB);
      else if (alan === "a") bildir(otherA, v, otherB);
      else bildir(otherA, otherB, v);
    };
  }

  const kutu =
    "h-9 rounded-lg border border-input bg-white text-center text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50 font-mono disabled:opacity-50 disabled:bg-gray-50";

  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="numeric"
        placeholder="gg"
        value={gun}
        onChange={h(setGun, 2, ay, yil, "g")}
        disabled={disabled}
        className={`${kutu} w-12`}
        maxLength={2}
      />
      <span className="text-gray-500 font-bold">.</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="aa"
        value={ay}
        onChange={h(setAy, 2, gun, yil, "a")}
        disabled={disabled}
        className={`${kutu} w-12`}
        maxLength={2}
      />
      <span className="text-gray-500 font-bold">.</span>
      <input
        type="text"
        inputMode="numeric"
        placeholder="yyyy"
        value={yil}
        onChange={h(setYil, 4, gun, ay, "y")}
        disabled={disabled}
        className={`${kutu} w-20`}
        maxLength={4}
      />
    </div>
  );
}
