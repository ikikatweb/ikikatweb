"""
Konfigürasyon yükleyici.

config/thresholds.yaml dosyasını okur, profil/CLI override uygular.
"""
from __future__ import annotations
import os
import sys
from pathlib import Path
from typing import Any
import yaml
from dotenv import load_dotenv

# Yapı: ihale-ai/core/config.py → root: ihale-ai/
ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT_DIR / "config"
DATA_DIR = ROOT_DIR / "data"

DEFAULT_THRESHOLDS = CONFIG_DIR / "thresholds.yaml"
PROFILES_PATH = CONFIG_DIR / "profiles.yaml"

# .env yükle (Supabase bağlantısı için)
load_dotenv(ROOT_DIR / ".env")


class Config:
    """Eşik konfigürasyonunu noktalı erişimle sunar.

    Kullanım:
        cfg = Config.load()
        print(cfg.get("sniper.threshold_pct"))
        # 0.50

        cfg.set("sniper.threshold_pct", 0.30)  # geçici override

        cfg2 = Config.load(profile="muhafazakar")
    """

    def __init__(self, data: dict):
        self._data = data

    @classmethod
    def load(
        cls,
        thresholds_path: Path | None = None,
        profile: str | None = None,
        overrides: dict[str, Any] | None = None,
    ) -> "Config":
        """Konfigürasyonu yükle.

        Sırası:
            1. thresholds.yaml (varsayılan)
            2. profile (varsa)
            3. overrides (varsa) — CLI'dan gelen
        """
        path = thresholds_path or DEFAULT_THRESHOLDS
        if not path.exists():
            raise FileNotFoundError(f"Konfigürasyon dosyası bulunamadı: {path}")

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}

        # Profil uygula
        if profile and PROFILES_PATH.exists():
            with open(PROFILES_PATH, "r", encoding="utf-8") as f:
                profiles = (yaml.safe_load(f) or {}).get("profiles", {})
            if profile not in profiles:
                raise ValueError(
                    f"Profil bulunamadı: {profile}. Mevcut: {list(profiles.keys())}"
                )
            for key, value in (profiles[profile] or {}).items():
                cls._set_nested(data, key, value)

        # CLI override
        if overrides:
            for key, value in overrides.items():
                cls._set_nested(data, key, value)

        return cls(data)

    @staticmethod
    def _set_nested(data: dict, dotted_key: str, value: Any) -> None:
        """'kartel.tenzilat.fark_esigi_pct' gibi noktalı path'i set eder."""
        parts = dotted_key.split(".")
        target = data
        for p in parts[:-1]:
            target = target.setdefault(p, {})
        target[parts[-1]] = value

    def get(self, dotted_key: str, default: Any = None) -> Any:
        """'sniper.threshold_pct' gibi noktalı erişim."""
        target = self._data
        for p in dotted_key.split("."):
            if not isinstance(target, dict) or p not in target:
                return default
            target = target[p]
        return target

    def set(self, dotted_key: str, value: Any) -> None:
        """Anlık override (kalıcı değil)."""
        Config._set_nested(self._data, dotted_key, value)

    def section(self, key: str) -> dict:
        """Bir alt bölümü dict olarak döndür."""
        result = self._data.get(key, {})
        return result if isinstance(result, dict) else {}

    def __repr__(self) -> str:
        return f"Config({list(self._data.keys())})"


# ===========================================
# DB Bağlantı Bilgileri (.env'den)
# ===========================================
class DbCreds:
    HOST = os.getenv("SUPABASE_HOST", "")
    PORT = int(os.getenv("SUPABASE_PORT", "5432"))
    DB = os.getenv("SUPABASE_DB", "postgres")
    USER = os.getenv("SUPABASE_USER", "postgres")
    PASSWORD = os.getenv("SUPABASE_PASSWORD", "")
    SSL_MODE = os.getenv("SUPABASE_SSL_MODE", "require")

    @classmethod
    def is_configured(cls) -> bool:
        return bool(cls.HOST and cls.PASSWORD)

    @classmethod
    def conn_string(cls) -> str:
        return (
            f"host={cls.HOST} port={cls.PORT} dbname={cls.DB} "
            f"user={cls.USER} password={cls.PASSWORD} sslmode={cls.SSL_MODE}"
        )


# ===========================================
# MY_FIRMS yönetimi (kalıcı)
# ===========================================
MY_FIRMS_FILE = DATA_DIR / "my_firms.json"


def load_my_firms() -> list[str]:
    """data/my_firms.json'dan firma isimlerini yükle."""
    import json
    if not MY_FIRMS_FILE.exists():
        return []
    with open(MY_FIRMS_FILE, "r", encoding="utf-8") as f:
        return json.load(f).get("firmalar", [])


def save_my_firms(firmalar: list[str]) -> None:
    """data/my_firms.json'a kaydet."""
    import json
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(MY_FIRMS_FILE, "w", encoding="utf-8") as f:
        json.dump({"firmalar": firmalar}, f, ensure_ascii=False, indent=2)


def prompt_my_firms_if_missing() -> list[str]:
    """Firma listesi yoksa kullanıcıya sor."""
    firmalar = load_my_firms()
    if firmalar:
        return firmalar

    print("\n=== KONTROLÜNÜZDEKİ FİRMALAR ===")
    print("Kontrolünüzdeki firma isimlerini aralarına virgül koyarak yazın.")
    print("Örnek: İKİKAT İNŞAAT, KAD-TEM YAPI, ABC MÜHENDİSLİK")
    print()

    raw = input("Firmalar: ").strip()
    if not raw:
        print("Boş giriş, çıkılıyor.")
        sys.exit(1)

    firmalar = [f.strip().upper() for f in raw.split(",") if f.strip()]
    save_my_firms(firmalar)
    print(f"\n{len(firmalar)} firma kaydedildi: {DATA_DIR / 'my_firms.json'}")
    return firmalar


# ===========================================
# CLI ARG PARSER (genel — --key.subkey value)
# ===========================================
def parse_overrides(argv: list[str]) -> tuple[dict[str, Any], list[str]]:
    """
    --kartel.tenzilat.fark_esigi_pct 0.10
    şeklindeki argümanları sözlüğe çevir, geri kalanları döndür.
    """
    overrides: dict[str, Any] = {}
    rest: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--") and "." in a:
            key = a[2:]
            if i + 1 < len(argv):
                val = argv[i + 1]
                overrides[key] = _coerce(val)
                i += 2
                continue
        rest.append(a)
        i += 1
    return overrides, rest


def _coerce(s: str) -> Any:
    """String'i uygun Python tipine çevir (int, float, bool, None, str)."""
    sl = s.lower()
    if sl in ("true", "yes", "evet"): return True
    if sl in ("false", "no", "hayir", "hayır"): return False
    if sl in ("none", "null"): return None
    try: return int(s)
    except ValueError: pass
    try: return float(s.replace(",", "."))
    except ValueError: pass
    return s


if __name__ == "__main__":
    # Smoke test
    cfg = Config.load()
    print("Config yüklendi:", cfg)
    print("Sniper threshold:", cfg.get("sniper.threshold_pct"))
    print("Tenzilat eşiği:", cfg.get("kartel.tenzilat.fark_esigi_pct"))
    print("DB konfigüre:", DbCreds.is_configured())
