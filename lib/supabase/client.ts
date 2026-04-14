// Tarayıcı tarafı Supabase client - Client component'larda kullanılır
import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function createClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase bağlantı bilgileri eksik. .env.local dosyasını kontrol edin."
    );
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
