"""
Kurumsal Sapma (Bias Factor) Hesabı.

Mantık:
    Bizim_YM = ihale.hesaplanan_yaklasik_maliyet  (firmamızın hesabı)
    Resmi_YM = ihale.yaklasik_maliyet              (idarenin açıkladığı)

    Sapma_i = Resmi_YM_i / Bizim_YM_i

    Global_Bias_Factor = ortalama veya medyan(Sapma_i)

İdarenin açıklayacağı YM'nin tahmini:
    Tahmini_Resmi_YM = Bizim_YM × Global_Bias_Factor

Çıktı:
    data/bias_history.json — zaman serisi takibi için
"""
from __future__ import annotations
import json
import logging
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
import pandas as pd
import numpy as np

from core.config import DATA_DIR, Config
from core import db

log = logging.getLogger(__name__)

BIAS_HISTORY_FILE = DATA_DIR / "bias_history.json"


@dataclass
class BiasResult:
    """Kurumsal sapma hesap sonucu."""
    n_ihale: int                      # Bizim_YM'si dolu olan ihale sayısı
    ortalama_bias: float              # Aritmetik ortalama
    medyan_bias: float                # Medyan (outlier dirençli)
    trimmed_mean_bias: float          # %10-%90 trimmed mean
    std_bias: float                   # Standart sapma
    min_bias: float                   # En düşük sapma
    max_bias: float                   # En yüksek sapma
    p10_bias: float                   # 10. percentile
    p90_bias: float                   # 90. percentile
    en_eski_tarih: str | None
    en_yeni_tarih: str | None
    onerilen_metrik: str              # "medyan" veya "trimmed_mean"
    onerilen_deger: float             # Senaryolarda kullanılacak nihai sapma
    son_3_ay_bias: float | None       # Son 3 ay (kayma var mı)
    son_6_ay_bias: float | None       # Son 6 ay
    son_12_ay_bias: float | None      # Son 12 ay
    hesap_tarihi: str

    def to_dict(self) -> dict:
        return asdict(self)


# ===========================================
# Hesaplama
# ===========================================
def hesapla_bias(ihaleler_df: pd.DataFrame | None = None) -> BiasResult | None:
    """Tüm geçmiş ihalelerden Global_Bias_Factor hesapla.

    Args:
        ihaleler_df: db.fetch_ihaleler() çıktısı veya None (otomatik yüklenir).

    Returns:
        BiasResult nesnesi veya None.
    """
    if ihaleler_df is None:
        ihaleler_df = db.fetch_ihaleler()

    if ihaleler_df.empty:
        log.warning("İhale verisi boş.")
        return None

    # Sadece her iki YM de dolu olan satırlar
    df = ihaleler_df.dropna(subset=["yaklasik_maliyet", "hesaplanan_yaklasik_maliyet"]).copy()
    df = df[
        (df["yaklasik_maliyet"] > 0) &
        (df["hesaplanan_yaklasik_maliyet"] > 0)
    ]

    if df.empty:
        log.warning("Hem Resmi_YM hem Bizim_YM dolu olan ihale bulunamadı.")
        return None

    # Sapma = Resmi / Bizim
    df["sapma"] = df["yaklasik_maliyet"] / df["hesaplanan_yaklasik_maliyet"]

    # Anomali filtresi: sapma 0.3-3.0 arası kabul edilir
    # (10x yanlış girilmiş kayıtlar olabilir)
    df_filtre = df[(df["sapma"] >= 0.3) & (df["sapma"] <= 3.0)]
    if len(df_filtre) < len(df):
        log.warning(f"{len(df) - len(df_filtre)} aykırı sapma değeri filtrelendi.")
    df = df_filtre

    if df.empty:
        log.warning("Filtreden sonra geçerli kayıt kalmadı.")
        return None

    sapmalar = df["sapma"].values
    n = len(sapmalar)

    ortalama = float(np.mean(sapmalar))
    medyan = float(np.median(sapmalar))
    std = float(np.std(sapmalar, ddof=1)) if n > 1 else 0.0

    # Trimmed mean (%10 baş, %10 son atılır)
    if n >= 10:
        trimmed = float(np.mean(np.sort(sapmalar)[int(n * 0.1): int(n * 0.9)]))
    else:
        trimmed = ortalama

    p10 = float(np.percentile(sapmalar, 10))
    p90 = float(np.percentile(sapmalar, 90))

    # Önerilen metrik: az veri ise medyan, çok veri ise trimmed mean
    if n >= 20:
        onerilen_metrik = "trimmed_mean"
        onerilen_deger = trimmed
    else:
        onerilen_metrik = "medyan"
        onerilen_deger = medyan

    # Son N ay analizi (kayma tespiti)
    df["ihale_tarihi"] = pd.to_datetime(df["ihale_tarihi"], errors="coerce")
    df_sorted = df.sort_values("ihale_tarihi")

    bugun = pd.Timestamp.today()
    son_3 = df_sorted[df_sorted["ihale_tarihi"] >= bugun - pd.DateOffset(months=3)]
    son_6 = df_sorted[df_sorted["ihale_tarihi"] >= bugun - pd.DateOffset(months=6)]
    son_12 = df_sorted[df_sorted["ihale_tarihi"] >= bugun - pd.DateOffset(months=12)]

    son_3_bias = float(son_3["sapma"].median()) if len(son_3) >= 3 else None
    son_6_bias = float(son_6["sapma"].median()) if len(son_6) >= 3 else None
    son_12_bias = float(son_12["sapma"].median()) if len(son_12) >= 3 else None

    en_eski = df_sorted.iloc[0]["ihale_tarihi"]
    en_yeni = df_sorted.iloc[-1]["ihale_tarihi"]

    return BiasResult(
        n_ihale=n,
        ortalama_bias=round(ortalama, 4),
        medyan_bias=round(medyan, 4),
        trimmed_mean_bias=round(trimmed, 4),
        std_bias=round(std, 4),
        min_bias=round(float(np.min(sapmalar)), 4),
        max_bias=round(float(np.max(sapmalar)), 4),
        p10_bias=round(p10, 4),
        p90_bias=round(p90, 4),
        en_eski_tarih=str(en_eski.date()) if pd.notna(en_eski) else None,
        en_yeni_tarih=str(en_yeni.date()) if pd.notna(en_yeni) else None,
        onerilen_metrik=onerilen_metrik,
        onerilen_deger=round(onerilen_deger, 4),
        son_3_ay_bias=round(son_3_bias, 4) if son_3_bias else None,
        son_6_ay_bias=round(son_6_bias, 4) if son_6_bias else None,
        son_12_ay_bias=round(son_12_bias, 4) if son_12_bias else None,
        hesap_tarihi=datetime.now().isoformat(),
    )


# ===========================================
# İdare bazlı bias (her idare için ayrı bias deseni)
# ===========================================
def hesapla_idare_bias(
    idare_adi: str,
    ihaleler_df: pd.DataFrame | None = None,
) -> BiasResult | None:
    """Belirli bir idare için bias hesapla. Genel hesabın kopyası ama
    sadece o idarenin ihaleleri kullanılır.

    Args:
        idare_adi: Tam idare adı (DB'deki idare_adi sütunuyla eşleşir).
        ihaleler_df: db.fetch_ihaleler() çıktısı veya None.

    Returns:
        İdarede yeterli veri varsa BiasResult, yoksa None.
    """
    if ihaleler_df is None:
        ihaleler_df = db.fetch_ihaleler()

    if ihaleler_df.empty:
        return None

    df = ihaleler_df[ihaleler_df["idare_adi"] == idare_adi].copy()
    if df.empty:
        return None

    return hesapla_bias(df)


def fallback_bias(
    bizim_ym: float,
    idare_adi: str | None,
    ihaleler_df: pd.DataFrame | None = None,
) -> tuple[float, str, int]:
    """En iyi bias değerini seç: idare-bazlı varsa onu, yoksa global.

    Returns:
        (bias_degeri, kaynak, n_ihale)
        kaynak: "idare" | "global" | "yok"
    """
    # 1. İdare bazlı dene
    if idare_adi:
        ib = hesapla_idare_bias(idare_adi, ihaleler_df)
        if ib and ib.n_ihale >= 3:
            return ib.onerilen_deger, "idare", ib.n_ihale
    # 2. Global'a düş
    gb = hesapla_bias(ihaleler_df)
    if gb:
        return gb.onerilen_deger, "global", gb.n_ihale
    # 3. Hiç veri yok — bizim_ym'i olduğu gibi kullan
    _ = bizim_ym
    return 1.0, "yok", 0


# ===========================================
# Otomatik Maliyet Marjı (geçmiş SELF tekliflerden)
# ===========================================
def hesapla_otomatik_maliyet_marji(
    df: pd.DataFrame,
    idare_adi: str | None = None,
    varsayilan: float = 8.0,
) -> tuple[float, str, int]:
    """Geçmiş SELF tekliflerinden tipik maliyet marjını hesapla.

    Mantık:
        - SELF satırlarda: kullanıcının kendi YM'sinden ne kadar kırdığı
          tenzilat_yme_gore = (1 - teklif_tutari/bizim_ym) × 100
        - Bunun medyanı = kullanıcının "tipik kâr payı feda etme oranı"
        - Bu değer simülasyonda break-even noktası olarak kullanılır

    Önce idare-bazlı arar (>=3 kayıt), yoksa global, o da yoksa varsayılan.

    Args:
        df: ETL ile etiket='SELF/COMPETITOR' eklenmiş birleşik DataFrame.
        idare_adi: İsteğe bağlı — sadece o idarenin verilerini kullan.
        varsayilan: Veri yoksa kullanılacak (% olarak).

    Returns:
        (marj_yuzde, kaynak, n_kayit)
        kaynak: "idare" | "global" | "varsayilan"
    """
    if df is None or df.empty or "etiket" not in df.columns:
        return varsayilan, "varsayilan", 0

    self_df = df[df["etiket"] == "SELF"].copy()
    if self_df.empty:
        return varsayilan, "varsayilan", 0

    # Sadece bizim_ym ve teklif_tutari dolu olanlar
    self_df = self_df.dropna(subset=["bizim_ym", "teklif_tutari"])
    self_df = self_df[(self_df["bizim_ym"] > 0) & (self_df["teklif_tutari"] > 0)]
    if self_df.empty:
        return varsayilan, "varsayilan", 0

    self_df["marj_pct"] = (1.0 - self_df["teklif_tutari"] / self_df["bizim_ym"]) * 100.0

    # Anomali: -50% ile 60% arası kabul (10x yanlış girişleri filtre)
    self_df = self_df[(self_df["marj_pct"] >= -50.0) & (self_df["marj_pct"] <= 60.0)]
    if self_df.empty:
        return varsayilan, "varsayilan", 0

    # İdare bazlı dene
    if idare_adi:
        idare_df = self_df[self_df["idare_adi"] == idare_adi]
        if len(idare_df) >= 3:
            return round(float(idare_df["marj_pct"].median()), 2), "idare", len(idare_df)

    # Global medyan
    return round(float(self_df["marj_pct"].median()), 2), "global", len(self_df)


# ===========================================
# Tahmin yardımcısı
# ===========================================
def tahmini_resmi_ym(bizim_ym: float, bias: float | BiasResult) -> float:
    """Bizim YM'mizden tahmini Resmi YM hesapla.

    Args:
        bizim_ym: Firmamızın hesapladığı YM.
        bias: float değer veya BiasResult nesnesi.

    Returns:
        Tahmini idare YM'si.
    """
    if isinstance(bias, BiasResult):
        bias_val = bias.onerilen_deger
    else:
        bias_val = float(bias)
    return bizim_ym * bias_val


# ===========================================
# Kalıcı tarihçe (zaman serisi)
# ===========================================
def kaydet_history(result: BiasResult) -> None:
    """Bias geçmişine yeni bir kayıt ekle (data/bias_history.json)."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    history = []
    if BIAS_HISTORY_FILE.exists():
        with open(BIAS_HISTORY_FILE, "r", encoding="utf-8") as f:
            try:
                history = json.load(f)
            except json.JSONDecodeError:
                history = []

    history.append(result.to_dict())

    # Sadece son 100 kaydı tut
    history = history[-100:]

    with open(BIAS_HISTORY_FILE, "w", encoding="utf-8") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)
    log.info(f"Bias history güncellendi: {BIAS_HISTORY_FILE} ({len(history)} kayıt)")


def yukle_history() -> list[dict]:
    """Bias geçmiş kayıtlarını yükle."""
    if not BIAS_HISTORY_FILE.exists():
        return []
    with open(BIAS_HISTORY_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []


# ===========================================
# CLI rapor
# ===========================================
def yazdir_rapor(r: BiasResult) -> None:
    """Konsola güzel rapor."""
    print("=" * 60)
    print("  KURUMSAL SAPMA (BIAS FACTOR) RAPORU")
    print("=" * 60)
    print(f"  Veri:                {r.n_ihale} ihale")
    print(f"  Aralık:              {r.en_eski_tarih} → {r.en_yeni_tarih}")
    print()
    print("  --- İSTATİSTİKLER ---")
    print(f"  Ortalama:            {r.ortalama_bias:.4f}  ({(r.ortalama_bias-1)*100:+.1f}%)")
    print(f"  Medyan:              {r.medyan_bias:.4f}  ({(r.medyan_bias-1)*100:+.1f}%)")
    print(f"  Trimmed Mean (%10):  {r.trimmed_mean_bias:.4f}  ({(r.trimmed_mean_bias-1)*100:+.1f}%)")
    print(f"  Standart Sapma:      {r.std_bias:.4f}")
    print(f"  Min / Max:           {r.min_bias:.4f} / {r.max_bias:.4f}")
    print(f"  P10 / P90:           {r.p10_bias:.4f} / {r.p90_bias:.4f}")
    print()
    print("  --- ZAMAN SERİSİ ---")
    print(f"  Son 3 ay  (medyan):  {r.son_3_ay_bias if r.son_3_ay_bias else '—'}")
    print(f"  Son 6 ay  (medyan):  {r.son_6_ay_bias if r.son_6_ay_bias else '—'}")
    print(f"  Son 12 ay (medyan):  {r.son_12_ay_bias if r.son_12_ay_bias else '—'}")
    print()
    print("  --- ÖNERİ ---")
    print(f"  ✓ Önerilen Metrik:   {r.onerilen_metrik}")
    print(f"  ✓ Önerilen Bias:     {r.onerilen_deger:.4f}")
    print()
    yorum = ""
    if r.onerilen_deger > 1.05:
        yorum = "→ İdareler genelde bizim hesaptan YÜKSEK YM açıklıyor"
    elif r.onerilen_deger < 0.95:
        yorum = "→ İdareler genelde bizim hesaptan DÜŞÜK YM açıklıyor"
    else:
        yorum = "→ İdare YM'leri bizim hesabımıza yakın"
    print(f"  {yorum}")
    print("=" * 60)


# ===========================================
# Smoke test
# ===========================================
if __name__ == "__main__":
    r = hesapla_bias()
    if r is None:
        print("⚠ Bias hesabı yapılamadı.")
        exit(1)
    yazdir_rapor(r)
    kaydet_history(r)
