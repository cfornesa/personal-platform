import type { ReactNode } from "react";
import { Link, useLocation, useRoute, Redirect } from "wouter";
import { getGetBootstrapStatusQueryKey, useGetBootstrapStatus } from "@workspace/api-client-react";
import { Settings, Tags, Link2, FileText, Rss, Inbox, ShieldCheck, ChevronLeft, Sparkles, Share2, Palette, CalendarDays, Images, LayoutGrid, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";

// Chrome wrapper for /admin/* routes. Owner-gates client-side (server
// is the real gate via requireOwner) and renders the sidebar.
const NAV: Array<{
  href: string;
  label: string;
  icon: typeof Settings;
  group: "site" | "feeds" | "outbound";
}> = [
  { href: "/admin", label: "Site", icon: Settings, group: "site" },
  { href: "/admin/posts", label: "Posts", icon: CalendarDays, group: "site" },
  { href: "/admin/ai", label: "AI", icon: Sparkles, group: "site" },
  { href: "/admin/pieces", label: "Pieces", icon: Palette, group: "site" },
  { href: "/admin/library", label: "Image Library", icon: Images, group: "site" },
  { href: "/admin/exhibits", label: "Exhibits", icon: LayoutGrid, group: "site" },
  { href: "/admin/categories", label: "Categories", icon: Tags, group: "site" },
  { href: "/admin/navigation", label: "Navigation", icon: Link2, group: "site" },
  { href: "/admin/pages", label: "Pages", icon: FileText, group: "site" },
  { href: "/admin/feeds", label: "Feed sources", icon: Rss, group: "feeds" },
  { href: "/admin/pending", label: "Review queue", icon: Inbox, group: "feeds" },
  { href: "/admin/platforms", label: "Platforms", icon: Share2, group: "outbound" },
  { href: "/admin/recycle-bin", label: "Recycle Bin", icon: Trash2, group: "site" },
];

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
};

export function AdminLayout({ title, description, children }: Props) {
  const { isLoading, isOwner } = useCurrentUser();
  const [location] = useLocation();
  const [isSetupRoute] = useRoute("/admin/setup");
  const bootstrapQuery = useGetBootstrapStatus({
    query: {
      enabled: isOwner,
      queryKey: getGetBootstrapStatusQueryKey(),
      staleTime: 10_000,
    },
  });

  if (isLoading || (isOwner && bootstrapQuery.isLoading && !isSetupRoute)) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-16 text-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!isOwner) {
    return <Redirect to="/" />;
  }
  if (!isSetupRoute && bootstrapQuery.data?.currentUserNeedsSetup) {
    return <Redirect to={bootstrapQuery.data.setupPath} />;
  }

  const siteItems = NAV.filter((n) => n.group === "site");
  const feedItems = NAV.filter((n) => n.group === "feeds");
  const outboundItems = NAV.filter((n) => n.group === "outbound");

  return (
    <div className="container mx-auto max-w-6xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/settings" className="inline-flex items-center gap-1 hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> back to your account
        </Link>
      </div>
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold leading-tight">Admin</h1>
          <p className="text-xs text-muted-foreground">Owner-only site management</p>
        </div>
      </div>
      <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
        <Card className="self-start p-2">
          <Section title="Site" items={siteItems} location={location} />
          <hr className="my-2 border-border" />
          <Section title="Inbound feeds" items={feedItems} location={location} />
          <hr className="my-2 border-border" />
          <Section title="Outbound" items={outboundItems} location={location} />
        </Card>
        <div className="min-w-0">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  items,
  location,
}: {
  title: string;
  items: typeof NAV;
  location: string;
}) {
  return (
    <nav className="space-y-0.5" aria-label={title}>
      <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.map((it) => {
        const Icon = it.icon;
        const isActive =
          it.href === "/admin"
            ? location === "/admin"
            : location === it.href || location.startsWith(`${it.href}/`);
        return (
          <Link
            key={it.href}
            href={it.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
              isActive
                ? "bg-primary/10 font-medium text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            data-testid={`admin-nav-${it.href.replace(/\//g, "-")}`}
          >
            <Icon className="h-4 w-4" />
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
