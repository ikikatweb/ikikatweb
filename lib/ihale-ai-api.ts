// İhale-AI Python API client
//
// Python sunucu çalıştırma:
//   cd ihale-ai
//   .venv\Scripts\python -m uvicorn api.server:app --port 8000
//
// Production'da NEXT_PUBLIC_IHALE_AI_API ortam değişkeni ile override edilebilir.

// 127.0.0.1 kullanılıyor (Windows'ta localhost bazen IPv6'ya resolve olur,
// uvicorn IPv4 dinliyor → ERR_CONNECTION_REFUSED'a sebep olabilir).
const BASE_URL =
  process.env.NEXT_PUBLIC_IHALE_AI_API ?? "http://127.0.0.1:8000";

export const IHALE_AI_BASE = BASE_URL;

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* yut */
    }
    throw new Error(
      `İhale-AI API hatası (${res.status}): ${body || res.statusText}`,
    );
  }
  return (await res.json()) as T;
}

// ===========================================
// Tipler
// ===========================================
export type IdareListItem = {
  idare_adi: string;
  ihale_sayisi: number;
};

export type SavasSimulasyonuRequest = {
  yaklasik_maliyet: number;       // Bizim hesapladığımız YM (bias ile idare YM'ye çevrilir)
  idare_adi?: string | null;
  rakip_kanonikleri?: string[] | null;
  tenzilat?: number | null;
  n_iterasyon?: number;
  n_katsayisi?: number;
  maliyet_marji?: number;
  max_rakip?: number;
  seed?: number | null;
  bias_kullan?: boolean;           // True (default): bizim_ym × bias = idare_ym
};

export type FirmaIdareYakinlikDto = {
  firma_kanon: string;
  firma_ad: string;
  n_ihale: number;
  ortalama_yakinlik: number;       // 1.0 = idare YM, 0.7 = %30 kırım
  medyan_yakinlik: number;
  std_yakinlik: number;
  ortalama_kirim_pct: number;      // 100*(1-ortalama_yakinlik)
};

export type RakipDto = {
  firma_kanon: string;
  firma_ad: string;
  n_gozlem: number;
  mu: number;
  sigma: number;
  min_tenzilat: number;
  max_tenzilat: number;
  is_sniper: boolean;
  sniper_idare_match: boolean;
  idare_yakinlik?: FirmaIdareYakinlikDto | null;
};

export type BiasOrnegi = {
  is_adi: string;
  ihale_tarihi: string | null;
  bizim_ym: number;
  resmi_ym: number;
  oran: number;
};

export type BiasDetayDto = {
  bizim_ym: number;
  bias_factor: number;
  tahmini_idare_ym: number;
  bias_kaynak: "idare" | "global" | "yok";
  bias_n_ihale: number;
  ornekler?: BiasOrnegi[];
};

export type IdareGecmisIhale = {
  is_adi: string;
  ihale_tarihi: string | null;
  resmi_ym: number | null;
  bizim_ym: number | null;
  bizim_katildik: boolean;
  bizim_teklif: number | null;
  bizim_tenzilat: number | null;
  sinir_deger: number | null;
  muhtemel_kazanan: string | null;
  muhtemel_kazanan_tutar: number | null;
  katilimci_sayisi: number;
};

export type TenzilatNoktasi = {
  tenzilat: number;
  bizim_teklif: number;
  win_prob: number;
  sinir_alti_olasiligi: number;
  sd_p10: number;
  sd_p50: number;
  sd_p90: number;
  kar_kazanildiginda: number;
  beklenen_kar: number;
  bizden_ucuz_ortalama: number;
};

export type SavasSimulasyonuResponse = {
  yaklasik_maliyet: number;          // Simülasyonda kullanılan (tahmini idare YM)
  idare_adi: string | null;
  n_iterasyon: number;
  maliyet_marji: number;             // Kullanılan değer (manuel veya otomatik)
  maliyet_marji_kaynak: "idare" | "global" | "varsayilan" | "manuel";
  maliyet_marji_n_kayit: number;     // Otomatik hesapta kullanılan SELF kayıt sayısı
  rakipler: RakipDto[];
  optimum_noktalar: TenzilatNoktasi[];
  onerilen_tenzilat: number;
  onerilen_teklif: number;
  onerilen_win_prob: number;
  onerilen_beklenen_kar: number;
  onerilen_kar_kazanildiginda: number;
  sd_medyan: number;
  girilmemeli: boolean;
  grafik_token: string;
  bias_detay?: BiasDetayDto | null;
  idare_gecmis?: IdareGecmisIhale[];
};

export type IdareIstatistik = {
  idare_adi: string;
  bias: {
    n_ihale: number;
    medyan_bias: number;
    trimmed_mean_bias: number;
    onerilen_metrik: string;
    onerilen_deger: number;
    son_3_ay_bias?: number | null;
    son_6_ay_bias?: number | null;
    son_12_ay_bias?: number | null;
  } | null;
  firmalar: Array<{
    firma_kanon: string;
    firma_ad: string;
    n_ihale: number;
    ortalama_yakinlik: number;
    medyan_yakinlik: number;
    std_yakinlik: number;
    ortalama_kirim_pct: number;
    min_yakinlik: number;
    max_yakinlik: number;
  }>;
};

export async function getIdareIstatistik(idareAdi: string): Promise<IdareIstatistik> {
  return _fetch<IdareIstatistik>(`/api/idare-istatistik?idare_adi=${encodeURIComponent(idareAdi)}`);
}

export type CiftDto = {
  firma_a: string;
  firma_b: string;
  firma_a_kanon: string;
  firma_b_kanon: string;
  toplam_skor: number;
  kategori: string;
  ortak_ihale: number;
  a_toplam: number;
  b_toplam: number;
  lift: number;
  tenzilat_medyan_fark: number;
  tenzilat_esik_alti_pct: number;
  teklif_cv: number;
  en_yogun_idare_orani: number;
  a_kazanma: number;
  b_kazanma: number;
};

export type KartelGrupDto = {
  grup_id: number;
  firmalar: string[];
  kanonikler: string[];
  cift_sayisi: number;
  ortalama_skor: number;
  paylaşilan_idareler: string[];
};

export type KartelRaporResponse = {
  toplam_cift: number;
  kartel_supheli_sayisi: number;
  orta_bag_sayisi: number;
  zayif_bag_sayisi: number;
  en_yuksek_ciftler: CiftDto[];
  gruplar: KartelGrupDto[];
};

export type SniperIdareDto = {
  idare_adi: string;
  toplam_ihale: number;
  in_band_sayisi: number;
  in_band_orani: number;
  ortalama_yakinlik_pct: number;
};

export type SniperFirmaDto = {
  firma_adi: string;
  firma_kanon: string;
  etiket: string;
  toplam_ihale: number;
  is_sniper: boolean;
  is_ultra_sniper: boolean;
  global_ortalama_yakinlik_pct: number;
  global_std_pct: number;
  en_yakin_teklif_pct: number;
  sniper_idareler: SniperIdareDto[];
};

export type SniperRaporResponse = {
  toplam_firma: number;
  sniper_sayisi: number;
  ultra_sniper_sayisi: number;
  firmalar: SniperFirmaDto[];
};

export type RakipKarneDto = {
  firma_adi: string;
  firma_kanon: string;
  etiket: string;
  toplam_ihale: number;
  toplam_kazanma: number;
  kazanma_orani: number;
  ortalama_tenzilat: number;
  deneyim_tutari: number;
  is_sniper: boolean;
  is_ultra_sniper: boolean;
  is_toplulastirmaci: boolean;
};

export type RakipKarneResponse = {
  karneler: RakipKarneDto[];
};

export type ManuelGrup = {
  id: string;
  grup_adi: string;
  firmalar: string[];
  aciklama: string;
  olusturma_tarihi: string;
  guncelleme_tarihi: string;
};

export type ManuelGrupRequest = {
  grup_adi: string;
  firmalar: string[];
  aciklama?: string;
};

export type FirmaArama = {
  firma_kanon: string;
  firma_adi: string;
};

// ===========================================
// API fonksiyonları
// ===========================================
export async function getIdareler(arama?: string): Promise<IdareListItem[]> {
  const url = arama
    ? `/api/idareler?arama=${encodeURIComponent(arama)}`
    : "/api/idareler";
  return _fetch<IdareListItem[]>(url);
}

export async function postSavasSimulasyonu(
  req: SavasSimulasyonuRequest,
): Promise<SavasSimulasyonuResponse> {
  return _fetch<SavasSimulasyonuResponse>("/api/savas-simulasyonu", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export function savasGrafikUrl(
  token: string,
  tip: "winprob-kar" | "rakipler" | "sd-dagilimi",
): string {
  return `${BASE_URL}/api/savas-simulasyonu/${token}/grafik/${tip}`;
}

export async function getKartelRapor(
  minSkor = 30,
  grupMinSkor = 75,
  top = 50,
): Promise<KartelRaporResponse> {
  const params = new URLSearchParams({
    min_skor: String(minSkor),
    grup_min_skor: String(grupMinSkor),
    top: String(top),
  });
  return _fetch<KartelRaporResponse>(`/api/kartel-rapor?${params.toString()}`);
}

export async function getSniperRapor(opts?: {
  sadeceUltra?: boolean;
  sadeceSniper?: boolean;
}): Promise<SniperRaporResponse> {
  const params = new URLSearchParams({
    sadece_ultra: String(opts?.sadeceUltra ?? false),
    sadece_sniper: String(opts?.sadeceSniper ?? true),
  });
  return _fetch<SniperRaporResponse>(`/api/sniper-rapor?${params.toString()}`);
}

export async function getRakipKarneleri(
  sadeceRakip = true,
): Promise<RakipKarneResponse> {
  return _fetch<RakipKarneResponse>(
    `/api/rakip-karneleri?sadece_rakip=${sadeceRakip}`,
  );
}

export async function getManuelGruplar(): Promise<ManuelGrup[]> {
  return _fetch<ManuelGrup[]>("/api/birlikte-hareket");
}

export async function postManuelGrup(req: ManuelGrupRequest): Promise<ManuelGrup> {
  return _fetch<ManuelGrup>("/api/birlikte-hareket", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function putManuelGrup(
  id: string,
  req: ManuelGrupRequest,
): Promise<ManuelGrup> {
  return _fetch<ManuelGrup>(`/api/birlikte-hareket/${id}`, {
    method: "PUT",
    body: JSON.stringify(req),
  });
}

export async function deleteManuelGrup(id: string): Promise<void> {
  await _fetch<{ silindi: string }>(`/api/birlikte-hareket/${id}`, {
    method: "DELETE",
  });
}

export async function searchFirma(q: string, limit = 20): Promise<FirmaArama[]> {
  if (q.length < 2) return [];
  const params = new URLSearchParams({ q, limit: String(limit) });
  return _fetch<FirmaArama[]>(`/api/firma-arama?${params.toString()}`);
}
