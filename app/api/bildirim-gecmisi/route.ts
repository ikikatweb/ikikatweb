// Bildirim geçmişi API'si
// GET: Belirli bir tarihteki bildirimleri getir (varsayılan: bugün) + okunmamış sayısı
// PATCH: Bildirimleri "okundu" olarak işaretle (tek id veya hepsi)
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { hasPermission } from "@/lib/permissions";
import { BILDIRIM_TAG_MODULE } from "@/lib/bildirim-mapping";
import type { Izinler } from "@/lib/supabase/types";

async function authUser() {
  const cookieStore = await cookies();
  const supabaseAuth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll() {},
      },
    },
  );
  const { data: { user } } = await supabaseAuth.auth.getUser();
  return user;
}

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function callerKullaniciId(authId: string): Promise<string | null> {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kullanicilar")
    .select("id")
    .eq("auth_id", authId)
    .single();
  return data?.id ?? null;
}

async function callerKullaniciFull(authId: string) {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kullanicilar")
    .select("id, rol, izinler, santiye_ids")
    .eq("auth_id", authId)
    .single();
  return data;
}

export async function GET(request: Request) {
  const user = await authUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const callerData = await callerKullaniciFull(user.id);
  if (!callerData) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });
  const kullaniciId = callerData.id;
  const rol = (callerData.rol ?? "kisitli") as "yonetici" | "santiye_admin" | "kisitli";
  const izinler = (callerData.izinler ?? {}) as Izinler;
  const isYonetici = rol === "yonetici";

  const url = new URL(request.url);
  // tarih: YYYY-MM-DD — yoksa bugünün tarihi (TR saati)
  let tarih = url.searchParams.get("tarih");
  if (!tarih || !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) {
    const now = new Date();
    // TR saatine göre yerel tarih
    tarih = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  const supabase = getServiceClient();

  // Seçili tarih aralığında bildirimler. santiye_id kolonu yoksa fallback uygula.
  let gecmisRaw: Array<{ id: string; baslik: string; govde: string; url: string; tag: string | null; tarih: string; saat: string; okundu: boolean; created_at: string; santiye_id?: string | null }> = [];
  const q1 = await supabase
    .from("bildirim_gecmisi")
    .select("id, baslik, govde, url, tag, tarih, saat, okundu, created_at, santiye_id")
    .eq("kullanici_id", kullaniciId)
    .eq("tarih", tarih)
    .order("created_at", { ascending: false });
  if (q1.error && /column .*santiye_id/i.test(q1.error.message)) {
    // Kolon yoksa eski şema
    const q2 = await supabase
      .from("bildirim_gecmisi")
      .select("id, baslik, govde, url, tag, tarih, saat, okundu, created_at")
      .eq("kullanici_id", kullaniciId)
      .eq("tarih", tarih)
      .order("created_at", { ascending: false });
    gecmisRaw = q2.data ?? [];
  } else {
    gecmisRaw = q1.data ?? [];
  }

  // İzin filtresi: kullanıcının yetkili olmadığı modülün geçmiş bildirimlerini gizle.
  // Ayrıca hiç şantiye atanmamış kullanıcılar santiye-bağlı bildirimleri göremez.
  const santiyeIds = Array.isArray(callerData.santiye_ids) ? (callerData.santiye_ids as string[]) : [];
  // Bu tag'ler şantiyeye özel bildirimler — şantiye_ids boş kullanıcılar göremez
  const SANTIYE_BAGLI_TAGLER = new Set([
    "kasa", "yakit", "arac-bakim", "yaklasan-sigorta", "yaklasan-bakim",
    "personel-puantaj", "arac-puantaj", "gelen-evrak", "giden-evrak",
    "iscilik-takibi", "santiye-defteri",
  ]);
  const izinliSet = new Set(santiyeIds);
  function izinli(tag: string | null | undefined, santiyeId: string | null | undefined): boolean {
    if (isYonetici) return true;
    if (!tag) return true; // tag'siz bildirim (mesajlaşma vb.) herkese
    const moduleKey = BILDIRIM_TAG_MODULE[tag];
    if (moduleKey && !hasPermission(rol, izinler, moduleKey, "goruntule")) return false;
    // Şantiye-bağlı tag'ler için:
    if (SANTIYE_BAGLI_TAGLER.has(tag)) {
      // santiye_id NULL → hangi şantiyeye ait olduğu bilinmiyor, GİZLE (eski/legacy bildirimler için)
      if (!santiyeId) return false;
      // santiye_id var → kullanıcının izinli şantiyelerinde olmalı
      if (!izinliSet.has(santiyeId)) return false;
    }
    return true;
  }
  const gecmis = (gecmisRaw ?? []).filter((b) => izinli(b.tag, b.santiye_id));

  // Okunmamış sayısı (santiye_id varsa onu da çek)
  let okunmamisListe: Array<{ tag: string | null; santiye_id?: string | null }> = [];
  const ok1 = await supabase
    .from("bildirim_gecmisi")
    .select("tag, santiye_id")
    .eq("kullanici_id", kullaniciId)
    .eq("okundu", false);
  if (ok1.error && /column .*santiye_id/i.test(ok1.error.message)) {
    const ok2 = await supabase
      .from("bildirim_gecmisi")
      .select("tag")
      .eq("kullanici_id", kullaniciId)
      .eq("okundu", false);
    okunmamisListe = ok2.data ?? [];
  } else {
    okunmamisListe = ok1.data ?? [];
  }
  const okunmamisSayisi = okunmamisListe.filter((b) => izinli(b.tag, b.santiye_id)).length;

  return NextResponse.json({
    tarih,
    bildirimler: gecmis,
    okunmamisSayisi,
  });
}

export async function PATCH(request: Request) {
  const user = await authUser();
  if (!user) return NextResponse.json({ error: "Yetkisiz" }, { status: 401 });
  const kullaniciId = await callerKullaniciId(user.id);
  if (!kullaniciId) return NextResponse.json({ error: "Kullanıcı bulunamadı" }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  const id = body.id ? String(body.id) : null;
  const tumu = body.tumu === true;

  const supabase = getServiceClient();
  let query = supabase
    .from("bildirim_gecmisi")
    .update({ okundu: true })
    .eq("kullanici_id", kullaniciId);

  if (id) {
    query = query.eq("id", id);
  } else if (!tumu) {
    return NextResponse.json({ error: "id veya tumu=true gerekli" }, { status: 400 });
  }

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
