"""
İş Deneyim Belgesi Hesabı (Tahmini).

Mantık:
    Bir firmanın geçmişte attığı tüm tekliflerin Yi-ÜFE ile bugüne
    getirilmiş hâllerinin MAKSİMUMU = tahmini iş deneyim belgesi.

    Joint Venture'da (Ortak Girişim):
        - Solo kayıt: tüm değer firmaya yazılır
        - JV kayıt: değer ortaklar arasında paylaşılır (varsayılan: eşit)

    JV bid limiti (firmanın yapabileceği teklif):
        - Solo: deneyim_belgesi
        - JV ile: max(deneyim_A, deneyim_B) × 1.20

Çıktı:
    data/profiles/<firma>.json    — her firma için karne
    veya tek tablo (DataFrame)
"""
from __future__ import annotations
import logging
import json
from dataclasses import dataclass, asdict, field
from pathlib import Path
import pandas as pd
import numpy as np

from core.config import DATA_DIR
from core import db, etl
from core.joint_venture import parse_firma_adi
from core.firma_normalize import kanonik_firma_adi
from .yi_ufe import yi_ufe_dict, bugune_getir

log = logging.getLogger(__name__)

PROFILES_DIR = DATA_DIR / "profiles"


@dataclass
class FirmaDeneyim:
    """Bir firmanın deneyim özeti."""
    firma_adi: str
    ihale_sayisi: int                       # Toplam katıldığı ihale (solo + JV)
    solo_ihale_sayisi: int                  # Sadece solo
    jv_ihale_sayisi: int                    # JV olarak katıldığı
    kazandigi_ihale_sayisi: int

    # Bugünkü değerlerle (Yi-ÜFE düzeltmeli)
    max_teklif_bugun: float                 # En büyük teklif (bugünkü TL) — DENEYİM BELGESİ
    max_teklif_orijinal: float              # En büyük teklif (ihale tarihindeki TL)
    max_teklif_tarih: str | None            # En büyük teklifin ihale tarihi
    max_teklif_ihale_id: str | None
    ortalama_teklif_bugun: float

    # JV potansiyeli
    jv_geçmisi_var: bool                     # En az 1 kez JV yapmış
    jv_partner_listesi: list[str] = field(default_factory=list)
    jv_bid_limit_bugun: float = 0.0         # max(deneyim) × 1.20

    # Tenzilat istatistiği (sadece "gecerli" tekliflerde)
    ortalama_tenzilat: float | None = None
    medyan_tenzilat: float | None = None
    std_tenzilat: float | None = None
    min_tenzilat: float | None = None
    max_tenzilat: float | None = None

    # İdare istatistiği
    katildigi_idareler: list[str] = field(default_factory=list)
    en_cok_katildigi_idare: str | None = None
    idare_dagilim: dict[str, int] = field(default_factory=dict)

    # Etiket
    etiket: str = "COMPETITOR"               # SELF veya COMPETITOR

    def to_dict(self) -> dict:
        return asdict(self)


# ===========================================
# Ana hesaplayıcı
# ===========================================
def hesapla_firma_deneyimleri(
    df: pd.DataFrame | None = None,
    my_firms: list[str] | None = None,
    jv_carpan: float = 1.20,
    tenzilat_min_pct: float | None = None,
    tenzilat_max_pct: float | None = None,
) -> dict[str, FirmaDeneyim]:
    """Tüm firmalar için deneyim özeti çıkar.

    Args:
        df: ETL'den geçirilmiş birleşik veri seti (etl.load_data() çıktısı).
            None ise otomatik yüklenir.
        my_firms: SELF etiketleme için firma listesi.
        jv_carpan: JV %20 kuralı için.
        tenzilat_min_pct / tenzilat_max_pct: Anomali filtre — bu aralık dışındaki
            tenzilatlar (örn -%14000) deneyim ve istatistik hesabından hariç.

    Returns:
        {kanonik_firma_adi: FirmaDeneyim} sözlüğü — aynı firmanın farklı
        yazılışları otomatik birleşir.
    """
    from core.config import Config, load_my_firms

    cfg = Config.load()
    if df is None:
        my_firms = my_firms or load_my_firms()
        df = etl.load_data(my_firms, cfg)

    if df.empty:
        log.warning("Veri seti boş, deneyim hesaplanamaz.")
        return {}

    # Tenzilat filtre eşikleri (config'ten gelir, parametre ile override edilebilir)
    if tenzilat_min_pct is None:
        tenzilat_min_pct = cfg.get("deneyim.tenzilat_min_pct", -50.0)
    if tenzilat_max_pct is None:
        tenzilat_max_pct = cfg.get("deneyim.tenzilat_max_pct", 60.0)

    # MY_FIRMS yoksa al (etiket ataması için her firmaya tek tek kontrol gerek)
    if my_firms is None:
        my_firms = load_my_firms()
    my_firms_kanon = [kanonik_firma_adi(f) for f in my_firms if f]

    # Yi-ÜFE'yi bir kez yükle (performans için)
    yi_map = yi_ufe_dict()

    # Bugünkü değer kolonu hesapla
    df = df.copy()

    def _bugun_teklif(row):
        return bugune_getir(row.get("teklif_tutari"), row.get("ihale_tarihi"), yi_map)

    df["teklif_bugun"] = df.apply(_bugun_teklif, axis=1)

    # Anomali tespiti: tenzilat aralık dışındaki teklifleri işaretle
    def _anomali(row):
        t = row.get("tenzilat_calc")
        if t is None:
            return False
        return t < tenzilat_min_pct or t > tenzilat_max_pct
    df["anomali"] = df.apply(_anomali, axis=1)

    n_anomali = int(df["anomali"].sum())
    if n_anomali > 0:
        log.info(
            f"⚠ {n_anomali} anomali teklif filtreden hariç tutulacak "
            f"(tenzilat dışı: <{tenzilat_min_pct}% veya >{tenzilat_max_pct}%)"
        )

    # Her firma için kayıt oluştur (kanonik formla)
    # JV satırlarında her ortak firma için ayrı bir kayıt üretilir
    expanded_rows = []
    for _, row in df.iterrows():
        firmalar = row.get("firmalar") or []
        firmalar_kanon = row.get("firmalar_kanon") or []
        if not firmalar:
            continue

        is_jv = bool(row.get("is_jv"))
        n_ortak = len(firmalar)
        pay_orani = 1.0 / n_ortak if is_jv else 1.0

        # Anomali tekliflerin DENEYİM hesabına dahil olmaması için
        anomali = bool(row.get("anomali"))

        for idx, firma in enumerate(firmalar):
            firma_kanon = firmalar_kanon[idx] if idx < len(firmalar_kanon) else kanonik_firma_adi(firma)
            if not firma_kanon:
                continue
            diger_ortak_kanon = [
                firmalar_kanon[j] if j < len(firmalar_kanon) else kanonik_firma_adi(f)
                for j, f in enumerate(firmalar) if f != firma
            ]
            # ETİKET — HER FİRMA İÇİN AYRI KONTROL
            # JV içinde bizim firmamız varsa, sadece o SELF olur, ortakları COMPETITOR
            firma_etiket = "COMPETITOR"
            for my_kanon in my_firms_kanon:
                if not my_kanon:
                    continue
                if my_kanon in firma_kanon or firma_kanon in my_kanon:
                    firma_etiket = "SELF"
                    break

            expanded_rows.append({
                "firma_adi": firma,            # Görsel için orijinal yazım
                "firma_kanon": firma_kanon,    # ⭐ Gruplamada kullanılır
                "ihale_id": row.get("ihale_id"),
                "ihale_tarihi": row.get("ihale_tarihi"),
                "idare_adi": row.get("idare_adi"),
                "is_jv": is_jv,
                "ortak_sayisi": n_ortak,
                "diger_ortaklar": [f for f in firmalar if f != firma],
                "diger_ortaklar_kanon": diger_ortak_kanon,
                "teklif_orijinal": row.get("teklif_tutari"),
                "teklif_pay_orijinal": (row.get("teklif_tutari") or 0) * pay_orani,
                "teklif_bugun": (row.get("teklif_bugun") or 0) * pay_orani if not anomali else 0,
                "teklif_bugun_anomali_dahil": (row.get("teklif_bugun") or 0) * pay_orani,
                "teklif_tam_bugun": row.get("teklif_bugun"),
                "teklif_tam_orijinal": row.get("teklif_tutari"),
                "tenzilat": row.get("tenzilat_calc") if not anomali else None,
                "anomali": anomali,
                "durum": row.get("durum"),
                "muhtemel_kazanan": row.get("muhtemel_kazanan"),
                "etiket": firma_etiket,        # ⭐ Firma bazlı etiket, satır bazlı değil
            })

    if not expanded_rows:
        return {}

    edf = pd.DataFrame(expanded_rows)

    # Her firma için karne çıkar — KANONİK ad ile gruplama (aynı firma farklı yazılışları birleşir)
    sonuc: dict[str, FirmaDeneyim] = {}

    for firma_kanon, grup in edf.groupby("firma_kanon"):
        if not firma_kanon:
            continue

        # Görsel için en sık kullanılan orijinal yazımı seç (en uzun varyant — daha bilgilendirici)
        adi_varyantlari = grup["firma_adi"].value_counts().index.tolist()
        firma_display = max(adi_varyantlari, key=len) if adi_varyantlari else firma_kanon

        ihale_sayisi = grup["ihale_id"].nunique()
        solo_grup = grup[~grup["is_jv"]]
        jv_grup = grup[grup["is_jv"]]

        # En yüksek teklif (deneyim belgesi) — anomalileri ATLA
        # teklif_bugun anomali ise zaten 0
        gecerli_grup = grup[~grup["anomali"]]
        if not gecerli_grup.empty and gecerli_grup["teklif_bugun"].max() > 0:
            max_idx = gecerli_grup["teklif_bugun"].idxmax()
            max_row = gecerli_grup.loc[max_idx]
        else:
            max_row = None

        max_teklif_bugun = float(max_row["teklif_bugun"]) if max_row is not None else 0.0
        max_teklif_orijinal = float(max_row["teklif_pay_orijinal"]) if max_row is not None else 0.0
        max_teklif_tarih = str(max_row["ihale_tarihi"]) if max_row is not None and pd.notna(max_row["ihale_tarihi"]) else None
        max_teklif_ihale_id = str(max_row["ihale_id"]) if max_row is not None else None

        # Ortalama: anomali olmayan tekliflerin ortalaması
        if not gecerli_grup.empty:
            ortalama_teklif_bugun = float(gecerli_grup["teklif_bugun"].mean())
        else:
            ortalama_teklif_bugun = 0.0

        # Kazanan ihaleler — kanonik karşılaştırma
        kazandigi = grup[grup.apply(
            lambda r: r["muhtemel_kazanan"] and (
                firma_kanon in kanonik_firma_adi(str(r["muhtemel_kazanan"]))
            ),
            axis=1
        )]["ihale_id"].nunique()

        # JV partner listesi (kanonik form — aynı partner tek satır)
        partner_set: set[str] = set()
        for _, r in jv_grup.iterrows():
            for p in (r["diger_ortaklar_kanon"] or []):
                if p:
                    partner_set.add(p)

        # JV bid limit
        jv_geçmisi = len(jv_grup) > 0
        jv_bid_limit = max_teklif_bugun * jv_carpan if jv_geçmisi else 0.0

        # Tenzilat istatistiği — anomali olmayan + gecerli
        gecerli_tenz = grup[
            (grup["durum"] == "gecerli") &
            (~grup["anomali"]) &
            grup["tenzilat"].notna()
        ]["tenzilat"]
        tenz_ort = float(gecerli_tenz.mean()) if len(gecerli_tenz) else None
        tenz_med = float(gecerli_tenz.median()) if len(gecerli_tenz) else None
        tenz_std = float(gecerli_tenz.std()) if len(gecerli_tenz) > 1 else None
        tenz_min = float(gecerli_tenz.min()) if len(gecerli_tenz) else None
        tenz_max = float(gecerli_tenz.max()) if len(gecerli_tenz) else None

        # İdare dağılımı
        idare_counts = grup["idare_adi"].value_counts().to_dict()
        idare_counts = {str(k): int(v) for k, v in idare_counts.items() if pd.notna(k)}
        en_cok_idare = max(idare_counts.items(), key=lambda x: x[1])[0] if idare_counts else None

        # Etiket (SELF/COMPETITOR) — herhangi bir kayıt SELF ise grup SELF
        etiket = "SELF" if (grup["etiket"] == "SELF").any() else "COMPETITOR"

        sonuc[firma_kanon] = FirmaDeneyim(
            firma_adi=firma_display,
            ihale_sayisi=int(ihale_sayisi),
            solo_ihale_sayisi=int(solo_grup["ihale_id"].nunique()),
            jv_ihale_sayisi=int(jv_grup["ihale_id"].nunique()),
            kazandigi_ihale_sayisi=int(kazandigi),
            max_teklif_bugun=round(max_teklif_bugun, 2),
            max_teklif_orijinal=round(max_teklif_orijinal, 2),
            max_teklif_tarih=max_teklif_tarih,
            max_teklif_ihale_id=max_teklif_ihale_id,
            ortalama_teklif_bugun=round(ortalama_teklif_bugun, 2),
            jv_geçmisi_var=jv_geçmisi,
            jv_partner_listesi=sorted(partner_set),
            jv_bid_limit_bugun=round(jv_bid_limit, 2),
            ortalama_tenzilat=round(tenz_ort, 2) if tenz_ort is not None else None,
            medyan_tenzilat=round(tenz_med, 2) if tenz_med is not None else None,
            std_tenzilat=round(tenz_std, 2) if tenz_std is not None else None,
            min_tenzilat=round(tenz_min, 2) if tenz_min is not None else None,
            max_tenzilat=round(tenz_max, 2) if tenz_max is not None else None,
            katildigi_idareler=sorted(idare_counts.keys()),
            en_cok_katildigi_idare=en_cok_idare,
            idare_dagilim=idare_counts,
            etiket=etiket,
        )

    return sonuc


# ===========================================
# Belirli bir firmanın bid yetkisi
# ===========================================
def bid_yetkisi(
    firma_deneyim: FirmaDeneyim,
    teklif_tutari_bugun: float,
    jv_partner_deneyimleri: list[FirmaDeneyim] | None = None,
    jv_carpan: float = 1.20,
) -> tuple[bool, str, dict]:
    """Bir firmanın (veya JV'nin) belirtilen teklifi atıp atamayacağı.

    Args:
        firma_deneyim: Ana firma karnesi.
        teklif_tutari_bugun: Bugünün TL'si ile teklif tutarı.
        jv_partner_deneyimleri: JV ortakları (varsa).
        jv_carpan: %20 kuralı.

    Returns:
        (yetebilir, açıklama, detay)
    """
    detay = {"teklif": teklif_tutari_bugun}

    # Solo
    if not jv_partner_deneyimleri:
        if teklif_tutari_bugun <= firma_deneyim.max_teklif_bugun:
            return True, f"Solo yeter ({firma_deneyim.max_teklif_bugun:,.0f} TL)", detay
        if firma_deneyim.jv_geçmisi_var:
            limit = firma_deneyim.jv_bid_limit_bugun
            return (
                False,
                f"Solo yetersiz (max {firma_deneyim.max_teklif_bugun:,.0f}). "
                f"Ama JV ile {limit:,.0f} TL'ye kadar çıkabilir.",
                detay
            )
        return False, f"Yetersiz ({firma_deneyim.max_teklif_bugun:,.0f} TL)", detay

    # JV
    deneyimler = [firma_deneyim.max_teklif_bugun]
    deneyimler.extend(p.max_teklif_bugun for p in jv_partner_deneyimleri)
    en_buyuk = max(deneyimler)
    limit = en_buyuk * jv_carpan
    detay["en_buyuk_deneyim"] = en_buyuk
    detay["jv_limit"] = limit

    if teklif_tutari_bugun <= limit:
        return True, f"JV yeter (max {en_buyuk:,.0f} × {jv_carpan} = {limit:,.0f} TL)", detay
    return False, f"JV bile yetersiz ({limit:,.0f} TL)", detay


# ===========================================
# Kalıcı kaydetme (firma karneleri)
# ===========================================
def kaydet_profile(deneyim: FirmaDeneyim) -> Path:
    """Tek firma karnesi → JSON dosya."""
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)

    # Dosya adı: firma adının güvenli versiyonu
    safe_name = "".join(c if c.isalnum() else "_" for c in deneyim.firma_adi)[:80]
    path = PROFILES_DIR / f"{safe_name}.json"

    with open(path, "w", encoding="utf-8") as f:
        json.dump(deneyim.to_dict(), f, ensure_ascii=False, indent=2, default=str)
    return path


def kaydet_tum_profileleri(deneyimler: dict[str, FirmaDeneyim]) -> int:
    """Tüm firma karnelerini topluca kaydet."""
    PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for firma, d in deneyimler.items():
        kaydet_profile(d)
        n += 1
    log.info(f"{n} firma karnesi kaydedildi: {PROFILES_DIR}")
    return n


def yukle_profile(firma_adi: str) -> FirmaDeneyim | None:
    """Bir firmanın kaydedilmiş karnesini yükle."""
    safe_name = "".join(c if c.isalnum() else "_" for c in firma_adi)[:80]
    path = PROFILES_DIR / f"{safe_name}.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return FirmaDeneyim(**data)


# ===========================================
# DataFrame raporu (tabloya çevirme)
# ===========================================
def deneyimleri_to_dataframe(deneyimler: dict[str, FirmaDeneyim]) -> pd.DataFrame:
    """{firma: FirmaDeneyim} → pandas DataFrame."""
    rows = [d.to_dict() for d in deneyimler.values()]
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    # Sıralama: deneyim büyüklüğüne göre
    df = df.sort_values("max_teklif_bugun", ascending=False).reset_index(drop=True)
    return df


# ===========================================
# Smoke test
# ===========================================
if __name__ == "__main__":
    print("=== Firma Deneyim Hesabı ===\n")
    deneyimler = hesapla_firma_deneyimleri()
    if not deneyimler:
        print("⚠ Veri yok.")
        exit(1)

    df = deneyimleri_to_dataframe(deneyimler)
    print(f"Toplam firma: {len(df)}")
    print()

    # En büyük 10 firma
    print("--- En Büyük 10 Firma (Tahmini İş Deneyim Belgesi) ---")
    top10 = df.head(10)[[
        "firma_adi", "ihale_sayisi", "max_teklif_bugun",
        "ortalama_tenzilat", "etiket"
    ]]
    for _, r in top10.iterrows():
        tenz = f"%{r['ortalama_tenzilat']:.1f}" if pd.notna(r['ortalama_tenzilat']) else "—"
        print(f"  {r['firma_adi'][:40]:<40} "
              f"İhale: {r['ihale_sayisi']:>3}  "
              f"Deneyim: {r['max_teklif_bugun']:>15,.0f} TL  "
              f"Ort.Tenz: {tenz:>6}  [{r['etiket']}]")

    # Kaydet
    kaydet_tum_profileleri(deneyimler)
    print(f"\nProfiller kaydedildi: {PROFILES_DIR}")
