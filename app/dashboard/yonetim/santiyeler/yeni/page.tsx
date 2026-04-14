// Yeni iş (şantiye) ekleme sayfası
import PageHeader from "@/components/shared/page-header";
import SantiyeForm from "@/components/shared/santiye-form";

export default function YeniSantiyePage() {
  return (
    <div>
      <PageHeader title="Yeni İş Ekle" />
      <SantiyeForm />
    </div>
  );
}
