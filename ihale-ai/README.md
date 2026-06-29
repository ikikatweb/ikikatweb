# İhale AI

İkikat Web projesinin yanında çalışan, geçmiş ihale verisiyle:
- Sınır değer tahmini
- Sniper (avcı) firma tespiti
- Kartel / birlikte hareket eden firma analizi
- Monte Carlo ihale savaş simülasyonu

yapan Python servisi.

## Kurulum

```bash
cd ihale-ai
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
# .env dosyasındaki SUPABASE_* değerlerini doldur
```

## İlk Çalıştırma

```bash
# DB bağlantısını test et
python -m scripts.health_check

# KİK formülü tek başına test
python -m core.kik_formula

# JV parser test
python -m core.joint_venture

# Config sistemini test
python -m core.config
```

## Klasör Yapısı

```
ihale-ai/
├── config/
│   ├── thresholds.yaml      # Tüm eşikler (sniper, kartel, JV, vb.)
│   └── profiles.yaml        # Hazır profiller (paranoyak/dengeli/muhafazakar)
├── core/                     # Temel modüller
│   ├── config.py            # YAML yükleyici, MY_FIRMS, DB creds
│   ├── db.py                # Supabase Postgres bağlantı
│   ├── kik_formula.py       # KİK Tebliği Madde 45.1.1 — Python port
│   ├── joint_venture.py     # JV parser ("ABC, XYZ - DD.MM.YYYY HH:MM")
│   └── etl.py               # Veri temizleme + etiketleme
├── intelligence/             # (Sprint 2-3)
│   ├── bias.py              # Global_Bias_Factor
│   ├── yi_ufe.py            # Enflasyon güncelleme
│   ├── experience.py        # İş deneyim belgesi
│   ├── profiling.py         # Sniper detection + rakip karneleri
│   └── collusion.py         # Kartel tespiti (5-sinyalli skor)
├── simulation/               # (Sprint 5)
│   ├── monte_carlo.py       # 1000x simülasyon
│   ├── bid_generator.py     # NORMAL/SNIPER/JV teklif üretimi
│   └── war_room.py          # Senaryo orkestratörü
├── reports/                  # (Sprint 6)
│   ├── firma_raporu.py      # Excel — renkli firma tablosu
│   └── histogram.py         # PNG histogram
├── scripts/                  # CLI başlatıcılar
│   ├── health_check.py      # DB + temel veri sağlığı
│   ├── ihale_stratejisi.py  # ⭐ Ana savaş simülasyonu
│   ├── veri_guncelle.py     # Profil + bias yenileme
│   └── firma_listesi.py     # Tüm firma raporu
├── data/                     # Üretilmiş çıktılar
│   ├── my_firms.json        # Kontrolünüzdeki firmalar
│   ├── profiles/            # Firma karneleri (JSON)
│   └── bias_history.json    # Bias factor zaman serisi
├── tests/
├── requirements.txt
├── .env.example
└── README.md
```

## Konfigürasyon Yönetimi

### Varsayılan eşikler
`config/thresholds.yaml` — tüm sayısal parametreler.

### Profiller
```bash
python scripts/ihale_stratejisi.py --profile muhafazakar
```

### Anlık override (CLI)
```bash
python scripts/ihale_stratejisi.py \
  --kartel.tenzilat.fark_esigi_pct 0.10 \
  --sniper.threshold_pct 0.40
```

### Hassasiyet (sweep) analizi
```bash
python scripts/firma_listesi.py --sweep kartel.tenzilat.fark_esigi_pct 0.05,0.10,0.15,0.20
```

## Geliştirme Sprintleri

| Sprint | İçerik | Durum |
|--------|--------|-------|
| **S1** | İskelet + DB + ETL + KİK formülü + JV parser | ✅ TAMAMLANDI |
| **S2** | Yi-UFE + Bias Factor + Experience belgesi | ⏳ Sıradaki |
| **S3** | Sniper detection + Rakip profilleme | ⏳ |
| **S4** | Kartel detection (5-sinyalli skor) + Network kümeleme | ⏳ |
| **S5** | Monte Carlo + War Room interaktif CLI | ⏳ |
| **S6** | Raporlar (Excel + PNG + PDF) | ⏳ |
| **S7** | Veri güncelleme + cron entegrasyonu | ⏳ |

## Önemli Tasarım Kararları

### Sniper Detection
- `|T - SD| / SD < %0.50` (alt+üst, kullanıcı kararı)
- **Aynı idarede** 2+ "in-band" hit → o idare için sniper
- Global std > %2 ise firma sniper sayılmaz
- Min 3 toplam ihale gerekli

### Joint Venture
- Format: `<FIRMA1>, <FIRMA2>[, <FIRMA3>] - DD.MM.YYYY HH:MM`
- JV bid limit: `max(deneyim_A, deneyim_B) × 1.20` (büyük olanın %20 üstü)

### Kartel Skoru (0-100)
| Sinyal | Ağırlık |
|--------|---------|
| Lift (gözlenen/beklenen) | 25 |
| **Tenzilat farkı < %0.15** ⭐ | **35** |
| Teklif oranı sabitliği | 15 |
| Kazanma rotasyonu | 10 |
| İdare yoğunluğu | 15 |

### Toplulaştırmacı Filtre
Taban oranı %70+ olan firmalar için:
- Lift düşükse normal (rastgele birlikte görünüyorlar)
- Tenzilat sinyali yine de kontrol edilir (toplulaştırmacılar arası kartel)

## Bağımlılıklar
- pandas, numpy, scipy
- psycopg2-binary (Postgres)
- PyYAML (config)
- matplotlib, seaborn (görsel)
- networkx (kartel kümeleme)
- openpyxl, xlsxwriter (Excel)
- rich, click (CLI)

## Lisans
Proje içi kullanım — İkikat İnşaat.
