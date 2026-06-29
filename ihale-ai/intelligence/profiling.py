"""
Sniper Detection + Detaylı Rakip Profilleme.

Kullanıcının kuralları:
    - |T - SD| / SD × 100 < %0.50  → "in-band" sayılır
    - Bir firma aynı İDAREDE 2+ ihalede in-band ise → o idare için SNIPER
    - Global std > %2 ise firma sniper sayılmaz (tutarsız davranış)
    - Min 3 toplam ihale gerekli (anlamlılık için)
    - Ultra sniper: eşik %0.20

Çıktı yapısı:
    SniperKarne {
        firma,
        sniper_idareler[]: [{idare, in_band_sayisi, oran, ortalama_yakinlik}],
        global_std,
        is_sniper,
        is_ultra_sniper,
        confidence: HIGH/MEDIUM/LOW
    }

Önemli: Sniper status idare-spesifik. Bir firma DSİ Erzurum'da sniper olabilir
ama Karayolları'nda olmayabilir (idare-spesifik bilgi sızıntısı).
"""
from __future__ import annotations
import logging
import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
import pandas as pd
import numpy as np

from core.config import DATA_DIR, Config
from core import db, etl
from core.firma_normalize import kanonik_firma_adi
from .experience import FirmaDeneyim, hesapla_firma_deneyimleri

log = logging.getLogger(__name__)

SNIPER_PROFILES_DIR = DATA_DIR / "sniper_profiles"


# ===========================================
# Veri sınıfları
# ===========================================
@dataclass
class SniperIdareBilgi:
    """Bir firmanın belirli bir idarede sniper davranışı."""
    idare_adi: str
    toplam_ihale: int                    # Bu idarede firma kaç ihaleye girmiş
    in_band_sayisi: int                  # |T-SD|/SD < %0.5 olan ihale sayısı
    in_band_orani: float                 # in_band_sayisi / toplam_ihale
    ortalama_yakinlik_pct: float        # |T-SD|/SD ortalaması (% cinsinden)
    medyan_yakinlik_pct: float
    min_yakinlik_pct: float
    is_ultra_idare: bool                 # Bu idarede ultra sniper mı

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class SniperKarne:
    """Bir firmanın sniper karnesi (tüm idareler bazında)."""
    firma_adi: str
    firma_kanon: str
    etiket: str                          # SELF / COMPETITOR
    toplam_ihale: int                    # SD verisi olan ihale sayısı
    is_sniper: bool                      # Herhangi bir idarede sniper mı
    is_ultra_sniper: bool                # Herhangi bir idarede ultra
    sniper_idareler: list[SniperIdareBilgi] = field(default_factory=list)
    sniper_olmadigi_idareler: list[str] = field(default_factory=list)

    # Global istatistikler (tüm ihaleler)
    global_ortalama_yakinlik_pct: float = 0.0
    global_medyan_yakinlik_pct: float = 0.0
    global_std_pct: float = 0.0          # Standart sapma — > %2 ise filtreden hariç
    en_yakin_teklif_pct: float = 0.0     # En küçük |T-SD|/SD

    # Kontrol bilgileri
    min_total_ihale_saglandi: bool = False
    std_filter_saglandi: bool = False    # std < %2

    confidence: str = "LOW"              # HIGH / MEDIUM / LOW
    notlar: str = ""

    def to_dict(self) -> dict:
        d = asdict(self)
        d["sniper_idareler"] = [s.to_dict() if isinstance(s, SniperIdareBilgi) else s for s in self.sniper_idareler]
        return d


# ===========================================
# Ana hesaplayıcı
# ===========================================
def hesapla_sniper(
    df: pd.DataFrame | None = None,
    my_firms: list[str] | None = None,
    cfg: Config | None = None,
) -> dict[str, SniperKarne]:
    """Tüm firmalar için sniper analizi.

    Args:
        df: ETL'den geçmiş birleşik veri seti.
        my_firms: SELF firmaları.
        cfg: Konfigürasyon.

    Returns:
        {firma_kanon: SniperKarne} — TÜM firmalar (sniper olmayan dahil).
        Filtre için `is_sniper` kullanın.
    """
    if cfg is None:
        cfg = Config.load()

    # Eşikler
    thr_pct = float(cfg.get("sniper.threshold_pct", 0.50))
    ultra_thr_pct = float(cfg.get("sniper.ultra_threshold_pct", 0.20))
    min_idare_hits = int(cfg.get("sniper.min_idare_hits", 2))
    max_global_std_pct = float(cfg.get("sniper.max_global_std_pct", 2.0))
    min_total_ihale = int(cfg.get("sniper.min_total_ihale", 3))

    if df is None:
        from core.config import load_my_firms as _lmf
        my_firms = my_firms or _lmf()
        df = etl.load_data(my_firms, cfg)

    if df.empty:
        log.warning("Veri seti boş.")
        return {}

    # Sadece SD verisi olan satırlar
    df_sd = df[df["sd_uzaklik_pct"].notna() & df["sinir_deger"].notna()].copy()
    if df_sd.empty:
        log.warning("Sınır değer verisi olan kayıt bulunamadı.")
        return {}

    # JV satırlarını her firma için expand et
    rows = []
    for _, row in df_sd.iterrows():
        firmalar = row.get("firmalar") or []
        firmalar_kanon = row.get("firmalar_kanon") or []
        if not firmalar:
            continue

        sd_uzaklik = float(row["sd_uzaklik_pct"])
        in_band = sd_uzaklik < thr_pct
        in_ultra = sd_uzaklik < ultra_thr_pct

        for idx, firma in enumerate(firmalar):
            firma_kanon = firmalar_kanon[idx] if idx < len(firmalar_kanon) else kanonik_firma_adi(firma)
            if not firma_kanon:
                continue
            rows.append({
                "firma_kanon": firma_kanon,
                "firma_adi": firma,
                "ihale_id": row.get("ihale_id"),
                "idare_adi": row.get("idare_adi"),
                "sd_uzaklik_pct": sd_uzaklik,
                "in_band": in_band,
                "in_ultra": in_ultra,
                "etiket": row.get("etiket", "COMPETITOR"),
            })

    if not rows:
        return {}

    edf = pd.DataFrame(rows)
    sonuc: dict[str, SniperKarne] = {}

    for firma_kanon, grup in edf.groupby("firma_kanon"):
        toplam_ihale = int(grup["ihale_id"].nunique())

        # Görsel ad
        firma_display_kandidat = grup["firma_adi"].value_counts().index.tolist()
        firma_display = max(firma_display_kandidat, key=len) if firma_display_kandidat else firma_kanon
        etiket = "SELF" if (grup["etiket"] == "SELF").any() else "COMPETITOR"

        # Global istatistikler
        sd_vals = grup["sd_uzaklik_pct"].astype(float)
        global_ort = float(sd_vals.mean())
        global_med = float(sd_vals.median())
        global_std = float(sd_vals.std(ddof=1)) if len(sd_vals) > 1 else 0.0
        en_yakin = float(sd_vals.min())

        # Filtreler
        min_total_saglandi = toplam_ihale >= min_total_ihale
        std_filter_saglandi = global_std <= max_global_std_pct

        # İdare bazlı sniper analizi
        sniper_idareler: list[SniperIdareBilgi] = []
        sniper_olmayan_idareler: list[str] = []

        for idare, idare_grup in grup.groupby("idare_adi"):
            if pd.isna(idare):
                continue
            idare = str(idare)
            in_band_sayisi = int(idare_grup["in_band"].sum())
            toplam_idare = int(idare_grup["ihale_id"].nunique())

            if in_band_sayisi >= min_idare_hits and min_total_saglandi and std_filter_saglandi:
                # ⚠ SNIPER bu idarede
                sniper_idareler.append(SniperIdareBilgi(
                    idare_adi=idare,
                    toplam_ihale=toplam_idare,
                    in_band_sayisi=in_band_sayisi,
                    in_band_orani=round(in_band_sayisi / toplam_idare, 4),
                    ortalama_yakinlik_pct=round(float(idare_grup["sd_uzaklik_pct"].mean()), 4),
                    medyan_yakinlik_pct=round(float(idare_grup["sd_uzaklik_pct"].median()), 4),
                    min_yakinlik_pct=round(float(idare_grup["sd_uzaklik_pct"].min()), 4),
                    is_ultra_idare=bool(int(idare_grup["in_ultra"].sum()) >= min_idare_hits),
                ))
            else:
                if toplam_idare >= 1:
                    sniper_olmayan_idareler.append(idare)

        is_sniper = len(sniper_idareler) > 0
        is_ultra = any(s.is_ultra_idare for s in sniper_idareler)

        # Confidence — toplam ihale sayısına göre
        if toplam_ihale >= 10:
            confidence = "HIGH"
        elif toplam_ihale >= 5:
            confidence = "MEDIUM"
        else:
            confidence = "LOW"

        # Notlar
        notlar = []
        if not min_total_saglandi:
            notlar.append(f"Yetersiz veri ({toplam_ihale}<{min_total_ihale})")
        if not std_filter_saglandi:
            notlar.append(f"Tutarsız davranış (std=%{global_std:.2f}>%{max_global_std_pct})")

        sonuc[firma_kanon] = SniperKarne(
            firma_adi=firma_display,
            firma_kanon=firma_kanon,
            etiket=etiket,
            toplam_ihale=toplam_ihale,
            is_sniper=is_sniper,
            is_ultra_sniper=is_ultra,
            sniper_idareler=sniper_idareler,
            sniper_olmadigi_idareler=sorted(sniper_olmayan_idareler),
            global_ortalama_yakinlik_pct=round(global_ort, 4),
            global_medyan_yakinlik_pct=round(global_med, 4),
            global_std_pct=round(global_std, 4),
            en_yakin_teklif_pct=round(en_yakin, 4),
            min_total_ihale_saglandi=min_total_saglandi,
            std_filter_saglandi=std_filter_saglandi,
            confidence=confidence,
            notlar="; ".join(notlar),
        )

    log.info(f"{len(sonuc)} firma profili çıkarıldı, {sum(1 for s in sonuc.values() if s.is_sniper)} sniper.")
    return sonuc


# ===========================================
# Kalıcı kayıt
# ===========================================
def kaydet_sniper_profileleri(karneler: dict[str, SniperKarne]) -> int:
    """Sniper karneleri data/sniper_profiles/'a JSON olarak kaydet."""
    SNIPER_PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for kanon, karne in karneler.items():
        if not karne.is_sniper:
            continue  # Sadece sniper'ları kaydet
        safe_name = "".join(c if c.isalnum() else "_" for c in karne.firma_adi)[:80]
        path = SNIPER_PROFILES_DIR / f"{safe_name}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(karne.to_dict(), f, ensure_ascii=False, indent=2, default=str)
        n += 1
    log.info(f"{n} sniper profili kaydedildi: {SNIPER_PROFILES_DIR}")
    return n


# ===========================================
# Birleşik Karne (Deneyim + Sniper)
# ===========================================
@dataclass
class RakipProfili:
    """Detaylı rakip profili (deneyim + sniper birleşik)."""
    firma_adi: str
    firma_kanon: str
    etiket: str

    # Deneyim
    ihale_sayisi: int
    solo_ihale_sayisi: int
    jv_ihale_sayisi: int
    kazandigi_ihale_sayisi: int
    max_teklif_bugun: float
    max_teklif_orijinal: float
    max_teklif_tarih: str | None
    ortalama_teklif_bugun: float
    jv_geçmisi_var: bool
    jv_partner_listesi: list[str]
    jv_bid_limit_bugun: float

    # Tenzilat
    ortalama_tenzilat: float | None
    medyan_tenzilat: float | None
    std_tenzilat: float | None
    min_tenzilat: float | None
    max_tenzilat: float | None

    # İdare
    katildigi_idareler: list[str]
    en_cok_katildigi_idare: str | None
    idare_dagilim: dict[str, int]

    # Sniper
    is_sniper: bool
    is_ultra_sniper: bool
    sniper_idareler: list[dict]
    global_yakinlik_ort_pct: float
    global_yakinlik_std_pct: float
    sniper_confidence: str
    sniper_notlar: str

    def to_dict(self) -> dict:
        return asdict(self)


def hesapla_rakip_profilleri(
    my_firms: list[str] | None = None,
    cfg: Config | None = None,
) -> dict[str, RakipProfili]:
    """Tek seferde deneyim + sniper birleşik profil çıkar."""
    if cfg is None:
        cfg = Config.load()

    from core.config import load_my_firms as _lmf
    my_firms = my_firms or _lmf()

    df = etl.load_data(my_firms, cfg)
    if df.empty:
        return {}

    deneyimler = hesapla_firma_deneyimleri(
        df=df,
        my_firms=my_firms,
        jv_carpan=float(cfg.get("deneyim.jv_carpan", 1.20)),
    )
    sniperler = hesapla_sniper(df=df, my_firms=my_firms, cfg=cfg)

    profilller: dict[str, RakipProfili] = {}
    # Tüm kanon firmaları topla (deneyim + sniper birleşimi)
    tum_kanonlar = set(deneyimler.keys()) | set(sniperler.keys())

    for kanon in tum_kanonlar:
        d = deneyimler.get(kanon)
        s = sniperler.get(kanon)

        if d is None and s is None:
            continue

        firma_adi = d.firma_adi if d else (s.firma_adi if s else kanon)
        etiket = d.etiket if d else (s.etiket if s else "COMPETITOR")

        profilller[kanon] = RakipProfili(
            firma_adi=firma_adi,
            firma_kanon=kanon,
            etiket=etiket,
            # Deneyim
            ihale_sayisi=d.ihale_sayisi if d else 0,
            solo_ihale_sayisi=d.solo_ihale_sayisi if d else 0,
            jv_ihale_sayisi=d.jv_ihale_sayisi if d else 0,
            kazandigi_ihale_sayisi=d.kazandigi_ihale_sayisi if d else 0,
            max_teklif_bugun=d.max_teklif_bugun if d else 0.0,
            max_teklif_orijinal=d.max_teklif_orijinal if d else 0.0,
            max_teklif_tarih=d.max_teklif_tarih if d else None,
            ortalama_teklif_bugun=d.ortalama_teklif_bugun if d else 0.0,
            jv_geçmisi_var=d.jv_geçmisi_var if d else False,
            jv_partner_listesi=d.jv_partner_listesi if d else [],
            jv_bid_limit_bugun=d.jv_bid_limit_bugun if d else 0.0,
            ortalama_tenzilat=d.ortalama_tenzilat if d else None,
            medyan_tenzilat=d.medyan_tenzilat if d else None,
            std_tenzilat=d.std_tenzilat if d else None,
            min_tenzilat=d.min_tenzilat if d else None,
            max_tenzilat=d.max_tenzilat if d else None,
            katildigi_idareler=d.katildigi_idareler if d else [],
            en_cok_katildigi_idare=d.en_cok_katildigi_idare if d else None,
            idare_dagilim=d.idare_dagilim if d else {},
            # Sniper
            is_sniper=s.is_sniper if s else False,
            is_ultra_sniper=s.is_ultra_sniper if s else False,
            sniper_idareler=[i.to_dict() for i in (s.sniper_idareler if s else [])],
            global_yakinlik_ort_pct=s.global_ortalama_yakinlik_pct if s else 0.0,
            global_yakinlik_std_pct=s.global_std_pct if s else 0.0,
            sniper_confidence=s.confidence if s else "—",
            sniper_notlar=s.notlar if s else "",
        )

    return profilller


def profilleri_to_dataframe(profiller: dict[str, RakipProfili]) -> pd.DataFrame:
    """Profilleri pandas DataFrame'e çevir (Excel için)."""
    rows = [p.to_dict() for p in profiller.values()]
    df = pd.DataFrame(rows)
    if df.empty:
        return df

    # JSON kolonlar Excel'de güzel göstermek için stringe çevir
    if "jv_partner_listesi" in df.columns:
        df["jv_partner_listesi"] = df["jv_partner_listesi"].apply(
            lambda x: ", ".join(x) if isinstance(x, list) else ""
        )
    if "katildigi_idareler" in df.columns:
        df["katildigi_idareler"] = df["katildigi_idareler"].apply(
            lambda x: ", ".join(x) if isinstance(x, list) else ""
        )
    if "sniper_idareler" in df.columns:
        df["sniper_idareler"] = df["sniper_idareler"].apply(
            lambda lst: "; ".join(
                f"{x.get('idare_adi', '')} ({x.get('in_band_sayisi', 0)}/{x.get('toplam_ihale', 0)})"
                for x in lst
            ) if isinstance(lst, list) else ""
        )
    if "idare_dagilim" in df.columns:
        df["idare_dagilim"] = df["idare_dagilim"].apply(
            lambda x: ", ".join(f"{k}:{v}" for k, v in x.items()) if isinstance(x, dict) else ""
        )

    df = df.sort_values("max_teklif_bugun", ascending=False).reset_index(drop=True)
    return df


# ===========================================
# Smoke test
# ===========================================
if __name__ == "__main__":
    print("=== Sniper Detection Smoke Test ===\n")
    sniperler = hesapla_sniper()
    if not sniperler:
        print("⚠ Veri yok.")
        exit(1)

    sniper_only = {k: v for k, v in sniperler.items() if v.is_sniper}
    print(f"Toplam analiz edilen firma: {len(sniperler)}")
    print(f"Sniper sayısı:               {len(sniper_only)}")
    print(f"Ultra sniper:                {sum(1 for v in sniper_only.values() if v.is_ultra_sniper)}")
    print()

    print("--- Top 10 Sniper ---")
    sirali = sorted(
        sniper_only.values(),
        key=lambda s: (-len(s.sniper_idareler), s.global_ortalama_yakinlik_pct)
    )
    for i, s in enumerate(sirali[:10], 1):
        bayrak = "🚨" if s.is_ultra_sniper else "⚠"
        print(f" {i:2} {bayrak} {s.firma_adi[:50]:<50} "
              f"İdare sayısı: {len(s.sniper_idareler):>2}  "
              f"Toplam ihale: {s.toplam_ihale:>3}  "
              f"Ort. yakınlık: %{s.global_ortalama_yakinlik_pct:.2f}")
