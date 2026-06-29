"""DB bağlantısı + temel veri kontrolü.

Kullanım:
    cd ihale-ai
    python -m scripts.health_check
"""
from __future__ import annotations
import sys
from pathlib import Path

# ihale-ai klasörünü Python path'ine ekle
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import json
from core import db, Config


def main() -> int:
    print("=" * 60)
    print("  İHALE AI — Sağlık Kontrolü")
    print("=" * 60)

    # 1. Config yüklenir mi
    print("\n[1] Konfigürasyon...")
    try:
        cfg = Config.load()
        print(f"  ✓ Yüklendi: {cfg}")
        print(f"  ✓ Sniper threshold: %{cfg.get('sniper.threshold_pct')}")
        print(f"  ✓ Tenzilat eşiği: %{cfg.get('kartel.tenzilat.fark_esigi_pct')}")
    except Exception as e:
        print(f"  ✗ HATA: {e}")
        return 1

    # 2. DB bağlantı testi
    print("\n[2] DB Bağlantısı...")
    result = db.health_check()
    if not result["ok"]:
        print(f"  ✗ HATA: {result['error']}")
        print("\n  → .env dosyasını oluşturun (.env.example'dan kopyalayın)")
        return 1

    print(f"  ✓ Postgres: {result['postgres_version'][:60]}...")
    print(f"  ✓ Tablolar:")
    for tbl, count in result["table_counts"].items():
        print(f"     - {tbl}: {count}")

    # 3. Veri akışı testi
    print("\n[3] Veri Akışı (basit)...")
    try:
        ihaleler = db.fetch_ihaleler()
        print(f"  ✓ İhaleler: {len(ihaleler)} kayıt")
        if not ihaleler.empty:
            print(f"     - En eski: {ihaleler['ihale_tarihi'].min()}")
            print(f"     - En yeni: {ihaleler['ihale_tarihi'].max()}")
            print(f"     - Toplam YM: {ihaleler['yaklasik_maliyet'].sum():,.0f} TL")

        katilimcilar = db.fetch_katilimcilar()
        print(f"  ✓ Katılımcılar: {len(katilimcilar)} kayıt")
        if not katilimcilar.empty:
            print(f"     - Geçerli: {(katilimcilar['durum'] == 'gecerli').sum()}")
            print(f"     - Geçersiz: {(katilimcilar['durum'] == 'gecersiz').sum()}")
            print(f"     - Sınır altı: {(katilimcilar['durum'] == 'sinir_alti').sum()}")
    except Exception as e:
        print(f"  ✗ HATA: {e}")
        return 1

    print("\n" + "=" * 60)
    print("  ✅ Tüm kontroller başarılı.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
