"""
ETL — Extract / Transform / Load.

Veri akışı:
    db.fetch_birlesik_dataset()
         ↓
    Türkçe sayı normalizasyonu
         ↓
    Joint Venture parse (firma_adi → firmalar[])
         ↓
    SELF / COMPETITOR etiketleme (MY_FIRMS listesinden)
         ↓
    Eksik / hatalı kayıtların temizlenmesi
         ↓
    Pandas DataFrame (analize hazır)
"""
from __future__ import annotations
import re
import logging
import pandas as pd
import numpy as np

from .joint_venture import parse_firma_adi, normalize_firma_adi
from .firma_normalize import kanonik_firma_adi, kanonik_içeriyor_mu
from .config import Config
from . import db

log = logging.getLogger(__name__)


# ===========================================
# Türkçe sayı dönüşümü
# ===========================================
def parse_turkish_number(s: str | float | int | None) -> float | None:
    """'1.234.567,89' → 1234567.89

    Zaten float ise dokunmaz.
    None / boş → None.
    """
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return float(s) if not pd.isna(s) else None

    s = str(s).strip()
    if not s:
        return None

    # Para birimi sembollerini sil
    s = re.sub(r"[₺$€£\sTL]", "", s, flags=re.IGNORECASE)

    # "1.234,56" formatı: nokta = bin ayraç, virgül = ondalık
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    # Sadece nokta varsa: 3 haneli grup ise bin ayraç (1.234.567), değilse ondalık
    elif s.count(".") > 1:
        s = s.replace(".", "")

    try:
        return float(s)
    except ValueError:
        return None


# ===========================================
# Etiketleme
# ===========================================
def is_my_firm(firma_adi: str, my_firms: list[str]) -> bool:
    """firma_adi MY_FIRMS listesinde mi (KANONİK eşleştirme).

    `firma_adi` JV içeriyorsa (virgülle ayrılmış), her bir alt-firma kontrol edilir.
    Eşleştirme kanonik form üzerinden yapılır:
        "KAD-TEM MÜH. MÜT. ... A.Ş." == "KAD-TEM MÜH. MÜT. ... ANONİM ŞİRKETİ"
        çünkü ikisi de "KAD-TEM MUH MUT ... AS" kanonik formuna çevriliyor.

    `my_firms` kısa olabilir (örn: "KAD-TEM"). O zaman kanonik içeren
    firmaları SELF kabul ederiz (kanonik substring match).
    """
    if not firma_adi:
        return False
    parsed = parse_firma_adi(firma_adi)
    if not parsed.firmalar:
        return False

    # Her bir alt-firma için kanonik kontrol
    for f in parsed.firmalar:
        f_kanon = kanonik_firma_adi(f)
        if not f_kanon:
            continue
        for my in my_firms:
            my_kanon = kanonik_firma_adi(my)
            if not my_kanon:
                continue
            # Substring match — "IKIKAT" → "IKIKAT INS TAAH ..." içinde
            if my_kanon in f_kanon or f_kanon in my_kanon:
                return True
    return False


def label_etiket(row: pd.Series, my_firms: list[str]) -> str:
    """SELF / COMPETITOR etiketi.

    SADECE MY_FIRMS listesi ile kanonik eşleşme kontrolü yapılır.
    DB'deki `is_own_company` flag'i artık IGNORE ediliyor — JV partnerleri için
    de true işaretlendiğinden yanıltıcı oluyor.
    """
    if is_my_firm(row.get("firma_adi", ""), my_firms):
        return "SELF"
    return "COMPETITOR"


# ===========================================
# Ana ETL fonksiyonu
# ===========================================
def transform_birlesik(df: pd.DataFrame, my_firms: list[str], cfg: Config) -> pd.DataFrame:
    """Ham birleşik tabloyu analize hazır forma getir.

    Args:
        df: db.fetch_birlesik_dataset() çıktısı.
        my_firms: Kontrolünüzdeki firma listesi.
        cfg: Konfigürasyon nesnesi.

    Returns:
        Genişletilmiş DataFrame:
            + firmalar: list[str]    — JV ise birden fazla
            + is_jv: bool
            + tarih_saat_suffix: str | None
            + etiket: 'SELF' | 'COMPETITOR'
            + tenzilat_calc: float   — tutarlılık için yeniden hesaplanmış
    """
    if df.empty:
        log.warning("Birleşik veri seti boş.")
        return df

    df = df.copy()

    # Sayısal alanları normalize et (zaten numeric ise dokunma)
    for col in ["resmi_ym", "bizim_ym", "n_katsayisi", "sinir_deger",
                "t1", "t2", "c_degeri", "k_degeri", "standart_sapma",
                "muhtemel_kazanan_tutar", "teklif_tutari", "tenzilat"]:
        if col in df.columns:
            df[col] = df[col].apply(parse_turkish_number)

    # firma_adi → JV parse
    parsed = df["firma_adi"].apply(lambda x: parse_firma_adi(x or ""))
    df["firmalar"] = parsed.apply(lambda p: p.firmalar)
    df["is_jv"] = parsed.apply(lambda p: p.is_jv)
    df["tarih_saat_suffix"] = parsed.apply(lambda p: p.tarih_saat)
    df["primary_firma"] = parsed.apply(lambda p: p.primary_name())

    # KANONİK firma adları — aynı firmanın farklı yazılışlarını birleştirir
    df["firmalar_kanon"] = df["firmalar"].apply(
        lambda lst: [kanonik_firma_adi(f) for f in (lst or [])]
    )
    df["primary_firma_kanon"] = df["primary_firma"].apply(kanonik_firma_adi)

    # Etiket
    df["etiket"] = df.apply(lambda r: label_etiket(r, my_firms), axis=1)

    # Tenzilat'ı yeniden hesapla (tutarlılık için)
    def _calc_tenz(r):
        ym = r.get("resmi_ym")
        t = r.get("teklif_tutari")
        if ym and ym > 0 and t is not None:
            return round(((ym - t) / ym) * 100, 2)
        return None
    df["tenzilat_calc"] = df.apply(_calc_tenz, axis=1)

    # Sınır değer uzaklığı (sniper detection için)
    def _sd_dist(r):
        sd = r.get("sinir_deger")
        t = r.get("teklif_tutari")
        if sd and sd > 0 and t is not None:
            return abs(t - sd) / sd * 100  # % cinsinden
        return None
    df["sd_uzaklik_pct"] = df.apply(_sd_dist, axis=1)
    df["sd_in_band"] = df["sd_uzaklik_pct"].apply(
        lambda d: d is not None and d < cfg.get("sniper.threshold_pct", 0.50)
    )

    return df


def load_data(my_firms: list[str], cfg: Config) -> pd.DataFrame:
    """Tek satırla full ETL: DB → temizle → etiketle."""
    raw = db.fetch_birlesik_dataset()
    log.info(f"Ham veri: {len(raw)} satır ({raw['ihale_id'].nunique() if not raw.empty else 0} ihale)")
    return transform_birlesik(raw, my_firms, cfg)


# ===========================================
# Test
# ===========================================
if __name__ == "__main__":
    print("=== ETL Modülü Smoke Test ===\n")

    # Türkçe sayı parser testi
    examples = [
        "1.234.567,89", "1234567,89", "1.234,56", "1234.56",
        "1234567", "₺ 12.345,00", "  ", None, np.nan, 1234.5,
    ]
    for e in examples:
        print(f"  parse_turkish_number({e!r:>20}) = {parse_turkish_number(e)}")

    print("\n=== is_my_firm Testi ===")
    my = ["İKİKAT İNŞAAT", "KAD-TEM YAPI"]
    tests = [
        "İKİKAT İNŞAAT MÜH. LTD.",
        "KAD-TEM YAPI A.Ş.",
        "ABC İNŞAAT",
        "İKİKAT İNŞAAT, ORTAK FIRMA - 15.03.2021 11:19",  # JV içinde SELF var
    ]
    for t in tests:
        print(f"  is_my_firm({t!r}) = {is_my_firm(t, my)}")
