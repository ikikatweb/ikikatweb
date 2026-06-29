"""Rakip Karneleri Raporu — birleşik (deneyim + sniper) detaylı tablo.

Kullanım:
    python -m scripts.rakip_karneleri
    python -m scripts.rakip_karneleri --top 50
    python -m scripts.rakip_karneleri --excel rakip-karneleri.xlsx
    python -m scripts.rakip_karneleri --only-sniper
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from core.config import prompt_my_firms_if_missing
from intelligence.profiling import (
    hesapla_rakip_profilleri, profilleri_to_dataframe,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rakip Karneleri Raporu")
    parser.add_argument("--top", type=int, default=30, help="Kaç firma gösterilsin (default: 30)")
    parser.add_argument("--excel", type=str, default=None, help="Excel çıktı")
    parser.add_argument("--only-sniper", action="store_true", help="Sadece sniper firmalar")
    parser.add_argument("--only-self", action="store_true", help="Sadece SELF firmalar")
    args = parser.parse_args()

    print("=" * 70)
    print("  📋 RAKİP KARNELERİ — Deneyim + Sniper Birleşik")
    print("=" * 70)

    my_firms = prompt_my_firms_if_missing()
    print(f"\nKontrolünüzdeki firmalar: {my_firms}\n")

    print("Hesaplanıyor (deneyim + sniper)...")
    profiller = hesapla_rakip_profilleri(my_firms=my_firms)
    if not profiller:
        print("⚠ Veri yok.")
        return 1

    df = profilleri_to_dataframe(profiller)

    # Filtreler
    if args.only_sniper:
        df = df[df["is_sniper"] == True]
    if args.only_self:
        df = df[df["etiket"] == "SELF"]

    print(f"\nToplam profil: {len(df)}")
    print(f"  ⚠ Sniper:        {(df['is_sniper'] == True).sum()}")
    print(f"  🚨 Ultra Sniper:  {(df['is_ultra_sniper'] == True).sum()}")
    print(f"  💼 SELF:         {(df['etiket'] == 'SELF').sum()}")
    print(f"  🤝 JV geçmişli:  {(df['jv_geçmisi_var'] == True).sum()}")
    print()

    # Konsol gösterimi
    print(f"--- En Büyük {args.top} Firma ---")
    print(
        f"{'#':>3} {'Firma':<42} {'İhale':>5} {'Kazandı':>7} "
        f"{'Deneyim (M TL)':>14} {'Ort.Tenz':>8} {'Sniper':>6} {'Etiket':<10}"
    )
    print("-" * 110)

    sirali = df.head(args.top)
    for i, (_, r) in enumerate(sirali.iterrows(), 1):
        firma = r["firma_adi"][:40] if len(str(r["firma_adi"])) > 40 else r["firma_adi"]
        deneyim_m = r["max_teklif_bugun"] / 1_000_000  # milyon TL
        tenz = f"%{r['ortalama_tenzilat']:.1f}" if pd.notna(r['ortalama_tenzilat']) else "—"
        if r["is_ultra_sniper"]:
            sniper_bayrak = "🚨"
        elif r["is_sniper"]:
            sniper_bayrak = "⚠"
        else:
            sniper_bayrak = "—"
        print(
            f"{i:>3} {firma:<42} {r['ihale_sayisi']:>5} "
            f"{r['kazandigi_ihale_sayisi']:>7} "
            f"{deneyim_m:>14,.1f} {tenz:>8} {sniper_bayrak:>6} {r['etiket']:<10}"
        )

    # SELF özet
    self_df = df[df["etiket"] == "SELF"]
    if not self_df.empty and not args.only_sniper:
        print()
        print("--- BİZ (SELF) ---")
        for _, r in self_df.iterrows():
            tenz = f"%{r['ortalama_tenzilat']:.1f}" if pd.notna(r['ortalama_tenzilat']) else "—"
            sniper_str = ""
            if r["is_sniper"]:
                sniper_str = " 🎯 BİZ DE SNIPER!" if r["is_ultra_sniper"] else " ⚠ Hassas teklif"
            print(
                f"  {r['firma_adi'][:50]:<50} "
                f"İhale: {r['ihale_sayisi']:>3}  "
                f"Deneyim: {r['max_teklif_bugun']:>15,.0f} TL  "
                f"Ort.Tenz: {tenz}{sniper_str}"
            )

    # Excel çıktı (geniş — tüm kolonlar)
    if args.excel:
        out = Path(args.excel)
        with pd.ExcelWriter(out, engine="openpyxl") as writer:
            # Tab 1: Tüm rakipler
            df.to_excel(writer, sheet_name="Tüm Rakipler", index=False)

            # Tab 2: Sadece sniperlar
            sniper_df = df[df["is_sniper"] == True].copy()
            if not sniper_df.empty:
                sniper_df.to_excel(writer, sheet_name="Sniperlar", index=False)

            # Tab 3: Sadece SELF
            self_df = df[df["etiket"] == "SELF"].copy()
            if not self_df.empty:
                self_df.to_excel(writer, sheet_name="Biz (SELF)", index=False)

            # Kolon genişlikleri
            for sheet_name in writer.sheets:
                ws = writer.sheets[sheet_name]
                for col_idx, col in enumerate(df.columns, 1):
                    if col_idx > 26:
                        col_letter = "A" + chr(64 + col_idx - 26)
                    else:
                        col_letter = chr(64 + col_idx)
                    try:
                        ws.column_dimensions[col_letter].width = 22
                    except Exception:
                        pass
        print(f"\n✓ Excel kaydedildi: {out.absolute()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
