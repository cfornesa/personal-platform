import { AdminLayout } from "@/components/admin/AdminLayout";
import { ExhibitsManagementCard } from "@/components/post/ExhibitsManagementCard";

export default function AdminExhibitsPage() {
  return (
    <AdminLayout
      title="Exhibits"
      description="Named collections of art pieces and images. Assign artwork from the Pieces and Image Library pages, then view the museum wall via the link next to each exhibit."
    >
      <ExhibitsManagementCard />
    </AdminLayout>
  );
}
