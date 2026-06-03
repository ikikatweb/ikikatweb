// Bildirim (toast) süresi yardımcı fonksiyonu.
// Mobilde (viewport ≤ 768px) tüm bildirimler 3 sn gösterilir; masaüstünde
// verilen süre (varsayılan 5 sn) kullanılır.
//
// Kullanım:
//   toast.error("mesaj", { duration: toastSuresi() })        // masaüstü 5sn / mobil 3sn
//   toast.error("mesaj", { duration: toastSuresi(8000) })    // masaüstü 8sn / mobil 3sn
export function toastSuresi(masaustuMs = 5000): number {
  if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 768px)").matches) {
    return 3000;
  }
  return masaustuMs;
}
