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
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
