// TC KİMLİK MASKELEME — görülmesi gerekmeyen yerde tam numara gösterilmez.
//
// KVKK'nın istediği şey TC'yi hiç tutmamak değil (işveren yükümlülüğü için zorunlu),
// VERİ MİNİMİZASYONU: numarayı yalnız işi gereği ihtiyacı olan görsün.
//
// Ölçüm (26.10.2026): bordro/işçilik ekranını 12 kullanıcı görüyor, bunların yalnız 7'sinin
// personel yetkisi var. Kalan 5 kişi — şantiye yöneticileri ve kısıtlı kullanıcılar — işleri
// gerektirmediği hâlde 160 personelin TC'sini tam görüyordu.
//
// SINIR: Bu GÖRSEL bir tedbirdir; ekran görüntüsü, ekran paylaşımı, omuz üstünden bakma ve
// yanlışlıkla dışarı çıkan çıktılar için etkilidir. Tarayıcının ağ yanıtını okuyabilen bir
// kullanıcı tam numaraya yine ulaşır — onu kapatmak için TC'nin sunucudan hiç gönderilmemesi
// gerekir (ayrı iş).

/** "12345678901" → "123******01" (ilk 3 + son 2 görünür). Geçersiz/boş değer olduğu gibi döner. */
export function tcMaskele(tc: string | null | undefined): string {
  const t = String(tc ?? "").trim();
  if (t.length !== 11 || !/^\d{11}$/.test(t)) return t;
  return `${t.slice(0, 3)}${"*".repeat(6)}${t.slice(9)}`;
}

/** Yetkiye göre: tam numara ya da maskeli. */
export function tcGoster(tc: string | null | undefined, tamGorebilir: boolean): string {
  return tamGorebilir ? String(tc ?? "") : tcMaskele(tc);
}
