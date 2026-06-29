"""
Kartel Detection — 5-sinyalli skorlama + network kümeleme.

Sinyaller (toplam 100 puan):
    1. LIFT (gözlenen co-occurrence / beklenen)         25 puan
    2. TENZİLAT YAKINLIĞI (%0.15 fark eşiği)            35 puan ⭐ en güçlü
    3. TEKLİF ORANI SABİTLİĞİ (CV < %2)                 15 puan
    4. KAZANMA ROTASYONU                                10 puan
    5. İDARE YOĞUNLUĞU                                  15 puan

Toplulaştırmacı filtre:
    - %70+ ihaleye giren firmalar "toplulaştırmacı" — özel kural
    - Bu firmalar arasındaki kartel için TENZİLAT zorunlu

Network analizi (Sprint sonu):
    - Yüksek skorlu çiftler → graf
    - Connected components → otomatik kartel grupları
"""
from __future__ import annotations
import logging
import json
from dataclasses import dataclass, field, asdict
from itertools import combinations
import pandas as pd
import numpy as np

from core.config import DATA_DIR, Config
from core import db, etl
from core.firma_normalize import kanonik_firma_adi

log = logging.getLogger(__name__)


# ===========================================
# Veri sınıfları
# ===========================================
@dataclass
class CiftBilgisi:
    """İki firma arasındaki ilişkinin tüm sinyalleri."""
    firma_a_kanon: str
    firma_b_kanon: str
    firma_a_ad: str
    firma_b_ad: str

    # Genel istatistikler
    a_toplam_ihale: int             # A'nın toplam ihale sayısı
    b_toplam_ihale: int
    ortak_ihale: int                # İkisinin birlikte olduğu
    a_yalniz_ihale: int             # A var, B yok
    b_yalniz_ihale: int             # B var, A yok

    # SİNYAL 1: LIFT
    lift: float                     # P(A∩B) / (P(A)·P(B))
    lift_skoru: float               # 0-25

    # SİNYAL 2: TENZİLAT YAKINLIĞI ⭐
    tenzilat_farklari: list[float]  # Her ortak ihale için |Tenz_A - Tenz_B|
    tenzilat_ort_fark: float
    tenzilat_medyan_fark: float
    tenzilat_esik_alti_orani: float  # %0.15 altı orani
    tenzilat_skoru: float           # 0-35

    # SİNYAL 3: TEKLİF ORANI SABİTLİĞİ
    teklif_oranlari: list[float]    # Her ortak ihale için T_A/T_B
    teklif_orani_cv: float          # Coefficient of variation (std/mean)
    teklif_skoru: float             # 0-15

    # SİNYAL 4: KAZANMA ROTASYONU
    a_kazanma: int                  # ortak ihalelerde A kazanma
    b_kazanma: int                  # ortak ihalelerde B kazanma
    diger_kazanma: int              # 3. firma kazanmış
    rotasyon_paterni: str           # "sira", "destek", "rastgele"
    rotasyon_skoru: float           # 0-10

    # SİNYAL 5: İDARE YOĞUNLUĞU
    ortak_ihale_idare_dagilim: dict[str, int]
    en_yogun_idare_orani: float
    idare_skoru: float              # 0-15

    # TOPLAM SKOR
    toplam_skor: float              # 0-100
    kategori: str                   # "Bağımsız", "Zayıf Bağ", "Orta", "Kartel Şüphesi"

    # Tor ekstra: toplulaştırmacı flag'i
    a_toplulastirmaci: bool
    b_toplulastirmaci: bool

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class KartelGrubu:
    """Network analizinden çıkan otomatik kümelenmiş grup."""
    grup_id: int
    firmalar: list[str]              # Kanonik adlar
    firma_adlari: list[str]          # Görüntülenebilir adlar
    ortalama_skor: float
    cift_sayisi: int                 # Grup içi yüksek skorlu çift sayısı
    paylaşilan_idareler: list[str]   # Hepsinin birlikte olduğu idareler

    def to_dict(self) -> dict:
        return asdict(self)


# ===========================================
# Yardımcı: ihaleye katılım haritası
# ===========================================
def _build_katılım_map(df: pd.DataFrame) -> dict[str, set[str]]:
    """{ihale_id: {firma_kanon, ...}} — her ihaledeki firma seti."""
    katılım: dict[str, set[str]] = {}
    for _, row in df.iterrows():
        ihale_id = row.get("ihale_id")
        if not ihale_id:
            continue
        firmalar_kanon = row.get("firmalar_kanon") or []
        if not firmalar_kanon:
            continue
        if ihale_id not in katılım:
            katılım[ihale_id] = set()
        for fk in firmalar_kanon:
            if fk:
                katılım[ihale_id].add(fk)
    return katılım


def _build_firma_ihaleleri(katılım: dict[str, set[str]]) -> dict[str, set[str]]:
    """{firma_kanon: {ihale_id, ...}} — her firmanın katıldığı ihaleler."""
    firma_ihale: dict[str, set[str]] = {}
    for ihale_id, firmalar in katılım.items():
        for fk in firmalar:
            if fk not in firma_ihale:
                firma_ihale[fk] = set()
            firma_ihale[fk].add(ihale_id)
    return firma_ihale


# ===========================================
# Sinyal hesaplayıcılar
# ===========================================
def _lift_skoru(ortak: int, a_toplam: int, b_toplam: int, total_ihale: int, cfg: Config) -> tuple[float, float]:
    """LIFT = P(A∩B) / (P(A)·P(B)). Skor 0-25 puan.

    Negatif lift (< 0.5): pazar bölüşümü = kartel olabilir → 25 puan
    Lift > 5: çok güçlü → 25 puan
    Lift 2-5: güçlü → 20
    Lift 1.5-2: zayıf → 10
    Lift < 1.2: önemsiz → 0
    """
    if total_ihale <= 0 or a_toplam <= 0 or b_toplam <= 0:
        return 1.0, 0.0
    p_a = a_toplam / total_ihale
    p_b = b_toplam / total_ihale
    p_ab = ortak / total_ihale
    expected = p_a * p_b
    if expected <= 0:
        return 1.0, 0.0
    lift = p_ab / expected

    cok_guclu = float(cfg.get("kartel.lift.cok_guclu", 5.0))
    guclu = float(cfg.get("kartel.lift.guclu", 2.0))
    zayif = float(cfg.get("kartel.lift.zayif", 1.5))
    cok_zayif = float(cfg.get("kartel.lift.cok_zayif", 1.2))
    pazar_bolusum = float(cfg.get("kartel.lift.negatif_pazar_bolusumu", 0.5))

    skor = 0.0
    if lift >= cok_guclu:
        skor = 25.0
    elif lift >= guclu:
        skor = 20.0
    elif lift >= zayif:
        skor = 10.0
    elif lift >= cok_zayif:
        skor = 5.0
    elif lift < pazar_bolusum:
        # Pazar bölüşümü — kartel sinyali
        skor = 22.0
    return float(round(lift, 4)), float(skor)


def _tenzilat_skoru(farklar: list[float], cfg: Config) -> tuple[float, float, float, float]:
    """Tenzilat yakınlık skoru — KARTEL'in en güçlü sinyali.

    Returns: (ort_fark, medyan_fark, esik_alti_orani, skor 0-35)
    """
    if not farklar:
        return 0.0, 0.0, 0.0, 0.0
    arr = np.array(farklar)
    ort = float(arr.mean())
    medyan = float(np.median(arr))
    esik = float(cfg.get("kartel.tenzilat.fark_esigi_pct", 0.15))
    esik_alti = float((arr < esik).sum())
    esik_alti_orani = esik_alti / len(arr)

    guclu = float(cfg.get("kartel.tenzilat.guclu_oran", 0.80))
    orta = float(cfg.get("kartel.tenzilat.orta_oran", 0.50))
    zayif = float(cfg.get("kartel.tenzilat.zayif_oran", 0.30))

    metrik_secim = cfg.get("kartel.tenzilat.metrik", "esik_alti_orani")

    # Karar metriği
    if metrik_secim == "mean":
        oran_proxy = max(0.0, 1.0 - (ort / max(esik * 2, 1e-6)))
    elif metrik_secim == "median":
        oran_proxy = max(0.0, 1.0 - (medyan / max(esik * 2, 1e-6)))
    else:
        oran_proxy = esik_alti_orani

    if oran_proxy >= guclu:
        skor = 35.0
    elif oran_proxy >= orta:
        skor = 25.0
    elif oran_proxy >= zayif:
        skor = 12.0
    else:
        skor = 0.0

    return round(ort, 4), round(medyan, 4), round(esik_alti_orani, 4), float(skor)


def _teklif_orani_skoru(oranlar: list[float], cfg: Config) -> tuple[float, float]:
    """Teklif oranı sabitliği — CV (std/mean) çok düşükse koordinasyon."""
    if not oranlar or len(oranlar) < 2:
        return 0.0, 0.0
    arr = np.array(oranlar)
    arr = arr[arr > 0]
    if len(arr) < 2:
        return 0.0, 0.0
    mean = float(arr.mean())
    if mean <= 0:
        return 0.0, 0.0
    std = float(arr.std(ddof=1))
    cv = std / mean
    cv_esik = float(cfg.get("kartel.teklif_orani.cv_esigi", 0.02))
    min_ihale = int(cfg.get("kartel.teklif_orani.min_ihale", 3))

    if len(arr) < min_ihale:
        return round(cv, 4), 0.0

    if cv <= cv_esik:
        skor = 15.0
    elif cv <= cv_esik * 2:
        skor = 8.0
    else:
        skor = 0.0
    return round(cv, 4), float(skor)


def _rotasyon_skoru(a_kazanma: int, b_kazanma: int, diger_kazanma: int, ortak: int, cfg: Config) -> tuple[str, float]:
    """Kazanma rotasyonu — sıraya alma veya destek teklifi paterni."""
    if ortak < 3:
        return "rastgele", 0.0
    a_oran = a_kazanma / ortak if ortak > 0 else 0.0
    b_oran = b_kazanma / ortak if ortak > 0 else 0.0

    sira_min = float(cfg.get("kartel.rotasyon.sira_alma_min", 0.40))
    sira_max = float(cfg.get("kartel.rotasyon.sira_alma_max", 0.60))
    destek_esik = float(cfg.get("kartel.rotasyon.destek_teklifi_esigi", 0.85))

    if (a_oran + b_oran) >= 0.85:  # En az %85 birlikte alıyorlar
        if max(a_oran, b_oran) >= destek_esik:
            return "destek", 10.0  # Biri hep kazanıyor, diğeri "destek"
        if sira_min <= a_oran <= sira_max:
            return "sira", 8.0  # Sırayla alıyorlar
    return "rastgele", 0.0


def _idare_skoru(idare_dagilim: dict[str, int], ortak: int, cfg: Config) -> tuple[float, float]:
    """İdare yoğunluğu — aynı idarede yoğunlaşma kartel sinyali."""
    if not idare_dagilim or ortak <= 0:
        return 0.0, 0.0
    en_yogun = max(idare_dagilim.values())
    oran = en_yogun / ortak
    yuksek = float(cfg.get("kartel.idare.yuksek", 0.80))
    orta = float(cfg.get("kartel.idare.orta", 0.60))

    if oran >= yuksek:
        skor = 15.0
    elif oran >= orta:
        skor = 8.0
    else:
        skor = 0.0
    return round(oran, 4), float(skor)


# ===========================================
# Çift bilgisi hesaplama
# ===========================================
def _cift_hesapla(
    a: str, b: str,
    df: pd.DataFrame,
    katılım: dict[str, set[str]],
    firma_ihale: dict[str, set[str]],
    total_ihale: int,
    cfg: Config,
    toplulastirmaci_set: set[str],
) -> CiftBilgisi | None:
    """Bir firma çifti (A, B) için tüm sinyaller + skor."""
    # Self-match koruması — aynı kanonik gelirse hiç bakma
    if a == b or not a or not b:
        return None

    a_ihaleler = firma_ihale.get(a, set())
    b_ihaleler = firma_ihale.get(b, set())
    ortak_ihaleler = a_ihaleler & b_ihaleler

    min_ortak = int(cfg.get("kartel.min_ortak_ihale", 5))
    if len(ortak_ihaleler) < min_ortak:
        return None

    a_top = len(a_ihaleler)
    b_top = len(b_ihaleler)
    ortak = len(ortak_ihaleler)

    # Her ortak ihale için sinyal verisi topla
    tenz_farklari: list[float] = []
    teklif_oranlari: list[float] = []
    a_kazanma = 0
    b_kazanma = 0
    diger_kazanma = 0
    idare_dagilim: dict[str, int] = {}

    df_ortak = df[df["ihale_id"].isin(ortak_ihaleler)].copy()
    a_ad: str = a
    b_ad: str = b

    # Her ihalede A ve B'nin tekliflerini bul (kanonik index ile orijinal adı eşleştir)
    grup = df_ortak.groupby("ihale_id")
    for ihale_id, ihale_df in grup:
        a_row = None
        b_row = None
        for _, r in ihale_df.iterrows():
            firmalar = r.get("firmalar") or []
            firmalar_kanon = r.get("firmalar_kanon") or []
            if a_row is None and a in firmalar_kanon:
                a_row = r
                # Kanonik içindeki index'ten ORIJINAL adı al
                try:
                    idx = firmalar_kanon.index(a)
                    if idx < len(firmalar):
                        a_ad = firmalar[idx]
                except ValueError:
                    pass
            if b_row is None and b in firmalar_kanon:
                b_row = r
                try:
                    idx = firmalar_kanon.index(b)
                    if idx < len(firmalar):
                        b_ad = firmalar[idx]
                except ValueError:
                    pass

        if a_row is None or b_row is None:
            continue

        ta = a_row.get("teklif_tutari")
        tb = b_row.get("teklif_tutari")
        tenza = a_row.get("tenzilat_calc")
        tenzb = b_row.get("tenzilat_calc")

        # Tenzilat farkı (anomali kontrolü içermez — tenzilat zaten -%50/+%60 dışı NaN)
        if tenza is not None and tenzb is not None and not pd.isna(tenza) and not pd.isna(tenzb):
            tenz_farklari.append(abs(float(tenza) - float(tenzb)))

        # Teklif oranı
        if ta and tb and ta > 0 and tb > 0:
            teklif_oranlari.append(float(ta) / float(tb))

        # Kazanma
        mk = a_row.get("muhtemel_kazanan") or b_row.get("muhtemel_kazanan")
        if mk:
            mk_kanon = kanonik_firma_adi(str(mk))
            if a in mk_kanon:
                a_kazanma += 1
            elif b in mk_kanon:
                b_kazanma += 1
            else:
                diger_kazanma += 1

        # İdare
        idare = a_row.get("idare_adi")
        if idare and not pd.isna(idare):
            idare_dagilim[str(idare)] = idare_dagilim.get(str(idare), 0) + 1

    # Sinyaller
    lift, lift_sk = _lift_skoru(ortak, a_top, b_top, total_ihale, cfg)
    tenz_ort, tenz_med, tenz_esik_oran, tenz_sk = _tenzilat_skoru(tenz_farklari, cfg)
    teklif_cv, teklif_sk = _teklif_orani_skoru(teklif_oranlari, cfg)
    rotasyon_pat, rotasyon_sk = _rotasyon_skoru(a_kazanma, b_kazanma, diger_kazanma, ortak, cfg)
    idare_oran, idare_sk = _idare_skoru(idare_dagilim, ortak, cfg)

    # Toplulaştırmacılar arası kartel için tenzilat zorla
    a_top_lac = a in toplulastirmaci_set
    b_top_lac = b in toplulastirmaci_set
    if a_top_lac and b_top_lac:
        tenzilat_zorla = bool(cfg.get("toplulaştırmacı.toplulastirmaci_arasi_tenzilat_zorla", True))
        min_lift = float(cfg.get("toplulaştırmacı.toplulastirmaci_arasi_lift_min", 3.0))
        if lift < min_lift and tenzilat_zorla and tenz_sk < 25.0:
            # Toplulaştırmacılar arası — yetersiz sinyal, skor düşür
            lift_sk = lift_sk * 0.3
            idare_sk = idare_sk * 0.3

    toplam = lift_sk + tenz_sk + teklif_sk + rotasyon_sk + idare_sk

    # Kategori
    kategori_esikleri = cfg.get("kartel.kategori_esikleri", {}) or {}
    bagimsiz = kategori_esikleri.get("bagimsiz", [0, 30])
    zayif = kategori_esikleri.get("zayif_bag", [30, 50])
    orta = kategori_esikleri.get("orta_bag", [50, 75])
    if toplam >= orta[1] if isinstance(orta, list) and len(orta) >= 2 else False:
        kategori = "Kartel Şüphesi"
    elif toplam >= orta[0] if isinstance(orta, list) and len(orta) >= 2 else False:
        kategori = "Orta Bağ"
    elif toplam >= zayif[0] if isinstance(zayif, list) and len(zayif) >= 2 else False:
        kategori = "Zayıf Bağ"
    else:
        kategori = "Bağımsız"

    return CiftBilgisi(
        firma_a_kanon=a, firma_b_kanon=b,
        firma_a_ad=a_ad, firma_b_ad=b_ad,
        a_toplam_ihale=a_top, b_toplam_ihale=b_top,
        ortak_ihale=ortak,
        a_yalniz_ihale=a_top - ortak,
        b_yalniz_ihale=b_top - ortak,
        lift=lift, lift_skoru=lift_sk,
        tenzilat_farklari=tenz_farklari[:50],  # ilk 50 örnek
        tenzilat_ort_fark=tenz_ort,
        tenzilat_medyan_fark=tenz_med,
        tenzilat_esik_alti_orani=tenz_esik_oran,
        tenzilat_skoru=tenz_sk,
        teklif_oranlari=teklif_oranlari[:50],
        teklif_orani_cv=teklif_cv,
        teklif_skoru=teklif_sk,
        a_kazanma=a_kazanma, b_kazanma=b_kazanma,
        diger_kazanma=diger_kazanma,
        rotasyon_paterni=rotasyon_pat,
        rotasyon_skoru=rotasyon_sk,
        ortak_ihale_idare_dagilim=idare_dagilim,
        en_yogun_idare_orani=idare_oran,
        idare_skoru=idare_sk,
        toplam_skor=round(toplam, 2),
        kategori=kategori,
        a_toplulastirmaci=a_top_lac,
        b_toplulastirmaci=b_top_lac,
    )


# ===========================================
# Ana hesaplayıcı
# ===========================================
def hesapla_kartel(
    df: pd.DataFrame | None = None,
    my_firms: list[str] | None = None,
    cfg: Config | None = None,
    min_skor: float = 30.0,
) -> list[CiftBilgisi]:
    """Tüm firma çiftleri için kartel skoru hesapla.

    Args:
        df: ETL DataFrame.
        my_firms: SELF firmaları.
        cfg: Konfigürasyon.
        min_skor: Bu skorun altındaki çiftler döndürülmez (filtreleme).

    Returns:
        Skor azalan sırada CiftBilgisi listesi.
    """
    if cfg is None:
        cfg = Config.load()

    if df is None:
        from core.config import load_my_firms as _lmf
        my_firms = my_firms or _lmf()
        df = etl.load_data(my_firms, cfg)

    if df.empty:
        return []

    katılım = _build_katılım_map(df)
    firma_ihale = _build_firma_ihaleleri(katılım)
    total_ihale = len(katılım)

    log.info(f"Kartel analizi: {total_ihale} ihale, {len(firma_ihale)} firma")

    # Toplulaştırmacı tespit (taban_oran > eşik)
    taban_esik = float(cfg.get("toplulaştırmacı.taban_oran", 0.70))
    toplulastirmaci_set = {
        f for f, ihaleler in firma_ihale.items()
        if (len(ihaleler) / total_ihale) > taban_esik
    }
    log.info(f"Toplulaştırmacı: {len(toplulastirmaci_set)} firma")

    # Tüm çiftleri taramak çok pahalı: O(N²)
    # Optimization: sadece YETERLI ortak ihale olanları al
    min_ortak = int(cfg.get("kartel.min_ortak_ihale", 5))
    min_self_ihale = max(min_ortak, 5)
    aktif_firmalar = [f for f, ihaleler in firma_ihale.items() if len(ihaleler) >= min_self_ihale]
    log.info(f"En az {min_self_ihale} ihaleye katılan firma: {len(aktif_firmalar)}")

    sonuc: list[CiftBilgisi] = []
    cift_sayisi = len(aktif_firmalar) * (len(aktif_firmalar) - 1) // 2
    log.info(f"İncelenen çift sayısı: {cift_sayisi:,}")

    for i, (a, b) in enumerate(combinations(aktif_firmalar, 2)):
        if i > 0 and i % 10000 == 0:
            log.info(f"  ... {i:,}/{cift_sayisi:,} ({len(sonuc)} pozitif eşleşme)")

        # Hızlı filtre: ortak ihale eşik altıysa atla
        ortak_count = len(firma_ihale[a] & firma_ihale[b])
        if ortak_count < min_ortak:
            continue

        cift = _cift_hesapla(a, b, df, katılım, firma_ihale, total_ihale, cfg, toplulastirmaci_set)
        if cift is None:
            continue
        if cift.toplam_skor >= min_skor:
            sonuc.append(cift)

    sonuc.sort(key=lambda c: -c.toplam_skor)
    log.info(f"Toplam {len(sonuc)} pozitif eşleşme")
    return sonuc


# ===========================================
# Network analizi — otomatik kartel grupları
# ===========================================
def kartel_gruplari_olustur(
    ciftler: list[CiftBilgisi],
    min_skor: float = 75.0,
) -> list[KartelGrubu]:
    """Yüksek skorlu çiftlerden network kümeleme ile kartel grupları çıkar.

    Connected components: skoru min_skor üstünde olan çiftler bir graph oluşturur,
    bağlı bileşenler kartel grupları olarak yorumlanır.
    """
    try:
        import networkx as nx
    except ImportError:
        log.error("networkx kütüphanesi yok. pip install networkx")
        return []

    G = nx.Graph()
    for c in ciftler:
        if c.toplam_skor >= min_skor:
            G.add_edge(c.firma_a_kanon, c.firma_b_kanon, skor=c.toplam_skor)

    gruplar: list[KartelGrubu] = []
    for grup_id, component in enumerate(nx.connected_components(G), 1):
        firmalar = sorted(component)
        # Grup içi çift sayısı ve ortalama skor
        grup_ciftleri = [
            c for c in ciftler
            if c.firma_a_kanon in component and c.firma_b_kanon in component
        ]
        if not grup_ciftleri:
            continue
        ort_skor = sum(c.toplam_skor for c in grup_ciftleri) / len(grup_ciftleri)

        # Paylaşılan idareler — tüm grup üyelerinin birlikte olduğu idareler
        idare_sayilari: dict[str, int] = {}
        for c in grup_ciftleri:
            for idare in c.ortak_ihale_idare_dagilim.keys():
                idare_sayilari[idare] = idare_sayilari.get(idare, 0) + 1
        # Grup içindeki çiftlerin yarısından fazlasında geçen idareler
        esik = max(1, len(grup_ciftleri) // 2)
        paylaşilan = sorted(
            [i for i, n in idare_sayilari.items() if n >= esik],
            key=lambda x: -idare_sayilari[x],
        )

        # Her kanonik için EN UZUN display ad seç (kanonik → display map)
        kanon_to_display: dict[str, str] = {}
        for c in grup_ciftleri:
            for kanon, ad in [(c.firma_a_kanon, c.firma_a_ad), (c.firma_b_kanon, c.firma_b_ad)]:
                if kanon not in component:
                    continue
                mevcut = kanon_to_display.get(kanon, "")
                if len(ad or "") > len(mevcut):
                    kanon_to_display[kanon] = ad
        firma_adlari = [kanon_to_display.get(k, k) for k in firmalar]

        gruplar.append(KartelGrubu(
            grup_id=grup_id,
            firmalar=firmalar,
            firma_adlari=sorted(firma_adlari),
            ortalama_skor=round(ort_skor, 2),
            cift_sayisi=len(grup_ciftleri),
            paylaşilan_idareler=paylaşilan[:5],
        ))

    gruplar.sort(key=lambda g: -g.ortalama_skor)
    return gruplar


# ===========================================
# DataFrame export
# ===========================================
def ciftleri_to_dataframe(ciftler: list[CiftBilgisi]) -> pd.DataFrame:
    rows = []
    for c in ciftler:
        rows.append({
            "Firma A": c.firma_a_ad,
            "Firma B": c.firma_b_ad,
            "Toplam Skor": c.toplam_skor,
            "Kategori": c.kategori,
            "A İhale": c.a_toplam_ihale,
            "B İhale": c.b_toplam_ihale,
            "Ortak İhale": c.ortak_ihale,
            "Lift": c.lift,
            "Lift Skoru": c.lift_skoru,
            "Tenzilat Ort. Fark %": c.tenzilat_ort_fark,
            "Tenzilat Medyan Fark %": c.tenzilat_medyan_fark,
            "Tenzilat Eşik Altı %": round(c.tenzilat_esik_alti_orani * 100, 1),
            "Tenzilat Skoru": c.tenzilat_skoru,
            "Teklif CV": c.teklif_orani_cv,
            "Teklif Skoru": c.teklif_skoru,
            "A Kazanma": c.a_kazanma,
            "B Kazanma": c.b_kazanma,
            "Rotasyon": c.rotasyon_paterni,
            "Rotasyon Skoru": c.rotasyon_skoru,
            "En Yoğun İdare %": round(c.en_yogun_idare_orani * 100, 1),
            "İdare Skoru": c.idare_skoru,
            "İdare Sayısı": len(c.ortak_ihale_idare_dagilim),
            "A Toplulaştırmacı": c.a_toplulastirmaci,
            "B Toplulaştırmacı": c.b_toplulastirmaci,
        })
    return pd.DataFrame(rows)


# ===========================================
# Smoke test
# ===========================================
if __name__ == "__main__":
    print("=== Kartel Detection Smoke Test ===\n")
    ciftler = hesapla_kartel(min_skor=30.0)
    if not ciftler:
        print("Pozitif kartel sinyali bulunamadı.")
        exit(0)

    print(f"Pozitif eşleşme: {len(ciftler)} çift\n")

    # Top 10 yüksek skorlu çift
    print("--- Top 10 Şüpheli Çift ---")
    for i, c in enumerate(ciftler[:10], 1):
        print(f"\n{i:>2}. {c.firma_a_ad[:40]} ↔ {c.firma_b_ad[:40]}")
        print(f"    SKOR: {c.toplam_skor:.1f}/100  [{c.kategori}]")
        print(f"    Lift: {c.lift:.2f} ({c.lift_skoru})  |  "
              f"Tenz fark medyan: %{c.tenzilat_medyan_fark:.3f} ({c.tenzilat_skoru})  |  "
              f"Ortak: {c.ortak_ihale}")
