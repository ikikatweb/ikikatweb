// Harita sekmeleri (Reglaj/Stabilize/Serme/Sıkıştırma/Tümü) için YÜKLEME İSKELETİ.
// "Yükleniyor..." yazısı yerine gerçek yerleşimin hayaleti gösterilir: üstte chip kartı sırası,
// altta harita kutusu — sabit boyutlu gri bloklar. Veri gelince yerleşim zıplamaz.
export function HaritaIskelet({ chip = 6 }: { chip?: number }) {
  return (
    <div className="space-y-3 animate-pulse" aria-label="Yükleniyor">
      <div className="bg-white rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {Array.from({ length: chip }, (_, i) => (
            <div key={i} className="h-[72px] w-36 rounded-lg bg-gray-100 border border-gray-200" />
          ))}
        </div>
      </div>
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="h-[420px] bg-gray-100" />
      </div>
    </div>
  );
}
