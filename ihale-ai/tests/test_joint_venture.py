"""JV parser testleri."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from core.joint_venture import (
    parse_firma_adi, normalize_firma_adi,
    jv_bid_limit, can_bid,
)


def test_kullanicinin_verdigi_ornek():
    """Gerçek veri formatı."""
    raw = "KUBTAS INS. MUH. TIC. LTD.STI., NET PRJ. MUH. KONT.INS.DIS.TIC.LTD.STI. - 15.03.2021 11:19"
    p = parse_firma_adi(raw)
    assert p.is_jv is True
    assert len(p.firmalar) == 2
    assert "KUBTAS" in p.firmalar[0]
    assert "NET PRJ" in p.firmalar[1]
    assert p.tarih_saat == "15.03.2021 11:19"


def test_tek_firma_tarihli():
    raw = "ABC İNŞAAT MÜH. LTD. ŞTİ. - 22.04.2024 14:30"
    p = parse_firma_adi(raw)
    assert p.is_jv is False
    assert len(p.firmalar) == 1
    assert "ABC" in p.firmalar[0]


def test_tek_firma_tarihsiz():
    raw = "ABC YAPI A.Ş."
    p = parse_firma_adi(raw)
    assert p.is_jv is False
    assert p.tarih_saat is None
    assert len(p.firmalar) == 1


def test_uc_firmali_jv():
    raw = "ALFA İNŞ., BETA YAPI, GAMMA SAN. - 1.5.2023 9:00"
    p = parse_firma_adi(raw)
    assert p.is_jv is True
    assert len(p.firmalar) == 3


def test_bos_input():
    p = parse_firma_adi("")
    assert p.is_jv is False
    assert p.firmalar == []


def test_normalize():
    assert normalize_firma_adi("  abc inş.  ") == "ABC İNŞ."
    assert normalize_firma_adi("kad-tem  yapı") == "KAD-TEM YAPI"


def test_jv_bid_limit():
    """JV durumunda büyük olan firmanın deneyimi × 1.20."""
    # 8M ve 12M deneyim, max 12M × 1.20 = 14.4M
    assert jv_bid_limit([8_000_000, 12_000_000]) == 14_400_000

    # 5M tek firma (solo davranır)
    assert jv_bid_limit([5_000_000]) == 6_000_000

    # Boş liste
    assert jv_bid_limit([]) == 0


def test_can_bid_solo():
    # Solo, deneyim 10M, teklif 8M → yeter
    ok, msg = can_bid(8_000_000, [10_000_000], is_jv=False)
    assert ok is True

    # Solo, deneyim 10M, teklif 12M → yetmez
    ok, msg = can_bid(12_000_000, [10_000_000], is_jv=False)
    assert ok is False
    assert "yetersiz" in msg.lower()


def test_can_bid_jv():
    # JV, max 12M, teklif 13.5M → max × 1.20 = 14.4M ≥ 13.5 → yeter
    ok, msg = can_bid(13_500_000, [8_000_000, 12_000_000], is_jv=True)
    assert ok is True

    # JV, max 12M, teklif 15M → max × 1.20 = 14.4M < 15 → yetmez
    ok, msg = can_bid(15_000_000, [8_000_000, 12_000_000], is_jv=True)
    assert ok is False
