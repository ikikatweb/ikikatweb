"""
Supabase Postgres bağlantısı (psycopg2 + pandas).

Veri çekme fonksiyonları:
    fetch_ihaleler()        → ihale tablosu
    fetch_katilimcilar()    → ihale_katilimci tablosu
    fetch_yi_ufe()          → yi_ufe endeksleri
    fetch_firmalar()        → firmalar (renk + kısa ad)
"""
from __future__ import annotations
import logging
from contextlib import contextmanager
import pandas as pd
import psycopg2
from psycopg2.extras import RealDictCursor

from .config import DbCreds

log = logging.getLogger(__name__)


@contextmanager
def get_connection():
    """psycopg2 connection — context manager, otomatik kapatma."""
    if not DbCreds.is_configured():
        raise RuntimeError(
            "Supabase bağlantı bilgileri eksik. "
            ".env dosyasına SUPABASE_HOST ve SUPABASE_PASSWORD ekleyin."
        )
    conn = psycopg2.connect(DbCreds.conn_string())
    try:
        yield conn
    finally:
        conn.close()


def query_df(sql: str, params: tuple | dict | None = None) -> pd.DataFrame:
    """SQL sorgusunu çalıştırıp pandas DataFrame döndür."""
    with get_connection() as conn:
        try:
            df = pd.read_sql_query(sql, conn, params=params)
        except Exception as e:
            log.error(f"Sorgu hatası: {e}\nSQL: {sql[:200]}")
            raise
    return df


def query_dicts(sql: str, params: tuple | dict | None = None) -> list[dict]:
    """SQL sorgusunu çalıştırıp dict listesi döndür."""
    with get_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return [dict(r) for r in rows]


# ===========================================
# Veri çekme fonksiyonları
# ===========================================
def fetch_ihaleler() -> pd.DataFrame:
    """Tüm ihale kayıtlarını getir (ihale tablosu).

    Sütunlar:
        id, idare_adi, is_adi, ihale_kayit_no, ihale_tarihi, ihale_saati,
        yaklasik_maliyet, hesaplanan_yaklasik_maliyet, is_grubu,
        n_katsayisi, sinir_deger, t1, t2, c_degeri, k_degeri, standart_sapma,
        muhtemel_kazanan, muhtemel_kazanan_tutar, has_manual_edits,
        created_by, created_at
    """
    sql = """
    SELECT
        id, idare_adi, is_adi, ihale_kayit_no,
        ihale_tarihi, ihale_saati,
        yaklasik_maliyet,
        hesaplanan_yaklasik_maliyet,
        is_grubu,
        n_katsayisi,
        sinir_deger,
        t1, t2, c_degeri, k_degeri, standart_sapma,
        muhtemel_kazanan, muhtemel_kazanan_tutar,
        has_manual_edits, created_by, created_at
    FROM ihale
    ORDER BY ihale_tarihi DESC NULLS LAST
    """
    return query_df(sql)


def fetch_katilimcilar(ihale_id: str | None = None) -> pd.DataFrame:
    """Katılımcıları getir.

    Sütunlar:
        id, ihale_id, firma_adi, teklif_tutari, durum,
        gecersizlik_nedeni, tenzilat, is_own_company, is_manual,
        sira, created_at
    """
    if ihale_id:
        sql = """
        SELECT * FROM ihale_katilimci
        WHERE ihale_id = %s
        ORDER BY teklif_tutari ASC
        """
        return query_df(sql, (ihale_id,))

    sql = """
    SELECT * FROM ihale_katilimci
    ORDER BY ihale_id, teklif_tutari ASC
    """
    return query_df(sql)


def fetch_yi_ufe() -> pd.DataFrame:
    """Yi-ÜFE endeks tablosu — ay bazlı endeks değerleri.

    Mevcut sistem: yonetim/yi-ufe sayfasında düzenleniyor.
    Beklenen sütunlar (varsayım — gerçek şema ile uyumlandırılacak):
        yil, ay, deger
    """
    # Tablo adı henüz net değil — Next.js tarafında "yi_ufe" olduğunu varsayıyoruz
    sql = "SELECT * FROM yi_ufe ORDER BY yil, ay"
    try:
        return query_df(sql)
    except Exception as e:
        log.warning(f"yi_ufe tablosu okunamadı: {e}")
        return pd.DataFrame()


def fetch_firmalar() -> pd.DataFrame:
    """Firmalar tablosu (renk, kısa ad gibi metadata için)."""
    sql = "SELECT id, firma_adi, kisa_adi, renk FROM firmalar"
    try:
        return query_df(sql)
    except Exception as e:
        log.warning(f"firmalar tablosu okunamadı: {e}")
        return pd.DataFrame()


def fetch_birlesik_dataset() -> pd.DataFrame:
    """İhale + katılımcı verilerini join ederek tek tablo döndür.

    Çıktı: her satır bir ihale-katılımcı ikilisi.
    Bu fonksiyon ETL'in başlangıç noktasıdır.
    """
    sql = """
    SELECT
        i.id                                AS ihale_id,
        i.idare_adi,
        i.is_adi,
        i.ihale_kayit_no,
        i.ihale_tarihi,
        i.is_grubu,
        i.yaklasik_maliyet                  AS resmi_ym,
        i.hesaplanan_yaklasik_maliyet       AS bizim_ym,
        i.n_katsayisi,
        i.sinir_deger,
        i.t1, i.t2, i.c_degeri, i.k_degeri, i.standart_sapma,
        i.muhtemel_kazanan,
        i.muhtemel_kazanan_tutar,
        k.firma_adi,
        k.teklif_tutari,
        k.durum,
        k.gecersizlik_nedeni,
        k.tenzilat,
        k.is_own_company
    FROM ihale i
    LEFT JOIN ihale_katilimci k ON k.ihale_id = i.id
    ORDER BY i.ihale_tarihi DESC, k.teklif_tutari ASC
    """
    return query_df(sql)


# ===========================================
# Sağlık testi
# ===========================================
def health_check() -> dict:
    """Bağlantıyı test et ve tablo sayılarını döndür."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version()")
                version = cur.fetchone()[0]

                counts = {}
                for tbl in ["ihale", "ihale_katilimci", "yi_ufe", "firmalar"]:
                    try:
                        cur.execute(f"SELECT COUNT(*) FROM {tbl}")
                        counts[tbl] = cur.fetchone()[0]
                    except Exception as e:
                        counts[tbl] = f"ERROR: {e}"
                        conn.rollback()

        return {"ok": True, "postgres_version": version, "table_counts": counts}
    except Exception as e:
        return {"ok": False, "error": str(e)}


if __name__ == "__main__":
    import json
    print("=== DB Health Check ===")
    result = health_check()
    print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
