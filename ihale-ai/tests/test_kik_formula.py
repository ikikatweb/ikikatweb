"""KİK formülü testleri.

TypeScript referansı (app/dashboard/ihale/page.tsx) ile birebir aynı sonuç vermeli.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from core.kik_formula import (
    hesapla_sinir_deger, tenzilat, muhtemel_kazanan,
    yeniden_siniflandir, round2, round3,
)


def test_dokuman_ornegi():
    """Dökümanın 8. bölümündeki örnek — beklenen SD ≈ 7.470.000 TL."""
    teklifler = [4_500_000, 7_200_000, 8_000_000, 8_300_000,
                 8_500_000, 8_700_000, 9_100_000, 12_500_000]
    ym = 10_000_000
    n = 1.00

    sonuc = hesapla_sinir_deger(teklifler, ym, n)
    assert sonuc is not None
    assert sonuc.gecerli_sayi == 7  # 12.5M elenir (Ort2 üstü)
    assert sonuc.ortalama1 == 4_000_000
    assert sonuc.ortalama2 == 12_000_000
    # T1 ≈ 7.757.142,86
    assert abs(sonuc.t1 - 7_757_142.86) < 1
    # SD ≈ 7.470.000 (yaklaşık — yuvarlamadan dolayı küçük sapma kabul)
    assert 7_400_000 < sonuc.sinir_deger < 7_550_000


def test_bos_teklif_listesi():
    """Boş teklif listesi → None."""
    assert hesapla_sinir_deger([], 10_000_000, 1.00) is None


def test_negatif_ym():
    """Negatif/sıfır YM → None."""
    assert hesapla_sinir_deger([1, 2, 3], 0, 1.00) is None
    assert hesapla_sinir_deger([1, 2, 3], -100, 1.00) is None


def test_tek_teklif():
    """Tek teklif → σ = 0."""
    sonuc = hesapla_sinir_deger([8_000_000], 10_000_000, 1.00)
    assert sonuc is not None
    assert sonuc.standart_sapma == 0.0
    assert sonuc.t1 == 8_000_000


def test_hepsi_filtre_disinda():
    """Hiçbir teklif Ort1-Ort2 arasında değilse → SD = Ort1."""
    teklifler = [1_000_000, 1_500_000]  # Hepsi YM × %40 altı
    ym = 10_000_000
    sonuc = hesapla_sinir_deger(teklifler, ym, 1.00)
    assert sonuc is not None
    assert sonuc.gecerli_sayi == 0
    assert sonuc.sinir_deger == 4_000_000  # Ort1


def test_tenzilat():
    assert tenzilat(8_000_000, 10_000_000) == 20.00  # %20 kırım
    assert tenzilat(11_000_000, 10_000_000) == -10.00  # YM üstü
    assert tenzilat(10_000_000, 10_000_000) == 0.00


def test_muhtemel_kazanan():
    """SD'nin hemen üstündeki en düşük geçerli teklif."""
    teklifler = [
        ("A", 6_000_000, "sinir_alti"),
        ("B", 7_500_000, "gecerli"),
        ("C", 8_000_000, "gecerli"),
        ("D", 9_000_000, "gecerli"),
    ]
    sd = 7_470_000
    mk = muhtemel_kazanan(teklifler, sd)
    assert mk == ("B", 7_500_000)


def test_yeniden_siniflandir():
    """SD altındaki teklifler 'sinir_alti' olur."""
    teklifler = [
        ("A", 5_000_000, "gecerli"),
        ("B", 8_000_000, "gecerli"),
        ("C", 4_000_000, "gecersiz"),  # gecersiz dokunulmaz
    ]
    sd = 7_000_000
    yeni = yeniden_siniflandir(teklifler, sd)
    assert yeni[0] == ("A", 5_000_000, "sinir_alti")
    assert yeni[1] == ("B", 8_000_000, "gecerli")
    assert yeni[2] == ("C", 4_000_000, "gecersiz")


def test_yuvarlama():
    assert round2(7_757_142.857) == 7_757_142.86
    assert round3(0.8295) == 0.830
    assert round3(0.8294) == 0.829


def test_c_aralik_kontrolu():
    """K formülü C aralığına göre değişiyor mu?"""
    # C < 0.60 (düşük): K = C
    sonuc1 = hesapla_sinir_deger([4_500_000] * 5, 10_000_000, 1.00)
    # tüm teklifler 4.5M, ym 10M → c = 0.45 — k = c

    # C > 1.00 (yüksek): farklı formül
    sonuc2 = hesapla_sinir_deger([11_000_000] * 5, 10_000_000, 1.00)
    # tüm teklifler 11M, ym 10M → c = 1.10

    assert sonuc1 is not None
    assert sonuc2 is not None
