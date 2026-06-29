"""
Yi-ÜFE (Yurt İçi Üretici Fiyat Endeksi) — Enflasyon Güncelleme.

Mevcut Next.js sistemi (yonetim/santiyeler) ile birebir aynı mantık:
    "İhale tarihinden BİR ÖNCEKİ ayın endeksi" baz alınır.

Ana fonksiyon:
    bugune_getir(tutar, ihale_tarihi) → bugünkü TL değeri

Veritabanı şeması (yi_ufe tablosu):
    yil  | ay  | endeks
    2020 | 1   | 462.42
    2020 | 2   | 464.64
    ...
"""
from __future__ import annotations
import logging
from datetime import date, datetime
from dataclasses import dataclass
import pandas as pd

from core import db

log = logging.getLogger(__name__)


# ===========================================
# Veri yükleyici
# ===========================================
def load_yi_ufe() -> pd.DataFrame:
    """yi_ufe tablosunu DataFrame olarak yükle, yıl-ay ile sırala."""
    df = db.fetch_yi_ufe()
    if df.empty:
        log.warning("Yi-ÜFE tablosu boş. Enflasyon güncellemesi yapılamayacak.")
        return df
    # Sırala
    df = df.sort_values(["yil", "ay"]).reset_index(drop=True)
    return df


def yi_ufe_dict(df: pd.DataFrame | None = None) -> dict[tuple[int, int], float]:
    """{(yil, ay): endeks} sözlüğüne dönüştür — hızlı erişim için."""
    if df is None:
        df = load_yi_ufe()
    return {(int(r["yil"]), int(r["ay"])): float(r["endeks"]) for _, r in df.iterrows()}


# ===========================================
# Endeks bulucular
# ===========================================
def _to_year_month(d: str | date | datetime | pd.Timestamp) -> tuple[int, int]:
    """Tarihi (yil, ay) tuple'ına çevir."""
    if isinstance(d, str):
        d = pd.to_datetime(d).date()
    elif isinstance(d, (datetime, pd.Timestamp)):
        d = d.date() if hasattr(d, "date") else d
    return d.year, d.month


def _onceki_ay(yil: int, ay: int) -> tuple[int, int]:
    """Bir önceki ayı döndür (ay sıfır olamaz)."""
    if ay == 1:
        return yil - 1, 12
    return yil, ay - 1


def get_endeks(
    tarih: str | date | datetime,
    yi_ufe_map: dict[tuple[int, int], float] | None = None,
    onceki_ay: bool = True,
    eksik_ay_doldurma: str = "linear",
) -> float | None:
    """Bir tarihin Yi-ÜFE endeksini bul.

    Args:
        tarih: Tarih (string, date, datetime).
        yi_ufe_map: {(yil, ay): endeks} sözlüğü. Yoksa DB'den yüklenir.
        onceki_ay: True ise tarihin BİR ÖNCEKİ ayı kullanılır
            (mevcut sistem davranışıyla uyumlu).
        eksik_ay_doldurma: "linear" | "nearest" | "skip"

    Returns:
        Endeks değeri veya None.
    """
    if yi_ufe_map is None:
        yi_ufe_map = yi_ufe_dict()

    if not yi_ufe_map:
        return None

    yil, ay = _to_year_month(tarih)
    if onceki_ay:
        yil, ay = _onceki_ay(yil, ay)

    # Direkt eşleşme
    if (yil, ay) in yi_ufe_map:
        return yi_ufe_map[(yil, ay)]

    # Eksik ay — strateji uygula
    if eksik_ay_doldurma == "skip":
        return None

    # En yakın ay
    keys = sorted(yi_ufe_map.keys())
    target_num = yil * 100 + ay

    onceki = None
    sonraki = None
    for k in keys:
        k_num = k[0] * 100 + k[1]
        if k_num <= target_num:
            onceki = k
        elif k_num > target_num and sonraki is None:
            sonraki = k
            break

    if eksik_ay_doldurma == "nearest":
        if onceki and sonraki:
            d_onceki = target_num - onceki[0] * 100 - onceki[1]
            d_sonraki = sonraki[0] * 100 + sonraki[1] - target_num
            return yi_ufe_map[onceki] if d_onceki <= d_sonraki else yi_ufe_map[sonraki]
        return yi_ufe_map.get(onceki or sonraki)

    if eksik_ay_doldurma == "linear":
        if onceki and sonraki:
            o_num = onceki[0] * 100 + onceki[1]
            s_num = sonraki[0] * 100 + sonraki[1]
            o_val = yi_ufe_map[onceki]
            s_val = yi_ufe_map[sonraki]
            # Lineer interpolasyon (ay bazında, ~1 birim = 1 ay)
            ratio = (target_num - o_num) / (s_num - o_num) if s_num > o_num else 0
            return o_val + (s_val - o_val) * ratio
        # Sınırda kalan değeri döndür
        return yi_ufe_map.get(onceki or sonraki)

    return None


def get_son_endeks(yi_ufe_map: dict[tuple[int, int], float] | None = None) -> float | None:
    """En güncel (en son ay) endeks değeri."""
    if yi_ufe_map is None:
        yi_ufe_map = yi_ufe_dict()
    if not yi_ufe_map:
        return None
    en_son_key = max(yi_ufe_map.keys())
    return yi_ufe_map[en_son_key]


# ===========================================
# Enflasyon güncellemesi (ana fonksiyon)
# ===========================================
def bugune_getir(
    tutar: float | None,
    kaynak_tarih: str | date | datetime,
    yi_ufe_map: dict[tuple[int, int], float] | None = None,
    referans_tarih: str | date | datetime | None = None,
) -> float | None:
    """Geçmiş bir TL tutarı bugünün (veya referans tarihinin) değerine getir.

    Formül:
        bugun_tutar = tutar × (endeks_referans / endeks_kaynak)

    Args:
        tutar: Eski TL değeri.
        kaynak_tarih: Tutarın ait olduğu tarih (ihale tarihi).
        yi_ufe_map: Önceden yüklenmiş endeks sözlüğü (performans için).
        referans_tarih: Bu tarihe getir (None ise bugün).

    Returns:
        Güncellenmiş tutar veya None.
    """
    if tutar is None or tutar <= 0:
        return None

    if yi_ufe_map is None:
        yi_ufe_map = yi_ufe_dict()

    if not yi_ufe_map:
        log.warning("Yi-ÜFE verisi yok, güncelleme yapılamıyor.")
        return tutar  # değişiklik yapma

    endeks_kaynak = get_endeks(kaynak_tarih, yi_ufe_map)
    if endeks_kaynak is None or endeks_kaynak <= 0:
        log.warning(f"Kaynak endeks bulunamadı: {kaynak_tarih}")
        return None

    if referans_tarih:
        endeks_ref = get_endeks(referans_tarih, yi_ufe_map)
    else:
        endeks_ref = get_son_endeks(yi_ufe_map)

    if endeks_ref is None or endeks_ref <= 0:
        log.warning("Referans endeks bulunamadı.")
        return None

    return tutar * (endeks_ref / endeks_kaynak)


# ===========================================
# Toplu güncelleme (DataFrame için)
# ===========================================
def df_bugune_getir(
    df: pd.DataFrame,
    tutar_kolonu: str,
    tarih_kolonu: str,
    yeni_kolon: str | None = None,
    yi_ufe_map: dict[tuple[int, int], float] | None = None,
) -> pd.DataFrame:
    """DataFrame'deki bir TL kolonunu Yi-ÜFE ile bugüne getir.

    Args:
        df: Veri.
        tutar_kolonu: Eski tutar kolonu (örn. 'teklif_tutari').
        tarih_kolonu: Tarih kolonu (örn. 'ihale_tarihi').
        yeni_kolon: Çıktı kolon adı (varsayılan: '<tutar_kolonu>_bugun').
        yi_ufe_map: Önceden yüklenmiş endeks.

    Returns:
        Yeni kolon eklenmiş DataFrame.
    """
    if yi_ufe_map is None:
        yi_ufe_map = yi_ufe_dict()

    yeni = yeni_kolon or f"{tutar_kolonu}_bugun"

    df = df.copy()
    df[yeni] = df.apply(
        lambda r: bugune_getir(r.get(tutar_kolonu), r.get(tarih_kolonu), yi_ufe_map),
        axis=1,
    )
    return df


# ===========================================
# Sağlık & istatistik
# ===========================================
def yi_ufe_summary() -> dict:
    """Yi-ÜFE veri setinin özeti."""
    df = load_yi_ufe()
    if df.empty:
        return {"ok": False, "msg": "Yi-ÜFE tablosu boş"}

    en_eski = df.iloc[0]
    en_yeni = df.iloc[-1]

    # Yıl bazlı kümülatif enflasyon
    en_eski_endeks = float(en_eski["endeks"])
    en_yeni_endeks = float(en_yeni["endeks"])
    toplam_artis = (en_yeni_endeks / en_eski_endeks - 1) * 100 if en_eski_endeks > 0 else 0

    return {
        "ok": True,
        "kayit_sayisi": len(df),
        "en_eski_ay": f"{int(en_eski['yil'])}-{int(en_eski['ay']):02d}",
        "en_yeni_ay": f"{int(en_yeni['yil'])}-{int(en_yeni['ay']):02d}",
        "en_eski_endeks": en_eski_endeks,
        "en_yeni_endeks": en_yeni_endeks,
        "toplam_kumulatif_artis_pct": round(toplam_artis, 2),
    }


# ===========================================
# Test (DB gerekli)
# ===========================================
if __name__ == "__main__":
    print("=== Yi-ÜFE Modülü Smoke Test ===\n")
    summary = yi_ufe_summary()
    if not summary.get("ok"):
        print(f"⚠ {summary.get('msg')}")
        exit(1)

    print(f"Kayıt sayısı: {summary['kayit_sayisi']}")
    print(f"Aralık: {summary['en_eski_ay']} → {summary['en_yeni_ay']}")
    print(f"Endeks aralığı: {summary['en_eski_endeks']:.2f} → {summary['en_yeni_endeks']:.2f}")
    print(f"Kümülatif artış: %{summary['toplam_kumulatif_artis_pct']}")
    print()

    # Örnek dönüşüm: 2020-03'teki 1.000.000 TL bugüne ne kadar?
    bugun = bugune_getir(1_000_000, "2020-03-15")
    print(f"2020-03-15 tarihindeki 1.000.000 TL bugün: {bugun:,.0f} TL" if bugun else "Hesaplanamadı")
