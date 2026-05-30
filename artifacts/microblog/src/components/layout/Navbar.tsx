import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { LogOut, User as UserIcon, Settings, Menu, ExternalLink, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { signOut } from "@/lib/auth";
import { SearchBar } from "@/components/layout/SearchBar";
import {
  useListNavLinks,
  getListNavLinksQueryKey,
  type NavLink as NavLinkRecord,
} from "@workspace/api-client-react";

type FitState = {
  authInline: boolean;
  searchInline: boolean;
  visibleLinkCount: number;
  hamburgerNeeded: boolean;
};

const EMPTY_NAV_LINKS: NavLinkRecord[] = [];

export function Navbar() {
  const { currentUser, isAuthenticated, isOwner } = useCurrentUser();
  const { data: siteSettings } = useSiteSettings();
  const [location, setLocation] = useLocation();
  const navLinksQuery = useListNavLinks(
    {},
    { query: { queryKey: getListNavLinksQueryKey(), staleTime: 60_000 } },
  );
  const allLinks: NavLinkRecord[] = navLinksQuery.data?.links ?? EMPTY_NAV_LINKS;
  const navLinks: NavLinkRecord[] = allLinks.filter((l) => {
    if (l.visible === false) return false;
    if (l.kind === "page" && !l.pageSlug) return false;
    return true;
  });

  const [fit, setFit] = useState<FitState>({
    authInline: true,
    searchInline: true,
    visibleLinkCount: navLinks.length,
    hamburgerNeeded: false,
  });
  const [isMobile, setIsMobile] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener?.("change", update);
    return () => mql.removeEventListener?.("change", update);
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const logoRef = useRef<HTMLAnchorElement | null>(null);
  const measureLinkRef = useRef<HTMLDivElement | null>(null);
  const measureSearchRef = useRef<HTMLDivElement | null>(null);
  const measureAuthRef = useRef<HTMLDivElement | null>(null);
  const avatarRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function measure() {
      if (!container) return;
      const containerWidth = container.clientWidth;
      if (containerWidth === 0) return;
      const logoWidth = logoRef.current?.offsetWidth ?? 0;
      const avatarWidth = avatarRef.current?.offsetWidth ?? 0;
      // Gap constants must mirror the Tailwind classes in the JSX
      // below so width math stays accurate. If you change a `gap-*`
      // class on the container, the center zone, the right zone,
      // or the inline nav strip, update the matching constant here
      // too — otherwise the fitter under-/over-reserves space and
      // either hides the hamburger when links truly overflow or
      // surfaces a hamburger when nothing actually overflowed.
      const GAP_ZONE = 16; // outer container `gap-4`: left↔center and center↔right
      const GAP_CENTER = 24; // center zone `gap-6`: SearchBar↔inline nav strip
      const GAP_RIGHT = 8; // right zone `gap-2`: auth↔hamburger (only matters when both render)
      const GAP_LINK = 8; // inline nav `gap-1` (4px) — overestimated to 8 to match the measurer's `gap-2` and stay conservative on width
      // The fit is computed in two passes (see below). The first
      // pass assumes the hamburger does NOT render — its width is
      // not reserved — so we don't permanently steal ~44px from the
      // inline auth button at desktop widths and surface a
      // hamburger that wasn't needed. Only when the first pass
      // detects overflow do we redo the fit with the right-zone
      // reservation that actually matches the overflow layout.
      const HAMBURGER_WIDTH = 44; // matches the icon-only Button (h/w-9 + padding)
      const linkEls = Array.from(measureLinkRef.current?.children ?? []) as HTMLElement[];
      const linkWidths = linkEls.map((el) => el.offsetWidth + GAP_LINK);
      const searchWidth = measureSearchRef.current?.offsetWidth ?? 0;
      const rawAuthWidth = measureAuthRef.current?.offsetWidth ?? 0;
      const authWidth = isAuthenticated ? 0 : rawAuthWidth;

      // Greedy fit: given a fixed right-zone reservation, how many
      // nav links from the start fit in the remaining center budget?
      function fitLinks(rightZoneReserve: number): number {
        const reserved = logoWidth + rightZoneReserve + GAP_ZONE * 2;
        const centerBudget = Math.max(0, containerWidth - reserved);
        // Inside the center zone: search sits left, then GAP_CENTER,
        // then nav links share whatever remains.
        const linksAvailable = Math.max(0, centerBudget - searchWidth - GAP_CENTER);
        let count = 0;
        let used = 0;
        for (const w of linkWidths) {
          if (used + w > linksAvailable) break;
          used += w;
          count += 1;
        }
        return count;
      }

      // Two-pass fit. First pass assumes no hamburger renders — the
      // right zone holds either the avatar (signed in) or the auth
      // button (signed out), nothing else. If that fits every link,
      // we're done and the hamburger stays hidden. Otherwise we
      // redo the fit with the right-zone reservation that actually
      // matches the overflow layout: signed-in adds a hamburger
      // alongside the avatar (so the reserve grows); signed-out
      // replaces the auth button with a hamburger (so the reserve
      // shrinks, and possibly more links fit). Without this second
      // pass, signed-in overflow would clip nav links visually
      // because the inline strip's `overflow-hidden` masks them
      // even though they were never moved into the Sheet.
      let visibleLinkCount: number;
      let authInline = false;

      if (isAuthenticated) {
        const noHamburger = fitLinks(avatarWidth);
        if (noHamburger === navLinks.length) {
          visibleLinkCount = noHamburger;
        } else {
          // Avatar + hamburger both render in the right zone.
          visibleLinkCount = fitLinks(avatarWidth + GAP_RIGHT + HAMBURGER_WIDTH);
        }
      } else {
        const withAuth = fitLinks(authWidth);
        if (withAuth === navLinks.length) {
          // Every link fits AND there's room for the auth button —
          // it stays inline as the right-edge widget.
          visibleLinkCount = withAuth;
          authInline = true;
        } else {
          // Auth couldn't fit alongside all the links, so the
          // hamburger replaces it (auth moves into the Sheet).
          visibleLinkCount = fitLinks(HAMBURGER_WIDTH);
          authInline = false;
        }
      }

      const allLinksFit = visibleLinkCount === navLinks.length;
      const hamburgerNeeded =
        !allLinksFit || (!isAuthenticated && !authInline);

      setFit((prev) =>
        prev.authInline === authInline &&
        prev.searchInline === true &&
        prev.visibleLinkCount === visibleLinkCount &&
        prev.hamburgerNeeded === hamburgerNeeded
          ? prev
          : { authInline, searchInline: true, visibleLinkCount, hamburgerNeeded },
      );
    }

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    const candidates: Array<Element | null> = [
      logoRef.current,
      measureLinkRef.current,
      measureSearchRef.current,
      measureAuthRef.current,
      avatarRef.current,
    ];
    for (const el of candidates) {
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [navLinks, isAuthenticated, siteSettings?.siteTitle]);

  const effectiveFit: FitState = isMobile
    ? {
        authInline: false,
        searchInline: false,
        visibleLinkCount: 0,
        hamburgerNeeded: true,
      }
    : fit;
  const inlineLinks = navLinks.slice(0, effectiveFit.visibleLinkCount);
  // The hamburger Sheet must show only the items that didn't fit
  // inline — never the items already rendered in the inline strip.
  // On mobile the inline strip is empty so every link goes here.
  const overflowLinks = isMobile
    ? navLinks
    : navLinks.slice(effectiveFit.visibleLinkCount);
  const showHamburger = effectiveFit.hamburgerNeeded;
  // Auth control belongs in the hamburger only when it didn't fit
  // inline (or on mobile where nothing fits inline).
  const sheetShowsAuth = !isAuthenticated && (isMobile || !effectiveFit.authInline);

  const renderLink = (
    link: NavLinkRecord,
    opts: { variant: "inline" | "sheet"; onClick?: () => void } = { variant: "inline" },
  ) => {
    const href =
      link.kind === "page" && link.pageSlug
        ? `/p/${link.pageSlug}`
        : link.url;
    const isInternal = href.startsWith("/");
    const isActive = isInternal && location === href;
    const safeNewTab = link.openInNewTab && !isInternal;
    const className =
      opts.variant === "inline"
        ? "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-2 py-1 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        : "flex items-center justify-between rounded-md px-2 py-2 text-sm font-medium text-foreground hover:bg-muted";
    const iconRight = link.openInNewTab && !isInternal ? (
      <ExternalLink
        className={opts.variant === "inline" ? "h-3 w-3 opacity-60" : "h-3.5 w-3.5 text-muted-foreground"}
        aria-hidden="true"
      />
    ) : null;
    if (isInternal) {
      return (
        <Link
          key={link.id}
          href={href}
          onClick={opts.onClick}
          className={className}
          aria-current={isActive ? "page" : undefined}
          data-testid={`nav-link-${link.id}-${opts.variant}`}
        >
          <span>{link.label}</span>
          {iconRight}
        </Link>
      );
    }
    return (
      <a
        key={link.id}
        href={href}
        target={safeNewTab ? "_blank" : undefined}
        rel={safeNewTab ? "noopener noreferrer" : undefined}
        onClick={opts.onClick}
        className={className}
        data-testid={`nav-link-${link.id}-${opts.variant}`}
      >
        <span>{link.label}</span>
        {iconRight}
      </a>
    );
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
      <div
        ref={containerRef}
        className="mx-auto flex h-16 w-full max-w-screen-2xl items-center gap-4 px-4 sm:px-6 lg:px-8"
        data-testid="navbar-container"
      >
        {/* LEFT ZONE — pinned to the left edge: logo + site title. */}
        <Link
          ref={logoRef}
          href="/"
          className="flex shrink-0 items-center gap-2 transition-opacity hover:opacity-80"
          data-testid="navbar-left"
        >
          {/* LOGO ICON / IMAGE RENDERING */}
          {siteSettings?.logoLayout === "integrated_wordmark" && siteSettings?.logoUrl ? (
            <>
              <img
                src={siteSettings.logoUrl}
                alt={siteSettings.siteTitle ?? "Logo"}
                className="h-8 w-auto max-w-[160px] object-contain block dark:hidden"
              />
              {siteSettings.logoDarkUrl ? (
                <img
                  src={siteSettings.logoDarkUrl}
                  alt={siteSettings.siteTitle ?? "Logo"}
                  className="h-8 w-auto max-w-[160px] object-contain hidden dark:block"
                />
              ) : (
                <img
                  src={siteSettings.logoUrl}
                  alt={siteSettings.siteTitle ?? "Logo"}
                  className="h-8 w-auto max-w-[160px] object-contain hidden dark:block"
                />
              )}
            </>
          ) : siteSettings?.logoLayout === "icon_and_text" && siteSettings?.logoUrl ? (
            <>
              <img
                src={siteSettings.logoUrl}
                alt=""
                className="h-8 w-8 rounded-lg object-contain block dark:hidden"
              />
              {siteSettings.logoDarkUrl ? (
                <img
                  src={siteSettings.logoDarkUrl}
                  alt=""
                  className="h-8 w-8 rounded-lg object-contain hidden dark:block"
                />
              ) : (
                <img
                  src={siteSettings.logoUrl}
                  alt=""
                  className="h-8 w-8 rounded-lg object-contain hidden dark:block"
                />
              )}
            </>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <line x1="9" y1="10" x2="15" y2="10" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </div>
          )}

          {/* SITE TITLE RENDERING (with Visually Hidden sr-only support for full integrated logos to ensure SEO/A11y) */}
          {siteSettings?.logoLayout === "integrated_wordmark" && siteSettings?.logoUrl ? (
            <span className="sr-only">
              {siteSettings?.siteTitle ?? ""}
            </span>
          ) : (
            <span className="font-serif text-lg font-bold tracking-tight text-foreground">
              {siteSettings?.siteTitle ?? ""}
            </span>
          )}
        </Link>

        {/* CENTER ZONE — flex-grows between left and right edges. */}
        {isMobile ? (
          // Mobile: center zone is empty. Search lives inside the
          // hamburger Sheet (further down) so the navbar doesn't
          // double-render a second search input that collides with
          // the hamburger button at narrow widths.
          <div
            className="flex min-w-0 flex-1"
            data-testid="navbar-center"
          />
        ) : (
          // Desktop: search sits at the left of the center zone,
          // followed by the inline nav links with a comfortable gap
          // between the two groups. Search is always rendered inline
          // regardless of whether the hamburger overflow is needed.
          <div
            className="flex min-w-0 flex-1 items-center gap-6"
            data-testid="navbar-center"
          >
            <SearchBar />
            <nav
              className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden"
              aria-label="Primary"
              data-testid="navbar-inline-links"
            >
              {inlineLinks.map((l) => renderLink(l, { variant: "inline" }))}
            </nav>
          </div>
        )}

        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute -left-[9999px] top-0 flex"
        >
          <div ref={measureLinkRef} className="flex items-center gap-2">
            {navLinks.map((l) => renderLink(l, { variant: "inline" }))}
          </div>
          <div ref={measureSearchRef} aria-hidden="true">
            <div className="relative flex items-center gap-1.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  readOnly
                  tabIndex={-1}
                  defaultValue=""
                  placeholder="Search posts…"
                  className="h-9 w-44 pl-8 md:w-56"
                />
              </div>
              <Button type="button" size="sm" variant="secondary" className="h-9" tabIndex={-1}>
                Search
              </Button>
            </div>
          </div>
          <div ref={measureAuthRef} aria-hidden="true">
            <Button type="button" className="rounded-full font-medium" tabIndex={-1}>
              Log in / Register
            </Button>
          </div>
        </div>

        {/* RIGHT ZONE — pinned to the right edge: auth control
            (inline button or avatar dropdown) plus the optional
            hamburger. The hamburger is rendered only when the fit
            measurement determined real overflow exists. */}
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid="navbar-right"
        >
          {!isAuthenticated && !isMobile && effectiveFit.authInline ? (
            <Button asChild className="rounded-full font-medium" data-testid="navbar-auth-inline">
              <Link href="/sign-in">Log in / Register</Link>
            </Button>
          ) : null}

          {currentUser && !isMobile ? (
            <div ref={avatarRef} data-testid="navbar-avatar">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-9 w-9 rounded-full">
                    <Avatar className="h-9 w-9 border border-border">
                      <AvatarImage src={currentUser.imageUrl || undefined} alt={currentUser.name || "User"} />
                      <AvatarFallback className="bg-primary/10 text-primary">
                        {currentUser.name?.charAt(0) || "U"}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56" align="end" forceMount>
                  <div className="flex items-center justify-start gap-2 p-2">
                    <div className="flex flex-col space-y-1 leading-none">
                      {currentUser.name && (
                        <p className="font-medium text-sm">{currentUser.name}</p>
                      )}
                      {currentUser.email && (
                        <p className="w-[200px] truncate text-xs text-muted-foreground">
                          {currentUser.email}
                        </p>
                      )}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      const profileSlug = currentUser.username ? `@${currentUser.username}` : currentUser.id;
                      setLocation(`/users/${profileSlug}`);
                    }}
                    className="cursor-pointer"
                  >
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setLocation("/settings")} className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  {isOwner ? (
                    <DropdownMenuItem
                      onClick={() => setLocation("/admin")}
                      className="cursor-pointer"
                      data-testid="navbar-admin-entry"
                    >
                      <ShieldCheck className="mr-2 h-4 w-4" />
                      <span>Admin</span>
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onClick={async () => {
                      await signOut(`${window.location.origin}${import.meta.env.BASE_URL}`);
                    }}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Sign out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}

          {showHamburger ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              data-testid="navbar-hamburger"
              onClick={() => setSheetOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-80 max-w-full" data-testid="navbar-sheet">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            {overflowLinks.length > 0 ? (
              <>
                <nav
                  className="flex flex-col"
                  aria-label="Site navigation"
                  data-testid="navbar-sheet-links"
                >
                  {overflowLinks.map((link) =>
                    renderLink(link, {
                      variant: "sheet",
                      onClick: () => setSheetOpen(false),
                    }),
                  )}
                </nav>
                <hr className="border-border" />
              </>
            ) : null}

            {sheetShowsAuth ? (
              <>
                <Button
                  asChild
                  className="w-full rounded-full font-medium"
                  data-testid="navbar-sheet-auth"
                  onClick={() => setSheetOpen(false)}
                >
                  <Link href="/sign-in">Log in / Register</Link>
                </Button>
                <hr className="border-border" />
              </>
            ) : null}

            {isAuthenticated && isMobile ? (
              <>
                <div className="flex flex-col" data-testid="navbar-sheet-user">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
                    onClick={() => {
                      const slug = currentUser?.username
                        ? `@${currentUser.username}`
                        : currentUser?.id;
                      if (slug) setLocation(`/users/${slug}`);
                      setSheetOpen(false);
                    }}
                  >
                    <UserIcon className="h-4 w-4" />
                    Profile
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
                    onClick={() => {
                      setLocation("/settings");
                      setSheetOpen(false);
                    }}
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </button>
                  {isOwner ? (
                    <button
                      type="button"
                      className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
                      onClick={() => {
                        setLocation("/admin");
                        setSheetOpen(false);
                      }}
                      data-testid="navbar-sheet-admin"
                    >
                      <ShieldCheck className="h-4 w-4" />
                      Admin
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                    onClick={async () => {
                      setSheetOpen(false);
                      await signOut(`${window.location.origin}${import.meta.env.BASE_URL}`);
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </button>
                </div>
                <hr className="border-border" />
              </>
            ) : null}

            {isMobile ? (
              <div data-testid="navbar-sheet-search">
                <SearchBar embed />
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </header>
  );
}
