"""Sniper Firma Raporu — idare bazlı detaylı liste.

Kullanım:
    python -m scripts.sniper_raporu
    python -m scripts.sniper_raporu --excel sniper-rapor.xlsx
    python -m scripts.sniper_raporu --confidence HIGH       # sadece HIGH güven
    python -m scripts.sniper_raporu --ultra                 # sadece ultra
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from core.config import prompt_my_firms_if_missing, Config
from intelligence.profiling import (
    hesapla_sniper, kaydet_sniper_profileleri,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sniper Firma Raporu")
    parser.add_argument("--excel", type=str, default=None, help="Excel çıktı")
    parser.add_argument("--confidence", choices=["HIGH", "MEDIUM", "LOW", "ALL"],
                        default="ALL", help="Sadece bu confidence seviyesindeki firmalar")
    parser.add_argument("--ultra", action="store_true", help="Sadece ULTRA sniper'lar")
    parser.add_argument("--save-profiles", action="store_true", help="JSON karneleri kaydet")
    args = parser.parse_args()

    print("=" * 70)
    print("  🎯 SNIPER FIRMA RAPORU")
    print("=" * 70)

    cfg = Config.load()
    my_firms = prompt_my_firms_if_missing()

    print(f"\nKontrolünüzdeki firmalar: {my_firms}")
    print(f"\nEşikler:")
    print(f"  - In-band:       |T-SD|/SD < %{cfg.get('sniper.threshold_pct')}")
    print(f"  - Ultra:         |T-SD|/SD < %{cfg.get('sniper.ultra_threshold_pct')}")
    print(f"  - Min idare hit: {cfg.get('sniper.min_idare_hits')} ihale")
    print(f"  - Max global std: %{cfg.get('sniper.max_global_std_pct')}")
    print(f"  - Min toplam:    {cfg.get('sniper.min_total_ihale')} ihale")
    print()

    print("Hesaplanıyor...")
    karneler = hesapla_sniper(my_firms=my_firms, cfg=cfg)
    if not karneler:
        print("⚠ Veri yok veya SD verisi olan ihale bulunamadı.")
        return 1

    sniper_only = {k: v for k, v in karneler.items() if v.is_sniper}

    # Filtreler
    if args.confidence != "ALL":
        sniper_only = {k: v for k, v in sniper_only.items() if v.confidence == args.confidence}
    if args.ultra:
        sniper_only = {k: v for k, v in sniper_only.items() if v.is_ultra_sniper}

    print(f"\n📊 Özet:")
    print(f"  Toplam analiz edilen firma:  {len(karneler)}")
    print(f"  ⚠ Sniper firma sayısı:        {sum(1 for v in karneler.values() if v.is_sniper)}")
    print(f"  🚨 Ultra sniper:              {sum(1 for v in karneler.values() if v.is_ultra_sniper)}")
    if args.confidence != "ALL" or args.ultra:
        print(f"  Filtre sonrası gösterilen:   {len(sniper_only)}")

    if not sniper_only:
        print("\n  → Filtreye uyan sniper bulunamadı.")
        return 0

    # Sniper listesi (idare sayısı ve yakınlığa göre sıralı)
    sirali = sorted(
        sniper_only.values(),
        key=lambda s: (-len(s.sniper_idareler), s.global_ortalama_yakinlik_pct, -s.toplam_ihale)
    )

    print()
    print("=" * 70)
    print("  ⚠ SNIPER FIRMA LİSTESİ")
    print("=" * 70)

    for i, s in enumerate(sirali, 1):
        bayrak = "🚨" if s.is_ultra_sniper else "⚠ "
        etiket_str = f" [{s.etiket}]" if s.etiket == "SELF" else ""
        print()
        print(f"{i:>3}. {bayrak} {s.firma_adi}{etiket_str}")
        print(f"     Confidence: {s.confidence}  |  "
              f"Toplam ihale: {s.toplam_ihale}  |  "
              f"Ort. yakınlık: %{s.global_ortalama_yakinlik_pct:.3f}  |  "
              f"Std: %{s.global_std_pct:.3f}")
        print(f"     Sniper olduğu idareler ({len(s.sniper_idareler)}):")
        for si in s.sniper_idareler:
            ultra = "🚨 ULTRA" if si.is_ultra_idare else ""
            print(f"       • {si.idare_adi[:55]:<55} "
                  f"{si.in_band_sayisi}/{si.toplam_ihale} ihale ({si.in_band_orani*100:.0f}%)  "
                  f"ort: %{si.ortalama_yakinlik_pct:.3f}  "
                  f"min: %{si.min_yakinlik_pct:.3f} {ultra}")

    # Excel çıktı
    if args.excel:
        rows = []
        for s in sirali:
            for si in s.sniper_idareler:
                rows.append({
                    "Firma": s.firma_adi,
                    "Etiket": s.etiket,
                    "Idare": si.idare_adi,
                    "Toplam İhale (Bu İdarede)": si.toplam_ihale,
                    "In-Band Sayısı": si.in_band_sayisi,
                    "Oran %": round(si.in_band_orani * 100, 1),
                    "Ort. Yakınlık %": si.ortalama_yakinlik_pct,
                    "Min Yakınlık %": si.min_yakinlik_pct,
                    "Ultra?": "EVET" if si.is_ultra_idare else "",
                    "Confidence": s.confidence,
                    "Toplam İhale (Tüm Firma)": s.toplam_ihale,
                    "Global Ort. Yakınlık %": s.global_ortalama_yakinlik_pct,
                    "Global Std %": s.global_std_pct,
                })
        if rows:
            df = pd.DataFrame(rows)
            out = Path(args.excel)
            with pd.ExcelWriter(out, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Sniper Detaylı", index=False)
                ws = writer.sheets["Sniper Detaylı"]
                for col_idx, col in enumerate(df.columns, 1):
                    max_len = max(
                        df[col].astype(str).map(len).max() if not df[col].empty else 0,
                        len(str(col))
                    )
                    col_letter = chr(64 + col_idx) if col_idx <= 26 else "A" + chr(64 + col_idx - 26)
                    ws.column_dimensions[col_letter].width = min(max_len + 2, 50)
            print(f"\n✓ Excel kaydedildi: {out.absolute()}")

    if args.save_profiles:
        kaydet_sniper_profileleri(karneler)
        print("✓ Sniper profilleri JSON olarak kaydedildi.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
