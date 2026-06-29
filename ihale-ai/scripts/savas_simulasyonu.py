"""İhale Savaş Simülasyonu — Monte Carlo War Room.

Bir ihale için geçmiş veriden öğrenilmiş rakip davranışlarına göre
N senaryo simüle eder. Optimal tenzilat önerisi + win prob + beklenen kar.

Kullanım:
    # En sık idarede otomatik rakipler:
    python -m scripts.savas_simulasyonu --ym 50000000 --idare "DSİ 12. BÖLGE MÜDÜRLÜĞÜ"

    # Manuel rakipler:
    python -m scripts.savas_simulasyonu --ym 50000000 --rakipler "FARSEL,ADAKALE,ESEKA"

    # Tek tenzilat (optimum aramasız):
    python -m scripts.savas_simulasyonu --ym 50000000 --idare "..." --tenzilat 22.5

    # Excel:
    python -m scripts.savas_simulasyonu --ym 50000000 --idare "..." --excel sim.xlsx

Optimum aramada %15..%35 arası 21 nokta denenir. Her tenzilat için n=1000
iterasyon (default).
"""
from __future__ import annotations
import sys
import argparse
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd

from core.config import Config, prompt_my_firms_if_missing
from core import etl
from intelligence.simulation import (
    rakipleri_hazirla, monte_carlo_simulasyon, optimal_tenzilat_bul,
    sonuclari_to_dataframe, rakipleri_to_dataframe,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="İhale Savaş Simülasyonu")
    parser.add_argument("--ym", type=float, required=True, help="Yaklaşık maliyet (TL)")
    parser.add_argument("--idare", type=str, default=None, help="İdare adı (otomatik rakipler)")
    parser.add_argument("--rakipler", type=str, default=None, help="Manuel rakip listesi (virgülle)")
    parser.add_argument("--tenzilat", type=float, default=None,
                        help="Tek tenzilat (verilmezse %%15..%%35 optimum aranır)")
    parser.add_argument("--n", type=int, default=1000, help="İterasyon sayısı (default 1000)")
    parser.add_argument("--n-katsayisi", type=float, default=1.00, help="KİK n (1.00 yapım, 1.20 genel)")
    parser.add_argument("--max-rakip", type=int, default=20, help="Otomatik rakip seçiminde max")
    parser.add_argument("--maliyet-marji", type=float, default=5.0,
                        help="Bizim malzeme/işçilik tenzilat marjımız (kar=teklif-maliyet)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--excel", type=str, default=None, help="Excel çıktı dosyası")
    parser.add_argument("--plot", action="store_true",
                        help="PNG grafikler üret (winprob/kar curve, rakip dağılımı, SD histogramı)")
    parser.add_argument("--plot-dir", type=str, default=".",
                        help="Grafik PNG dosyalarının kaydedileceği klasör")
    args = parser.parse_args()

    print("=" * 70)
    print("  ⚔  İHALE SAVAŞ SİMÜLASYONU — Monte Carlo War Room")
    print("=" * 70)

    cfg = Config.load()
    my_firms = prompt_my_firms_if_missing()

    print(f"\nKendi firmalar:     {my_firms}")
    print(f"Yaklaşık Maliyet:   {args.ym:,.0f} TL")
    print(f"İterasyon:          {args.n}")
    print(f"n katsayısı:        {args.n_katsayisi}")
    print(f"Maliyet marjı:      %{args.maliyet_marji} (kar = teklif − YM×(1−marj))")
    if args.idare:
        print(f"İdare:              {args.idare}")
    if args.rakipler:
        print(f"Manuel rakipler:    {args.rakipler}")

    # Veri yükle
    print("\n→ Veri yükleniyor...")
    df = etl.load_data(my_firms, cfg)

    # Rakipleri hazırla
    rakip_listesi = None
    if args.rakipler:
        rakip_listesi = [r.strip() for r in args.rakipler.split(",") if r.strip()]

    print("→ Rakipler hazırlanıyor (sniper karneler dahil)...")
    rakipler = rakipleri_hazirla(
        df=df,
        idare_adi=args.idare,
        rakip_kanonikleri=rakip_listesi,
        cfg=cfg,
        my_firms=my_firms,
        max_rakip=args.max_rakip,
    )

    if not rakipler:
        print("\n  ⚠  Rakip bulunamadı. --idare veya --rakipler parametrelerini kontrol et.")
        return 1

    print()
    print("=" * 70)
    print(f"  📋 RAKİP TABLOSU — {len(rakipler)} firma")
    print("=" * 70)
    df_rakip = rakipleri_to_dataframe(rakipler)
    print(df_rakip.to_string(index=False, max_colwidth=40))

    # Simulasyon
    print()
    print("=" * 70)
    if args.tenzilat is not None:
        print(f"  🎯 TEK TEKLİF SİMÜLASYONU — Bizim Tenzilat: %{args.tenzilat}")
        print("=" * 70)
        sonuc = monte_carlo_simulasyon(
            yaklasik_maliyet=args.ym,
            rakipler=rakipler,
            bizim_tenzilat=args.tenzilat,
            n_iterasyon=args.n,
            n_katsayisi=args.n_katsayisi,
            seed=args.seed,
            maliyet_kar_marji=args.maliyet_marji,
        )
        print(f"\n  Bizim Teklif:           {sonuc.bizim_teklif:,.0f} TL")
        print(f"  🏆 Win Probability:      %{sonuc.kazanma_olasiligi*100:.1f}")
        print(f"  ❌ Sınır Altı Kalma:     %{sonuc.sinir_alti_olasiligi*100:.1f}")
        print()
        print(f"  📊 Sınır Değer Dağılımı:")
        print(f"     P10:  {sonuc.sd_p10:,.0f} TL")
        print(f"     P50:  {sonuc.sd_p50:,.0f} TL  (medyan)")
        print(f"     P90:  {sonuc.sd_p90:,.0f} TL")
        print(f"     Mean: {sonuc.sd_mean:,.0f} ± {sonuc.sd_std:,.0f}")
        print()
        print(f"  💰 Beklenen Kar:         {sonuc.beklenen_kar:,.0f} TL")
        print(f"  💰 Kazandığında Kar:     {sonuc.ortalama_kar_kazanildiginda:,.0f} TL")
        print(f"  📉 Bizden Ucuz Ort:      {sonuc.ortalama_rakip_sayisi_altinda:.1f} rakip")

        if args.excel:
            df_sonuc = pd.DataFrame([sonuc.to_dict()])
            with pd.ExcelWriter(args.excel, engine="openpyxl") as writer:
                df_sonuc.to_excel(writer, sheet_name="Simülasyon", index=False)
                df_rakip.to_excel(writer, sheet_name="Rakipler", index=False)
            print(f"\n✓ Excel kaydedildi: {Path(args.excel).absolute()}")

    else:
        # Dinamik aday aralığı bilgisi
        import numpy as _np
        piyasa_mu = float(_np.mean([r.mu for r in rakipler])) if rakipler else 25.0
        alt = max(0.0, piyasa_mu - 12.0)
        ust = min(60.0, piyasa_mu + 8.0)
        print(f"  🔍 OPTİMUM TEKLİF ARANIYOR — Piyasa μ=%{piyasa_mu:.1f}, aralık %{alt:.0f}..%{ust:.0f}")
        print("=" * 70)
        opt = optimal_tenzilat_bul(
            yaklasik_maliyet=args.ym,
            rakipler=rakipler,
            n_iterasyon=args.n,
            n_katsayisi=args.n_katsayisi,
            seed=args.seed,
            maliyet_kar_marji=args.maliyet_marji,
        )

        df_opt = sonuclari_to_dataframe(opt)
        print()
        print(df_opt.to_string(index=False))

        # En iyi
        en_iyi = max(opt.sonuclar, key=lambda s: s.beklenen_kar)
        # Gerçek pozitif kar var mı?
        positives = [s for s in opt.sonuclar if s.beklenen_kar > 0]

        print()
        print("=" * 70)
        if not positives:
            print(f"  ⛔ İHALEYE GİRMEYİN — Hiçbir tenzilatta pozitif beklenen kar yok")
        else:
            print(f"  🏆 ÖNERİ — Tenzilat %{opt.onerilen_tenzilat}")
        print("=" * 70)
        print(f"\n  Bizim Teklif:        {en_iyi.bizim_teklif:,.0f} TL")
        print(f"  Win Prob:            %{en_iyi.kazanma_olasiligi*100:.1f}")
        print(f"  SD Medyan:           {en_iyi.sd_p50:,.0f} TL")
        print(f"  Kazandığında Kar:    {en_iyi.ortalama_kar_kazanildiginda:,.0f} TL")
        print(f"  ⭐ Beklenen Kar:      {en_iyi.beklenen_kar:,.0f} TL")
        print()
        print(f"  Win prob max @ %{opt.en_yuksek_win_prob_tenzilat}")
        print(f"  Beklenen kar max @ %{opt.en_yuksek_beklenen_kar_tenzilat}")
        if not positives:
            print()
            print(f"  📉 Piyasa ortalama tenzilatı bizim maliyet marjımızdan ({args.maliyet_marji}%) yüksek.")
            print(f"     SD medyan ≈ %{round((1 - en_iyi.sd_p50/args.ym)*100, 1)} kırım — piyasa burada kazanıyor.")
            print(f"     Eğer maliyet marjını yeniden gözden geçirirsen, --maliyet-marji ile yeniden dene.")

        if args.excel:
            with pd.ExcelWriter(args.excel, engine="openpyxl") as writer:
                df_opt.to_excel(writer, sheet_name="Optimum Tenzilat", index=False)
                df_rakip.to_excel(writer, sheet_name="Rakipler", index=False)
                # Özet sayfa
                ozet = pd.DataFrame([{
                    "Yaklaşık Maliyet": args.ym,
                    "Rakip Sayısı": len(rakipler),
                    "İterasyon": args.n,
                    "Önerilen Tenzilat %": opt.onerilen_tenzilat,
                    "Önerilen Teklif": en_iyi.bizim_teklif,
                    "Win Prob %": round(en_iyi.kazanma_olasiligi * 100, 2),
                    "Beklenen Kar TL": round(en_iyi.beklenen_kar, 2),
                }])
                ozet.to_excel(writer, sheet_name="Özet", index=False)
            print(f"\n✓ Excel kaydedildi: {Path(args.excel).absolute()}")

        # Plotlar
        if args.plot:
            from intelligence.visualization import (
                grafik_winprob_kar_curve, grafik_rakip_dagilimi, grafik_sd_dagilimi,
            )
            from intelligence.simulation import monte_carlo_simulasyon

            plot_dir = Path(args.plot_dir)
            plot_dir.mkdir(parents=True, exist_ok=True)
            idare_kisa = (args.idare or "manuel")[:30]
            title = f"YM={args.ym:,.0f} TL | İdare: {idare_kisa}"

            print(f"\n→ Grafikler oluşturuluyor... ({plot_dir.absolute()})")

            p1 = grafik_winprob_kar_curve(
                opt, title_suffix=title,
                out_path=plot_dir / "savas-winprob-kar.png",
            )
            print(f"   ✓ {p1.name}")

            p2 = grafik_rakip_dagilimi(
                rakipler, bizim_tenzilat=opt.onerilen_tenzilat,
                out_path=plot_dir / "savas-rakipler.png",
            )
            print(f"   ✓ {p2.name}")

            # SD histogramı için optimum tenzilatla bir kez daha simülasyon (senaryolar dahil)
            _, senaryolar = monte_carlo_simulasyon(
                yaklasik_maliyet=args.ym,
                rakipler=rakipler,
                bizim_tenzilat=opt.onerilen_tenzilat,
                n_iterasyon=max(args.n, 1000),
                n_katsayisi=args.n_katsayisi,
                seed=args.seed,
                maliyet_kar_marji=args.maliyet_marji,
                return_senaryolar=True,
            )
            p3 = grafik_sd_dagilimi(
                senaryolar=senaryolar,
                yaklasik_maliyet=args.ym,
                bizim_teklif=en_iyi.bizim_teklif,
                title_suffix=f"Tenzilat=%{opt.onerilen_tenzilat} | {idare_kisa}",
                out_path=plot_dir / "savas-sd-dagilimi.png",
            )
            print(f"   ✓ {p3.name}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
