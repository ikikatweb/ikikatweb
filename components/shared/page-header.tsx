// Sayfa başlığı bileşeni - Başlık ve opsiyonel aksiyon butonu
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

type PageHeaderProps = {
  title: string;
  actionLabel?: string;
  actionHref?: string;
};

export default function PageHeader({
  title,
  actionLabel,
  actionHref,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="text-2xl font-bold text-[#1E3A5F]">{title}</h1>
      {actionLabel && actionHref && (
        <Link href={actionHref}>
          <Button className="bg-[#F97316] hover:bg-[#ea580c] text-white">
            <Plus size={18} className="mr-1" />
            {actionLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
