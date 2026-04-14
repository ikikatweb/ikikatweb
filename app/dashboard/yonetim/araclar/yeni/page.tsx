// Yeni özmal araç ekleme sayfası
import PageHeader from "@/components/shared/page-header";
import AracForm from "@/components/shared/arac-form";

export default function YeniAracPage() {
  return (
    <div>
      <PageHeader title="Yeni Araç Ekle" />
      <AracForm tip="ozmal" />
    </div>
  );
}
