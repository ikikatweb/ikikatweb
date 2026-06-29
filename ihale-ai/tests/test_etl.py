"""ETL — Türkçe sayı parser ve etiketleme testleri."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
import numpy as np
from core.etl import parse_turkish_number, is_my_firm


def test_turkce_sayi_normal():
    assert parse_turkish_number("1.234.567,89") == 1234567.89
    assert parse_turkish_number("1234567,89") == 1234567.89
    assert parse_turkish_number("1.234,56") == 1234.56
    assert parse_turkish_number("1234.56") == 1234.56  # Tek nokta = ondalık


def test_turkce_sayi_para():
    assert parse_turkish_number("₺ 12.345,00") == 12345.00
    assert parse_turkish_number("12.345,00 TL") == 12345.00


def test_turkce_sayi_bos():
    assert parse_turkish_number("") is None
    assert parse_turkish_number("  ") is None
    assert parse_turkish_number(None) is None


def test_turkce_sayi_zaten_float():
    assert parse_turkish_number(1234.5) == 1234.5
    assert parse_turkish_number(0) == 0.0


def test_turkce_sayi_nan():
    assert parse_turkish_number(np.nan) is None


def test_is_my_firm_dogrudan():
    my = ["İKİKAT İNŞAAT", "KAD-TEM YAPI"]
    assert is_my_firm("İKİKAT İNŞAAT MÜH. LTD.", my) is True
    assert is_my_firm("KAD-TEM YAPI A.Ş.", my) is True
    assert is_my_firm("ABC İNŞAAT", my) is False


def test_is_my_firm_jv_icinde():
    """JV içinde MY_FIRMS varsa SELF kabul edilir."""
    my = ["İKİKAT İNŞAAT"]
    raw = "İKİKAT İNŞAAT, ORTAK FIRMA - 15.03.2021 11:19"
    assert is_my_firm(raw, my) is True


def test_is_my_firm_bos():
    my = ["İKİKAT İNŞAAT"]
    assert is_my_firm("", my) is False
    assert is_my_firm(None, my) is False
