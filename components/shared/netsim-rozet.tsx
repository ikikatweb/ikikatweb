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

export function NetsimRozet({ className = "" }: { className?: string }) {
  return (
    <span
      title="Bu tutar Netsim'den otomatik geldi. Elle değiştirirseniz rozet kalkar; senkron 15 dakika içinde Netsim'deki değeri geri yazar."
      className={`inline-flex items-center rounded-sm bg-sky-100 px-1 py-px text-[8px] font-semibold uppercase leading-none tracking-wide text-sky-700 ${className}`}
    >
      Netsim
    </span>
  );
}
