"""Kartel Detection Raporu — 5-sinyalli skor + network grupları.

Kullanım:
    python -m scripts.kartel_raporu
    python -m scripts.kartel_raporu --excel kartel-rapor.xlsx
    python -m scripts.kartel_raporu --min-skor 50      # sadece 50+ skorlu çiftler
    python -m scripts.kartel_raporu --grup-min-skor 75 # network gruplaması için min eşik
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from core.config import prompt_my_firms_if_missing, Config
from intelligence.collusion import (
    hesapla_kartel, kartel_gruplari_olustur,
    ciftleri_to_dataframe,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Kartel Detection Raporu")
    parser.add_argument("--min-skor", type=float, default=30.0, help="Çift listesinde min skor (default 30)")
    parser.add_argument("--grup-min-skor", type=float, default=75.0, help="Kartel grubu için min skor (default 75)")
    parser.add_argument("--excel", type=str, default=None, help="Excel çıktı dosyası")
    parser.add_argument("--top", type=int, default=20, help="Konsolda kaç çift gösterilsin")
    args = parser.parse_args()

    print("=" * 70)
    print("  🔍 KARTEL DETECTION RAPORU — 5 Sinyal Skoru")
    print("=" * 70)

    cfg = Config.load()
    my_firms = prompt_my_firms_if_missing()

    print(f"\nKontrolünüzdeki firmalar: {my_firms}")
    print(f"\nEşikler:")
    print(f"  - Min ortak ihale:       {cfg.get('kartel.min_ortak_ihale')}")
    print(f"  - Tenzilat fark eşiği:   %{cfg.get('kartel.tenzilat.fark_esigi_pct')}")
    print(f"  - Toplulaştırmacı taban: %{int(cfg.get('toplulaştırmacı.taban_oran') * 100)}")
    print(f"\nAğırlıklar (toplam 100):")
    weights = cfg.get("kartel.skor_agirliklari", {}) or {}
    print(f"  - Lift:           {weights.get('lift')}")
    print(f"  - Tenzilat:       {weights.get('tenzilat')}  ⭐")
    print(f"  - Teklif oranı:   {weights.get('teklif_orani')}")
    print(f"  - Rotasyon:       {weights.get('rotasyon')}")
    print(f"  - İdare:          {weights.get('idare')}")
    print()
    print(f"Min skor (çift listesi): {args.min_skor}")
    print(f"Min skor (kartel grubu): {args.grup_min_skor}")
    print()

    print("Hesaplanıyor (büyük dataset için 30-60 saniye sürebilir)...")
    ciftler = hesapla_kartel(my_firms=my_firms, cfg=cfg, min_skor=args.min_skor)

    if not ciftler:
        print("\n  → Pozitif kartel sinyali bulunamadı.")
        return 0

    # Kategori sayıları
    kategori_sayisi = {}
    for c in ciftler:
        kategori_sayisi[c.kategori] = kategori_sayisi.get(c.kategori, 0) + 1

    print()
    print("=" * 70)
    print(f"  📊 SONUÇ — {len(ciftler)} pozitif çift")
    print("=" * 70)
    for kat in ["Kartel Şüphesi", "Orta Bağ", "Zayıf Bağ", "Bağımsız"]:
        n = kategori_sayisi.get(kat, 0)
        emoji = "🚨" if kat == "Kartel Şüphesi" else "⚠ " if kat == "Orta Bağ" else "🟡" if kat == "Zayıf Bağ" else "—"
        print(f"  {emoji} {kat}: {n}")

    # Top N şüpheli çift
    print()
    print("=" * 70)
    print(f"  🔥 TOP {min(args.top, len(ciftler))} ŞÜPHELİ ÇİFT")
    print("=" * 70)
    for i, c in enumerate(ciftler[:args.top], 1):
        emoji = "🚨" if c.kategori == "Kartel Şüphesi" else "⚠ " if c.kategori == "Orta Bağ" else "🟡"
        print()
        print(f"{i:>3}. {emoji} {c.firma_a_ad[:38]:<38} ↔ {c.firma_b_ad[:38]}")
        print(f"     SKOR: {c.toplam_skor:>5.1f}/100  [{c.kategori}]  "
              f"Ortak ihale: {c.ortak_ihale}/{min(c.a_toplam_ihale, c.b_toplam_ihale)}")
        print(f"     Lift={c.lift:.2f}({c.lift_skoru:.0f})  "
              f"Tenz med fark=%{c.tenzilat_medyan_fark:.3f}({c.tenzilat_skoru:.0f})  "
              f"CV={c.teklif_orani_cv:.3f}({c.teklif_skoru:.0f})  "
              f"İdare={c.en_yogun_idare_orani*100:.0f}%({c.idare_skoru:.0f})")
        # Tenzilat detayı varsa
        if c.tenzilat_esik_alti_orani > 0:
            print(f"     ⭐ {int(c.tenzilat_esik_alti_orani*100)}% ihalede tenzilat farkı %0.15 altında")

    # Network grupları
    print()
    print("=" * 70)
    print(f"  🕸️  NETWORK ANALİZİ — Otomatik Kartel Grupları (min skor {args.grup_min_skor})")
    print("=" * 70)
    gruplar = kartel_gruplari_olustur(ciftler, min_skor=args.grup_min_skor)

    if not gruplar:
        print(f"\n  → {args.grup_min_skor}+ skorlu çiftlerden grup oluşturulamadı.")
    else:
        for g in gruplar:
            print()
            print(f"  Grup #{g.grup_id}: {len(g.firmalar)} firma  |  Ort. skor: {g.ortalama_skor:.1f}  |  Çift: {g.cift_sayisi}")
            for f in g.firma_adlari[:8]:
                print(f"     • {f}")
            if len(g.firma_adlari) > 8:
                print(f"     • ... +{len(g.firma_adlari)-8} firma daha")
            if g.paylaşilan_idareler:
                print(f"     Yoğun idareler: {', '.join(g.paylaşilan_idareler[:3])}")

    # Excel çıktı
    if args.excel:
        df_ciftler = ciftleri_to_dataframe(ciftler)
        out = Path(args.excel)
        with pd.ExcelWriter(out, engine="openpyxl") as writer:
            # Sheet 1: Tüm Çiftler
            df_ciftler.to_excel(writer, sheet_name="Tüm Çiftler", index=False)

            # Sheet 2: Sadece Kartel Şüphesi
            df_kartel = df_ciftler[df_ciftler["Kategori"] == "Kartel Şüphesi"]
            if not df_kartel.empty:
                df_kartel.to_excel(writer, sheet_name="Kartel Şüphesi", index=False)

            # Sheet 3: Network Grupları
            grup_rows = []
            for g in gruplar:
                grup_rows.append({
                    "Grup ID": g.grup_id,
                    "Firma Sayısı": len(g.firmalar),
                    "Çift Sayısı": g.cift_sayisi,
                    "Ortalama Skor": g.ortalama_skor,
                    "Firmalar": " | ".join(g.firma_adlari),
                    "Paylaşılan İdareler": " | ".join(g.paylaşilan_idareler),
                })
            if grup_rows:
                pd.DataFrame(grup_rows).to_excel(writer, sheet_name="Kartel Grupları", index=False)

            # Sheet kolon genişlikleri
            for sheet in writer.sheets.values():
                for col in sheet.columns:
                    col_letter = col[0].column_letter if col else "A"
                    try:
                        sheet.column_dimensions[col_letter].width = 22
                    except Exception:
                        pass
        print(f"\n✓ Excel kaydedildi: {out.absolute()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
