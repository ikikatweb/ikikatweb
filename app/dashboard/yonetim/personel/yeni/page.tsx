// Yeni personel ekleme sayfası
import PageHeader from "@/components/shared/page-header";
import PersonelForm from "@/components/shared/personel-form";

export default function YeniPersonelPage() {
  return (
    <div>
      <PageHeader title="Personel Ekle" />
      <PersonelForm />
    </div>
  );
}
