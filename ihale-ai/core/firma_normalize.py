"""
Firma adı normalleştirme (canonicalization).

Mevcut sistemdeki sorun: Aynı firma farklı yazılmış olduğu için 1252 firma sayılıyor:
    - "KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. A.Ş."
    - "KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. ANONİM ŞİRKETİ"
    - "KAD-TEM MÜH. MÜT. İNŞ. OTO. TUR. TİC. VE SAN. ANONİM ŞİRKETİ"

Çözüm: Tüm bu varyantları tek kanonik forma getir.

Pipeline:
    1. Türkçe karakterleri ASCII'ye çevir (uppercase)
    2. Noktalama temizle (".", ",", ";", "'", "/" → boşluk)
    3. Çoklu boşlukları tekleştir
    4. Çok-kelimeli ifadeleri kısaltmaya çevir (uzun olan ilk)
    5. Tek-kelime kısaltmaları normalize et

Sonuç: KAD-TEM MUH MUT INS OTO TUR TIC VE SAN AS
"""
from __future__ import annotations
import re


# ===========================================
# 1. Türkçe ASCII map
# ===========================================
TR_TO_ASCII = str.maketrans({
    "İ": "I", "ı": "I", "i": "I",
    "Ş": "S", "ş": "S",
    "Ç": "C", "ç": "C",
    "Ğ": "G", "ğ": "G",
    "Ü": "U", "ü": "U",
    "Ö": "O", "ö": "O",
    # Ekstra harfler (latin extended)
    "â": "A", "Â": "A",
    "î": "I", "Î": "I",
    "û": "U", "Û": "U",
    "ô": "O", "Ô": "O",
    "ê": "E", "Ê": "E",
})


# ===========================================
# 2. Çok-kelimeli kısaltmalar (en uzun ilk)
# ===========================================
# Bu dönüşümler ASCII uppercase üzerinde uygulanır
MULTI_WORD_NORMALIZE = [
    # Şirket türleri
    (r"\bANONIM\s+SIRKETI\b", "AS"),
    (r"\bLIMITED\s+SIRKETI\b", "LTD STI"),
    (r"\bLTD\s+SIRKETI\b", "LTD STI"),
    (r"\bLIMITED\s+STI\b", "LTD STI"),
    (r"\bA\s*\.?\s*S\s*\.?\b", "AS"),  # "A.Ş.", "A. Ş.", "AŞ", "A Ş"
    (r"\bLTD\s*\.?\s*STI\s*\.?\b", "LTD STI"),
    # Yaygın iş kollarının uzun yazılışı
    (r"\bMUHENDISLIK\b", "MUH"),
    (r"\bMUSAVIRLIK\b", "MUS"),
    (r"\bMUTEAHHITLIK\b", "MUT"),
    (r"\bMUTAAHHIDLIK\b", "MUT"),
    (r"\bMUTAAHHITLIK\b", "MUT"),
    (r"\bMUTAAHHIT\b", "MUT"),
    (r"\bINSAAT\b", "INS"),
    (r"\bTAAHHUT\b", "TAAH"),
    (r"\bTAAHHUDU\b", "TAAH"),
    (r"\bOTOMOTIV\b", "OTO"),
    (r"\bOTOMOBIL\b", "OTO"),
    (r"\bTICARET\b", "TIC"),
    (r"\bTICARI\b", "TIC"),
    (r"\bSANAYI\b", "SAN"),
    (r"\bSANAYII\b", "SAN"),
    (r"\bTURIZM\b", "TUR"),
    (r"\bNAKLIYAT\b", "NAK"),
    (r"\bNAKLIYE\b", "NAK"),
    (r"\bNAKLIYESI\b", "NAK"),
    (r"\bMADENCILIK\b", "MAD"),
    (r"\bENERJI\b", "ENR"),
    (r"\bELEKTRIK\b", "ELK"),
    (r"\bELEKTRONIK\b", "ELKT"),
    (r"\bDANISMANLIK\b", "DAN"),
    (r"\bMIMARLIK\b", "MIM"),
    (r"\bMIMARLIK\s+MUHENDISLIK\b", "MIM MUH"),
    (r"\bORGANIZASYON\b", "ORG"),
    (r"\bPAZARLAMA\b", "PAZ"),
    (r"\bPEYZAJ\b", "PEY"),
    (r"\bDOGALGAZ\b", "DGZ"),
    (r"\bGIDA\b", "GIDA"),
    (r"\bHAYVANCILIK\b", "HAYV"),
    (r"\bAKARYAKIT\b", "AKAR"),
    (r"\bMEDIKAL\b", "MED"),
    (r"\bILETISIM\b", "ILT"),
    (r"\bGUVENLIK\b", "GUV"),
    (r"\bTEMIZLIK\b", "TEM"),
    (r"\bYAPIMCILIK\b", "YAP"),
    (r"\bYAPI\b", "YAP"),
    # SAN VE TIC kompakt birleştirme — sırasız
    # (Bunu yapmıyoruz çünkü sıra önemli olabilir)
]


# ===========================================
# 3. Tek kelime kısaltma normalize tablosu (idempotent)
# ===========================================
# Bunlar zaten kısa formdaysa dokunmaz, uzun formda tekrar koşarsak zaten yukarıda yapıldı
SINGLE_TOKEN_MAP = {
    "MUHENDIS": "MUH",
    "MUSAVIR": "MUS",
    "MUTEAHHIT": "MUT",
    "INSAAT": "INS",
    "OTOMOTIV": "OTO",
    "TICARET": "TIC",
    "SANAYI": "SAN",
    "SANAYII": "SAN",
    "TURIZM": "TUR",
    "NAKLIYAT": "NAK",
    "NAKLIYE": "NAK",
    "MADENCILIK": "MAD",
    "MIMARLIK": "MIM",
    "ENERJI": "ENR",
}


# ===========================================
# Pipeline
# ===========================================
def kanonik_firma_adi(s: str | None) -> str:
    """Firma adını kanonik (standart) forma getir.

    >>> kanonik_firma_adi("KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. A.Ş.")
    'KADTEM MUH MUT INS OTO TUR TIC VE SAN AS'

    >>> kanonik_firma_adi("KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. ANONİM ŞİRKETİ")
    'KADTEM MUH MUT INS OTO TUR TIC VE SAN AS'

    Aynı firma farklı yazılmış → aynı kanonik çıktı.
    """
    if not s:
        return ""

    # 1. Türkçe → ASCII (uppercase)
    text = str(s).translate(TR_TO_ASCII).upper()

    # 2. Sondaki tarih-saat varyasyonlarını sil (DD.MM.YYYY [HH:MM[:SS]])
    text = re.sub(
        r"\s*-?\s*\d{1,2}[\.\-/]\d{1,2}[\.\-/]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$",
        "",
        text,
    )

    # 3. Noktalama → boşluk (tire ve aksanlar dahil)
    # NOT: Tire firma adları içinde (KAD-TEM) anlamlı, ama uçlarda olmamalı.
    # Önce tireleri boşlukla değiştir (KAD-TEM → KAD TEM) — kanonik için tutarlılık.
    text = re.sub(r"[.,;:'\"/\\\-_()&]+", " ", text)

    # 4. Sıkıştır
    text = re.sub(r"\s+", " ", text).strip()

    # 5. Çok-kelimeli normalize (uzun olan önce)
    for pattern, replacement in MULTI_WORD_NORMALIZE:
        text = re.sub(pattern, replacement, text)

    # 6. Tek-kelime kısaltma sözlüğü
    tokens = text.split()
    tokens = [SINGLE_TOKEN_MAP.get(t, t) for t in tokens]
    text = " ".join(tokens)

    # 7. Tekrar sıkıştır (multi-word substitution sonrası)
    text = re.sub(r"\s+", " ", text).strip()

    return text


def aynı_firma_mı(a: str | None, b: str | None) -> bool:
    """İki firma adı aynı kanonik forma sahip mi?"""
    return kanonik_firma_adi(a) == kanonik_firma_adi(b) and bool(a) and bool(b)


def kanonik_içeriyor_mu(adres_olarak: str | None, aranacak: str | None) -> bool:
    """`aranacak` firma adı `adres_olarak`'ın kanoniğinde geçiyor mu?

    Örn: aranacak='IKIKAT INS' → 'KENAN TUGAY IKIKAT' içerse → True
    """
    if not adres_olarak or not aranacak:
        return False
    a = kanonik_firma_adi(adres_olarak)
    b = kanonik_firma_adi(aranacak)
    if not a or not b:
        return False
    return b in a or a in b


# ===========================================
# Test
# ===========================================
if __name__ == "__main__":
    print("=== Firma Adı Normalleştirme Testleri ===\n")

    tests = [
        # KAD-TEM varyantları
        "KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. A.Ş.",
        "KAD-TEM MÜH. MÜT. İNŞ. OTOMOTIV TUR. TİC. VE SAN. ANONİM ŞİRKETİ",
        "KAD-TEM MÜH. MÜT. İNŞ. OTO. TUR. TİC. VE SAN. A.Ş.",
        "KAD-TEM MÜH. MÜT. İNŞ. OTO. TUR. TİC. VE SAN. ANONİM ŞİRKETİ",
        # İKİKAT varyantları
        "İKİKAT İNŞ. TAAH. HAYV. SAN. VE TİC. LTD. ŞTİ.",
        "İKİKAT İNŞ. TAAH. HAYV. SAN. VE TİC. LTD. ŞİRKETİ",
        "İKİKAT İNŞ. TAAH. HAYV. SAN. VE TİC. LIMITED ŞİRKETİ",
        # Bağımsız test
        "BURKA YAP. ENR. SAN. VE TİC. A.Ş.",
        "İLKNUR AYDIN",  # Tek kişi
        "KENAN TUGAY İKİKAT",  # Kişi + firma adı (JV?)
    ]

    for t in tests:
        k = kanonik_firma_adi(t)
        print(f"  {t}")
        print(f"  → {k}")
        print()

    print("\n=== Eşleştirme Testleri ===")
    print(f"  aynı_firma_mı(KAD-TEM A.Ş., KAD-TEM ANONİM ŞİRKETİ):")
    print(f"  → {aynı_firma_mı('KAD-TEM A.Ş.', 'KAD-TEM ANONİM ŞİRKETİ')}")
    print(f"  kanonik_içeriyor_mu(KENAN TUGAY İKİKAT, İKİKAT):")
    print(f"  → {kanonik_içeriyor_mu('KENAN TUGAY İKİKAT', 'İKİKAT')}")
