import { useEffect, useState } from "react";

// Araç seçim filtresi (kullanıcının KAPATTIĞI = pasif plakalar).
// İstenen davranış:
//   • GÜN değişince korunsun  → tarih değişince parent sayfa içeriği kısa süre unmount/remount ediyordu,
//                               in-memory state sıfırlanıyordu.
//   • SAYFA yenilenince (F5) hepsi AÇIK gelsin → filtre kalıcı olmasın.
// Çözüm: değeri MODÜL seviyesinde (JS bundle yaşadığı sürece) tut. Remount'ta modül hâlâ yüklü → değer yaşar;
// F5'te JS sıfırdan çalışır → modül boş → hepsi açık. (sessionStorage/localStorage F5'te de kalacağı için uygun değil.)
const pasifStore = new Map<string, Set<string>>();

export function usePasifSecim(key: string): [Set<string>, (guncelle: (onceki: Set<string>) => Set<string>) => void] {
  const [pasif, setPasif] = useState<Set<string>>(() => pasifStore.get(key) ?? new Set<string>());
  useEffect(() => { pasifStore.set(key, pasif); }, [key, pasif]);
  return [pasif, setPasif];
}
