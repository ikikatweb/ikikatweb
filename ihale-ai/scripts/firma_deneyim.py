"""Tüm firmalar için iş deneyim belgesi raporu.

Kullanım:
    python -m scripts.firma_deneyim
    python -m scripts.firma_deneyim --excel firma-rapor.xlsx
    python -m scripts.firma_deneyim --top 50
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from core.config import prompt_my_firms_if_missing
from intelligence.experience import (
    hesapla_firma_deneyimleri, kaydet_tum_profileleri,
    deneyimleri_to_dataframe,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Firma deneyim raporu")
    parser.add_argument("--top", type=int, default=20, help="Konsolda kaç firma gösterilsin (default: 20)")
    parser.add_argument("--excel", type=str, default=None, help="Excel çıktı dosya yolu")
    parser.add_argument("--save-profiles", action="store_true", help="Her firma için JSON karne kaydet")
    args = parser.parse_args()

    # MY_FIRMS yoksa sor
    my_firms = prompt_my_firms_if_missing()
    print(f"\nKontrolünüzdeki firmalar: {my_firms}\n")

    print("=" * 60)
    print("  FIRMA DENEYİM RAPORU (Yi-ÜFE Düzeltmeli)")
    print("=" * 60)
    print()
    print("Hesaplama yapılıyor...")
    deneyimler = hesapla_firma_deneyimleri(my_firms=my_firms)

    if not deneyimler:
        print("⚠ Veri yok.")
        return 1

    df = deneyimleri_to_dataframe(deneyimler)
    print(f"Toplam firma: {len(df)}")
    print()

    # Konsolda göster
    print(f"--- En Büyük {args.top} Firma ---")
    print(f"{'#':>3} {'Firma':<40} {'İhale':>5} {'JV':>3} {'Kazandı':>7} {'Deneyim (Bugün TL)':>20} {'Ort.Tenz':>9} {'Etiket':<10}")
    print("-" * 110)
    for i, (_, r) in enumerate(df.head(args.top).iterrows(), 1):
        firma = r["firma_adi"][:38] if len(str(r["firma_adi"])) > 38 else r["firma_adi"]
        tenz = f"%{r['ortalama_tenzilat']:.1f}" if pd.notna(r['ortalama_tenzilat']) else "—"
        jv_mark = "✓" if r["jv_geçmisi_var"] else "—"
        print(
            f"{i:>3} {firma:<40} {r['ihale_sayisi']:>5} {jv_mark:>3} "
            f"{r['kazandigi_ihale_sayisi']:>7} "
            f"{r['max_teklif_bugun']:>20,.0f} {tenz:>9} {r['etiket']:<10}"
        )

    # SELF firmaları da ayrıca göster
    self_firms = df[df["etiket"] == "SELF"]
    if not self_firms.empty:
        print()
        print("--- BİZ (SELF) ---")
        for _, r in self_firms.iterrows():
            tenz = f"%{r['ortalama_tenzilat']:.1f}" if pd.notna(r['ortalama_tenzilat']) else "—"
            print(
                f"  {r['firma_adi']:<40} "
                f"İhale: {r['ihale_sayisi']:>3}  "
                f"Deneyim: {r['max_teklif_bugun']:>15,.0f} TL  "
                f"Ort.Tenz: {tenz}"
            )

    # Excel çıktı
    if args.excel:
        out_path = Path(args.excel)
        with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Firma Deneyim", index=False)
            # Kolon genişlikleri
            ws = writer.sheets["Firma Deneyim"]
            for col_idx, col in enumerate(df.columns, 1):
                max_len = max(
                    df[col].astype(str).map(len).max() if not df[col].empty else 0,
                    len(str(col))
                )
                ws.column_dimensions[chr(64 + col_idx)].width = min(max_len + 2, 50)
        print(f"\n✓ Excel kaydedildi: {out_path.absolute()}")

    # Profilleri JSON olarak kaydet
    if args.save_profiles:
        kaydet_tum_profileleri(deneyimler)

    return 0


if __name__ == "__main__":
    sys.exit(main())
