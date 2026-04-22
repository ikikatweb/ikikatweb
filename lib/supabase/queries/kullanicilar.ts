// Kullanıcı sorguları - API route'lara fetch yapan client fonksiyonları
import type { Kullanici, Izinler } from "@/lib/supabase/types";

export type KullaniciCreatePayload = {
  ad_soyad: string;
  kullanici_adi: string;
  sifre: string;
  rol: "yonetici" | "kisitli";
  izinler?: Izinler;
  santiye_ids?: string[];
  geriye_donus_gun?: number | null;
  // Modül bazlı işlem/görüntüleme gün limitleri
  puantaj_islem_gun?: number | null;
  puantaj_goruntuleme_gun?: number | null;
  yakit_islem_gun?: number | null;
  yakit_goruntuleme_gun?: number | null;
  kasa_islem_gun?: number | null;
  kasa_goruntuleme_gun?: number | null;
  santiye_defteri_islem_gun?: number | null;
  santiye_defteri_goruntuleme_gun?: number | null;
  dashboard_widgets?: string[] | null;
};

export type KullaniciUpdatePayload = {
  ad_soyad?: string;
  rol?: "yonetici" | "kisitli";
  aktif?: boolean;
  sifre?: string;
  izinler?: Izinler;
  santiye_ids?: string[];
  geriye_donus_gun?: number | null;
  // Modül bazlı işlem/görüntüleme gün limitleri
  puantaj_islem_gun?: number | null;
  puantaj_goruntuleme_gun?: number | null;
  yakit_islem_gun?: number | null;
  yakit_goruntuleme_gun?: number | null;
  kasa_islem_gun?: number | null;
  kasa_goruntuleme_gun?: number | null;
  santiye_defteri_islem_gun?: number | null;
  santiye_defteri_goruntuleme_gun?: number | null;
  dashboard_widgets?: string[] | null;
};

// İzin şablonu tipi
export type IzinSablonu = {
  id: string;
  ad: string;
  izinler: Izinler;
};

const SABLON_KEY = "ikikat_izin_sablonlari";

export function getSablonlar(): IzinSablonu[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(SABLON_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function saveSablon(sablon: IzinSablonu) {
  const mevcut = getSablonlar();
  const yeni = [...mevcut.filter((s) => s.id !== sablon.id), sablon];
  localStorage.setItem(SABLON_KEY, JSON.stringify(yeni));
}

export function deleteSablon(id: string) {
  const mevcut = getSablonlar();
  localStorage.setItem(SABLON_KEY, JSON.stringify(mevcut.filter((s) => s.id !== id)));
}

export async function getKullanicilar(): Promise<Kullanici[]> {
  const res = await fetch("/api/kullanicilar");
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function getKullaniciProfil(): Promise<Kullanici> {
  const res = await fetch("/api/kullanicilar/me");
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function createKullanici(data: KullaniciCreatePayload): Promise<Kullanici> {
  const res = await fetch("/api/kullanicilar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function updateKullanici(id: string, data: KullaniciUpdatePayload): Promise<Kullanici> {
  const res = await fetch(`/api/kullanicilar/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

export async function deleteKullanici(id: string): Promise<void> {
  const res = await fetch(`/api/kullanicilar/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error((await res.json()).error);
}
