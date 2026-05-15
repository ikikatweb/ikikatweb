// Yedek Al sayfası — yönetici DB yedeği indirir.
// /api/yedek endpoint'i tüm tabloları JSON olarak çekip download header'ı ile döner.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks";
import { Button } from "@/components/ui/button";
import { Download, ShieldCheck, AlertTriangle, Database, FileJson, FolderArchive, FileArchive } from "lucide-react";
import toast from "react-hot-toast";

export default function YedekPage() {
  const router = useRouter();
  const { isYonetici, loading: authLoading } = useAuth();
  const [yukleniyor, setYukleniyor] = useState(false);
  const [storageYukleniyor, setStorageYukleniyor] = useState(false);
  const [sonYedekBilgi, setSonYedekBilgi] = useState<{
    tarih: string;
    boyut: string;
    toplamSatir: number;
    tabloSayisi: number;
  } | null>(null);
  const [sonStorageYedekBilgi, setSonStorageYedekBilgi] = useState<{
    tarih: string;
    boyut: string;
    toplamDosya: number;
    bucketSayisi: number;
  } | null>(null);

  // Sadece yönetici görsün
  if (!authLoading && !isYonetici) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <ShieldCheck size={40} className="mx-auto text-red-500 mb-3" />
          <h2 className="text-lg font-bold text-red-700 mb-2">Erişim Reddedildi</h2>
          <p className="text-sm text-red-600">Bu sayfaya yalnızca yöneticiler erişebilir.</p>
          <Button variant="outline" onClick={() => router.push("/dashboard")} className="mt-4">
            Dashboard&apos;a Dön
          </Button>
        </div>
      </div>
    );
  }

  async function yedegiIndir() {
    setYukleniyor(true);
    const t = toast.loading("Yedek hazırlanıyor... (bu işlem birkaç dakika sürebilir)");
    try {
      const res = await fetch("/api/yedek");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const boyutMB = (blob.size / (1024 * 1024)).toFixed(2);

      // Yedek meta bilgisini blob'dan oku (download başlatmadan önce)
      const metin = await blob.text();
      const yedek = JSON.parse(metin);
      const tabloSayisi = yedek.meta?.toplam_tablo ?? 0;
      const toplamSatir = Object.values(yedek.meta?.tablo_satir_sayilari ?? {})
        .reduce((s: number, n) => s + (typeof n === "number" ? n : 0), 0);

      // Dosyayı tarayıcıya indir
      const url = URL.createObjectURL(blob);
      const dosyaAdi = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]
        ?? `ikikatweb-yedek-${new Date().toISOString().slice(0, 10)}.json`;
      const a = document.createElement("a");
      a.href = url;
      a.download = dosyaAdi;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setSonYedekBilgi({
        tarih: new Date().toLocaleString("tr-TR"),
        boyut: `${boyutMB} MB`,
        toplamSatir,
        tabloSayisi,
      });
      toast.success("Yedek indirildi!", { id: t });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      toast.error(`Yedek alınamadı: ${msg}`, { id: t });
    } finally {
      setYukleniyor(false);
    }
  }

  async function storageYedeginiIndir() {
    setStorageYukleniyor(true);
    const t = toast.loading("Storage yedeği hazırlanıyor... (PDF/görsel dosyaları indiriliyor — birkaç dakika sürebilir)");
    try {
      const res = await fetch("/api/yedek/storage");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const boyutMB = (blob.size / (1024 * 1024)).toFixed(2);

      // ZIP'i tarayıcıya indir
      const url = URL.createObjectURL(blob);
      const dosyaAdi = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1]
        ?? `ikikatweb-dosya-yedek-${new Date().toISOString().slice(0, 10)}.zip`;
      const a = document.createElement("a");
      a.href = url;
      a.download = dosyaAdi;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Meta okumak için: ZIP içinden çıkarmak yerine response header'da tutsak
      // veya kullanıcıya basit özet gösterelim (tam meta için JSZip client tarafında parse gerek).
      setSonStorageYedekBilgi({
        tarih: new Date().toLocaleString("tr-TR"),
        boyut: `${boyutMB} MB`,
        toplamDosya: 0, // ZIP içinden okumak için ek iş — şimdilik 0
        bucketSayisi: 5, // Sabit liste sayısı
      });
      toast.success("Storage yedeği indirildi!", { id: t });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bilinmeyen hata";
      toast.error(`Storage yedeği alınamadı: ${msg}`, { id: t });
    } finally {
      setStorageYukleniyor(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-6">
      <h1 className="text-2xl font-bold text-[#1E3A5F] mb-2">Veri Yedeği</h1>
      <p className="text-sm text-gray-500 mb-6">
        Sistemdeki tüm veritabanı tablolarının yedeğini JSON dosyası olarak indirin.
      </p>

      {/* Bilgilendirme kartı */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex gap-3">
        <AlertTriangle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Önemli notlar:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            <li>Bu yedek sadece <strong>veritabanı kayıtlarını</strong> içerir (firma, şantiye, evrak metadata, kasa hareketleri, vb.).</li>
            <li><strong>PDF dosyaları (Üst Yazı, Ekler, kaşeler vb.) yedeklemez</strong> — bu dosyalar Supabase Storage&apos;da ayrı tutulur.</li>
            <li>Yedek dosyasını <strong>güvenli bir yere</strong> (harici disk, Google Drive vb.) saklayın.</li>
            <li>Yedek boyutu büyük olabilir, indirme birkaç dakika sürebilir.</li>
            <li>Hassas veri içerir — yetkisiz kişilerle paylaşmayın.</li>
          </ul>
        </div>
      </div>

      {/* Yedek alma kartı */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
        <div className="flex items-start gap-4 mb-4">
          <div className="bg-[#1E3A5F]/10 p-3 rounded-lg">
            <Database size={24} className="text-[#1E3A5F]" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-[#1E3A5F] mb-1">Veritabanı Yedeği</h2>
            <p className="text-xs text-gray-500">
              Tüm tabloların tüm satırlarını JSON formatında indirir. Dosya adı tarih damgalı olur.
            </p>
          </div>
        </div>

        <Button
          onClick={yedegiIndir}
          disabled={yukleniyor || authLoading}
          className="bg-[#F97316] hover:bg-[#ea580c] text-white"
        >
          <Download size={16} className="mr-2" />
          {yukleniyor ? "Hazırlanıyor..." : "Yedeği İndir (JSON)"}
        </Button>

        {sonYedekBilgi && (
          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-600">
            <div className="flex items-center gap-2 text-emerald-700 mb-2">
              <FileJson size={14} />
              <span className="font-semibold">Son yedek başarıyla alındı</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-6">
              <div>
                <span className="text-gray-400">Tarih:</span> {sonYedekBilgi.tarih}
              </div>
              <div>
                <span className="text-gray-400">Dosya boyutu:</span> {sonYedekBilgi.boyut}
              </div>
              <div>
                <span className="text-gray-400">Tablo sayısı:</span> {sonYedekBilgi.tabloSayisi}
              </div>
              <div>
                <span className="text-gray-400">Toplam satır:</span> {sonYedekBilgi.toplamSatir.toLocaleString("tr-TR")}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Storage (Dosya) Yedeği Kartı */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 mb-4">
        <div className="flex items-start gap-4 mb-4">
          <div className="bg-emerald-500/10 p-3 rounded-lg">
            <FolderArchive size={24} className="text-emerald-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-bold text-[#1E3A5F] mb-1">Dosya Yedeği (Storage)</h2>
            <p className="text-xs text-gray-500 mb-1.5">
              Tüm PDF, görsel ve eklerin (yazışmalar, antet, kaşe, ruhsat, bakım vb.) ZIP arşivi olarak indir.
            </p>
            <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
              ✓ Klasör adları artık <strong>okunaklı</strong>: firma adı, plaka, iş adı, evrak konusu olarak isimlendirilir.
              UUID&apos;ler eşleştirme için <code>_yedek_meta.json</code> dosyasında listelenir.
            </p>
          </div>
        </div>

        <Button
          onClick={storageYedeginiIndir}
          disabled={storageYukleniyor || authLoading}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <FileArchive size={16} className="mr-2" />
          {storageYukleniyor ? "Hazırlanıyor..." : "Dosya Yedeğini İndir (ZIP)"}
        </Button>

        {sonStorageYedekBilgi && (
          <div className="mt-4 pt-4 border-t border-gray-100 text-xs text-gray-600">
            <div className="flex items-center gap-2 text-emerald-700 mb-2">
              <FileArchive size={14} />
              <span className="font-semibold">Son storage yedeği başarıyla alındı</span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-6">
              <div>
                <span className="text-gray-400">Tarih:</span> {sonStorageYedekBilgi.tarih}
              </div>
              <div>
                <span className="text-gray-400">Dosya boyutu:</span> {sonStorageYedekBilgi.boyut}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-2 pl-6">
              ZIP içinde <code>_yedek_meta.json</code> dosyasında detaylı liste (bucket bazında dosya sayıları, hatalar) bulunur.
            </p>
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-gray-100 text-[10px] text-gray-400 space-y-1">
          <p>⚠ Storage yedeği büyük olabilir — Vercel timeout (60sn) sınırı aşılırsa hata alabilirsin.</p>
          <p>Çok dosya varsa yedek almak 1-5 dakika sürebilir, sayfayı kapatma.</p>
        </div>
      </div>

      {/* Geri yükleme uyarısı */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-xs text-blue-800">
        <p className="font-semibold mb-1">Yedeği nasıl geri yüklerim?</p>
        <p>
          <strong>DB JSON</strong>: Supabase Dashboard → SQL Editor üzerinden veya özel bir restore aracıyla yüklenir.
          {" "}<strong>Storage ZIP</strong>: ZIP&apos;i aç, her bucket klasörünün içeriğini Supabase Dashboard → Storage altına geri yükle.
          {" "}Acil durumda ikikatweb destek ile iletişime geçin.
        </p>
      </div>
    </div>
  );
}
