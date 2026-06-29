"""
Görselleştirme — Monte Carlo savaş simülasyonu için matplotlib grafikler.

3 panel:
    1. Sınır Değer dağılımı histogramı (Monte Carlo P10/P50/P90)
    2. Tenzilat vs Win Prob curve (knee point'i görsel)
    3. Tenzilat vs Beklenen Kar (optimum tepe görsel)

Çıktı: PNG dosyası (Excel'e gömme yerine ayrı dosya).
"""
from __future__ import annotations
from pathlib import Path
import logging

import numpy as np
import matplotlib
matplotlib.use("Agg")  # Headless / Windows uyumluluğu
import matplotlib.pyplot as plt

from intelligence.simulation import SimulasyonSonuc, OptimumSonuc, IhaleSenaryosu

log = logging.getLogger(__name__)

# Türkçe karakter desteği için font fallback
plt.rcParams["font.family"] = ["DejaVu Sans", "Arial", "sans-serif"]
plt.rcParams["axes.unicode_minus"] = False


def _format_para(x: float, _: int = 0) -> str:
    """Tutar formatı — milyonlarda kısaltma."""
    if abs(x) >= 1_000_000:
        return f"{x/1_000_000:.1f}M"
    if abs(x) >= 1_000:
        return f"{x/1_000:.0f}K"
    return f"{x:.0f}"


def grafik_sd_dagilimi(
    senaryolar: list[IhaleSenaryosu],
    yaklasik_maliyet: float,
    bizim_teklif: float | None = None,
    title_suffix: str = "",
    out_path: str | Path = "sd-dagilimi.png",
) -> Path:
    """Sınır Değer dağılımı histogramı.

    Args:
        senaryolar: monte_carlo_simulasyon iç dökümünden senaryolar (dışarı açıldıysa).
                   Eğer SimulasyonSonuc'tan da çıkarılabilir, ama burada raw senaryolar.
        yaklasik_maliyet: YM (TL) — referans çizgi.
        bizim_teklif: Bizim teklif (varsa) — referans çizgi.
        out_path: PNG dosya yolu.
    """
    sd_arr = np.array([s.sinir_deger for s in senaryolar if s.sinir_deger > 0])
    if len(sd_arr) == 0:
        log.warning("SD dizisi boş — grafik çizilmedi")
        return Path(out_path)

    fig, ax = plt.subplots(figsize=(10, 6))
    ax.hist(sd_arr / 1_000_000, bins=40, color="#4A90E2", edgecolor="black", alpha=0.7)

    # Percentile çizgileri
    p10, p50, p90 = np.percentile(sd_arr, [10, 50, 90])
    ax.axvline(p50 / 1_000_000, color="#27AE60", linestyle="--", linewidth=2,
               label=f"P50 (medyan): {p50/1_000_000:.2f}M")
    ax.axvline(p10 / 1_000_000, color="#F39C12", linestyle=":", linewidth=1.5,
               label=f"P10: {p10/1_000_000:.2f}M")
    ax.axvline(p90 / 1_000_000, color="#F39C12", linestyle=":", linewidth=1.5,
               label=f"P90: {p90/1_000_000:.2f}M")

    # Bizim teklif
    if bizim_teklif is not None and bizim_teklif > 0:
        ax.axvline(bizim_teklif / 1_000_000, color="#E74C3C", linewidth=2.5,
                   label=f"Bizim teklif: {bizim_teklif/1_000_000:.2f}M")

    # YM
    ax.axvline(yaklasik_maliyet / 1_000_000, color="#9B59B6", linestyle="-.",
               linewidth=1.5, alpha=0.7,
               label=f"YM: {yaklasik_maliyet/1_000_000:.2f}M")

    ax.set_xlabel("Sınır Değer (Milyon TL)", fontsize=11)
    ax.set_ylabel("Senaryo Sayısı", fontsize=11)
    ax.set_title(f"Sınır Değer Dağılımı — Monte Carlo (n={len(sd_arr)})\n{title_suffix}",
                 fontsize=12, fontweight="bold")
    ax.legend(loc="best", fontsize=9)
    ax.grid(True, alpha=0.3)
    plt.tight_layout()

    out = Path(out_path)
    plt.savefig(out, dpi=120, bbox_inches="tight")
    plt.close(fig)
    log.info(f"SD dağılımı grafiği kaydedildi: {out.absolute()}")
    return out


def grafik_winprob_kar_curve(
    opt: OptimumSonuc,
    title_suffix: str = "",
    out_path: str | Path = "winprob-kar.png",
) -> Path:
    """Tek figürde 3 panel:
        - Tenzilat vs Win Prob
        - Tenzilat vs SD Altı Kalma %
        - Tenzilat vs Beklenen Kar (TL)

    Üzerinde optimum tenzilat işaretlenir.
    """
    tenz = np.array([s.bizim_tenzilat for s in opt.sonuclar])
    win = np.array([s.kazanma_olasiligi * 100 for s in opt.sonuclar])
    sinir_alti = np.array([s.sinir_alti_olasiligi * 100 for s in opt.sonuclar])
    kar = np.array([s.beklenen_kar for s in opt.sonuclar])

    fig, axes = plt.subplots(3, 1, figsize=(11, 10), sharex=True)

    # 1. Win Prob
    ax1 = axes[0]
    ax1.plot(tenz, win, "o-", color="#27AE60", linewidth=2, markersize=5)
    ax1.fill_between(tenz, 0, win, alpha=0.2, color="#27AE60")
    ax1.axvline(opt.onerilen_tenzilat, color="#E74C3C", linestyle="--", linewidth=1.5,
                label=f"Öneri: %{opt.onerilen_tenzilat}")
    ax1.set_ylabel("Win Prob (%)", fontsize=11)
    ax1.set_title(f"Kazanma Olasılığı vs Tenzilat\n{title_suffix}", fontsize=12, fontweight="bold")
    ax1.legend(loc="best", fontsize=9)
    ax1.grid(True, alpha=0.3)

    # 2. Sınır Altı Kalma
    ax2 = axes[1]
    ax2.plot(tenz, sinir_alti, "o-", color="#E67E22", linewidth=2, markersize=5)
    ax2.fill_between(tenz, 0, sinir_alti, alpha=0.2, color="#E67E22")
    ax2.axvline(opt.onerilen_tenzilat, color="#E74C3C", linestyle="--", linewidth=1.5)
    ax2.axhline(50, color="gray", linestyle=":", linewidth=1, alpha=0.5)
    ax2.set_ylabel("SD Altı Kalma (%)", fontsize=11)
    ax2.set_title("Risk: Bizim Teklif Sınır Değerin Altına Düşme Olasılığı", fontsize=11)
    ax2.grid(True, alpha=0.3)

    # 3. Beklenen Kar
    ax3 = axes[2]
    colors = ["#27AE60" if k > 0 else "#E74C3C" for k in kar]
    ax3.bar(tenz, kar, width=0.7, color=colors, alpha=0.7, edgecolor="black", linewidth=0.5)
    ax3.axvline(opt.onerilen_tenzilat, color="#E74C3C", linestyle="--", linewidth=1.5,
                label=f"Optimum: %{opt.onerilen_tenzilat}")
    ax3.axhline(0, color="black", linewidth=0.8)
    ax3.set_xlabel("Tenzilat (%)", fontsize=11)
    ax3.set_ylabel("Beklenen Kar (TL)", fontsize=11)
    ax3.set_title("Beklenen Kar = Win Prob × Kar(Kazanıldığında)", fontsize=11)
    ax3.yaxis.set_major_formatter(plt.FuncFormatter(_format_para))
    ax3.legend(loc="best", fontsize=9)
    ax3.grid(True, alpha=0.3, axis="y")

    plt.tight_layout()
    out = Path(out_path)
    plt.savefig(out, dpi=120, bbox_inches="tight")
    plt.close(fig)
    log.info(f"Win/Kar curve grafiği kaydedildi: {out.absolute()}")
    return out


def grafik_rakip_dagilimi(
    rakipler: list,  # list[RakipParam]
    bizim_tenzilat: float | None = None,
    out_path: str | Path = "rakip-dagilimi.png",
) -> Path:
    """Rakiplerin tenzilat dağılımları — yatay error bar.

    Her rakip için μ ± σ aralığı, ortalama nokta. Sniperlar farklı renkte.
    """
    if not rakipler:
        log.warning("Rakip listesi boş")
        return Path(out_path)

    # Sırala ortalama tenzilata göre
    rakipler_sorted = sorted(rakipler, key=lambda r: r.mu)
    mu_arr = np.array([r.mu for r in rakipler_sorted])
    sigma_arr = np.array([r.sigma for r in rakipler_sorted])
    n_arr = np.array([r.n_gozlem for r in rakipler_sorted])
    isimler = [r.firma_ad[:35] for r in rakipler_sorted]
    snipers = [r.is_sniper and r.sniper_idare_match for r in rakipler_sorted]

    y_pos = np.arange(len(rakipler_sorted))

    fig, ax = plt.subplots(figsize=(11, max(5, 0.32 * len(rakipler_sorted) + 2)))
    colors = ["#E74C3C" if s else "#3498DB" for s in snipers]

    # Error bar
    for i, (mu, sigma, c) in enumerate(zip(mu_arr, sigma_arr, colors)):
        ax.errorbar(mu, i, xerr=sigma, fmt="o", color=c, capsize=4, markersize=8,
                    linewidth=1.5, alpha=0.85)
        # n etiketi
        ax.text(mu + sigma + 0.3, i, f"n={n_arr[i]}",
                fontsize=8, va="center", color="gray")

    if bizim_tenzilat is not None:
        ax.axvline(bizim_tenzilat, color="#27AE60", linestyle="--", linewidth=2,
                   label=f"Bizim teklif: %{bizim_tenzilat}")

    ax.set_yticks(y_pos)
    ax.set_yticklabels(isimler, fontsize=8)
    ax.set_xlabel("Tenzilat (%) — μ ± σ", fontsize=11)
    ax.set_title("Rakip Tenzilat Profili (Geçmiş Veri)\nKırmızı: Sniper-İdare match  |  Mavi: Normal",
                 fontsize=11, fontweight="bold")
    ax.grid(True, alpha=0.3, axis="x")
    if bizim_tenzilat is not None:
        ax.legend(loc="best", fontsize=9)

    plt.tight_layout()
    out = Path(out_path)
    plt.savefig(out, dpi=120, bbox_inches="tight")
    plt.close(fig)
    log.info(f"Rakip dağılımı grafiği kaydedildi: {out.absolute()}")
    return out


def tum_grafikleri_uret(
    opt: OptimumSonuc,
    rakipler: list,
    yaklasik_maliyet: float,
    out_dir: str | Path = ".",
    prefix: str = "savas",
    title_suffix: str = "",
) -> list[Path]:
    """Tüm grafikleri tek seferde üret. SD histogramı için en iyi senaryolar gerekli —
    bu yüzden burada üretilemez. Ana 2 grafik üretilir."""
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    paths = []

    # 1. Win prob / kar curve
    p1 = grafik_winprob_kar_curve(
        opt,
        title_suffix=title_suffix,
        out_path=out_dir / f"{prefix}-winprob-kar.png",
    )
    paths.append(p1)

    # 2. Rakip dağılımı
    p2 = grafik_rakip_dagilimi(
        rakipler,
        bizim_tenzilat=opt.onerilen_tenzilat,
        out_path=out_dir / f"{prefix}-rakipler.png",
    )
    paths.append(p2)

    return paths
