import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs SUNUCU PAKETİNE GÖMÜLMESİN (27.11.2026).
  // İcra tebligatı PDF'i sunucuda okunuyor (app/api/icra/belge-oku →
  // scripts/icra-belge-oku.mjs). pdfjs paketlenince iş parçacığı dosyasını
  // (pdf.worker.mjs) derlenmiş yığının yanında arıyor, bulamıyor ve
  // "Setting up fake worker failed" diyerek HER PDF'i açamıyor. Dışarıda
  // bırakılınca node_modules'tan normal yükleniyor ve kendi dosyalarını buluyor.
  // Tarayıcıdaki kullanımını (app/dashboard/ihale) etkilemez: bu ayar yalnız
  // sunucu paketlemesi içindir.
  //
  // @napi-rs/canvas DA LİSTEDE — şart (27.11.2026, üretimde yakalandı).
  // pdfjs Node'da DOMMatrix/Path2D'yi bu paketten ödünç alıyor; bulamazsa
  // "Cannot polyfill DOMMatrix" diye uyarıp devam ediyor ama modülün tepesindeki
  // `new DOMMatrix()` satırında patlıyor: "ReferenceError: DOMMatrix is not
  // defined". Yerelde görünmüyordu çünkü paket Windows ikilisiyle zaten kuruluydu;
  // Vercel'in sunucu paketine ise izlenemediği için girmiyordu (pdfjs onu
  // try/catch içinde createRequire ile çağırıyor, izleyici göremiyor).
  // Listeye yazmak paketin işlevle birlikte gönderilmesini sağlıyor.
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas"],
};

export default nextConfig;
