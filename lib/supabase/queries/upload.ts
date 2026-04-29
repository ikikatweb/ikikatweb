// Genel dosya yükleme helper'ı — herhangi bir bucket'a path ile yükler
// /api/upload route'unu kullanır (server-side, service role)
export async function uploadDosya(file: File, bucket: string, path: string): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("bucket", bucket);
  formData.append("path", path);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Dosya yüklenemedi");
  return data.url as string;
}
