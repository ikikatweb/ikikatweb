"""
Monte Carlo Savaş Simülasyonu — İhale War Room.

Bir ihaleye girecekken, geçmiş veriden öğrenilmiş rakip davranışlarına göre
N adet senaryo simüle eder. Her senaryoda:
  1. Her rakip için tenzilat sample (geçmiş dağılımdan)
  2. KİK formülü ile Sınır Değer hesaplanır
  3. Bizim teklifimizle karşılaştırılır → kazanır/kaybeder
  4. Kar/zarar hesaplanır

Pipeline:
  - firma_tenzilat_dagilimi(): firma kanonik adından geçmiş tenzilatları
    çekip Normal(μ, σ) parametreleri döndürür. Sniper firmalar idare-spesifik
    SD-merkezli dağılım kullanır.
  - monte_carlo_simulasyon(): tek bir teklif tutarımız için win prob + kar dağılımı.
  - optimal_tenzilat_bul(): birden çok teklif denenip en yüksek beklenen kar.

Çıktı: optimal teklif, win probability, P10/P50/P90 sınır değer.
"""
from __future__ import annotations
import logging
from dataclasses import dataclass, field, asdict
from typing import Iterable

import numpy as np
import pandas as pd

from core.config import Config
from core.kik_formula import hesapla_sinir_deger
from core.firma_normalize import kanonik_firma_adi
from core import etl
from intelligence.profiling import hesapla_sniper, SniperKarne

log = logging.getLogger(__name__)


# ===========================================
# Veri yapıları
# ===========================================
@dataclass
class FirmaIdareYakinlik:
    """Bir firmanın bir idarede idare-YM'sine ne kadar yaklaştığı.

    Yakınlık = teklif / resmi_ym (1.0 = idare YM'si, 0.7 = %30 kırım)
    """
    firma_kanon: str
    firma_ad: str
    idare_adi: str
    n_ihale: int                        # Bu idarede kaç ihalede teklif vermiş
    ortalama_yakinlik: float            # Ortalama (teklif / resmi_ym)
    medyan_yakinlik: float              # Medyan
    std_yakinlik: float                 # Std (kararlılık)
    min_yakinlik: float
    max_yakinlik: float

    @property
    def ortalama_kirim_pct(self) -> float:
        """Ortalama tenzilat (% cinsinden)."""
        return (1.0 - self.ortalama_yakinlik) * 100.0


@dataclass
class RakipParam:
    """Bir rakip firmanın simülasyon parametreleri.

    Tenzilat dağılımı:
      - mu, sigma: Normal(mu, sigma) — yüzde olarak (örn. 22.5 = %22.5 kırım)
      - is_sniper: True ise idare bazında sniper davranışı
    """
    firma_kanon: str
    firma_ad: str
    n_gozlem: int                       # Geçmiş ihale sayısı (anlamlılık)
    mu: float                           # Ortalama tenzilat (%)
    sigma: float                        # Std (%)
    min_tenzilat: float                 # Sample alırken alt clipping
    max_tenzilat: float                 # Sample alırken üst clipping
    is_sniper: bool = False
    sniper_idare_match: bool = False    # Bu idarede sniper karnesi var mı
    is_kartel_grup_uyesi: bool = False
    kartel_grup_id: int | None = None
    # İdare-bazlı tahmin doğruluğu (varsa, simülasyonda öncelikli kullanılır)
    idare_yakinlik: FirmaIdareYakinlik | None = None


@dataclass
class IhaleSenaryosu:
    """Tek bir Monte Carlo iterasyonunun çıktısı."""
    iterasyon: int
    sinir_deger: float
    bizim_kazandik: bool
    kazanan_firma: str
    kazanan_teklif: float
    bizim_teklif: float
    bizim_tenzilat: float
    rakip_tenzilatlari: dict[str, float]   # {firma_kanon: tenzilat}
    valid_count: int                       # Geçerli teklif sayısı
    sinir_alti_count: int                  # Eleenen teklif sayısı


@dataclass
class SimulasyonSonuc:
    """Aggregate edilmiş simülasyon sonucu."""
    n_iterasyon: int
    yaklasik_maliyet: float
    bizim_tenzilat: float                  # %
    bizim_teklif: float                    # TL
    n_rakip: int

    # Win/loss
    kazanma_sayisi: int
    kazanma_olasiligi: float               # 0..1
    sinir_alti_kalma_sayisi: int           # Bizim teklif SD altında kaldığı senaryolar
    sinir_alti_olasiligi: float

    # Sınır değer dağılımı
    sd_p10: float
    sd_p25: float
    sd_p50: float
    sd_p75: float
    sd_p90: float
    sd_mean: float
    sd_std: float

    # Kazanan teklif dağılımı (rekabet seviyesi)
    kazanan_teklif_p10: float
    kazanan_teklif_p50: float
    kazanan_teklif_p90: float

    # Bizim göreceli pozisyon
    ortalama_rakip_sayisi_altinda: float   # Kaç rakip bizden ucuz teklif vermiş ortalamada

    # Beklenen kar (sadece kazanılan senaryolarda)
    ortalama_kar_kazanildiginda: float     # TL
    beklenen_kar: float                    # win_prob × ort_kar

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OptimumSonuc:
    """Birden çok tenzilatla simülasyon → en iyi olan."""
    aday_tenzilatlar: list[float]
    sonuclar: list[SimulasyonSonuc]
    en_yuksek_win_prob_tenzilat: float
    en_yuksek_beklenen_kar_tenzilat: float
    onerilen_tenzilat: float                # Beklenen kar bazlı


# ===========================================
# Firma × İdare YM yakınlığı
# ===========================================
def firma_idare_yakinligi(
    firma_kanon: str,
    idare_adi: str,
    df: pd.DataFrame,
) -> FirmaIdareYakinlik | None:
    """Bir firmanın o idarede geçmişte verdiği tekliflerin idare-YM'sine yakınlık dağılımı.

    Yakınlık = teklif_tutari / resmi_ym
    - 1.0 → idare YM'sine eşit teklif
    - 0.65 → %35 kırım

    Bu metric, simülasyonda firma teklifini doğrudan idare YM'sine göre üretmek için
    kullanılır (bu firma genelde idare YM'sinin %X'ine teklif veriyor).
    """
    mask = (
        df["idare_adi"] == idare_adi
    ) & df["firmalar_kanon"].apply(
        lambda lst: isinstance(lst, list) and firma_kanon in lst
    )
    sub = df[mask]
    if sub.empty:
        return None

    yakinliklar = []
    firma_ad = firma_kanon
    for _, r in sub.iterrows():
        teklif = r.get("teklif_tutari")
        resmi_ym = r.get("resmi_ym")
        if not teklif or not resmi_ym or resmi_ym <= 0 or teklif <= 0:
            continue
        oran = float(teklif) / float(resmi_ym)
        # Anomali filtresi: 0.3-2.0 arası kabul (10x yanlış kayıtları ele)
        if 0.3 <= oran <= 2.0:
            yakinliklar.append(oran)
            # En uzun firma adını seç (display)
            firmalar = r.get("firmalar") or []
            firmalar_kanon = r.get("firmalar_kanon") or []
            try:
                idx = firmalar_kanon.index(firma_kanon)
                if idx < len(firmalar) and len(firmalar[idx]) > len(firma_ad):
                    firma_ad = firmalar[idx]
            except ValueError:
                pass

    if len(yakinliklar) < 2:
        return None

    arr = np.array(yakinliklar)
    return FirmaIdareYakinlik(
        firma_kanon=firma_kanon,
        firma_ad=firma_ad,
        idare_adi=idare_adi,
        n_ihale=len(arr),
        ortalama_yakinlik=round(float(arr.mean()), 4),
        medyan_yakinlik=round(float(np.median(arr)), 4),
        std_yakinlik=round(float(arr.std(ddof=1)), 4),
        min_yakinlik=round(float(arr.min()), 4),
        max_yakinlik=round(float(arr.max()), 4),
    )


# ===========================================
# Geçmiş veriden tenzilat dağılımı çıkarma
# ===========================================
def firma_tenzilat_dagilimi(
    firma_kanon: str,
    df: pd.DataFrame,
    idare_adi: str | None = None,
    cfg: Config | None = None,
    sniper_karneler: dict[str, SniperKarne] | None = None,
) -> RakipParam | None:
    """Firma kanonik adından geçmiş tenzilatları çekip Normal(μ, σ) parametreleri.

    Args:
        firma_kanon: Kanonik firma adı.
        df: ETL DataFrame (firmalar_kanon kolonu ile).
        idare_adi: Eğer verilirse, ÖNCELİKLE o idaredeki teklifleri kullan;
                   yetersizse (>=2 değil) tüm ihalelere düş.
        cfg: Konfigürasyon.
        sniper_karneler: hesapla_sniper() çıktısı (cache).

    Returns:
        RakipParam veya None (yetersiz veri).
    """
    if cfg is None:
        cfg = Config.load()

    tenzilat_min = float(cfg.get("deneyim.tenzilat_min_pct", -50.0))
    tenzilat_max = float(cfg.get("deneyim.tenzilat_max_pct", 60.0))

    # Bu firmanın TÜM teklifleri (anomalisiz)
    mask = df["firmalar_kanon"].apply(
        lambda lst: isinstance(lst, list) and firma_kanon in lst
    )
    firma_df_tum = df[mask].copy()

    if firma_df_tum.empty:
        return None

    def _tenzilatlar_topla(sub: pd.DataFrame) -> list[float]:
        out: list[float] = []
        for _, r in sub.iterrows():
            tenz = r.get("tenzilat_calc")
            if tenz is None or pd.isna(tenz):
                continue
            tenz = float(tenz)
            if tenzilat_min <= tenz <= tenzilat_max:
                out.append(tenz)
        return out

    # Öncelik: idare-özel tenzilat dağılımı (o firma o idarede ne yapıyor?)
    tenzilatlar: list[float] = []
    kaynak_idare = False
    if idare_adi:
        idare_sub = firma_df_tum[firma_df_tum["idare_adi"] == idare_adi]
        idare_tenzilatlar = _tenzilatlar_topla(idare_sub)
        if len(idare_tenzilatlar) >= 2:
            tenzilatlar = idare_tenzilatlar
            kaynak_idare = True

    # Fallback: tüm ihaleler (idare özel yetersizse veya idare verilmedi)
    if not tenzilatlar:
        tenzilatlar = _tenzilatlar_topla(firma_df_tum)

    if len(tenzilatlar) < 2:
        return None

    # log için: hangi kaynak kullanıldı
    if kaynak_idare:
        log.debug(f"[{firma_kanon}] idare-özel tenzilat: {len(tenzilatlar)} kayıt")
    else:
        log.debug(f"[{firma_kanon}] global tenzilat: {len(tenzilatlar)} kayıt")
    firma_df = firma_df_tum

    arr = np.array(tenzilatlar)
    mu = float(arr.mean())
    sigma = float(arr.std(ddof=1)) if len(arr) > 1 else 0.0
    n = len(arr)

    # Sniper kontrolü
    is_sniper = False
    sniper_idare_match = False
    if sniper_karneler and firma_kanon in sniper_karneler:
        karne = sniper_karneler[firma_kanon]
        is_sniper = karne.is_sniper or karne.is_ultra_sniper
        if idare_adi:
            sniper_idare_match = any(
                ib.idare_adi == idare_adi for ib in karne.sniper_idareler
            )

    # Sniper firmalar için sigma daha düşük (hedef şutu)
    if is_sniper and sniper_idare_match:
        sigma = max(sigma * 0.3, 0.5)  # Çok dar dağılım

    # Firma adı için tek bir display seç (en uzun)
    firma_ad = firma_kanon
    for _, r in firma_df.iterrows():
        firmalar = r.get("firmalar") or []
        firmalar_kanon = r.get("firmalar_kanon") or []
        try:
            idx = firmalar_kanon.index(firma_kanon)
            if idx < len(firmalar):
                cand = firmalar[idx]
                if len(cand) > len(firma_ad):
                    firma_ad = cand
        except ValueError:
            continue

    return RakipParam(
        firma_kanon=firma_kanon,
        firma_ad=firma_ad,
        n_gozlem=n,
        mu=round(mu, 2),
        sigma=round(sigma, 2),
        min_tenzilat=round(float(arr.min()), 2),
        max_tenzilat=round(float(arr.max()), 2),
        is_sniper=is_sniper,
        sniper_idare_match=sniper_idare_match,
    )


def idare_rakip_listesi(
    df: pd.DataFrame,
    idare_adi: str,
    cfg: Config | None = None,
    min_ihale: int = 2,
    max_rakip: int = 30,
) -> list[str]:
    """Bir idarede en sık görülen rakip firmaların kanonik listesi.

    Args:
        df: ETL DataFrame.
        idare_adi: Idare adı (tam eşleşme).
        min_ihale: Bu idarede minimum kaç ihaleye katılmış olmalı.
        max_rakip: Maksimum kaç rakip dönsün (frekansa göre top).
    """
    if cfg is None:
        cfg = Config.load()

    # Sadece o idarenin ihaleleri
    idare_df = df[df["idare_adi"] == idare_adi]
    if idare_df.empty:
        return []

    # Her firmanın bu idaredeki ihale sayısı
    sayim: dict[str, int] = {}
    for _, r in idare_df.iterrows():
        firmalar_kanon = r.get("firmalar_kanon") or []
        ihale_id = r.get("ihale_id")
        if not ihale_id:
            continue
        for fk in firmalar_kanon:
            if fk:
                sayim[fk] = sayim.get(fk, 0) + 1

    # Sırala ve filtrele
    sirali = sorted(
        [(fk, n) for fk, n in sayim.items() if n >= min_ihale],
        key=lambda x: -x[1],
    )
    return [fk for fk, _ in sirali[:max_rakip]]


# ===========================================
# Monte Carlo motor
# ===========================================
def _sample_teklif(
    rakip: RakipParam,
    idare_ym: float,
    sd_estimate: float | None,
    rng: np.random.Generator,
) -> float:
    """Bir rakibin teklif tutarını sample et. Üç katman halinde:

    1. SNIPER + idare match: SD-merkezli (en dar, en kesin tahmin)
    2. İdare-bazlı yakınlık varsa (firma_idare_yakinligi): teklif/ym oranı doğrudan
       — bu firma o idarede genelde idare YM'sinin %X'ine teklif vermiş, onu kullan
    3. Fallback: tarihsel tenzilat dağılımından (Normal μ ± σ)

    Returns:
        Teklif tutarı (TL)
    """
    # 1. Sniper davranışı (SD'ye yapışan)
    if rakip.is_sniper and rakip.sniper_idare_match and sd_estimate is not None:
        # SD ± %0.3 dar dağılım, sonra teklife çevir
        tenz_sd = ((idare_ym - sd_estimate) / idare_ym) * 100.0
        tenz = rng.normal(loc=tenz_sd, scale=0.3)
        tenz = float(np.clip(tenz, rakip.min_tenzilat, rakip.max_tenzilat))
        return idare_ym * (1.0 - tenz / 100.0)

    # 2. İdare-bazlı yakınlık (en güçlü sinyal — bu firmanın bu idaredeki gerçek davranışı)
    yk = rakip.idare_yakinlik
    if yk and yk.n_ihale >= 2:
        # Yakınlık dağılımı: ortalama_yakinlik ± std_yakinlik
        oran = rng.normal(loc=yk.ortalama_yakinlik, scale=max(yk.std_yakinlik, 0.005))
        # Gözlem aralığına clip
        oran = float(np.clip(oran, yk.min_yakinlik, yk.max_yakinlik))
        return idare_ym * oran

    # 3. Fallback: tarihsel tenzilat (Normal)
    tenz = rng.normal(loc=rakip.mu, scale=max(rakip.sigma, 0.1))
    tenz = float(np.clip(tenz, rakip.min_tenzilat, rakip.max_tenzilat))
    return idare_ym * (1.0 - tenz / 100.0)


# Eski fonksiyonu geriye dönük uyum için bırak (sadece tenzilat döner)
def _sample_tenzilat(rakip: RakipParam, sd_estimate: float | None, ym: float, rng: np.random.Generator) -> float:
    """LEGACY: tek tenzilat değeri döner (eski kodlar için)."""
    teklif = _sample_teklif(rakip, ym, sd_estimate, rng)
    return ((ym - teklif) / ym) * 100.0 if ym > 0 else 0.0


def _bir_senaryo(
    iterasyon: int,
    yaklasik_maliyet: float,
    rakipler: list[RakipParam],
    bizim_tenzilat: float,
    rng: np.random.Generator,
    n_katsayisi: float = 1.00,
    sd_pre_estimate: float | None = None,
) -> IhaleSenaryosu:
    """Tek iterasyon — tüm rakipler sample, SD hesabı, kazanan tespiti.

    Not: yaklasik_maliyet artık "tahmini idare YM"sidir (bizim_ym × bias).
    Rakipler bu değere göre teklif üretir.
    """
    bizim_teklif = yaklasik_maliyet * (1 - bizim_tenzilat / 100.0)

    # Rakip teklifleri sample (idare YM'sine göre, idare-bazlı yakınlık öncelikli)
    rakip_tenzilatlari: dict[str, float] = {}
    rakip_teklifleri: list[tuple[str, float]] = []  # (firma_kanon, teklif)

    for r in rakipler:
        teklif = _sample_teklif(r, yaklasik_maliyet, sd_pre_estimate, rng)
        # Geriye dönük tenzilat metriği için (raporlamada kullanılır)
        tenz = ((yaklasik_maliyet - teklif) / yaklasik_maliyet) * 100.0 if yaklasik_maliyet > 0 else 0.0
        rakip_tenzilatlari[r.firma_kanon] = round(tenz, 3)
        rakip_teklifleri.append((r.firma_kanon, teklif))

    # Tüm teklifler (biz + rakipler)
    BIZIM = "__BIZ__"
    all_teklifler = [(BIZIM, bizim_teklif)] + rakip_teklifleri
    teklif_tutarlari = [t for _, t in all_teklifler]

    # KİK Sınır Değer
    sd_sonuc = hesapla_sinir_deger(teklif_tutarlari, yaklasik_maliyet, n_katsayisi)
    sd = sd_sonuc.sinir_deger if sd_sonuc else 0.0

    # Geçerli teklifler (SD üstü, ön filtre içi)
    ort1 = yaklasik_maliyet * 0.40
    ort2 = yaklasik_maliyet * 1.20
    gecerliler = [
        (firma, t) for (firma, t) in all_teklifler
        if ort1 <= t <= ort2 and t >= sd
    ]
    sinir_alti = [
        (firma, t) for (firma, t) in all_teklifler
        if ort1 <= t <= ort2 and t < sd
    ]

    # Kazanan: SD üstü en düşük
    if gecerliler:
        kazanan = min(gecerliler, key=lambda x: x[1])
        kazanan_firma_k, kazanan_teklif = kazanan
    else:
        kazanan_firma_k = "__YOK__"
        kazanan_teklif = 0.0

    return IhaleSenaryosu(
        iterasyon=iterasyon,
        sinir_deger=sd,
        bizim_kazandik=(kazanan_firma_k == BIZIM),
        kazanan_firma=kazanan_firma_k,
        kazanan_teklif=kazanan_teklif,
        bizim_teklif=bizim_teklif,
        bizim_tenzilat=bizim_tenzilat,
        rakip_tenzilatlari=rakip_tenzilatlari,
        valid_count=len(gecerliler),
        sinir_alti_count=len(sinir_alti),
    )


def monte_carlo_simulasyon(
    yaklasik_maliyet: float,
    rakipler: list[RakipParam],
    bizim_tenzilat: float,
    n_iterasyon: int = 1000,
    n_katsayisi: float = 1.00,
    seed: int | None = None,
    maliyet_kar_marji: float = 5.0,
    return_senaryolar: bool = False,
) -> SimulasyonSonuc | tuple[SimulasyonSonuc, list[IhaleSenaryosu]]:
    """Monte Carlo simülasyonu — bizim teklif tutarımız sabit.

    Args:
        yaklasik_maliyet: İdarenin YM (TL).
        rakipler: RakipParam listesi.
        bizim_tenzilat: Bizim tenzilat (%, örn. 22.5).
        n_iterasyon: Kaç senaryo.
        n_katsayisi: KİK n katsayısı (1.00 yapım, 1.20 genel).
        seed: Random seed (tekrarlanabilir).
        maliyet_kar_marji: Bizim malzeme/işçilik dahil maliyet tenzilatı (%) —
                          biz bundan AZ kırarsak kar, çok kırarsak zarar.

    Returns:
        SimulasyonSonuc.
    """
    rng = np.random.default_rng(seed)

    # SD tahmini için bir ön çalışma (sniper'lar için)
    sd_pre_estimates = []
    for i in range(min(50, n_iterasyon)):
        s = _bir_senaryo(
            iterasyon=i,
            yaklasik_maliyet=yaklasik_maliyet,
            rakipler=rakipler,
            bizim_tenzilat=bizim_tenzilat,
            rng=rng,
            n_katsayisi=n_katsayisi,
            sd_pre_estimate=None,
        )
        if s.sinir_deger > 0:
            sd_pre_estimates.append(s.sinir_deger)

    sd_estimate = float(np.median(sd_pre_estimates)) if sd_pre_estimates else None

    # Asıl simülasyon (sniper'lar için SD tahmini ile)
    senaryolar: list[IhaleSenaryosu] = []
    for i in range(n_iterasyon):
        s = _bir_senaryo(
            iterasyon=i,
            yaklasik_maliyet=yaklasik_maliyet,
            rakipler=rakipler,
            bizim_tenzilat=bizim_tenzilat,
            rng=rng,
            n_katsayisi=n_katsayisi,
            sd_pre_estimate=sd_estimate,
        )
        senaryolar.append(s)

    # Aggregate
    sd_arr = np.array([s.sinir_deger for s in senaryolar if s.sinir_deger > 0])
    kazanma_count = sum(1 for s in senaryolar if s.bizim_kazandik)
    sinir_alti_count = sum(1 for s in senaryolar if s.bizim_teklif < s.sinir_deger)
    bizim_teklif = yaklasik_maliyet * (1 - bizim_tenzilat / 100.0)
    bizim_maliyet = yaklasik_maliyet * (1 - maliyet_kar_marji / 100.0)
    kar_kazanildiginda = bizim_teklif - bizim_maliyet  # Kazanırsak ne kadar kar

    # Kazanan teklif istatistiği
    kazanan_teklifleri = np.array(
        [s.kazanan_teklif for s in senaryolar if s.kazanan_teklif > 0]
    )

    # Bizden daha ucuz rakip sayısı
    bizden_ucuz_sayilari = []
    for s in senaryolar:
        n_ucuz = sum(
            1 for fk, tenz in s.rakip_tenzilatlari.items()
            if tenz > s.bizim_tenzilat
        )
        bizden_ucuz_sayilari.append(n_ucuz)

    win_prob = kazanma_count / max(n_iterasyon, 1)

    sonuc = SimulasyonSonuc(
        n_iterasyon=n_iterasyon,
        yaklasik_maliyet=yaklasik_maliyet,
        bizim_tenzilat=bizim_tenzilat,
        bizim_teklif=bizim_teklif,
        n_rakip=len(rakipler),
        kazanma_sayisi=kazanma_count,
        kazanma_olasiligi=round(win_prob, 4),
        sinir_alti_kalma_sayisi=sinir_alti_count,
        sinir_alti_olasiligi=round(sinir_alti_count / max(n_iterasyon, 1), 4),
        sd_p10=float(np.percentile(sd_arr, 10)) if len(sd_arr) else 0.0,
        sd_p25=float(np.percentile(sd_arr, 25)) if len(sd_arr) else 0.0,
        sd_p50=float(np.percentile(sd_arr, 50)) if len(sd_arr) else 0.0,
        sd_p75=float(np.percentile(sd_arr, 75)) if len(sd_arr) else 0.0,
        sd_p90=float(np.percentile(sd_arr, 90)) if len(sd_arr) else 0.0,
        sd_mean=float(sd_arr.mean()) if len(sd_arr) else 0.0,
        sd_std=float(sd_arr.std(ddof=1)) if len(sd_arr) > 1 else 0.0,
        kazanan_teklif_p10=float(np.percentile(kazanan_teklifleri, 10)) if len(kazanan_teklifleri) else 0.0,
        kazanan_teklif_p50=float(np.percentile(kazanan_teklifleri, 50)) if len(kazanan_teklifleri) else 0.0,
        kazanan_teklif_p90=float(np.percentile(kazanan_teklifleri, 90)) if len(kazanan_teklifleri) else 0.0,
        ortalama_rakip_sayisi_altinda=float(np.mean(bizden_ucuz_sayilari)) if bizden_ucuz_sayilari else 0.0,
        ortalama_kar_kazanildiginda=float(kar_kazanildiginda),
        beklenen_kar=float(win_prob * kar_kazanildiginda),
    )

    if return_senaryolar:
        return sonuc, senaryolar
    return sonuc


def optimal_tenzilat_bul(
    yaklasik_maliyet: float,
    rakipler: list[RakipParam],
    aday_tenzilatlar: list[float] | None = None,
    n_iterasyon: int = 1000,
    n_katsayisi: float = 1.00,
    seed: int | None = None,
    maliyet_kar_marji: float = 5.0,
) -> OptimumSonuc:
    """Birden çok tenzilat ile simüle ederek en iyiyi seç.

    Default aday tenzilatlar: rakiplerin ortalama tenzilatına göre dinamik.
    Aralık: [piyasa_ortalama - 12, piyasa_ortalama + 8] her %1'de bir.
    """
    if aday_tenzilatlar is None:
        if rakipler:
            piyasa_mu = float(np.mean([r.mu for r in rakipler]))
            alt = max(0.0, piyasa_mu - 12.0)
            ust = min(60.0, piyasa_mu + 8.0)
            adim = 1.0
            aday_tenzilatlar = [
                round(alt + i * adim, 1)
                for i in range(int((ust - alt) / adim) + 1)
            ]
        else:
            aday_tenzilatlar = [round(15.0 + i * 1.0, 1) for i in range(21)]

    sonuclar: list[SimulasyonSonuc] = []
    for tenz in aday_tenzilatlar:
        s = monte_carlo_simulasyon(
            yaklasik_maliyet=yaklasik_maliyet,
            rakipler=rakipler,
            bizim_tenzilat=tenz,
            n_iterasyon=n_iterasyon,
            n_katsayisi=n_katsayisi,
            seed=seed,
            maliyet_kar_marji=maliyet_kar_marji,
        )
        sonuclar.append(s)

    # En yüksek win prob
    best_winprob = max(sonuclar, key=lambda x: x.kazanma_olasiligi)
    # En yüksek beklenen kar
    best_kar = max(sonuclar, key=lambda x: x.beklenen_kar)

    return OptimumSonuc(
        aday_tenzilatlar=aday_tenzilatlar,
        sonuclar=sonuclar,
        en_yuksek_win_prob_tenzilat=best_winprob.bizim_tenzilat,
        en_yuksek_beklenen_kar_tenzilat=best_kar.bizim_tenzilat,
        onerilen_tenzilat=best_kar.bizim_tenzilat,
    )


# ===========================================
# Yüksek seviye yardımcı: bir ihale için tüm rakipler
# ===========================================
def rakipleri_hazirla(
    df: pd.DataFrame,
    idare_adi: str | None = None,
    rakip_kanonikleri: list[str] | None = None,
    cfg: Config | None = None,
    my_firms: list[str] | None = None,
    max_rakip: int = 20,
) -> list[RakipParam]:
    """Simülasyon için rakip listesi hazırla.

    Args:
        df: ETL DataFrame.
        idare_adi: Idare verilirse o idaredeki sık rakipler otomatik bulunur.
        rakip_kanonikleri: Manuel verilirse bu listeden RakipParam çıkarılır.
        my_firms: Kendi firmalarımız (rakip listesinden çıkarılır).

    Returns:
        RakipParam listesi.
    """
    if cfg is None:
        cfg = Config.load()

    # Kendi firmalarımızı kanonikleştir
    my_kanon: set[str] = set()
    if my_firms:
        for mf in my_firms:
            my_kanon.add(kanonik_firma_adi(mf))

    # Sniper karneler (zaten dict[firma_kanon, SniperKarne])
    try:
        sniper_karneler = hesapla_sniper(df=df, my_firms=my_firms, cfg=cfg)
    except Exception as e:
        log.warning(f"Sniper karneler hesaplanamadı: {e}")
        sniper_karneler = {}

    # Rakip listesi belirle
    if rakip_kanonikleri:
        kanonikler = list(rakip_kanonikleri)
    elif idare_adi:
        kanonikler = idare_rakip_listesi(df, idare_adi, cfg, max_rakip=max_rakip)
    else:
        log.warning("Ne idare ne de rakip listesi verildi — boş döner")
        return []

    # Bizi listeden çıkar, kanonikleştir
    kanonikler = [
        kanonik_firma_adi(k) for k in kanonikler
        if kanonik_firma_adi(k) not in my_kanon
    ]
    # Tekrarları temizle, sırayı koru
    seen = set()
    kanonikler = [k for k in kanonikler if not (k in seen or seen.add(k))]

    rakipler: list[RakipParam] = []
    for k in kanonikler:
        rp = firma_tenzilat_dagilimi(
            firma_kanon=k,
            df=df,
            idare_adi=idare_adi,
            cfg=cfg,
            sniper_karneler=sniper_karneler,
        )
        if rp:
            # İdare bazlı yakınlık (varsa) — daha doğru simülasyon için
            if idare_adi:
                rp.idare_yakinlik = firma_idare_yakinligi(k, idare_adi, df)
            rakipler.append(rp)

    return rakipler


# ===========================================
# DataFrame export
# ===========================================
def sonuclari_to_dataframe(opt: OptimumSonuc) -> pd.DataFrame:
    rows = []
    for s in opt.sonuclar:
        rows.append({
            "Tenzilat %": s.bizim_tenzilat,
            "Bizim Teklif TL": round(s.bizim_teklif, 2),
            "Win Prob %": round(s.kazanma_olasiligi * 100, 2),
            "Sınır Altı Kalma %": round(s.sinir_alti_olasiligi * 100, 2),
            "SD P10": round(s.sd_p10, 2),
            "SD P50": round(s.sd_p50, 2),
            "SD P90": round(s.sd_p90, 2),
            "SD Std": round(s.sd_std, 2),
            "Kazanan Teklif P50": round(s.kazanan_teklif_p50, 2),
            "Kar (Kazandığında)": round(s.ortalama_kar_kazanildiginda, 2),
            "Beklenen Kar": round(s.beklenen_kar, 2),
            "Bizden Ucuz Ort. Rakip": round(s.ortalama_rakip_sayisi_altinda, 2),
        })
    return pd.DataFrame(rows)


def rakipleri_to_dataframe(rakipler: list[RakipParam]) -> pd.DataFrame:
    rows = []
    for r in rakipler:
        rows.append({
            "Firma": r.firma_ad,
            "Kanonik": r.firma_kanon,
            "N Gözlem": r.n_gozlem,
            "Ort. Tenzilat %": r.mu,
            "Std %": r.sigma,
            "Min %": r.min_tenzilat,
            "Max %": r.max_tenzilat,
            "Sniper": "✓" if r.is_sniper else "",
            "Sniper-İdare Match": "✓" if r.sniper_idare_match else "",
        })
    return pd.DataFrame(rows)


# ===========================================
# Smoke test
# ===========================================
if __name__ == "__main__":
    print("=== Monte Carlo Simulasyon Smoke Test ===\n")

    from core.config import load_my_firms
    my_firms = load_my_firms()
    cfg = Config.load()
    df = etl.load_data(my_firms, cfg)

    print(f"DataFrame: {len(df)} satır")

    # En sık rastlanan idareyi bul
    idare_sik = (
        df["idare_adi"].value_counts().head(1)
    )
    print(f"En sık idare: {idare_sik}")

    if idare_sik.empty:
        print("Idare bulunamadı.")
        exit(0)

    idare_adi = idare_sik.index[0]
    rakipler = rakipleri_hazirla(
        df=df, idare_adi=idare_adi, cfg=cfg, my_firms=my_firms, max_rakip=10
    )
    print(f"\n{len(rakipler)} rakip hazırlandı:")
    for r in rakipler[:5]:
        print(f"  • {r.firma_ad[:40]}: μ={r.mu:.1f}±{r.sigma:.1f}% (n={r.n_gozlem})")

    # Simulasyon
    YM = 10_000_000.0
    print(f"\nSimülasyon: YM={YM:,.0f} TL, Bizim Tenz=%22.5")
    sonuc = monte_carlo_simulasyon(
        yaklasik_maliyet=YM,
        rakipler=rakipler,
        bizim_tenzilat=22.5,
        n_iterasyon=500,
        seed=42,
    )
    print(f"\nWin Prob:           %{sonuc.kazanma_olasiligi*100:.1f}")
    print(f"SD P50:             {sonuc.sd_p50:,.0f} TL")
    print(f"SD [P10..P90]:      [{sonuc.sd_p10:,.0f} .. {sonuc.sd_p90:,.0f}]")
    print(f"Beklenen Kar:       {sonuc.beklenen_kar:,.0f} TL")

    # Optimum
    print("\n--- Optimum tenzilat aranıyor ---")
    opt = optimal_tenzilat_bul(
        yaklasik_maliyet=YM,
        rakipler=rakipler,
        n_iterasyon=300,
        seed=42,
    )
    print(f"En yüksek win prob: %{opt.en_yuksek_win_prob_tenzilat:.1f}")
    print(f"En yüksek beklenen kar: %{opt.en_yuksek_beklenen_kar_tenzilat:.1f}")
    print(f"ÖNERİ: %{opt.onerilen_tenzilat:.1f}")
