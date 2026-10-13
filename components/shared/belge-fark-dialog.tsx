"use client";

// BELGE KARŞILAŞTIRMA — yüklenen PDF ile sitedeki kaydı yan yana gösterir, seçilenleri yazar.
//
// Hiçbir şey kendiliğinden yazılmaz. Sebebi somut: taranmış belgelerde model tablo
// satırlarını karıştırabiliyor; bir geçici kabul tutanağında "7. Süre Uzatımı" satırını
// iş süresi sanmıştı. Bu yüzden her satırda belgedeki KAYNAK SATIR da gösteriliyor ve
// onay kullanıcıda.
//
// Tabloda yalnız farklar değil, uyuşan ve belgede bulunamayan alanlar da var — belgenin
// gerçekten o işe ait olduğu da görünsün diye.
import { useEffect, useState } from "react";
import { FileText, Check, Plus, AlertTriangle, Minus } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { uygulanabilir, type BelgeSatir } from "@/lib/belge-karsilastir";

const DURUM = {
  fark:   { im: AlertTriangle, renk: "text-red-600",     etiket: "farklı" },
  ekleme: { im: Plus,          renk: "text-indigo-600",  etiket: "eklenecek" },
  ayni:   { im: Check,         renk: "text-emerald-600", etiket: "aynı" },
  yok:    { im: Minus,         renk: "text-gray-400",    etiket: "belgede yok" },
} as const;

export default function BelgeFarkDialog({
  acik,
  satirlar,
  belgeAdi,
  onUygula,
  onKapat,
  onVazgec,
}: {
  acik: boolean;
  satirlar: BelgeSatir[];
  belgeAdi: string;
  onUygula: (secilen: BelgeSatir[]) => Promise<void> | void;
  /** Pencereyi kapatır, belge KALIR (çarpı / dışarı tıklama). */
  onKapat: () => void;
  /** Vazgeç: yüklenen belge geri alınır, mail gitmez. */
  onVazgec?: () => Promise<void> | void;
}) {
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [isleniyor, setIsleniyor] = useState(false);

  useEffect(() => {
    // Sitede BOŞ olan alanlar işaretli başlar (kaybedilecek bilgi yok); DEĞER ÇAKIŞANLAR
    // işaretsiz (mevcut veri bilerek girilmiş olabilir).
    setSecili(new Set(satirlar.filter((s) => s.durum === "ekleme").map((s) => s.alan)));
  }, [satirlar]);

  if (!acik || satirlar.length === 0) return null;

  const degistir = (alan: string) =>
    setSecili((s) => {
      const y = new Set(s);
      if (y.has(alan)) y.delete(alan); else y.add(alan);
      return y;
    });

  const uygula = async () => {
    setIsleniyor(true);
    try {
      await onUygula(satirlar.filter((s) => secili.has(s.alan)));
    } finally {
      setIsleniyor(false);
    }
  };

  const eklenecek = satirlar.filter((s) => s.durum === "ekleme").length;
  const farkli = satirlar.filter((s) => s.durum === "fark").length;
  const ayniSayi = satirlar.filter((s) => s.durum === "ayni").length;

  return (
    <Dialog open={acik} onOpenChange={(a) => { if (!a && !isleniyor) onKapat(); }}>
      {/* sm:max-w-4xl ŞART: DialogContent varsayılanında sm:max-w-sm var ve yalnız
          max-w-4xl yazmak onu geçmiyor — pencere 384px'te kalıp tablo sütunları
          ortadan bölünüyordu. */}
      <DialogContent className="max-w-4xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText size={18} className="text-[#1E3A5F]" />
            Belge ile kayıt karşılaştırması
          </DialogTitle>
          <DialogDescription>
            <span className="font-medium">{belgeAdi}</span> okundu.
            {farkli > 0 && ` ${farkli} alan farklı.`}
            {eklenecek > 0 && ` ${eklenecek} alan sitede boş.`}
            {ayniSayi > 0 && ` ${ayniSayi} alan belgeyle aynı.`}
            {" "}İşaretlediklerinizi yazarım, diğerlerine dokunmam.
            {onVazgec && " Vazgeçerseniz belge hiç yüklenmemiş sayılır."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
          {/* table-fixed + colgroup: alıntı metni uzun olduğunda tablo yanlara taşıyor ve
              "Alan" sütunu ekrandan kayıyordu. Sabit genişlikte metin satır atlıyor. */}
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
              <col className="w-[22%]" />
            </colgroup>
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-semibold">Alan</th>
                <th className="px-3 py-2 font-semibold">Sitedeki form</th>
                <th className="px-3 py-2 font-semibold">Belgede</th>
                <th className="px-3 py-2 text-right font-semibold">Düzelt</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s) => {
                const d = DURUM[s.durum];
                const Im = d.im;
                const secilebilir = uygulanabilir(s);
                const isaretli = secili.has(s.alan);
                return (
                  <tr
                    key={s.alan}
                    className={`border-t align-top ${isaretli ? "bg-sky-50" : "bg-white"} ${secilebilir ? "cursor-pointer" : ""}`}
                    onClick={() => { if (secilebilir && !isleniyor) degistir(s.alan); }}
                  >
                    <td className="break-words px-3 py-2 font-medium text-[#1E3A5F]">
                      {s.etiket}
                      {s.alinti && (
                        <div className="mt-0.5 line-clamp-2 text-[10px] font-normal italic leading-tight text-gray-500">
                          Belgede: “{s.alinti}”
                        </div>
                      )}
                    </td>
                    <td className={`break-words px-3 py-2 ${s.durum === "fark" ? "text-red-700" : "text-gray-700"}`}>
                      {s.site}
                    </td>
                    <td className={`break-words px-3 py-2 ${s.durum === "ayni" || s.durum === "yok" ? "text-gray-700" : "font-semibold text-emerald-800"}`}>
                      {s.belge}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={`mr-2 inline-flex items-center gap-1 whitespace-nowrap text-[11px] ${d.renk}`}>
                        <Im size={13} /> {d.etiket}
                      </span>
                      {secilebilir ? (
                        <input
                          type="checkbox"
                          className="align-middle"
                          checked={isaretli}
                          onChange={() => degistir(s.alan)}
                          onClick={(e) => e.stopPropagation()}
                          disabled={isleniyor}
                        />
                      ) : (
                        <span className="inline-block w-[13px]" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            onClick={async () => {
              if (!onVazgec) { onKapat(); return; }
              setIsleniyor(true);
              try { await onVazgec(); } finally { setIsleniyor(false); }
            }}
            disabled={isleniyor}
          >
            Vazgeç — belgeyi yükleme
          </Button>
          <Button
            type="button"
            className="bg-[#F97316] text-white hover:bg-[#ea580c]"
            onClick={uygula}
            disabled={isleniyor || secili.size === 0}
          >
            {isleniyor ? "Kaydediliyor…" : `Düzelt ve Kaydet (${secili.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
