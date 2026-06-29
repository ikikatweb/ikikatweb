"""
Joint Venture (Ortak Girişim) parser.

İhale sonuç tablosundaki firma adı formatı:

    "KUBTAS INS. MUH. TIC. LTD.STI., NET PRJ. MUH. KONT.INS.DIS.TIC.LTD.STI. - 15.03.2021 11:19"

Akış:
    1. Sonundaki "- TARIH SAAT" eki temizlenir
    2. ", " (virgül-boşluk) ile bölünür
    3. Her parça temizlenir, normalize edilir
    4. Birden fazla parça varsa → JOINT VENTURE
"""
from __future__ import annotations
import re
from dataclasses import dataclass


@dataclass
class FirmaParsed:
    """Parse edilmiş firma kaydı."""
    raw: str                    # Orijinal metin
    firmalar: list[str]         # Standart bireysel firma isimleri
    is_jv: bool                 # Joint Venture mi
    tarih_saat: str | None      # Sondaki tarih (varsa)

    @property
    def firma_sayisi(self) -> int:
        return len(self.firmalar)

    def primary_name(self) -> str:
        """JV ise ilk firma (pilot kabul), değilse tek firma."""
        return self.firmalar[0] if self.firmalar else ""


# Sondaki tarih-saat son ekini yakalayan regex (esnek)
# "15.03.2021 11:19" veya "5.3.2021 1:9", "15-03-2021 11:19", "15/03/2021"
# Saat opsiyonel — bazı kayıtlarda sadece tarih var
DATE_SUFFIX_RE = re.compile(
    r"\s*-\s*(\d{1,2}[\.\-/]\d{1,2}[\.\-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$"
)


def normalize_firma_adi(s: str) -> str:
    """Firma adını standart hâle getir (büyük harf, çoklu boşluk vb.)."""
    s = s.strip()
    # Çoklu boşlukları teke indir
    s = re.sub(r"\s+", " ", s)
    # Sondaki noktayı bırak (LTD.ŞTİ. gibi yapılarda anlamlı)
    return s.upper()


def parse_firma_adi(raw: str, ayraclar: list[str] | None = None) -> FirmaParsed:
    """Firma adı string'ini parse et.

    Args:
        raw: Ham metin (örn. "ABC, XYZ - 15.03.2021 11:19")
        ayraclar: Bölme ayraçları (varsayılan: [", "])

    Returns:
        FirmaParsed nesnesi.
    """
    if ayraclar is None:
        ayraclar = [", "]

    if raw is None or not str(raw).strip():
        return FirmaParsed(raw=raw or "", firmalar=[], is_jv=False, tarih_saat=None)

    text = str(raw).strip()

    # 1. Tarih-saat son ekini ayır
    tarih_saat = None
    m = DATE_SUFFIX_RE.search(text)
    if m:
        tarih_saat = m.group(1)
        text = text[: m.start()].rstrip()

    # 2. Ayraçlara göre böl (uzun ayraçlar önce)
    ayraclar_sorted = sorted(ayraclar, key=len, reverse=True)
    parcalar = [text]
    for ay in ayraclar_sorted:
        new_parcalar = []
        for p in parcalar:
            new_parcalar.extend(p.split(ay))
        parcalar = new_parcalar

    # 3. Temizle ve filtrele
    firmalar = []
    for p in parcalar:
        norm = normalize_firma_adi(p)
        if norm and len(norm) >= 3:
            firmalar.append(norm)

    is_jv = len(firmalar) >= 2

    return FirmaParsed(
        raw=raw,
        firmalar=firmalar,
        is_jv=is_jv,
        tarih_saat=tarih_saat,
    )


# ===========================================
# JV bid limiti — KİK %20 kuralı
# ===========================================
def jv_bid_limit(experience_values: list[float], carpan: float = 1.20) -> float:
    """JV durumunda max teklif tutarı.

    Kullanıcı kuralı: "iş deneyim belgesi büyük olan firmanın %20 üzerine çıkılabilir"

    Yani: max(experience_A, experience_B, ...) × 1.20

    Args:
        experience_values: Her ortak firmanın iş deneyim belgesi (TL).
        carpan: %20 fazla için 1.20.

    Returns:
        Maksimum teklif limiti.
    """
    if not experience_values:
        return 0.0
    return max(experience_values) * carpan


def can_bid(
    teklif_tutari: float,
    experience_values: list[float],
    carpan: float = 1.20,
    is_jv: bool = False,
) -> tuple[bool, str]:
    """Bir firmanın/JV'nin verilen teklifi atıp atamayacağını kontrol et.

    Returns:
        (yetebilir_mi, açıklama)
    """
    if not experience_values:
        return False, "İş deneyim belgesi yok"

    if is_jv:
        limit = jv_bid_limit(experience_values, carpan=carpan)
        if teklif_tutari <= limit:
            return True, (
                f"JV: max(deneyim)={max(experience_values):,.0f} × {carpan} "
                f"= {limit:,.0f} ≥ teklif {teklif_tutari:,.0f}"
            )
        return False, (
            f"JV bile yetersiz: max(deneyim)×{carpan} = {limit:,.0f} "
            f"< teklif {teklif_tutari:,.0f}"
        )

    # Solo
    deneyim = experience_values[0] if experience_values else 0.0
    if teklif_tutari <= deneyim:
        return True, f"Solo: deneyim={deneyim:,.0f} ≥ teklif {teklif_tutari:,.0f}"
    return False, (
        f"Solo yetersiz: deneyim={deneyim:,.0f} < teklif {teklif_tutari:,.0f}. "
        f"JV gerekli."
    )


# ===========================================
# Test
# ===========================================
if __name__ == "__main__":
    print("=== JV Parser Testleri ===\n")

    tests = [
        # 1. Tipik JV (kullanıcının verdiği örnek)
        "KUBTAS INS. MUH. TIC. LTD.STI., NET PRJ. MUH. KONT.INS.DIS.TIC.LTD.STI. - 15.03.2021 11:19",

        # 2. Tek firma (tarih ile)
        "İKİKAT İNŞAAT MÜH. TİC. LTD. ŞTİ. - 22.04.2024 14:30",

        # 3. Tek firma (tarihsiz)
        "ABC YAPI A.Ş.",

        # 4. 3 firmalı JV
        "ALFA İNŞ., BETA YAPI, GAMMA SAN. - 1.5.2023 9:00",

        # 5. Boşluklu virgül + UPPER/LOWER karışık
        "ikikat inşaat,  KAD-TEM YAPI - 10.10.2020 12:34",

        # 6. Boş
        "",

        # 7. Trailing whitespace
        "   ABC İNŞ. LTD.   ",
    ]

    for raw in tests:
        p = parse_firma_adi(raw)
        print(f"INPUT:  {raw!r}")
        print(f"  JV:        {p.is_jv}")
        print(f"  Firmalar:  {p.firmalar}")
        print(f"  Tarih:     {p.tarih_saat}")
        print()

    print("\n=== Bid Limit Testi ===")
    # ABC firması solo deneyim 8M, XYZ firması 12M ise JV ile kaç teklif atabilir?
    limit = jv_bid_limit([8_000_000, 12_000_000])
    print(f"JV limit (8M + 12M, max ×1.20): {limit:,.0f} TL")
    # Beklenen: 12.000.000 × 1.20 = 14.400.000

    can, msg = can_bid(13_500_000, [8_000_000, 12_000_000], is_jv=True)
    print(f"13.5M teklif yetebilir mi? {can} — {msg}")

    can, msg = can_bid(15_000_000, [8_000_000, 12_000_000], is_jv=True)
    print(f"15M teklif yetebilir mi? {can} — {msg}")
