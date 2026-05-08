// Günlük Ücret — yıl bazlı tutar yönetimi
"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, Plus, Trash2, Pencil } from "lucide-react";
import toast from "react-hot-toast";
import {
  getGunlukUcretler, setGunlukUcret, deleteGunlukUcret,
  type GunlukUcret,
} from "@/lib/supabase/queries/bordro";
import { formatParaInput, parseParaInput } from "@/lib/utils/para-format";
import { useAuth } from "@/hooks";

export default function GunlukUcretSayfasi() {
  const { hasPermission } = useAuth();
  // Bordro takibi modülü yetkileri (Günlük Ücret de bu modülün altında)
  const yEkle = hasPermission("bordro-takibi", "ekle");
  const yDuzenle = hasPermission("bordro-takibi", "duzenle");
  const ySil = hasPermission("bordro-takibi", "sil");
  const [list, setList] = useState<GunlukUcret[]>([]);
  const [loading, setLoading] = useState(true);
  const [yeniYil, setYeniYil] = useState<string>(String(new Date().getFullYear()));
  const [yeniUcret, setYeniUcret] = useState<string>("");
  const [editYil, setEditYil] = useState<number | null>(null);
  const [editUcret, setEditUcret] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getGunlukUcretler();
      setList(data);
    } catch (err) {
      toast.error(`Yükleme hatası: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function ekle() {
    if (!yEkle) { toast.error("Ekleme yetkiniz yok."); return; }
    const yil = parseInt(yeniYil, 10);
    const ucret = parseParaInput(yeniUcret);
    if (!yil || yil < 2000 || yil > 2100) { toast.error("Geçerli yıl girin (2000-2100)"); return; }
    if (ucret <= 0) { toast.error("Ücret 0'dan büyük olmalı"); return; }
    try {
      await setGunlukUcret(yil, ucret);
      toast.success(`${yil} yılı için günlük ücret kaydedildi`);
      setYeniUcret("");
      await load();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function kaydetEdit() {
    if (!yDuzenle) { toast.error("Düzenleme yetkiniz yok."); return; }
    if (editYil == null) return;
    const ucret = parseParaInput(editUcret);
    if (ucret <= 0) { toast.error("Ücret 0'dan büyük olmalı"); return; }
    try {
      await setGunlukUcret(editYil, ucret);
      toast.success(`${editYil} güncellendi`);
      setEditYil(null);
      setEditUcret("");
      await load();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function sil(yil: number) {
    if (!ySil) { toast.error("Silme yetkiniz yok."); return; }
    if (!confirm(`${yil} yılı günlük ücretini silmek istediğinize emin misiniz?`)) return;
    try {
      await deleteGunlukUcret(yil);
      toast.success(`${yil} silindi`);
      await load();
    } catch (err) {
      toast.error(`Hata: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <Calendar size={24} className="text-[#1E3A5F]" />
        <div>
          <h2 className="text-xl font-bold text-[#1E3A5F]">Günlük Ücret</h2>
          <p className="text-sm text-gray-500">
            Yıl bazlı günlük ücret tanımlayın. Bordro hesaplamalarında kullanılır.
          </p>
        </div>
      </div>

      {/* Yeni ekle — sadece ekleme yetkisi olanlar görür */}
      {yEkle && (
      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-4">
        <div className="text-xs font-semibold text-blue-700 mb-2">Yeni Yıl Ekle / Güncelle</div>
        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <Label className="text-xs">Yıl</Label>
            <Input type="number" min={2000} max={2100}
              value={yeniYil} onChange={(e) => setYeniYil(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Günlük Ücret (TL)</Label>
            <Input type="text" inputMode="decimal"
              value={yeniUcret}
              onChange={(e) => setYeniUcret(formatParaInput(e.target.value))}
              placeholder="0,00" />
          </div>
        </div>
        <Button onClick={ekle} className="bg-blue-600 hover:bg-blue-700 text-white" size="sm">
          <Plus size={14} className="mr-1" /> Kaydet
        </Button>
      </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Yükleniyor...</div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg border text-gray-400 text-sm">
          Henüz tanımlı yıl yok.
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-700 px-4 py-2">Yıl</th>
                <th className="text-right text-xs font-semibold text-gray-700 px-4 py-2">Günlük Ücret</th>
                <th className="text-center text-xs font-semibold text-gray-700 px-4 py-2 w-32">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {list.map((u) => (
                <tr key={u.id} className="border-b last:border-b-0 hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-bold text-[#1E3A5F]">{u.yil}</td>
                  <td className="px-4 py-2 text-right text-sm font-semibold">
                    {editYil === u.yil ? (
                      <Input type="text" inputMode="decimal"
                        value={editUcret}
                        onChange={(e) => setEditUcret(formatParaInput(e.target.value))}
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") kaydetEdit(); if (e.key === "Escape") setEditYil(null); }}
                        className="text-right" />
                    ) : (
                      <span>{u.ucret.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {editYil === u.yil ? (
                      <div className="flex gap-1 justify-center">
                        <button onClick={kaydetEdit} className="text-xs px-2 py-1 bg-emerald-600 text-white rounded">Kaydet</button>
                        <button onClick={() => setEditYil(null)} className="text-xs px-2 py-1 border rounded">İptal</button>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-center">
                        {yDuzenle && (
                          <button onClick={() => { setEditYil(u.yil); setEditUcret(formatParaInput(String(u.ucret).replace(".", ","))); }}
                            className="p-1.5 text-gray-400 hover:text-blue-600" title="Düzenle">
                            <Pencil size={14} />
                          </button>
                        )}
                        {ySil && (
                          <button onClick={() => sil(u.yil)} className="p-1.5 text-gray-400 hover:text-red-600" title="Sil">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
