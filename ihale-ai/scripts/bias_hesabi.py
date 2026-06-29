"""Kurumsal sapma (Bias Factor) hesabı + raporu.

Kullanım:
    python -m scripts.bias_hesabi
"""
from __future__ import annotations
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from intelligence.bias import hesapla_bias, kaydet_history, yazdir_rapor
from intelligence.yi_ufe import yi_ufe_summary


def main() -> int:
    print("=" * 60)
    print("  KURUMSAL SAPMA RAPORU + Yi-ÜFE DURUMU")
    print("=" * 60)

    # 1. Yi-ÜFE durumu
    print("\n[1] Yi-ÜFE Tablosu...")
    yi_summary = yi_ufe_summary()
    if yi_summary.get("ok"):
        print(f"  ✓ {yi_summary['kayit_sayisi']} kayıt")
        print(f"  ✓ Aralık: {yi_summary['en_eski_ay']} → {yi_summary['en_yeni_ay']}")
        print(f"  ✓ Kümülatif artış: %{yi_summary['toplam_kumulatif_artis_pct']}")
    else:
        print(f"  ⚠ {yi_summary.get('msg')}")

    # 2. Bias Factor
    print("\n[2] Bias Factor Hesaplanıyor...")
    result = hesapla_bias()
    if result is None:
        print("  ✗ Hesap yapılamadı (Bizim_YM dolu olan ihale yok)")
        return 1

    print()
    yazdir_rapor(result)

    # 3. Tarihçeye kaydet
    kaydet_history(result)
    print(f"\n✓ Tarihçeye kaydedildi: data/bias_history.json")

    return 0


if __name__ == "__main__":
    sys.exit(main())
