import { Link } from "wouter";
import { useMemo } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import {
  useListPages,
  useDeletePage,
  useListNavLinks,
  useUpdateNavLink,
  getListPagesQueryKey,
  getListNavLinksQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Pencil, Trash2, ExternalLink, FileText, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const PAGES_QUERY_KEY = getListPagesQueryKey({ includeDrafts: "1" });
const NAV_QUERY_KEY = getListNavLinksQueryKey({ includeHidden: "1" });

function formatTimestamp(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export default function AdminPagesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const list = useListPages(
    { includeDrafts: "1" },
    { query: { queryKey: PAGES_QUERY_KEY } },
  );
  const navList = useListNavLinks(
    { includeHidden: "1" },
    { query: { queryKey: NAV_QUERY_KEY } },
  );
  const pages = list.data?.pages ?? [];
  const navByPageId = useMemo(() => {
    const map = new Map<number, { id: number; visible: boolean }>();
    for (const link of navList.data?.links ?? []) {
      if (link.kind === "page" && link.pageId != null) {
        map.set(link.pageId, { id: link.id, visible: link.visible });
      }
    }
    return map;
  }, [navList.data?.links]);

  const remove = useDeletePage({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: PAGES_QUERY_KEY });
        queryClient.invalidateQueries({ queryKey: NAV_QUERY_KEY });
        toast({ title: "Page deleted" });
      },
      onError: () =>
        toast({ title: "Couldn't delete page", variant: "destructive" }),
    },
  });

  const updateNav = useUpdateNavLink({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: NAV_QUERY_KEY });
      },
      onError: () =>
        toast({ title: "Couldn't change nav visibility", variant: "destructive" }),
    },
  });

  return (
    <AdminLayout
      title="Pages"
      description="Standalone CMS pages. Each page is addressed at /p/<slug>. The Hide/Show actions toggle just the navbar entry; the page itself stays published."
    >
      <div className="mb-4 flex justify-end">
        <Button asChild>
          <Link href="/admin/pages/new">
            <Plus className="mr-1 h-4 w-4" /> New page
          </Link>
        </Button>
      </div>
      {list.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : pages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No pages yet. Create your first page to publish standalone content like an &ldquo;About&rdquo; page or colophon.
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2">
          {pages.map((p) => {
            const navRow = navByPageId.get(p.id);
            const navVisible = Boolean(navRow?.visible);
            return (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3"
                data-testid={`admin-page-row-${p.id}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                    {p.title}
                    <StatusBadge status={p.status} />
                    {navVisible ? (
                      <span
                        className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary"
                        data-testid={`admin-page-nav-badge-${p.id}`}
                      >
                        in nav
                      </span>
                    ) : navRow ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        nav hidden
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    /p/{p.slug}
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    Last edited {formatTimestamp(p.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {navRow ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      title={navVisible ? "Hide from menu" : "Show in menu"}
                      aria-label={navVisible ? "Hide from menu" : "Show in menu"}
                      disabled={updateNav.isPending}
                      onClick={() =>
                        updateNav.mutate({
                          id: navRow.id,
                          data: { visible: !navVisible },
                        })
                      }
                      data-testid={`admin-page-nav-toggle-${p.id}`}
                    >
                      {navVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </Button>
                  ) : null}
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <a href={`/p/${p.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                    <Link href={`/admin/pages/${p.id}/edit`}>
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Move &ldquo;{p.title}&rdquo; to the Recycle Bin?</AlertDialogTitle>
                        <AlertDialogDescription>
                          The page will be hidden from the navbar and /p/{p.slug} will 404 until restored.
                          You can recover it or permanently delete it from the Recycle Bin.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove.mutate({ id: p.id })}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Move to Recycle Bin
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </AdminLayout>
  );
}

function StatusBadge({ status }: { status: "draft" | "published" }) {
  const styles =
    status === "published"
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
      : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${styles}`}>
      {status}
    </span>
  );
}
