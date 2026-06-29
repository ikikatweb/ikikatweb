"""
İhale-AI FastAPI Sunucusu — ikikat.net entegrasyonu.

Çalıştırma:
    cd ihale-ai
    .venv/Scripts/python -m uvicorn api.server:app --host 0.0.0.0 --port 8000 --reload

Endpoint'ler:
    GET  /api/health                         — Sağlık kontrolü
    GET  /api/idareler                       — Idare listesi (form dropdown)
    POST /api/savas-simulasyonu              — Monte Carlo savaş simülasyonu
    GET  /api/savas-simulasyonu/{path}/png   — Üretilen grafik PNG
    GET  /api/kartel-rapor                   — Kartel detection
    GET  /api/sniper-rapor                   — Sniper firmalar
    GET  /api/rakip-karneleri                — Tüm rakip karneleri
    GET  /api/birlikte-hareket               — Manuel grupları getir
    POST /api/birlikte-hareket               — Manuel grup oluştur/güncelle
    DELETE /api/birlikte-hareket/{id}        — Manuel grubu sil

CORS: ikikat.net + localhost:3000 izinli.

Not: Her istek baz alınarak ETL DataFrame yüklenir. Production'da bunun cache
edilmesi önerilir; şu anlık her seferde DB'den çekilir.
"""
from __future__ import annotations
import os
import json
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import pandas as pd

# İhale-AI modülleri
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import Config, load_my_firms
from core import etl
from core.firma_normalize import kanonik_firma_adi
from intelligence.simulation import (
    rakipleri_hazirla, monte_carlo_simulasyon, optimal_tenzilat_bul,
    sonuclari_to_dataframe, rakipleri_to_dataframe,
    SimulasyonSonuc, OptimumSonuc, RakipParam,
)
from intelligence.collusion import (
    hesapla_kartel, kartel_gruplari_olustur, ciftleri_to_dataframe,
)
from intelligence.profiling import (
    hesapla_sniper, hesapla_rakip_profilleri,
)
from intelligence.visualization import (
    grafik_winprob_kar_curve, grafik_rakip_dagilimi, grafik_sd_dagilimi,
)

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

# ===========================================
# FastAPI app
# ===========================================
app = FastAPI(
    title="İhale-AI API",
    version="1.0.0",
    description="Kartel detection, sniper detection, Monte Carlo savaş simülasyonu — ikikat.net için",
)

# CORS — Tüm origin'lere açık (dev için).
# allow_origin_regex ile localhost ve production hostları kapsanır.
# Not: allow_credentials=True ile "*" kullanılamaz, regex bu kısıtlamayı aşar.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|.*\.ikikat\.net|ikikat\.net)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ===========================================
# Sunucu başlangıcında pre-compute (warmup)
# ===========================================
# Pahalı hesaplar (kartel ~6dk, sniper ~30sn) sunucu açıldığında arka planda
# çalışır → ilk kullanıcı çağrısı cache'den anında döner.
# Hesaplar bitmeden çağrı gelirse normal flow ile hesap (eski davranış).
_WARMUP_STATE: dict[str, str] = {"status": "idle", "started": "", "kartel": "—", "sniper": "—", "rakip": "—"}


def _warmup_worker() -> None:
    """Arka plan thread — sunucu açılışında ağır hesapları cache'e doldurur."""
    import threading
    log.info("🔥 Warmup başlıyor...")
    _WARMUP_STATE["status"] = "running"
    _WARMUP_STATE["started"] = datetime.now().isoformat()
    try:
        cfg = Config.load()
        my_firms = load_my_firms()

        # 1. DataFrame yükle (ETL — ~5sn)
        df = get_dataframe()
        log.info(f"  ✓ DF yüklendi: {len(df)} satır")

        # 2. Sniper rapor (~30sn) — varsayılan parametrelerle
        try:
            karneler_dict = hesapla_sniper(df=df, my_firms=my_firms, cfg=cfg)
            sniper_n = sum(1 for k in karneler_dict.values() if k.is_sniper)
            ultra_n = sum(1 for k in karneler_dict.values() if k.is_ultra_sniper)
            for sadece_sniper, sadece_ultra in [(True, False), (False, False)]:
                karneler = list(karneler_dict.values())
                if sadece_ultra:
                    karneler = [k for k in karneler if k.is_ultra_sniper]
                elif sadece_sniper:
                    karneler = [k for k in karneler if k.is_sniper]
                karneler.sort(key=lambda k: k.global_ortalama_yakinlik_pct)
                response = SniperRaporResponse(
                    toplam_firma=len(karneler_dict),
                    sniper_sayisi=sniper_n,
                    ultra_sniper_sayisi=ultra_n,
                    firmalar=[
                        SniperFirmaDto(
                            firma_adi=k.firma_adi,
                            firma_kanon=k.firma_kanon,
                            etiket=k.etiket,
                            toplam_ihale=k.toplam_ihale,
                            is_sniper=k.is_sniper,
                            is_ultra_sniper=k.is_ultra_sniper,
                            global_ortalama_yakinlik_pct=k.global_ortalama_yakinlik_pct,
                            global_std_pct=k.global_std_pct,
                            en_yakin_teklif_pct=k.en_yakin_teklif_pct,
                            sniper_idareler=[
                                SniperIdareDto(
                                    idare_adi=i.idare_adi,
                                    toplam_ihale=i.toplam_ihale,
                                    in_band_sayisi=i.in_band_sayisi,
                                    in_band_orani=i.in_band_orani,
                                    ortalama_yakinlik_pct=i.ortalama_yakinlik_pct,
                                )
                                for i in k.sniper_idareler
                            ],
                        )
                        for k in karneler
                    ],
                )
                cache_set(f"sniper:{sadece_sniper}:{sadece_ultra}", response)
            log.info(f"  ✓ Sniper cache: {sniper_n} sniper, {ultra_n} ultra")
            _WARMUP_STATE["sniper"] = "ok"
        except Exception as e:
            log.exception(f"Sniper warmup hatası: {e}")
            _WARMUP_STATE["sniper"] = f"hata: {e}"

        # 3. Kartel rapor (~6dk) — varsayılan parametrelerle
        try:
            min_skor, grup_min_skor, top = 30.0, 75.0, 50
            ciftler = hesapla_kartel(df=df, my_firms=my_firms, cfg=cfg, min_skor=min_skor)
            sayim = {"Kartel Şüphesi": 0, "Orta Bağ": 0, "Zayıf Bağ": 0, "Bağımsız": 0}
            for c in ciftler:
                sayim[c.kategori] = sayim.get(c.kategori, 0) + 1
            gruplar = kartel_gruplari_olustur(ciftler, min_skor=grup_min_skor)
            response = KartelRaporResponse(
                toplam_cift=len(ciftler),
                kartel_supheli_sayisi=sayim["Kartel Şüphesi"],
                orta_bag_sayisi=sayim["Orta Bağ"],
                zayif_bag_sayisi=sayim["Zayıf Bağ"],
                en_yuksek_ciftler=[
                    CiftDto(
                        firma_a=c.firma_a_ad, firma_b=c.firma_b_ad,
                        firma_a_kanon=c.firma_a_kanon, firma_b_kanon=c.firma_b_kanon,
                        toplam_skor=c.toplam_skor, kategori=c.kategori,
                        ortak_ihale=c.ortak_ihale, a_toplam=c.a_toplam_ihale, b_toplam=c.b_toplam_ihale,
                        lift=c.lift, tenzilat_medyan_fark=c.tenzilat_medyan_fark,
                        tenzilat_esik_alti_pct=round(c.tenzilat_esik_alti_orani * 100, 1),
                        teklif_cv=c.teklif_orani_cv, en_yogun_idare_orani=c.en_yogun_idare_orani,
                        a_kazanma=c.a_kazanma, b_kazanma=c.b_kazanma,
                    )
                    for c in ciftler[:top]
                ],
                gruplar=[
                    KartelGrupDto(
                        grup_id=g.grup_id, firmalar=g.firma_adlari, kanonikler=g.firmalar,
                        cift_sayisi=g.cift_sayisi, ortalama_skor=g.ortalama_skor,
                        paylaşilan_idareler=g.paylaşilan_idareler,
                    )
                    for g in gruplar
                ],
            )
            cache_set(f"kartel:{min_skor}:{grup_min_skor}:{top}", response)
            log.info(f"  ✓ Kartel cache: {len(ciftler)} çift, {sayim['Kartel Şüphesi']} şüphe")
            _WARMUP_STATE["kartel"] = "ok"
        except Exception as e:
            log.exception(f"Kartel warmup hatası: {e}")
            _WARMUP_STATE["kartel"] = f"hata: {e}"

        _WARMUP_STATE["status"] = "done"
        log.info("🔥 Warmup tamamlandı.")
    except Exception as e:
        log.exception(f"Warmup hatası: {e}")
        _WARMUP_STATE["status"] = f"hata: {e}"
    finally:
        # threading import yukarıda, burada başka iş yok
        pass


@app.on_event("startup")
async def startup_warmup() -> None:
    """Sunucu başlarken arka planda warmup çalıştır."""
    import threading
    threading.Thread(target=_warmup_worker, daemon=True).start()
    log.info("Warmup thread başlatıldı (arka plan)")


# ===========================================
# Cache (basit in-memory)
# ===========================================
_DF_CACHE: dict[str, tuple[pd.DataFrame, datetime]] = {}
_CACHE_TTL_SECONDS = 600  # 10 dakika

# Pahalı hesap sonuçları için cache (kartel ~5dk, sniper ~30sn)
# Anahtar = (endpoint, params hash). TTL: 1 saat (zorla yenile için ?refresh=true)
_RESULT_CACHE: dict[str, tuple[object, datetime]] = {}
_RESULT_TTL_SECONDS = 3600


def cache_get(key: str) -> object | None:
    if key in _RESULT_CACHE:
        val, t = _RESULT_CACHE[key]
        if (datetime.now() - t).total_seconds() < _RESULT_TTL_SECONDS:
            return val
    return None


def cache_set(key: str, val: object) -> None:
    _RESULT_CACHE[key] = (val, datetime.now())


def get_dataframe(refresh: bool = False) -> pd.DataFrame:
    """ETL DataFrame'i cache'le. 10 dakikada bir yenile."""
    now = datetime.now()
    if not refresh and "main" in _DF_CACHE:
        df, cached_at = _DF_CACHE["main"]
        if (now - cached_at).total_seconds() < _CACHE_TTL_SECONDS:
            return df
    cfg = Config.load()
    my_firms = load_my_firms()
    df = etl.load_data(my_firms, cfg)
    _DF_CACHE["main"] = (df, now)
    return df


# Grafik dosyaları için geçici klasör
GRAFIK_DIR = Path(tempfile.gettempdir()) / "ihale-ai-grafikler"
GRAFIK_DIR.mkdir(parents=True, exist_ok=True)

# Manuel kartel grupları için JSON dosyası
MANUEL_GRUP_FILE = Path(__file__).resolve().parent.parent / "data" / "manuel-gruplar.json"
MANUEL_GRUP_FILE.parent.mkdir(parents=True, exist_ok=True)


# ===========================================
# Pydantic modeller (request/response)
# ===========================================
class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: str
    df_satir: int


class IdareListItem(BaseModel):
    idare_adi: str
    ihale_sayisi: int


class SavasSimulasyonuRequest(BaseModel):
    yaklasik_maliyet: float = Field(..., gt=0, description="Bizim hesapladığımız YM (TL). Bias ile tahmini idare YM'sine çevrilir.")
    idare_adi: Optional[str] = Field(None, description="Idare seçilirse otomatik rakipler ve idare-bazlı bias kullanılır")
    rakip_kanonikleri: Optional[list[str]] = Field(None, description="Manuel rakip listesi (kanonik veya display)")
    tenzilat: Optional[float] = Field(None, description="Tek tenzilat (None=optimum aranır)")
    n_iterasyon: int = Field(1000, ge=100, le=10000)
    n_katsayisi: float = Field(1.00, description="KİK n: 1.00 yapım, 1.20 genel")
    maliyet_marji: Optional[float] = Field(None, description="Bizim maliyet/kar marjı (%). None = geçmiş SELF tekliflerden otomatik hesaplanır.")
    max_rakip: int = Field(20, ge=2, le=50)
    seed: Optional[int] = Field(42)
    # Yeni: kullanıcı bias-corrected mod kullanmak istemezse override edilebilir
    bias_kullan: bool = Field(True, description="True: bizim_ym × bias = idare_ym. False: yaklasik_maliyet doğrudan idare YM'si.")


class FirmaIdareYakinlikDto(BaseModel):
    firma_kanon: str
    firma_ad: str
    n_ihale: int
    ortalama_yakinlik: float          # 1.0 = idare YM, 0.7 = %30 kırım
    medyan_yakinlik: float
    std_yakinlik: float
    ortalama_kirim_pct: float         # 100*(1-ortalama_yakinlik)


class RakipDto(BaseModel):
    firma_kanon: str
    firma_ad: str
    n_gozlem: int
    mu: float
    sigma: float
    min_tenzilat: float
    max_tenzilat: float
    is_sniper: bool
    sniper_idare_match: bool
    # İdare-bazlı yakınlık (varsa) — simülasyonda kullanılan asıl sinyal
    idare_yakinlik: Optional[FirmaIdareYakinlikDto] = None


class BiasOrnegi(BaseModel):
    """Bias hesabında kullanılan geçmiş ihalenin özeti."""
    is_adi: str
    ihale_tarihi: Optional[str] = None
    bizim_ym: float
    resmi_ym: float
    oran: float                          # resmi_ym / bizim_ym


class IdareGecmisIhale(BaseModel):
    """Seçilen idarenin geçmiş ihale özeti — şeffaflık için."""
    is_adi: str
    ihale_tarihi: Optional[str] = None
    resmi_ym: Optional[float] = None
    bizim_ym: Optional[float] = None
    bizim_katildik: bool                  # Bu ihalede biz teklif vermiş miyiz?
    bizim_teklif: Optional[float] = None
    bizim_tenzilat: Optional[float] = None
    sinir_deger: Optional[float] = None
    muhtemel_kazanan: Optional[str] = None
    muhtemel_kazanan_tutar: Optional[float] = None
    katilimci_sayisi: int                # Toplam teklif sayısı


class BiasDetayDto(BaseModel):
    """Bizim YM'mizden tahmini idare YM'sine çevirme detayı."""
    bizim_ym: float                     # Kullanıcının girdiği değer
    bias_factor: float                  # bizim_ym × bias = tahmini_idare_ym
    tahmini_idare_ym: float             # Simülasyonda kullanılan değer
    bias_kaynak: str                    # "idare" | "global" | "yok"
    bias_n_ihale: int                   # Bias hesabında kullanılan ihale sayısı
    ornekler: list[BiasOrnegi] = []     # Hesabı oluşturan ihaleler (max 10)


class TenzilatNoktasi(BaseModel):
    tenzilat: float
    bizim_teklif: float
    win_prob: float           # 0..1
    sinir_alti_olasiligi: float
    sd_p10: float
    sd_p50: float
    sd_p90: float
    kar_kazanildiginda: float
    beklenen_kar: float
    bizden_ucuz_ortalama: float


class SavasSimulasyonuResponse(BaseModel):
    yaklasik_maliyet: float           # Simülasyonda kullanılan (tahmini idare YM)
    idare_adi: Optional[str]
    n_iterasyon: int
    maliyet_marji: float
    rakipler: list[RakipDto]
    optimum_noktalar: list[TenzilatNoktasi]
    onerilen_tenzilat: float
    onerilen_teklif: float
    onerilen_win_prob: float
    onerilen_beklenen_kar: float
    onerilen_kar_kazanildiginda: float
    sd_medyan: float
    girilmemeli: bool
    grafik_token: str
    bias_detay: Optional[BiasDetayDto] = None  # Bizim YM → idare YM çevirisi detayı
    maliyet_marji_kaynak: str = "manuel"      # "idare" | "global" | "varsayilan" | "manuel"
    maliyet_marji_n_kayit: int = 0            # Otomatik hesapta kaç SELF kaydı kullanıldı
    idare_gecmis: list[IdareGecmisIhale] = [] # Seçilen idarenin geçmiş ihaleleri (şeffaflık)


class CiftDto(BaseModel):
    firma_a: str
    firma_b: str
    firma_a_kanon: str
    firma_b_kanon: str
    toplam_skor: float
    kategori: str
    ortak_ihale: int
    a_toplam: int
    b_toplam: int
    lift: float
    tenzilat_medyan_fark: float
    tenzilat_esik_alti_pct: float
    teklif_cv: float
    en_yogun_idare_orani: float
    a_kazanma: int
    b_kazanma: int


class KartelGrupDto(BaseModel):
    grup_id: int
    firmalar: list[str]              # display
    kanonikler: list[str]            # kanonik
    cift_sayisi: int
    ortalama_skor: float
    paylaşilan_idareler: list[str]


class KartelRaporResponse(BaseModel):
    toplam_cift: int
    kartel_supheli_sayisi: int
    orta_bag_sayisi: int
    zayif_bag_sayisi: int
    en_yuksek_ciftler: list[CiftDto]
    gruplar: list[KartelGrupDto]


class SniperIdareDto(BaseModel):
    idare_adi: str
    toplam_ihale: int
    in_band_sayisi: int
    in_band_orani: float
    ortalama_yakinlik_pct: float


class SniperFirmaDto(BaseModel):
    firma_adi: str
    firma_kanon: str
    etiket: str
    toplam_ihale: int
    is_sniper: bool
    is_ultra_sniper: bool
    global_ortalama_yakinlik_pct: float
    global_std_pct: float
    en_yakin_teklif_pct: float
    sniper_idareler: list[SniperIdareDto]


class SniperRaporResponse(BaseModel):
    toplam_firma: int
    sniper_sayisi: int
    ultra_sniper_sayisi: int
    firmalar: list[SniperFirmaDto]


class RakipKarneDto(BaseModel):
    firma_adi: str
    firma_kanon: str
    etiket: str
    toplam_ihale: int
    toplam_kazanma: int
    kazanma_orani: float
    ortalama_tenzilat: float
    deneyim_tutari: float
    is_sniper: bool
    is_ultra_sniper: bool
    is_toplulastirmaci: bool


class RakipKarneResponse(BaseModel):
    karneler: list[RakipKarneDto]


class ManuelGrup(BaseModel):
    id: str
    grup_adi: str
    firmalar: list[str]              # kanonik adlar
    aciklama: str = ""
    olusturma_tarihi: str
    guncelleme_tarihi: str


class ManuelGrupRequest(BaseModel):
    grup_adi: str
    firmalar: list[str]
    aciklama: str = ""


# ===========================================
# Endpoints
# ===========================================
@app.get("/api/warmup-status")
def warmup_status():
    """Sunucu başlangıcı arka plan hesaplarının durumu."""
    return _WARMUP_STATE


@app.get("/api/health", response_model=HealthResponse)
def health():
    """Sağlık kontrolü + DataFrame durumu."""
    try:
        df = get_dataframe()
        return HealthResponse(
            status="ok",
            version="1.0.0",
            timestamp=datetime.now().isoformat(),
            df_satir=len(df),
        )
    except Exception as e:
        log.exception("Health check failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/idareler", response_model=list[IdareListItem])
def idareler(
    min_ihale: int = Query(3, ge=1, description="Minimum ihale sayısı"),
    arama: Optional[str] = Query(None, description="Idare adı içinde arama"),
):
    """Idare listesi — form dropdown için. Frekansa göre sıralı."""
    df = get_dataframe()
    sayim = (
        df.dropna(subset=["idare_adi", "ihale_id"])
        .drop_duplicates(subset=["ihale_id", "idare_adi"])
        .groupby("idare_adi")["ihale_id"].count()
        .sort_values(ascending=False)
    )
    sonuc = []
    for adi, n in sayim.items():
        if n < min_ihale:
            break
        adi_str = str(adi)
        if arama and arama.lower() not in adi_str.lower():
            continue
        sonuc.append(IdareListItem(idare_adi=adi_str, ihale_sayisi=int(n)))
    return sonuc


@app.post("/api/savas-simulasyonu", response_model=SavasSimulasyonuResponse)
def savas_simulasyonu(req: SavasSimulasyonuRequest):
    """Monte Carlo savaş simülasyonu — bias-corrected.

    Akış:
      1. Kullanıcının bulduğu YM (req.yaklasik_maliyet) gelir
      2. İdare bazlı bias hesaplanır → tahmini_idare_ym = bizim_ym × bias
      3. Rakipler bu tahmini_idare_ym'ye göre teklif üretir
      4. Sınır değer hesabı tahmini_idare_ym üzerinden yapılır
      5. Optimum bizim tenzilat ve beklenen kar hesaplanır
    """
    cfg = Config.load()
    my_firms = load_my_firms()
    df = get_dataframe()

    # Bias hesabı — bizim YM'yi tahmini idare YM'sine çevir
    from intelligence.bias import fallback_bias
    bias_detay: Optional[BiasDetayDto] = None
    if req.bias_kullan:
        # ihaleler_df: bias hesabı için sadeleştirilmiş ihale tablosu lazım
        # ETL'deki df satır bazlı (her firma ayrı satır), ihale bazlı tek satır gerek
        ihale_kolonlari = ["ihale_id", "idare_adi", "ihale_tarihi", "is_adi", "resmi_ym", "bizim_ym"]
        var_olan = [k for k in ihale_kolonlari if k in df.columns]
        ornekler: list[BiasOrnegi] = []
        if "resmi_ym" in var_olan and "bizim_ym" in var_olan:
            ihaleler_df = df[var_olan].drop_duplicates(subset=["ihale_id"]).copy()
            # Bias modülü "yaklasik_maliyet" ve "hesaplanan_yaklasik_maliyet" bekler
            ihaleler_df_bias = ihaleler_df.rename(columns={
                "resmi_ym": "yaklasik_maliyet",
                "bizim_ym": "hesaplanan_yaklasik_maliyet",
            })
            bias_val, kaynak, n = fallback_bias(req.yaklasik_maliyet, req.idare_adi, ihaleler_df_bias)

            # Örnekleri topla — kullanıcı şeffaflık için görsün
            ornek_df = ihaleler_df.dropna(subset=["resmi_ym", "bizim_ym"]).copy()
            ornek_df = ornek_df[(ornek_df["resmi_ym"] > 0) & (ornek_df["bizim_ym"] > 0)]
            if kaynak == "idare" and req.idare_adi:
                ornek_df = ornek_df[ornek_df["idare_adi"] == req.idare_adi]
            # Anomali filtresi (bias.py'deki ile aynı)
            ornek_df["__oran"] = ornek_df["resmi_ym"] / ornek_df["bizim_ym"]
            ornek_df = ornek_df[(ornek_df["__oran"] >= 0.3) & (ornek_df["__oran"] <= 3.0)]
            # Tarih sırasıyla en yenilerden (max 10)
            if "ihale_tarihi" in ornek_df.columns:
                ornek_df["__tarih"] = pd.to_datetime(ornek_df["ihale_tarihi"], errors="coerce")
                ornek_df = ornek_df.sort_values("__tarih", ascending=False)
            for _, r in ornek_df.head(10).iterrows():
                tarih_val = r.get("ihale_tarihi")
                tarih_str: Optional[str] = None
                if tarih_val is not None and not (isinstance(tarih_val, float) and pd.isna(tarih_val)):
                    tarih_str = str(tarih_val)[:10]
                ornekler.append(BiasOrnegi(
                    is_adi=str(r.get("is_adi", "—") or "—")[:80],
                    ihale_tarihi=tarih_str,
                    bizim_ym=float(r["bizim_ym"]),
                    resmi_ym=float(r["resmi_ym"]),
                    oran=round(float(r["__oran"]), 4),
                ))
        else:
            bias_val, kaynak, n = 1.0, "yok", 0

        tahmini_idare_ym = req.yaklasik_maliyet * bias_val
        bias_detay = BiasDetayDto(
            bizim_ym=req.yaklasik_maliyet,
            bias_factor=round(bias_val, 4),
            tahmini_idare_ym=round(tahmini_idare_ym, 2),
            bias_kaynak=kaynak,
            bias_n_ihale=n,
            ornekler=ornekler,
        )
    else:
        tahmini_idare_ym = req.yaklasik_maliyet

    # Maliyet marjı otomatik hesaplanır (kullanıcı verirse override)
    from intelligence.bias import hesapla_otomatik_maliyet_marji
    if req.maliyet_marji is not None:
        maliyet_marji_val = float(req.maliyet_marji)
        marji_kaynak = "manuel"
        marji_n = 0
    else:
        marji, marji_kaynak, marji_n = hesapla_otomatik_maliyet_marji(
            df=df,
            idare_adi=req.idare_adi,
        )
        maliyet_marji_val = float(marji)

    # Seçilen idarenin geçmiş ihale listesi (şeffaflık için kullanıcıya gösterilir)
    idare_gecmis_listesi: list[IdareGecmisIhale] = []
    if req.idare_adi and not df.empty:
        idare_df = df[df["idare_adi"] == req.idare_adi].copy()
        if not idare_df.empty:
            # İhale bazlı grupla (her ihaleyi tek satır olarak)
            ihale_kolonlari_meta = ["ihale_id", "is_adi", "ihale_tarihi", "resmi_ym", "bizim_ym",
                                    "sinir_deger", "muhtemel_kazanan", "muhtemel_kazanan_tutar"]
            mevcut_meta = [k for k in ihale_kolonlari_meta if k in idare_df.columns]
            ihale_meta = idare_df[mevcut_meta].drop_duplicates(subset=["ihale_id"]).copy()
            # Tarihe göre yenide eskiye
            if "ihale_tarihi" in ihale_meta.columns:
                ihale_meta["__t"] = pd.to_datetime(ihale_meta["ihale_tarihi"], errors="coerce")
                ihale_meta = ihale_meta.sort_values("__t", ascending=False)
            # Max 15 ihale
            for _, ihale in ihale_meta.head(15).iterrows():
                ihale_id = ihale.get("ihale_id")
                # Bu ihaledeki tüm satırlar
                ihale_satirlari = idare_df[idare_df["ihale_id"] == ihale_id]
                # Biz katıldık mı?
                self_satirlar = ihale_satirlari[ihale_satirlari.get("etiket", "") == "SELF"]
                bizim_katildik = not self_satirlar.empty
                bizim_teklif: Optional[float] = None
                bizim_tenzilat: Optional[float] = None
                if bizim_katildik:
                    # En düşük (kazanan) bizim teklif
                    self_sorted = self_satirlar.sort_values("teklif_tutari", na_position="last")
                    ilk = self_sorted.iloc[0]
                    if pd.notna(ilk.get("teklif_tutari")):
                        bizim_teklif = float(ilk["teklif_tutari"])
                    if pd.notna(ilk.get("tenzilat_calc")):
                        bizim_tenzilat = round(float(ilk["tenzilat_calc"]), 2)
                tarih_val = ihale.get("ihale_tarihi")
                tarih_str: Optional[str] = None
                if tarih_val is not None and not (isinstance(tarih_val, float) and pd.isna(tarih_val)):
                    tarih_str = str(tarih_val)[:10]
                idare_gecmis_listesi.append(IdareGecmisIhale(
                    is_adi=str(ihale.get("is_adi", "—") or "—")[:120],
                    ihale_tarihi=tarih_str,
                    resmi_ym=float(ihale["resmi_ym"]) if pd.notna(ihale.get("resmi_ym")) else None,
                    bizim_ym=float(ihale["bizim_ym"]) if pd.notna(ihale.get("bizim_ym")) else None,
                    bizim_katildik=bizim_katildik,
                    bizim_teklif=bizim_teklif,
                    bizim_tenzilat=bizim_tenzilat,
                    sinir_deger=float(ihale["sinir_deger"]) if pd.notna(ihale.get("sinir_deger")) else None,
                    muhtemel_kazanan=str(ihale.get("muhtemel_kazanan") or "")[:80] or None,
                    muhtemel_kazanan_tutar=float(ihale["muhtemel_kazanan_tutar"]) if pd.notna(ihale.get("muhtemel_kazanan_tutar")) else None,
                    katilimci_sayisi=len(ihale_satirlari),
                ))

    rakipler = rakipleri_hazirla(
        df=df,
        idare_adi=req.idare_adi,
        rakip_kanonikleri=req.rakip_kanonikleri,
        cfg=cfg,
        my_firms=my_firms,
        max_rakip=req.max_rakip,
    )

    if not rakipler:
        raise HTTPException(
            status_code=400,
            detail="Rakip bulunamadı. idare_adi veya rakip_kanonikleri parametrelerini kontrol edin.",
        )

    if req.tenzilat is not None:
        # Tek tenzilat
        s = monte_carlo_simulasyon(
            yaklasik_maliyet=tahmini_idare_ym,
            rakipler=rakipler,
            bizim_tenzilat=req.tenzilat,
            n_iterasyon=req.n_iterasyon,
            n_katsayisi=req.n_katsayisi,
            seed=req.seed,
            maliyet_kar_marji=maliyet_marji_val,
        )
        opt_sonuclar = [s]
        en_iyi = s
        onerilen_tenzilat = req.tenzilat
    else:
        # Optimum aranır
        opt = optimal_tenzilat_bul(
            yaklasik_maliyet=tahmini_idare_ym,
            rakipler=rakipler,
            n_iterasyon=req.n_iterasyon,
            n_katsayisi=req.n_katsayisi,
            seed=req.seed,
            maliyet_kar_marji=maliyet_marji_val,
        )
        opt_sonuclar = opt.sonuclar
        en_iyi = max(opt_sonuclar, key=lambda x: x.beklenen_kar)
        onerilen_tenzilat = opt.onerilen_tenzilat

    # Pozitif kar var mı
    positives = [s for s in opt_sonuclar if s.beklenen_kar > 0]
    girilmemeli = not positives

    # Grafikler için unique token
    token = uuid.uuid4().hex[:16]
    plot_dir = GRAFIK_DIR / token
    plot_dir.mkdir(parents=True, exist_ok=True)

    title = f"YM={req.yaklasik_maliyet:,.0f} TL"
    if req.idare_adi:
        title += f" | {req.idare_adi[:40]}"

    # Sadece optimum aranıyorsa winprob/kar curve çiz
    if len(opt_sonuclar) > 1:
        opt_obj = OptimumSonuc(
            aday_tenzilatlar=[s.bizim_tenzilat for s in opt_sonuclar],
            sonuclar=opt_sonuclar,
            en_yuksek_win_prob_tenzilat=max(opt_sonuclar, key=lambda x: x.kazanma_olasiligi).bizim_tenzilat,
            en_yuksek_beklenen_kar_tenzilat=onerilen_tenzilat,
            onerilen_tenzilat=onerilen_tenzilat,
        )
        try:
            grafik_winprob_kar_curve(
                opt_obj,
                title_suffix=title,
                out_path=plot_dir / "winprob-kar.png",
            )
        except Exception as e:
            log.exception(f"winprob-kar grafiği başarısız: {e}")

    try:
        grafik_rakip_dagilimi(
            rakipler,
            bizim_tenzilat=onerilen_tenzilat,
            out_path=plot_dir / "rakipler.png",
        )
    except Exception as e:
        log.exception(f"rakip-dagilimi grafiği başarısız: {e}")

    # SD histogramı için optimum tenzilatla bir simülasyon (return_senaryolar=True)
    try:
        _, senaryolar = monte_carlo_simulasyon(
            yaklasik_maliyet=tahmini_idare_ym,
            rakipler=rakipler,
            bizim_tenzilat=onerilen_tenzilat,
            n_iterasyon=max(req.n_iterasyon, 1000),
            n_katsayisi=req.n_katsayisi,
            seed=req.seed,
            maliyet_kar_marji=maliyet_marji_val,
            return_senaryolar=True,
        )
        grafik_sd_dagilimi(
            senaryolar=senaryolar,
            yaklasik_maliyet=tahmini_idare_ym,
            bizim_teklif=en_iyi.bizim_teklif,
            title_suffix=f"Tenzilat=%{onerilen_tenzilat} | {title}",
            out_path=plot_dir / "sd-dagilimi.png",
        )
    except Exception as e:
        log.exception(f"sd-dagilimi grafiği başarısız: {e}")

    return SavasSimulasyonuResponse(
        yaklasik_maliyet=tahmini_idare_ym,
        idare_adi=req.idare_adi,
        n_iterasyon=req.n_iterasyon,
        maliyet_marji=maliyet_marji_val,
        maliyet_marji_kaynak=marji_kaynak,
        maliyet_marji_n_kayit=marji_n,
        rakipler=[
            RakipDto(
                firma_kanon=r.firma_kanon,
                firma_ad=r.firma_ad,
                n_gozlem=r.n_gozlem,
                mu=r.mu, sigma=r.sigma,
                min_tenzilat=r.min_tenzilat, max_tenzilat=r.max_tenzilat,
                is_sniper=r.is_sniper, sniper_idare_match=r.sniper_idare_match,
                idare_yakinlik=FirmaIdareYakinlikDto(
                    firma_kanon=r.idare_yakinlik.firma_kanon,
                    firma_ad=r.idare_yakinlik.firma_ad,
                    n_ihale=r.idare_yakinlik.n_ihale,
                    ortalama_yakinlik=r.idare_yakinlik.ortalama_yakinlik,
                    medyan_yakinlik=r.idare_yakinlik.medyan_yakinlik,
                    std_yakinlik=r.idare_yakinlik.std_yakinlik,
                    ortalama_kirim_pct=round(r.idare_yakinlik.ortalama_kirim_pct, 2),
                ) if r.idare_yakinlik else None,
            )
            for r in rakipler
        ],
        optimum_noktalar=[
            TenzilatNoktasi(
                tenzilat=s.bizim_tenzilat,
                bizim_teklif=s.bizim_teklif,
                win_prob=s.kazanma_olasiligi,
                sinir_alti_olasiligi=s.sinir_alti_olasiligi,
                sd_p10=s.sd_p10, sd_p50=s.sd_p50, sd_p90=s.sd_p90,
                kar_kazanildiginda=s.ortalama_kar_kazanildiginda,
                beklenen_kar=s.beklenen_kar,
                bizden_ucuz_ortalama=s.ortalama_rakip_sayisi_altinda,
            )
            for s in opt_sonuclar
        ],
        onerilen_tenzilat=onerilen_tenzilat,
        onerilen_teklif=en_iyi.bizim_teklif,
        onerilen_win_prob=en_iyi.kazanma_olasiligi,
        onerilen_beklenen_kar=en_iyi.beklenen_kar,
        onerilen_kar_kazanildiginda=en_iyi.ortalama_kar_kazanildiginda,
        sd_medyan=en_iyi.sd_p50,
        girilmemeli=girilmemeli,
        grafik_token=token,
        bias_detay=bias_detay,
        idare_gecmis=idare_gecmis_listesi,
    )


@app.get("/api/idare-istatistik")
def idare_istatistik(idare_adi: str = Query(..., description="Tam idare adı")):
    """Bir idare için bias özet + firma yakınlık tablosu.

    Dönen veri:
      - bias: o idarenin geçmişindeki bizim_ym ↔ resmi_ym sapma deseni
      - firmalar: o idarede teklif vermiş firmaların idare-YM yakınlıkları
                  (hangi firma idare YM'sine ne kadar yaklaşmış)
    """
    from intelligence.bias import hesapla_idare_bias
    from intelligence.simulation import firma_idare_yakinligi, idare_rakip_listesi
    cfg = Config.load()
    df = get_dataframe()

    # Bias
    bias_obj: dict | None = None
    var_olan = [k for k in ["ihale_id", "idare_adi", "ihale_tarihi", "resmi_ym", "bizim_ym"] if k in df.columns]
    if "resmi_ym" in var_olan and "bizim_ym" in var_olan:
        ihaleler_df = df[var_olan].drop_duplicates(subset=["ihale_id"]).rename(columns={
            "resmi_ym": "yaklasik_maliyet",
            "bizim_ym": "hesaplanan_yaklasik_maliyet",
        })
        ib = hesapla_idare_bias(idare_adi, ihaleler_df)
        if ib:
            bias_obj = ib.to_dict()

    # Firma yakınlık listesi
    rakip_kanonikleri = idare_rakip_listesi(df, idare_adi, cfg, max_rakip=50)
    yakinliklar = []
    for k in rakip_kanonikleri:
        y = firma_idare_yakinligi(k, idare_adi, df)
        if y:
            yakinliklar.append({
                "firma_kanon": y.firma_kanon,
                "firma_ad": y.firma_ad,
                "n_ihale": y.n_ihale,
                "ortalama_yakinlik": y.ortalama_yakinlik,
                "medyan_yakinlik": y.medyan_yakinlik,
                "std_yakinlik": y.std_yakinlik,
                "ortalama_kirim_pct": round(y.ortalama_kirim_pct, 2),
                "min_yakinlik": y.min_yakinlik,
                "max_yakinlik": y.max_yakinlik,
            })
    # En yakın olanlar üstte (yakınlık 1'e yakın olanlar)
    yakinliklar.sort(key=lambda x: -x["ortalama_yakinlik"])

    return {
        "idare_adi": idare_adi,
        "bias": bias_obj,
        "firmalar": yakinliklar,
    }


@app.get("/api/savas-simulasyonu/{token}/grafik/{tip}")
def savas_grafik(token: str, tip: str):
    """Grafik PNG dön. Tip: 'winprob-kar', 'rakipler', 'sd-dagilimi'."""
    if tip not in {"winprob-kar", "rakipler", "sd-dagilimi"}:
        raise HTTPException(status_code=400, detail="Geçersiz tip")
    path = GRAFIK_DIR / token / f"{tip}.png"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Grafik bulunamadı")
    return FileResponse(path, media_type="image/png")


@app.get("/api/kartel-rapor", response_model=KartelRaporResponse)
def kartel_rapor(
    min_skor: float = Query(30.0, description="Çift listesinde minimum skor"),
    grup_min_skor: float = Query(75.0, description="Network grubu için minimum skor"),
    top: int = Query(20, ge=1, le=200, description="Kaç çift döndürülsün"),
    refresh: bool = Query(False, description="Cache'i atla, yeniden hesapla"),
):
    """Kartel detection — 5-sinyalli skor + network grupları (1 saat cache)."""
    cache_key = f"kartel:{min_skor}:{grup_min_skor}:{top}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    cfg = Config.load()
    my_firms = load_my_firms()
    df = get_dataframe()

    ciftler = hesapla_kartel(df=df, my_firms=my_firms, cfg=cfg, min_skor=min_skor)

    # Kategori sayıları
    sayim = {"Kartel Şüphesi": 0, "Orta Bağ": 0, "Zayıf Bağ": 0, "Bağımsız": 0}
    for c in ciftler:
        sayim[c.kategori] = sayim.get(c.kategori, 0) + 1

    gruplar = kartel_gruplari_olustur(ciftler, min_skor=grup_min_skor)

    response = KartelRaporResponse(
        toplam_cift=len(ciftler),
        kartel_supheli_sayisi=sayim["Kartel Şüphesi"],
        orta_bag_sayisi=sayim["Orta Bağ"],
        zayif_bag_sayisi=sayim["Zayıf Bağ"],
        en_yuksek_ciftler=[
            CiftDto(
                firma_a=c.firma_a_ad,
                firma_b=c.firma_b_ad,
                firma_a_kanon=c.firma_a_kanon,
                firma_b_kanon=c.firma_b_kanon,
                toplam_skor=c.toplam_skor,
                kategori=c.kategori,
                ortak_ihale=c.ortak_ihale,
                a_toplam=c.a_toplam_ihale,
                b_toplam=c.b_toplam_ihale,
                lift=c.lift,
                tenzilat_medyan_fark=c.tenzilat_medyan_fark,
                tenzilat_esik_alti_pct=round(c.tenzilat_esik_alti_orani * 100, 1),
                teklif_cv=c.teklif_orani_cv,
                en_yogun_idare_orani=c.en_yogun_idare_orani,
                a_kazanma=c.a_kazanma,
                b_kazanma=c.b_kazanma,
            )
            for c in ciftler[:top]
        ],
        gruplar=[
            KartelGrupDto(
                grup_id=g.grup_id,
                firmalar=g.firma_adlari,
                kanonikler=g.firmalar,
                cift_sayisi=g.cift_sayisi,
                ortalama_skor=g.ortalama_skor,
                paylaşilan_idareler=g.paylaşilan_idareler,
            )
            for g in gruplar
        ],
    )
    cache_set(cache_key, response)
    return response


@app.get("/api/sniper-rapor", response_model=SniperRaporResponse)
def sniper_rapor(
    sadece_sniper: bool = Query(True, description="Sadece sniper firmaları döndür"),
    sadece_ultra: bool = Query(False, description="Sadece ultra sniperları"),
    refresh: bool = Query(False, description="Cache'i atla"),
):
    """Sniper firmalar — sınır değere çok yakın teklif veren firmalar (1 saat cache)."""
    cache_key = f"sniper:{sadece_sniper}:{sadece_ultra}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    cfg = Config.load()
    my_firms = load_my_firms()
    df = get_dataframe()

    karneler_dict = hesapla_sniper(df=df, my_firms=my_firms, cfg=cfg)

    sniper_n = sum(1 for k in karneler_dict.values() if k.is_sniper)
    ultra_n = sum(1 for k in karneler_dict.values() if k.is_ultra_sniper)

    karneler = list(karneler_dict.values())
    if sadece_ultra:
        karneler = [k for k in karneler if k.is_ultra_sniper]
    elif sadece_sniper:
        karneler = [k for k in karneler if k.is_sniper]

    # En yakın olanlar üstte
    karneler.sort(key=lambda k: k.global_ortalama_yakinlik_pct)

    response = SniperRaporResponse(
        toplam_firma=len(karneler_dict),
        sniper_sayisi=sniper_n,
        ultra_sniper_sayisi=ultra_n,
        firmalar=[
            SniperFirmaDto(
                firma_adi=k.firma_adi,
                firma_kanon=k.firma_kanon,
                etiket=k.etiket,
                toplam_ihale=k.toplam_ihale,
                is_sniper=k.is_sniper,
                is_ultra_sniper=k.is_ultra_sniper,
                global_ortalama_yakinlik_pct=k.global_ortalama_yakinlik_pct,
                global_std_pct=k.global_std_pct,
                en_yakin_teklif_pct=k.en_yakin_teklif_pct,
                sniper_idareler=[
                    SniperIdareDto(
                        idare_adi=i.idare_adi,
                        toplam_ihale=i.toplam_ihale,
                        in_band_sayisi=i.in_band_sayisi,
                        in_band_orani=i.in_band_orani,
                        ortalama_yakinlik_pct=i.ortalama_yakinlik_pct,
                    )
                    for i in k.sniper_idareler
                ],
            )
            for k in karneler
        ],
    )
    cache_set(cache_key, response)
    return response


@app.get("/api/rakip-karneleri", response_model=RakipKarneResponse)
def rakip_karneleri(
    sadece_rakip: bool = Query(True, description="Sadece COMPETITOR (kendi firmaları hariç)"),
    refresh: bool = Query(False, description="Cache'i atla"),
):
    """Rakip karneleri — deneyim + kazanma + sniper birleşik (1 saat cache)."""
    cache_key = f"rakip-karne:{sadece_rakip}"
    if not refresh:
        cached = cache_get(cache_key)
        if cached is not None:
            return cached

    cfg = Config.load()
    my_firms = load_my_firms()

    profiller_dict = hesapla_rakip_profilleri(my_firms=my_firms, cfg=cfg)

    # Toplulaştırmacı tespiti: bir firma toplam ihale sayısının %70+'ına katılmış mı
    df = get_dataframe()
    toplam_ihale = df["ihale_id"].nunique() if not df.empty else 0
    taban_oran = float(cfg.get("toplulaştırmacı.taban_oran", 0.70))

    karneler = []
    for p in profiller_dict.values():
        if sadece_rakip and p.etiket == "SELF":
            continue
        kazanma_orani = (p.kazandigi_ihale_sayisi / p.ihale_sayisi) if p.ihale_sayisi > 0 else 0.0
        is_toplulastirmaci = (
            toplam_ihale > 0 and
            (p.ihale_sayisi / toplam_ihale) >= taban_oran
        )
        karneler.append(RakipKarneDto(
            firma_adi=p.firma_adi,
            firma_kanon=p.firma_kanon,
            etiket=p.etiket,
            toplam_ihale=p.ihale_sayisi,
            toplam_kazanma=p.kazandigi_ihale_sayisi,
            kazanma_orani=round(kazanma_orani, 4),
            ortalama_tenzilat=p.ortalama_tenzilat or 0.0,
            deneyim_tutari=p.max_teklif_bugun,
            is_sniper=p.is_sniper,
            is_ultra_sniper=p.is_ultra_sniper,
            is_toplulastirmaci=is_toplulastirmaci,
        ))

    karneler.sort(key=lambda k: -k.toplam_ihale)
    response = RakipKarneResponse(karneler=karneler)
    cache_set(cache_key, response)
    return response


# ===========================================
# Manuel Birlikte Hareket Grupları
# ===========================================
def _load_manuel_gruplar() -> list[dict]:
    if not MANUEL_GRUP_FILE.exists():
        return []
    try:
        return json.loads(MANUEL_GRUP_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save_manuel_gruplar(gruplar: list[dict]) -> None:
    MANUEL_GRUP_FILE.write_text(
        json.dumps(gruplar, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@app.get("/api/birlikte-hareket", response_model=list[ManuelGrup])
def birlikte_hareket_listele():
    """Kullanıcının manuel olarak işaretlediği 'birlikte hareket' grupları."""
    return _load_manuel_gruplar()


@app.post("/api/birlikte-hareket", response_model=ManuelGrup)
def birlikte_hareket_olustur(req: ManuelGrupRequest):
    """Yeni manuel grup oluştur."""
    gruplar = _load_manuel_gruplar()
    yeni = {
        "id": uuid.uuid4().hex[:12],
        "grup_adi": req.grup_adi,
        "firmalar": [kanonik_firma_adi(f) for f in req.firmalar],
        "aciklama": req.aciklama,
        "olusturma_tarihi": datetime.now().isoformat(),
        "guncelleme_tarihi": datetime.now().isoformat(),
    }
    gruplar.append(yeni)
    _save_manuel_gruplar(gruplar)
    return yeni


@app.put("/api/birlikte-hareket/{grup_id}", response_model=ManuelGrup)
def birlikte_hareket_guncelle(grup_id: str, req: ManuelGrupRequest):
    """Mevcut manuel grubu güncelle."""
    gruplar = _load_manuel_gruplar()
    for g in gruplar:
        if g["id"] == grup_id:
            g["grup_adi"] = req.grup_adi
            g["firmalar"] = [kanonik_firma_adi(f) for f in req.firmalar]
            g["aciklama"] = req.aciklama
            g["guncelleme_tarihi"] = datetime.now().isoformat()
            _save_manuel_gruplar(gruplar)
            return g
    raise HTTPException(status_code=404, detail="Grup bulunamadı")


@app.delete("/api/birlikte-hareket/{grup_id}")
def birlikte_hareket_sil(grup_id: str):
    """Manuel grubu sil."""
    gruplar = _load_manuel_gruplar()
    yeni_liste = [g for g in gruplar if g["id"] != grup_id]
    if len(yeni_liste) == len(gruplar):
        raise HTTPException(status_code=404, detail="Grup bulunamadı")
    _save_manuel_gruplar(yeni_liste)
    return {"silindi": grup_id}


@app.get("/api/firma-arama")
def firma_arama(
    q: str = Query(..., min_length=2, description="Firma adı arama"),
    limit: int = Query(20, ge=1, le=100),
):
    """Firma adı arama — manuel grup formu için autocomplete."""
    df = get_dataframe()
    q_kanon = kanonik_firma_adi(q)

    sonuc: dict[str, str] = {}  # kanonik → en uzun display
    for _, r in df.iterrows():
        firmalar = r.get("firmalar") or []
        firmalar_kanon = r.get("firmalar_kanon") or []
        for f, fk in zip(firmalar, firmalar_kanon):
            if not fk:
                continue
            if q_kanon in fk:
                if fk not in sonuc or len(f) > len(sonuc[fk]):
                    sonuc[fk] = f
                if len(sonuc) >= limit * 3:
                    break
        if len(sonuc) >= limit * 3:
            break

    return [
        {"firma_kanon": k, "firma_adi": v}
        for k, v in list(sonuc.items())[:limit]
    ]


# ===========================================
# Root
# ===========================================
@app.get("/")
def root():
    return {
        "service": "İhale-AI API",
        "version": "1.0.0",
        "endpoints": [
            "/api/health",
            "/api/idareler",
            "/api/savas-simulasyonu",
            "/api/kartel-rapor",
            "/api/sniper-rapor",
            "/api/rakip-karneleri",
            "/api/birlikte-hareket",
            "/api/firma-arama",
        ],
        "docs": "/docs",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.server:app", host="0.0.0.0", port=8000, reload=True)
