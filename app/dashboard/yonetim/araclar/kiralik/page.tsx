// Kiralık araç ekleme sayfası
import PageHeader from "@/components/shared/page-header";
import AracForm from "@/components/shared/arac-form";

export default function KiralikAracPage() {
  return (
    <div>
      <PageHeader title="Kiralık Araç Ekle" />
      <AracForm tip="kiralik" />
    </div>
  );
}
