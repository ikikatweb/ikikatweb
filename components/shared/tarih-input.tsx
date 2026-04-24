// Maskeli tarih girişi — dd.MM.yyyy formatında, bölümler silinebilir
// Kullanıcı "24" veya "04" bölümlerini silerse "..." olarak görünür
"use client";

import { useState, useEffect, useRef } from "react";
import { Input } from "@/components/ui/input";

type Props = {
  // "YYYY-MM-DD" (tam tarih) veya null
  value: string | null;
  // Kısmi tarih metni (örn: "..04.2026" veya "24.04.2026" veya ".....2026")
  gosterim: string | null;
  onChange: (degerler: { tarih: string | null; gosterim: string | null }) => void;
  disabled?: boolean;
  required?: boolean;
};

// ISO "YYYY-MM-DD" → "dd.MM.yyyy"
function isoToTr(iso: string | null): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${m[3]}.${m[2]}.${m[1]}`;
}

// "dd.MM.yyyy" veya kısmi → ISO'ya çevir (sadece tam tarih ise)
function trToIso(tr: string): string | null {
  const m = tr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!m) return null;
  const gun = parseInt(m[1], 10);
  const ay = parseInt(m[2], 10);
  const yil = parseInt(m[3], 10);
  if (ay < 1 || ay > 12 || gun < 1 || gun > 31) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Kullanıcı girdisini dd.MM.yyyy formuna doğru otomatik dönüştür
// Nokta eklemelerini sağlar, kısmi eksik parçalara izin verir
function normalize(raw: string): string {
  // Sadece rakam ve noktaları koru
  let s = raw.replace(/[^0-9.]/g, "");
  // Fazla noktaları temizle (3'ten fazlasını iki nokta kaldır)
  const parcalar = s.split(".");
  if (parcalar.length > 3) {
    s = `${parcalar[0]}.${parcalar[1]}.${parcalar.slice(2).join("")}`;
  }
  return s;
}

export default function TarihInput({ value, gosterim, onChange, disabled, required }: Props) {
  // gosterim varsa onu kullan, yoksa value'yu dd.MM.yyyy yap
  const [metin, setMetin] = useState<string>(() => gosterim ?? isoToTr(value));
  const ilkKurulum = useRef(true);

  // value/gosterim değişirse state güncelle (controlled senaryolar için)
  useEffect(() => {
    if (ilkKurulum.current) { ilkKurulum.current = false; return; }
    const yeni = gosterim ?? isoToTr(value);
    if (yeni !== metin) setMetin(yeni);
  }, [value, gosterim]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const ham = normalize(e.target.value);
    setMetin(ham);
    const iso = trToIso(ham);
    // Eğer tam geçerli tarih ise evrak_tarihi olarak, aksi halde sadece gösterim
    if (iso) {
      onChange({ tarih: iso, gosterim: null });
    } else if (ham.trim()) {
      // Kısmi/yanlış format — sadece gösterim kaydet, evrak_tarihi null
      onChange({ tarih: null, gosterim: ham });
    } else {
      onChange({ tarih: null, gosterim: null });
    }
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      placeholder="gg.aa.yyyy (örn: 24.04.2026)"
      value={metin}
      onChange={handleChange}
      disabled={disabled}
      required={required}
      maxLength={10}
      className="font-mono"
    />
  );
}
