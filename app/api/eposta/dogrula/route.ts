// E-POSTA DOĞRULAMA — maildeki bağlantı buraya düşer. Oturum gerektirmez, yetki jetondan.
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { tokenCoz, tokenKullanildi } from "@/lib/auth/sifre-token";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let token = "";
  try { token = String((await request.json())?.token ?? ""); } catch { /* gövdesiz */ }
  if (!token) return NextResponse.json({ error: "Bağlantı geçersiz." }, { status: 400 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const kayit = await tokenCoz(sb, token);
  if (!kayit || kayit.tip !== "eposta_dogrulama") {
    return NextResponse.json({ error: "Bağlantı geçersiz ya da süresi dolmuş." }, { status: 400 });
  }

  const { data } = await sb.from("kullanicilar").select("eposta").eq("id", kayit.kullanici_id).maybeSingle();
  const guncelEposta = ((data as { eposta: string | null } | null)?.eposta ?? "").trim().toLowerCase();
  // Adres bu arada değiştiyse eski bağlantı doğrulama yapmamalı.
  if (guncelEposta !== kayit.eposta.trim().toLowerCase()) {
    await tokenKullanildi(sb, kayit.id);
    return NextResponse.json({ error: "Bu bağlantı artık geçerli değil (adres değişmiş)." }, { status: 400 });
  }

  await sb.from("kullanicilar").update({ eposta_dogrulandi: true }).eq("id", kayit.kullanici_id);
  await tokenKullanildi(sb, kayit.id);
  return NextResponse.json({ ok: true, eposta: kayit.eposta });
}
