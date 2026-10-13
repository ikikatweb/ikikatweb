"use client";

// BELGE FARKLARI — yüklenen PDF ile sitedeki kayıt arasındaki farkları seçmeli uygular.
//
// Hiçbir şey kendiliğinden yazılmaz. Sebebi somut: taranmış belgelerde model tablo
// satırlarını karıştırabiliyor; bir geçici kabul tutanağında sözleşme bedelini
// 2.841.065,90 yerine ,99 okumuştu ve iş süresiyle süre uzatımını yer değiştirmişti.
// Bu yüzden her satırda belgedeki KAYNAK SATIR da gösteriliyor ve onay kullanıcıda.
//
// Varsayılan seçim: sitede BOŞ olan alanlar işaretli gelir (kaybedilecek bilgi yok),
// DEĞER ÇAKIŞAN alanlar işaretsiz gelir (mevcut veri bilerek girilmiş olabilir).
import { useEffect, useState } from "react";
import { FileText, AlertTriangle } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export type BelgeFark = {
  alan: string;
  etiket: string;
  /** Sitedeki değerin gösterimi ("boş" olabilir) */
  site: string;
  /** Belgeden okunan değerin gösterimi */
  belge: string;
  /** Yazılacak ham değer */
  deger: string | number | null;
  /** Belgedeki kaynak satır — kullanıcı neye dayandığını görsün */
  alinti?: string;
  /** Sitede karşılığı boş mu (true) yoksa farklı bir değer mi var (false) */
  bosDoldurma: boolean;
};

export default function BelgeFarkDialog({
  acik,
  farklar,
  belgeAdi,
  onUygula,
  onKapat,
}: {
  acik: boolean;
  farklar: BelgeFark[];
  belgeAdi: string;
  onUygula: (secilen: BelgeFark[]) => Promise<void> | void;
  onKapat: () => void;
}) {
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    // Boş alanlar işaretli, çakışanlar işaretsiz başlar.
    setSecili(new Set(farklar.filter((f) => f.bosDoldurma).map((f) => f.alan)));
  }, [farklar]);

  if (!acik || farklar.length === 0) return null;

  const degistir = (alan: string) =>
    setSecili((s) => {
      const y = new Set(s);
      if (y.has(alan)) y.delete(alan); else y.add(alan);
      return y;
    });

  const uygula = async () => {
    setIsleniyor(true);
    try {
      await onUygula(farklar.filter((f) => secili.has(f.alan)));
    } finally {
      setIsleniyor(false);
    }
  };

  const bosSayisi = farklar.filter((f) => f.bosDoldurma).length;
  const cakisan = farklar.length - bosSayisi;

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a && !isleniyor) onKapat(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} className="text-[#1E3A5F]" />
            Belgedeki bilgiler kayıttan farklı
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{belgeAdi}</span> okundu.
            {bosSayisi > 0 && ` Sitede boş olan ${bosSayisi} alan doldurulabilir.`}
            {cakisan > 0 && ` ${cakisan} alanda farklı değer var.`}
            {" "}İşaretlediklerinizi uygularım, diğerlerine dokunmam.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto">
          {farklar.map((f) => (
            <label
              key={f.alan}
              className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${
                secili.has(f.alan) ? "border-sky-300 bg-sky-50" : "border-gray-200 bg-white"
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={secili.has(f.alan)}
                onChange={() => degistir(f.alan)}
                disabled={isleniyor}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-[#1E3A5F]">{f.etiket}</span>
                  {!f.bosDoldurma && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      <AlertTriangle size={10} /> mevcut değer değişecek
                    </span>
                  )}
                </span>
                <span className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="rounded bg-red-50 px-1.5 text-red-700 line-through decoration-red-300">
                    {f.site}
                  </span>
                  <span className="text-gray-400">→</span>
                  <span className="rounded bg-emerald-50 px-1.5 font-medium text-emerald-800">
                    {f.belge}
                  </span>
                </span>
                {f.alinti && (
                  <span className="mt-1 block text-[11px] italic text-gray-500">
                    Belgede: “{f.alinti}”
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onKapat} disabled={isleniyor}>
            Hiçbirini uygulama
          </Button>
          <Button
            type="button"
            className="bg-[#F97316] text-white hover:bg-[#ea580c]"
            onClick={uygula}
            disabled={isleniyor || secili.size === 0}
          >
            {isleniyor ? "Uygulanıyor…" : `Seçilenleri uygula (${secili.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
