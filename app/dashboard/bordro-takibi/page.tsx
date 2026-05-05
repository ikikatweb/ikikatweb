// Bordro Takibi sayfası — kanban + drag-drop personel yönetimi
"use client";

import { UserPlus } from "lucide-react";
import BordroTakibi from "../iscilik-takibi/BordroTakibi";

export default function BordroTakibiPage() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <UserPlus size={28} className="text-[#1E3A5F]" />
        <div>
          <h1 className="text-2xl font-bold text-[#1E3A5F]">Bordro Takibi</h1>
          <p className="text-sm text-gray-500">Personel atama, transfer ve giriş/çıkış yönetimi</p>
        </div>
      </div>
      <BordroTakibi />
    </div>
  );
}
