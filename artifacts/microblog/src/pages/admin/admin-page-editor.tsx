import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPages,
  useCreatePage,
  useUpdatePage,
  useUploadMedia,
  getListPagesQueryKey,
  getGetPageBySlugQueryKey,
  getListNavLinksQueryKey,
} from "@workspace/api-client-react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink } from "lucide-react";
import { normalizePieceEmbedUrls } from "@/lib/content-normalization";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { RichPostEditor } from "@/components/post/RichPostEditor";

const ALL_QUERY_KEY = getListPagesQueryKey({ includeDrafts: "1" });

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function slugifyTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function clientValidateSlug(raw: string): string | null {
  const slug = raw.trim().toLowerCase();
  if (!slug) return "slug is required";
  if (slug.length > 96) return "slug must be 96 characters or fewer";
  if (!SLUG_PATTERN.test(slug)) {
    return "slug must be lowercase letters, digits, and hyphens (cannot start or end with a hyphen)";
  }
  return null;
}

export default function AdminPageEditor() {
  const params = useParams<{ id?: string }>();
  const editId = params.id ? Number.parseInt(params.id, 10) : null;
  const isEdit = editId !== null && Number.isFinite(editId);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: siteSettings } = useSiteSettings();
  const canonicalOrigin = 
    (window as any).__CANONICAL_ORIGIN__ || 
    siteSettings?.allowedOrigins?.[0] || 
    window.location.origin;

  const list = useListPages(
    { includeDrafts: "1" },
    { query: { queryKey: ALL_QUERY_KEY } },
  );
  const target = useMemo(
    () => (isEdit ? list.data?.pages.find((p) => p.id === editId) : null),
    [list.data?.pages, isEdit, editId],
  );

  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [content, setContent] = useState("");
  const [showInNav, setShowInNav] = useState(true);
  const [showInNavInitial, setShowInNavInitial] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"draft" | "published">("draft");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [slugSuggestion, setSlugSuggestion] = useState<string | null>(null);
  const [hasLoadedTarget, setHasLoadedTarget] = useState(false);

  useEffect(() => {
    if (target && !hasLoadedTarget) {
      setTitle(target.title);
      setSlug(target.slug);
      setSlugTouched(true);
      setContent(target.content);
      setShowInNav(target.showInNav);
      setShowInNavInitial(target.showInNav);
      setStatus(target.status);
      setHasLoadedTarget(true);
    }
  }, [target, hasLoadedTarget]);

  const create = useCreatePage();
  const update = useUpdatePage();
  const uploadMedia = useUploadMedia();
  const isPending = create.isPending || update.isPending;

  const computedSlug = slugTouched ? slug : slugifyTitle(title);
  const otherPages = useMemo(
    () => (list.data?.pages ?? []).filter((p) => p.id !== editId),
    [list.data?.pages, editId],
  );

  const onSlugBlur = () => {
    const candidate = computedSlug.trim().toLowerCase();
    if (!candidate) {
      setSlugError(null);
      return;
    }
    const localError = clientValidateSlug(candidate);
    if (localError) {
      setSlugError(localError);
      return;
    }
    if (otherPages.some((p) => p.slug === candidate)) {
      setSlugError(`\`${candidate}\` is already taken by another page`);
      return;
    }
    setSlugError(null);
  };

  const submit = (publish: boolean) => {
    setSlugError(null);
    setSlugSuggestion(null);
    const finalTitle = title.trim();
    const finalSlug = computedSlug.trim().toLowerCase();
    if (!finalTitle) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }
    const localError = clientValidateSlug(finalSlug);
    if (localError) {
      setSlugError(localError);
      return;
    }
    const finalStatus = publish ? "published" : status;
    const normalizedContent = normalizePieceEmbedUrls(content, canonicalOrigin);

    const onSuccess = (page: { id: number; slug: string }) => {
      queryClient.invalidateQueries({ queryKey: ALL_QUERY_KEY });
      queryClient.invalidateQueries({
        queryKey: getGetPageBySlugQueryKey(page.slug),
      });
      // Page mutations can add, remove, rename, or rehide nav rows
      // (the `showInNav` toggle and the slug both feed the navbar
      // query). Invalidate both the public and owner-only nav-link
      // queries so the navbar re-renders without a manual reload.
      queryClient.invalidateQueries({ queryKey: getListNavLinksQueryKey() });
      queryClient.invalidateQueries({
        queryKey: getListNavLinksQueryKey({ includeHidden: "1" }),
      });
      toast({
        title: isEdit ? "Page updated" : "Page created",
        description: publish ? "Published" : "Saved as draft",
      });
      setLocation("/admin/pages");
    };
    const onError = (err: unknown) => {
      const data = (err as { response?: { data?: { error?: string; suggestion?: string } } })
        ?.response?.data;
      const message = data?.error ?? "Save failed";
      const suggestion = typeof data?.suggestion === "string" ? data.suggestion : null;
      if (/slug/i.test(message)) {
        setSlugError(message);
        setSlugSuggestion(suggestion);
      } else {
        toast({ title: "Save failed", description: message, variant: "destructive" });
      }
    };

    if (isEdit && editId !== null) {
      const showInNavChanged =
        showInNavInitial !== null && showInNav !== showInNavInitial;
      update.mutate(
        {
          id: editId,
          data: {
            title: finalTitle,
            slug: finalSlug,
            content: normalizedContent,
            status: finalStatus,
            ...(showInNavChanged ? { showInNav } : {}),
          },
        },
        { onSuccess: (data) => onSuccess(data), onError },
      );
    } else {
      create.mutate(
        {
          data: {
            title: finalTitle,
            slug: finalSlug,
            content: normalizedContent,
            status: finalStatus,
            showInNav,
          },
        },
        { onSuccess: (data) => onSuccess(data), onError },
      );
    }
  };

  return (
    <AdminLayout
      title={isEdit ? `Edit page` : "New page"}
      description="HTML content runs through the same sanitizer that posts use. Drafts only show to you."
    >
      {isEdit && list.isLoading && !hasLoadedTarget ? (
        <p className="text-sm text-muted-foreground">Loading page…</p>
      ) : isEdit && !target && !list.isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Page not found.{" "}
            <Link href="/admin/pages" className="underline">
              Back to pages
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardContent className="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="page-title">Title</Label>
                <Input
                  id="page-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={255}
                  placeholder="About"
                  data-testid="page-title-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="page-slug">Slug</Label>
                <div className="flex items-stretch gap-2">
                  <span className="inline-flex items-center rounded-md border border-input bg-muted px-3 text-xs text-muted-foreground">
                    /p/
                  </span>
                  <Input
                    id="page-slug"
                    value={computedSlug}
                    onChange={(e) => {
                      setSlug(e.target.value);
                      setSlugTouched(true);
                      setSlugError(null);
                      setSlugSuggestion(null);
                    }}
                    onBlur={onSlugBlur}
                    maxLength={96}
                    placeholder="about"
                    data-testid="page-slug-input"
                  />
                </div>
                {slugError ? (
                  <p className="text-xs text-destructive" data-testid="page-slug-error">
                    {slugError}
                    {slugSuggestion ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setSlug(slugSuggestion);
                            setSlugTouched(true);
                            setSlugError(null);
                            setSlugSuggestion(null);
                          }}
                          data-testid="page-slug-suggestion-apply"
                        >
                          Use &ldquo;{slugSuggestion}&rdquo;
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Lowercase letters, digits, and hyphens. A few names
                    (e.g. &ldquo;feeds&rdquo;, &ldquo;categories&rdquo;)
                    are reserved by the platform; the server will reject
                    those on save.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Content</Label>
                <RichPostEditor
                  initialContent={hasLoadedTarget || !isEdit ? content : ""}
                  placeholder="Write the page content. Same toolbar as posts."
                  submitLabel="Apply"
                  cancelLabel="Reset"
                  showCategories={false}
                  showTitle={false}
                  isSubmitting={isPending || uploadMedia.isPending}
                  onUpload={async (file) => {
                    const uploaded = await uploadMedia.mutateAsync({
                      data: { file },
                    });
                    return uploaded.url;
                  }}
                  onContentChange={(html) => setContent(html)}
                  onSubmit={(payload) => setContent(payload.content)}
                  onCancel={() => setContent(target?.content ?? "")}
                />
                <p className="text-xs text-muted-foreground">
                  HTML is sanitized on save.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={status === "published"}
                    onCheckedChange={(v) => setStatus(v ? "published" : "draft")}
                    data-testid="page-status-toggle"
                  />
                  {status === "published" ? "Published" : "Draft"}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={showInNav}
                    onCheckedChange={(v) => setShowInNav(Boolean(v))}
                    data-testid="page-show-in-nav-toggle"
                  />
                  Add to nav on publish
                </label>
                {isEdit && target?.status === "published" ? (
                  <a
                    href={`/p/${target.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-3 w-3" />
                    View live
                  </a>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <div className="flex justify-between">
            <Button asChild variant="outline">
              <Link href="/admin/pages">Cancel</Link>
            </Button>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => submit(false)}
                disabled={isPending}
                data-testid="page-save-draft-button"
              >
                Save draft
              </Button>
              <Button
                onClick={() => submit(true)}
                disabled={isPending}
                data-testid="page-publish-button"
              >
                {status === "published" || !isEdit ? "Publish" : "Publish now"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
