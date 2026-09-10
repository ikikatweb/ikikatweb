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
export function NetsimRozet({ className = "" }: { className?: string }) {
  return (
    <span
      title="Bu tutar Netsim'den otomatik geldi. Elle değiştirirseniz rozet kalkar; senkron 15 dakika içinde Netsim'deki değeri geri yazar."
      aria-label="Netsim'den geldi"
      className={`inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-[2px] bg-sky-100 text-[8px] font-bold leading-none text-sky-700 ${className}`}
    >
      N
    </span>
  );
}
