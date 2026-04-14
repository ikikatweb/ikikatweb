// Yeni firma ekleme sayfası
import PageHeader from "@/components/shared/page-header";
import FirmaForm from "@/components/shared/firma-form";

export default function YeniFirmaPage() {
  return (
    <div>
      <PageHeader title="Yeni Firma Ekle" />
      <FirmaForm />
    </div>
  );
}
