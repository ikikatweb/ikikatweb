// Bordro Takibi sayfası — kanban + drag-drop personel yönetimi
"use client";

import { useState } from "react";
import { UserPlus, Calendar, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import BordroTakibi from "../iscilik-takibi/BordroTakibi";
import GunlukUcretSayfasi from "./GunlukUcret";

type Sekme = "bordro" | "pasif-isler" | "gunluk-ucret";

export default function BordroTakibiPage() {
  const [sekme, setSekme] = useState<Sekme>("bordro");
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <UserPlus size={28} className="text-[#1E3A5F]" />
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Bordro Takibi</h1>
          <p className="text-sm text-gray-500">Personel atama, transfer ve giriş/çıkış yönetimi</p>
        </div>
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <Button
          variant={sekme === "bordro" ? "default" : "outline"}
          size="sm"
          onClick={() => setSekme("bordro")}
          className={sekme === "bordro" ? "bg-[#1E3A5F]" : ""}
        >
          <UserPlus size={14} className="mr-1" /> Bordro
        </Button>
        <Button
          variant={sekme === "pasif-isler" ? "default" : "outline"}
          size="sm"
          onClick={() => setSekme("pasif-isler")}
          className={sekme === "pasif-isler" ? "bg-[#64748B]" : ""}
        >
          <Archive size={14} className="mr-1" /> Geçici Kabulü Yapılmış İşler
        </Button>
        <Button
          variant={sekme === "gunluk-ucret" ? "default" : "outline"}
          size="sm"
          onClick={() => setSekme("gunluk-ucret")}
          className={sekme === "gunluk-ucret" ? "bg-[#1E3A5F]" : ""}
        >
          <Calendar size={14} className="mr-1" /> Günlük Ücret
        </Button>
      </div>

      {sekme === "bordro" && <BordroTakibi gosterilecekDurum="aktif" />}
      {sekme === "pasif-isler" && <BordroTakibi gosterilecekDurum="pasif" />}
      {sekme === "gunluk-ucret" && <GunlukUcretSayfasi />}
    </div>
  );
}
