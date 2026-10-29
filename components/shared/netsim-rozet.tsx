// "Netsim" rozeti — değerin ön muhasebeden (Netsim/Ofisnet) otomatik geldiğini gösterir.
//
// Rozet, senkronun en son yazdığı değer (netsim_* gölge alanı) ekrandaki değerle
// BİREBİR aynıysa çıkar. Kullanıcı tutarı elle değiştirince ikisi tutmaz ve rozet
// kendiliğinden kalkar — yani rozet "bu rakama kimse elle dokunmadı" demektir.
//
// Not: senkron 15 dakikada bir Netsim'in değerini geri yazar; elle değiştirilen bir
// tutar bir sonraki turda tekrar Netsim'inkiyle değişir ve rozet geri gelir.

// Kuruş altı kayan nokta farkları rozeti düşürmesin.
export function netsimKaynakli(deger: number | null | undefined, netsimDeger: number | null | undefined): boolean {
  if (deger == null || netsimDeger == null) return false;
  return Math.abs(Number(deger) - Number(netsimDeger)) < 0.005;
}

// Dar tablolarda yer kaplamasin diye tek harf: rakamin yanina sigan kucuk bir "N".
// Anlami tooltip'te yazili; uzerine gelince tam aciklama cikar.
export function NetsimRozet({ className = "", title, hesaplanan = false }: {
  className?: string;
  title?: string;
  /** true → tutar Netsim'den GELMEDİ, Netsim verisiyle HESAPLANDI. İçi boş rozet. */
  hesaplanan?: boolean;
}) {
  return (
    <span
      // Varsayılan açıklama SENKRONLA yazılan tutarlar için. Form ön doldurmasında
      // senkron geri yazmaz, o yüzden oradan farklı bir açıklama veriliyor.
      title={title ?? (hesaplanan
        ? "Bu tutar Netsim'den gelmedi — Netsim'den gelen veriyle HESAPLANDI."
        : "Bu tutar Netsim'den otomatik geldi. Elle değiştirirseniz rozet kalkar; senkron 15 dakika içinde Netsim'deki değeri geri yazar.")}
      aria-label={hesaplanan ? "Netsim verisiyle hesaplandı" : "Netsim'den geldi"}
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] text-[8px] font-bold leading-none ${
        hesaplanan
          ? "bg-white text-sky-600 ring-1 ring-inset ring-sky-300"
          : "bg-sky-100 text-sky-700"} ${className}`}
    >
      N
    </span>
  );
}
