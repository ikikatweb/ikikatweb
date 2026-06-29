"""
KİK Tebliği Madde 45.1.1 — Sınır Değer hesaplama.

Mevcut Next.js sistemindeki `hesaplaSinirDeger` fonksiyonunun
(app/dashboard/ihale/page.tsx, satır 252-324) Python port'u.

Test edildi: TypeScript çıktısı ile birebir aynı sonuç.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Iterable
import math


@dataclass
class HesapSonuc:
    """Sınır değer hesabı sonucu — KİK Tebliği'ne uygun."""
    ortalama1: float        # YM × 0.40 — alt sınır
    ortalama2: float        # YM × 1.20 — üst sınır
    t1: float               # Aritmetik ortalama
    standart_sapma: float   # σ (örneklem)
    std_sapma_alt: float    # T1 - σ
    std_sapma_ust: float    # T1 + σ
    t2: float               # [T1-σ, T1+σ] aralığı ortalaması
    c: float                # T2 / YM (3 ondalık)
    k: float                # Düzeltme katsayısı
    sinir_deger: float      # (K × T2) / (C × N)
    gecerli_sayi: int       # Ön filtre sonrası teklif sayısı
    makul_sayi: int         # σ aralığındaki teklif sayısı

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def round2(n: float) -> float:
    """KİK 2 ondalık yuvarlama (parasal değerler için)."""
    return round(n * 100) / 100


def round3(n: float) -> float:
    """KİK 3 ondalık yuvarlama (katsayılar için)."""
    return round(n * 1000) / 1000


def hesapla_sinir_deger(
    teklifler: Iterable[float],
    yaklasik_maliyet: float,
    n_katsayisi: float = 1.00,
) -> HesapSonuc | None:
    """KİK Tebliği Madde 45.1.1'e göre sınır değer hesapla.

    Args:
        teklifler: Geçerli tekliflerin listesi (TL).
        yaklasik_maliyet: İdarenin yaklaşık maliyeti (TL).
        n_katsayisi: 1.00 (Yapım) veya 1.20 (Genel).

    Returns:
        HesapSonuc nesnesi veya None (geçersiz girdi).
    """
    teklifler = list(teklifler)
    if not teklifler or yaklasik_maliyet <= 0:
        return None

    # ---- AŞAMA 1: Ön Filtre (YM × %40 alt, YM × %120 üst) ----
    ort1 = yaklasik_maliyet * 0.40
    ort2 = yaklasik_maliyet * 1.20
    gecerli = [t for t in teklifler if ort1 <= t <= ort2]

    if not gecerli:
        return HesapSonuc(
            ortalama1=round2(ort1),
            ortalama2=round2(ort2),
            t1=0.0, standart_sapma=0.0,
            std_sapma_alt=0.0, std_sapma_ust=0.0,
            t2=0.0, c=0.0, k=0.0,
            sinir_deger=round2(ort1),
            gecerli_sayi=0, makul_sayi=0,
        )

    n = len(gecerli)

    # ---- AŞAMA 2: Aritmetik Ortalama (T1) ----
    t1 = round2(sum(gecerli) / n)

    # ---- AŞAMA 3: Standart Sapma (σ) — Bessel düzeltmesi (n-1) ----
    if n > 1:
        sigma = round2(math.sqrt(sum((t - t1) ** 2 for t in gecerli) / (n - 1)))
    else:
        sigma = 0.0

    # ---- AŞAMA 4: Makul Aralık [T1-σ, T1+σ] Ortalaması (T2) ----
    sapma_alt = round2(t1 - sigma)
    sapma_ust = round2(t1 + sigma)
    makul_teklifler = [t for t in gecerli if sapma_alt <= t <= sapma_ust]
    if makul_teklifler:
        t2 = round2(sum(makul_teklifler) / len(makul_teklifler))
    else:
        t2 = t1

    # ---- AŞAMA 5: C, K, SD ----
    c = round3(t2 / yaklasik_maliyet)

    if c < 0.60:
        k = round3(c)
    elif c <= 1.00:
        k = round3((3.2 * c - c * c - 0.60) / (c + 1))
    else:
        k = round3((c * c - 0.8 * c + 1.4) / (c + 1))

    sinir_deger = round2((k * t2) / (c * n_katsayisi))

    # Güvenlik kuralı: SD < Ort1 ise Ort1'e çek
    if sinir_deger < round2(ort1):
        sinir_deger = round2(ort1)

    return HesapSonuc(
        ortalama1=round2(ort1),
        ortalama2=round2(ort2),
        t1=t1,
        standart_sapma=sigma,
        std_sapma_alt=sapma_alt,
        std_sapma_ust=sapma_ust,
        t2=t2,
        c=c,
        k=k,
        sinir_deger=sinir_deger,
        gecerli_sayi=len(gecerli),
        makul_sayi=len(makul_teklifler),
    )


def tenzilat(teklif: float, yaklasik_maliyet: float) -> float:
    """Tenzilat (kırım) yüzdesi.

    Tenzilat = ((YM - Teklif) / YM) × 100
    Pozitif: kırım, Negatif: YM üstü.
    """
    if yaklasik_maliyet <= 0:
        return 0.0
    return round2(((yaklasik_maliyet - teklif) / yaklasik_maliyet) * 100)


def muhtemel_kazanan(teklifler: list[tuple[str, float, str]], sinir_deger: float) -> tuple[str, float] | None:
    """Sınır değerin hemen üstündeki en düşük geçerli teklifi bul.

    Args:
        teklifler: [(firma_adi, teklif_tutari, durum), ...]
                   durum: "gecerli" / "gecersiz" / "sinir_alti"
        sinir_deger: Hesaplanmış SD.

    Returns:
        (firma_adi, teklif_tutari) veya None.
    """
    aday = [
        (firma, t)
        for (firma, t, durum) in teklifler
        if durum == "gecerli" and t >= sinir_deger
    ]
    if not aday:
        return None
    return min(aday, key=lambda x: x[1])


def yeniden_siniflandir(
    teklifler: list[tuple[str, float, str]],
    sinir_deger: float,
) -> list[tuple[str, float, str]]:
    """Sınır değer hesabı sonrası teklifleri yeniden etiketle.

    Geçerli teklif SD altındaysa → 'sinir_alti'.
    SD üstündeyse → 'gecerli'.
    'gecersiz' olanlar dokunulmaz.
    """
    sonuc = []
    for firma, t, durum in teklifler:
        if durum == "gecersiz":
            sonuc.append((firma, t, durum))
            continue
        yeni_durum = "gecerli" if t >= sinir_deger else "sinir_alti"
        sonuc.append((firma, t, yeni_durum))
    return sonuc


# ===========================================
# Test (TypeScript ile birebir kıyas)
# ===========================================
if __name__ == "__main__":
    # Dökümanın "Tam Hesaplama Örneği" bölümündeki veriler:
    teklifler = [4_500_000, 7_200_000, 8_000_000, 8_300_000,
                 8_500_000, 8_700_000, 9_100_000, 12_500_000]
    ym = 10_000_000
    n = 1.00

    sonuc = hesapla_sinir_deger(teklifler, ym, n)
    print("=== KİK Sınır Değer Hesabı ===")
    print(f"YM:              {ym:>15,.2f} TL")
    print(f"Ort1 (%40):      {sonuc.ortalama1:>15,.2f} TL")
    print(f"Ort2 (%120):     {sonuc.ortalama2:>15,.2f} TL")
    print(f"Geçerli (n):     {sonuc.gecerli_sayi}")
    print(f"T1:              {sonuc.t1:>15,.2f} TL")
    print(f"σ (std):         {sonuc.standart_sapma:>15,.2f} TL")
    print(f"Aralık:          [{sonuc.std_sapma_alt:,.2f}, {sonuc.std_sapma_ust:,.2f}]")
    print(f"Makul (n):       {sonuc.makul_sayi}")
    print(f"T2:              {sonuc.t2:>15,.2f} TL")
    print(f"C:               {sonuc.c:.3f}")
    print(f"K:               {sonuc.k:.3f}")
    print(f"SINIR DEĞER:     {sonuc.sinir_deger:>15,.2f} TL")
    print()
    # Beklenen: SD ≈ 7.470.000 TL (dökümandaki örneğe göre)

    # Muhtemel kazanan testi
    katilimcilar = [
        ("FIRMA_A", 4_500_000, "gecerli"),
        ("FIRMA_B", 7_200_000, "gecerli"),
        ("FIRMA_C", 8_000_000, "gecerli"),
        ("FIRMA_D", 8_300_000, "gecerli"),
        ("FIRMA_E", 8_500_000, "gecerli"),
        ("FIRMA_F", 8_700_000, "gecerli"),
        ("FIRMA_G", 9_100_000, "gecerli"),
        ("FIRMA_H", 12_500_000, "gecerli"),
    ]
    yeniden = yeniden_siniflandir(katilimcilar, sonuc.sinir_deger)
    mk = muhtemel_kazanan(yeniden, sonuc.sinir_deger)
    print(f"Muhtemel Kazanan: {mk}")
    # Beklenen: ('FIRMA_C', 8_000_000)
