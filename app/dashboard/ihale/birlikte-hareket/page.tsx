// İhale Birlikte Hareket — Manuel kartel grup yönetimi
// Sistem otomatik bulduklarına ek olarak, kullanıcının kendi gözlemlerine
// göre işaretleyeceği firma grupları.
"use client";

import { useEffect, useState } from "react";
import {
  getManuelGruplar,
  postManuelGrup,
  putManuelGrup,
  deleteManuelGrup,
  searchFirma,
  type ManuelGrup,
  type FirmaArama,
  IHALE_AI_BASE,
} from "@/lib/ihale-ai-api";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Network, AlertCircle, Loader2, Plus, X, Pencil, Trash2, Search,
  Save,
} from "lucide-react";
import toast from "react-hot-toast";

const inputClass = "h-9 rounded-lg border border-input bg-white px-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/50";

type DialogState =
  | { type: "yok" }
  | { type: "yeni" }
  | { type: "duzenle"; grup: ManuelGrup };

export default function BirlikteHareketPage() {
  const [yukleniyor, setYukleniyor] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [gruplar, setGruplar] = useState<ManuelGrup[]>([]);
  const [dialog, setDialog] = useState<DialogState>({ type: "yok" });

  const yukle = async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      const r = await getManuelGruplar();
      setGruplar(r);
    } catch (e) {
      const msg = (e as Error).message;
      setHata(msg);
      toast.error(msg);
    } finally {
      setYukleniyor(false);
    }
  };

  useEffect(() => {
    yukle();
  }, []);

  async function silGrup(g: ManuelGrup) {
    if (!confirm(`"${g.grup_adi}" grubunu silmek istediğinden emin misin?`)) return;
    try {
      await deleteManuelGrup(g.id);
      toast.success("Silindi");
      yukle();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
            <Network size={22} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Birlikte Hareket Eden Firmalar</h1>
            <p className="text-sm text-gray-500">
              Kendi gözlemlediğin grupları kaydet — savaş simülasyonunda referans alınır
            </p>
          </div>
        </div>
        <Button
          onClick={() => setDialog({ type: "yeni" })}
          className="bg-orange-600 hover:bg-orange-700 text-white"
        >
          <Plus size={16} /> Yeni Grup
        </Button>
      </div>

      {hata && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 shrink-0" size={20} />
          <div>
            <p className="font-semibold text-red-900">Hata</p>
            <p className="text-sm text-red-700">{hata}</p>
            <p className="text-xs text-red-600 mt-2">
              Python sunucusu çalışıyor mu? <code className="bg-white px-1 rounded">{IHALE_AI_BASE}</code>
            </p>
          </div>
        </div>
      )}

      {yukleniyor && (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="animate-spin" size={16} /> Yükleniyor...
        </div>
      )}

      {/* Grup listesi */}
      {!yukleniyor && gruplar.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-10 text-center">
          <Network className="mx-auto text-gray-400 mb-3" size={40} />
          <p className="text-gray-600 font-medium">Henüz manuel grup yok</p>
          <p className="text-sm text-gray-400 mt-1">
            Şüphelendiğin birlikte hareket eden firmaları gruplayabilirsin
          </p>
          <Button
            onClick={() => setDialog({ type: "yeni" })}
            className="mt-4 bg-orange-600 hover:bg-orange-700 text-white"
          >
            <Plus size={16} /> İlk Grubu Oluştur
          </Button>
        </div>
      )}

      {gruplar.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grup Adı</TableHead>
                <TableHead className="text-center">Firma Sayısı</TableHead>
                <TableHead>Firmalar</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead>Güncelleme</TableHead>
                <TableHead className="text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gruplar.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.grup_adi}</TableCell>
                  <TableCell className="text-center">{g.firmalar.length}</TableCell>
                  <TableCell className="max-w-[300px]">
                    <div className="flex flex-wrap gap-1">
                      {g.firmalar.slice(0, 3).map((f) => (
                        <span key={f} className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[11px]">
                          {f.length > 20 ? f.substring(0, 20) + "…" : f}
                        </span>
                      ))}
                      {g.firmalar.length > 3 && (
                        <span className="text-xs text-gray-400">+{g.firmalar.length - 3}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm text-gray-600" title={g.aciklama}>
                    {g.aciklama || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {new Date(g.guncelleme_tarihi).toLocaleDateString("tr-TR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => setDialog({ type: "duzenle", grup: g })}
                        title="Düzenle"
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => silGrup(g)}
                        title="Sil"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog */}
      {dialog.type !== "yok" && (
        <GrupDialog
          mode={dialog.type}
          grup={dialog.type === "duzenle" ? dialog.grup : null}
          onClose={() => setDialog({ type: "yok" })}
          onSaved={() => {
            setDialog({ type: "yok" });
            yukle();
          }}
        />
      )}
    </div>
  );
}

function GrupDialog({
  mode, grup, onClose, onSaved,
}: {
  mode: "yeni" | "duzenle";
  grup: ManuelGrup | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grupAdi, setGrupAdi] = useState(grup?.grup_adi ?? "");
  const [aciklama, setAciklama] = useState(grup?.aciklama ?? "");
  const [firmalar, setFirmalar] = useState<{ kanon: string; ad: string }[]>(
    grup
      ? grup.firmalar.map((k) => ({ kanon: k, ad: k }))
      : [],
  );
  const [arama, setArama] = useState("");
  const [aramaSonuclari, setAramaSonuclari] = useState<FirmaArama[]>([]);
  const [aramaYapiliyor, setAramaYapiliyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);

  // Debounced arama
  useEffect(() => {
    if (arama.length < 2) {
      setAramaSonuclari([]);
      return;
    }
    const t = setTimeout(async () => {
      setAramaYapiliyor(true);
      try {
        const r = await searchFirma(arama, 15);
        setAramaSonuclari(r);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setAramaYapiliyor(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [arama]);

  const ekleFirma = (f: FirmaArama) => {
    if (firmalar.some((x) => x.kanon === f.firma_kanon)) {
      toast.error("Bu firma zaten ekli");
      return;
    }
    setFirmalar([...firmalar, { kanon: f.firma_kanon, ad: f.firma_adi }]);
    setArama("");
    setAramaSonuclari([]);
  };

  const cikarFirma = (kanon: string) => {
    setFirmalar(firmalar.filter((f) => f.kanon !== kanon));
  };

  const kaydet = async () => {
    if (!grupAdi.trim()) {
      toast.error("Grup adı girin");
      return;
    }
    if (firmalar.length < 2) {
      toast.error("En az 2 firma seçin");
      return;
    }
    setKaydediliyor(true);
    try {
      const req = {
        grup_adi: grupAdi.trim(),
        aciklama: aciklama.trim(),
        firmalar: firmalar.map((f) => f.kanon),
      };
      if (mode === "yeni") {
        await postManuelGrup(req);
        toast.success("Grup oluşturuldu");
      } else if (grup) {
        await putManuelGrup(grup.id, req);
        toast.success("Grup güncellendi");
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setKaydediliyor(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "yeni" ? "Yeni Birlikte Hareket Grubu" : "Grubu Düzenle"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="mb-1.5 block">Grup Adı *</Label>
            <Input
              className={inputClass + " w-full"}
              type="text"
              value={grupAdi}
              onChange={(e) => setGrupAdi(e.target.value)}
              placeholder="örn. Adıyaman Grubu"
              disabled={kaydediliyor}
            />
          </div>
          <div>
            <Label className="mb-1.5 block">Açıklama</Label>
            <Textarea
              className="min-h-[60px] rounded-lg border border-input bg-white px-3 py-2 text-sm"
              value={aciklama}
              onChange={(e) => setAciklama(e.target.value)}
              placeholder="Bu grup hakkında kısa not..."
              disabled={kaydediliyor}
            />
          </div>

          {/* Firma arama */}
          <div>
            <Label className="mb-1.5 block">Firma Ekle ({firmalar.length} eklendi)</Label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                className={inputClass + " w-full pl-8"}
                type="text"
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                placeholder="Firma adı yaz (en az 2 harf)..."
                disabled={kaydediliyor}
              />
              {aramaYapiliyor && (
                <Loader2 className="animate-spin absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
              )}
            </div>
            {aramaSonuclari.length > 0 && (
              <div className="mt-2 border border-gray-200 rounded-lg bg-white max-h-60 overflow-y-auto shadow-sm">
                {aramaSonuclari.map((f) => {
                  const ekli = firmalar.some((x) => x.kanon === f.firma_kanon);
                  return (
                    <button
                      key={f.firma_kanon}
                      onClick={() => !ekli && ekleFirma(f)}
                      disabled={ekli}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 last:border-0 transition-colors ${
                        ekli
                          ? "bg-gray-50 text-gray-400 cursor-not-allowed"
                          : "hover:bg-orange-50 cursor-pointer"
                      }`}
                    >
                      <div className="font-medium text-gray-800">{f.firma_adi}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{f.firma_kanon}</div>
                      {ekli && <span className="text-[11px] text-gray-500">(zaten ekli)</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Eklenen firmalar */}
          {firmalar.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
              <div className="text-xs font-semibold text-gray-700 mb-2">Eklenen Firmalar:</div>
              <div className="flex flex-wrap gap-2">
                {firmalar.map((f) => (
                  <div
                    key={f.kanon}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-300 rounded-full text-sm"
                  >
                    <span title={f.kanon}>
                      {f.ad.length > 30 ? f.ad.substring(0, 30) + "…" : f.ad}
                    </span>
                    <button
                      onClick={() => cikarFirma(f.kanon)}
                      className="text-gray-400 hover:text-red-600"
                      disabled={kaydediliyor}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Aksiyon */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <Button variant="ghost" onClick={onClose} disabled={kaydediliyor}>
              İptal
            </Button>
            <Button
              onClick={kaydet}
              disabled={kaydediliyor}
              className="bg-orange-600 hover:bg-orange-700 text-white"
            >
              {kaydediliyor ? (
                <><Loader2 className="animate-spin" size={16} /> Kaydediliyor</>
              ) : (
                <><Save size={16} /> Kaydet</>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
