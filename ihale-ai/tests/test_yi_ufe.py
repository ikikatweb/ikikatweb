"""Yi-ÜFE birim testleri (DB gerektirmez)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from intelligence.yi_ufe import (
    _to_year_month, _onceki_ay, get_endeks, bugune_getir, get_son_endeks,
)


def test_to_year_month():
    from datetime import date, datetime
    assert _to_year_month("2023-05-15") == (2023, 5)
    assert _to_year_month(date(2023, 5, 15)) == (2023, 5)
    assert _to_year_month(datetime(2023, 5, 15, 10, 30)) == (2023, 5)


def test_onceki_ay():
    assert _onceki_ay(2023, 5) == (2023, 4)
    assert _onceki_ay(2023, 1) == (2022, 12)
    assert _onceki_ay(2024, 12) == (2024, 11)


def test_get_endeks_dogrudan():
    yi_map = {(2023, 4): 1500.0, (2023, 5): 1550.0, (2023, 6): 1600.0}
    # Mayıs 2023 → bir önceki ay (Nisan) endeksini al
    assert get_endeks("2023-05-15", yi_map, onceki_ay=True) == 1500.0
    # onceki_ay=False → direkt Mayıs
    assert get_endeks("2023-05-15", yi_map, onceki_ay=False) == 1550.0


def test_get_endeks_eksik_ay_linear():
    """Eksik ay → linear interpolation."""
    yi_map = {(2023, 1): 1000.0, (2023, 5): 1400.0}
    # Mart 2023 → Şubat (yok) → linear
    # Onceki=Ocak (1000), Sonraki=Mayıs (1400)
    # Mart: yıl-ay = 202303, kaynak: 202301, hedef: 202305
    # Hedef - Ocak = 2 ay, Mayıs - Ocak = 4 ay → ratio 2/4 = 0.5
    # Sonuç: 1000 + (1400-1000) * 0.5 = 1200
    val = get_endeks("2023-04-15", yi_map, onceki_ay=True, eksik_ay_doldurma="linear")
    # 2023-04 - 1 ay = 2023-03 → eksik, lineer doldurulur
    assert val is not None
    assert 1100 < val < 1300


def test_get_son_endeks():
    yi_map = {(2023, 1): 1000.0, (2024, 5): 1500.0, (2023, 12): 1200.0}
    assert get_son_endeks(yi_map) == 1500.0


def test_bugune_getir():
    yi_map = {(2020, 2): 100.0, (2024, 12): 200.0}
    # 2020-03 tarihindeki tutar → bir önceki ay (Şubat) endeksi 100
    # Bugünkü en son endeks: 200
    # 1.000.000 × (200/100) = 2.000.000
    sonuc = bugune_getir(1_000_000, "2020-03-15", yi_map)
    assert sonuc == 2_000_000


def test_bugune_getir_none():
    yi_map = {(2020, 2): 100.0}
    assert bugune_getir(None, "2020-03-15", yi_map) is None
    assert bugune_getir(0, "2020-03-15", yi_map) is None


def test_bugune_getir_referans_tarih():
    """Belirli bir tarihe getirme."""
    yi_map = {(2020, 2): 100.0, (2022, 11): 150.0, (2024, 12): 200.0}
    # 2020-03 tutarını → 2022-12 değerine getir
    # Kaynak: 2020-02 = 100, Referans: 2022-11 = 150
    # 1.000.000 × (150/100) = 1.500.000
    sonuc = bugune_getir(1_000_000, "2020-03-15", yi_map, referans_tarih="2022-12-15")
    assert sonuc == 1_500_000
