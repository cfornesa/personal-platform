import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUpdateSiteSettings,
  getGetSiteSettingsQueryKey,
  type SiteSettings,
  type UpdateSiteSettingsBody,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ThemePalettePicker, hslToHex, hexToHsl } from "@/components/layout/ThemePalettePicker";
import { FeaturedImagePicker } from "@/components/media/FeaturedImagePicker";
import {
  DEFAULT_PALETTE_ID,
  DEFAULT_THEME_ID,
  PALETTE_COLOR_KEYS,
  getPalette,
  smartMergePalette,
  type PaletteColors,
} from "@/lib/site-themes";

const HSL_DEFAULTS: PaletteColors = {
  ...getPalette(DEFAULT_PALETTE_ID)!.colors,
};

type FormState = Record<string, string>;

function buildInitialState(settings: SiteSettings): FormState {
  return {
    theme: settings.theme,
    palette: settings.palette,
    siteTitle: settings.siteTitle,
    heroHeading: settings.heroHeading,
    heroSubheading: settings.heroSubheading,
    aboutHeading: settings.aboutHeading,
    aboutBody: settings.aboutBody,
    copyrightLine: settings.copyrightLine,
    footerCredit: settings.footerCredit,
    ctaLabel: settings.ctaLabel,
    ctaHref: settings.ctaHref,
    colorBackground: settings.colorBackground,
    colorForeground: settings.colorForeground,
    colorBackgroundDark: settings.colorBackgroundDark,
    colorForegroundDark: settings.colorForegroundDark,
    colorPrimary: settings.colorPrimary,
    colorPrimaryForeground: settings.colorPrimaryForeground,
    colorSecondary: settings.colorSecondary,
    colorSecondaryForeground: settings.colorSecondaryForeground,
    colorAccent: settings.colorAccent,
    colorAccentForeground: settings.colorAccentForeground,
    colorMuted: settings.colorMuted,
    colorMutedForeground: settings.colorMutedForeground,
    colorDestructive: settings.colorDestructive,
    colorDestructiveForeground: settings.colorDestructiveForeground,
    logoUrl: settings.logoUrl ?? "",
    logoDarkUrl: settings.logoDarkUrl ?? "",
    logoLayout: settings.logoLayout,
    defaultThemeMode: settings.defaultThemeMode ?? "system",
    colorPrimaryDark: settings.colorPrimaryDark ?? "",
    colorPrimaryForegroundDark: settings.colorPrimaryForegroundDark ?? "",
    colorSecondaryDark: settings.colorSecondaryDark ?? "",
    colorSecondaryForegroundDark: settings.colorSecondaryForegroundDark ?? "",
    colorAccentDark: settings.colorAccentDark ?? "",
    colorAccentForegroundDark: settings.colorAccentForegroundDark ?? "",
    colorMutedDark: settings.colorMutedDark ?? "",
    colorMutedForegroundDark: settings.colorMutedForegroundDark ?? "",
    colorDestructiveDark: settings.colorDestructiveDark ?? "",
    colorDestructiveForegroundDark: settings.colorDestructiveForegroundDark ?? "",
  };
}

function pickColors(form: FormState): PaletteColors {
  const out: Record<string, string> = {};
  for (const key of PALETTE_COLOR_KEYS) {
    out[key] = form[key] ?? "";
  }
  return out as unknown as PaletteColors;
}

interface SiteCustomizationCardProps {
  settings: SiteSettings;
}

export function SiteCustomizationCard({ settings }: SiteCustomizationCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(() => buildInitialState(settings));
  const [baseline, setBaseline] = useState<FormState>(() => buildInitialState(settings));
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isDarkPickerOpen, setIsDarkPickerOpen] = useState(false);
  // Tracks the palette id we last smart-merged FROM, so palette swaps can tell
  // which color fields are still "stock" vs custom-edited by the owner.
  const lastPaletteRef = useRef<string>(settings.palette);

  const isDirty = useMemo(() => {
    return Object.keys(form).some((k) => form[k] !== baseline[k]);
  }, [form, baseline]);

  // Only adopt server state when the user has no unsaved edits — never
  // clobber in-progress work just because React Query refetched.
  useEffect(() => {
    const next = buildInitialState(settings);
    setBaseline(next);
    if (!isDirty) {
      setForm(next);
      lastPaletteRef.current = settings.palette;
    }
    // We intentionally exclude `isDirty` from deps: we want this to fire on
    // every new server snapshot and check dirty state at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const update = useUpdateSiteSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSiteSettingsQueryKey() });
        toast({ title: "Site settings saved", description: "Your changes are live." });
      },
      onError: (error: any) => {
        const message = error?.response?.data?.error || "Failed to save site settings";
        toast({ title: "Error", description: message, variant: "destructive" });
      },
    },
  });

  const setField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handlePickTheme = (themeId: string) => {
    setForm((prev) => ({ ...prev, theme: themeId }));
  };

  const handlePickPalette = (nextPaletteId: string) => {
    setForm((prev) => {
      const merged = smartMergePalette(prev, lastPaletteRef.current, nextPaletteId);
      lastPaletteRef.current = nextPaletteId;
      return { ...merged, palette: nextPaletteId };
    });
  };

  const handleResetDefaults = () => {
    setForm((prev) => ({
      ...prev,
      ...HSL_DEFAULTS,
      theme: DEFAULT_THEME_ID,
      palette: DEFAULT_PALETTE_ID,
    }));
    lastPaletteRef.current = DEFAULT_PALETTE_ID;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({ data: form as UpdateSiteSettingsBody });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Site Customization</CardTitle>
        <CardDescription>
          Owner-only. Pick a theme and palette, fine-tune any color or copy. Changes apply
          everywhere as soon as you save.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-8">
          <ThemePalettePicker
            theme={form.theme}
            palette={form.palette}
            colors={pickColors(form)}
            onPickTheme={handlePickTheme}
            onPickPalette={handlePickPalette}
            onChangeColor={(key, value) => setField(key as string, value)}
            onResetDefaults={handleResetDefaults}
          />

          <section className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Identity & Copy
            </h3>

            <div className="space-y-2">
              <Label htmlFor="siteTitle">Site title</Label>
              <Input
                id="siteTitle"
                value={form.siteTitle}
                onChange={(e) => setField("siteTitle", e.target.value)}
                maxLength={255}
              />
              <p className="text-xs text-muted-foreground">
                Shown in the navbar and the browser tab.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="heroHeading">Hero heading</Label>
                <Input
                  id="heroHeading"
                  value={form.heroHeading}
                  onChange={(e) => setField("heroHeading", e.target.value)}
                  maxLength={255}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ctaLabel">Hero button label</Label>
                <Input
                  id="ctaLabel"
                  value={form.ctaLabel}
                  onChange={(e) => setField("ctaLabel", e.target.value)}
                  maxLength={255}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="heroSubheading">Hero subheading</Label>
              <Textarea
                id="heroSubheading"
                value={form.heroSubheading}
                onChange={(e) => setField("heroSubheading", e.target.value)}
                className="resize-none h-20"
                maxLength={1000}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ctaHref">Hero button link</Label>
              <Input
                id="ctaHref"
                value={form.ctaHref}
                onChange={(e) => setField("ctaHref", e.target.value)}
                maxLength={2048}
                placeholder="/users/@yourhandle"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aboutHeading">"About" heading</Label>
              <Input
                id="aboutHeading"
                value={form.aboutHeading}
                onChange={(e) => setField("aboutHeading", e.target.value)}
                maxLength={255}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="aboutBody">"About" body</Label>
              <Textarea
                id="aboutBody"
                value={form.aboutBody}
                onChange={(e) => setField("aboutBody", e.target.value)}
                className="resize-none h-28"
                maxLength={2000}
              />
              <p className="text-xs text-muted-foreground">
                Shown in the right sidebar on the home page. Line breaks are preserved.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="copyrightLine">Copyright name</Label>
                <Input
                  id="copyrightLine"
                  value={form.copyrightLine}
                  onChange={(e) => setField("copyrightLine", e.target.value)}
                  maxLength={255}
                />
                <p className="text-xs text-muted-foreground">
                  Renders as: "© {new Date().getFullYear()} {form.copyrightLine}."
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="footerCredit">Footer credit</Label>
                <Input
                  id="footerCredit"
                  value={form.footerCredit}
                  onChange={(e) => setField("footerCredit", e.target.value)}
                  maxLength={255}
                />
              </div>
            </div>

            {/* Logo Customization Sub-section */}
            <div className="border-t pt-6 space-y-4">
              <div className="flex flex-col gap-1">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Logo Configuration</h4>
                <p className="text-xs text-muted-foreground">
                  Customize the branding display in your header. Choose a layout preset and upload light/dark logo assets.
                </p>
              </div>
              
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="logoLayout">Branding Layout</Label>
                  <select
                    id="logoLayout"
                    value={form.logoLayout}
                    onChange={(e) => setField("logoLayout", e.target.value)}
                    className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <option value="text_only">Text Only (System Title)</option>
                    <option value="icon_and_text">Icon + Text (Logo Mark & Title)</option>
                    <option value="integrated_wordmark">Integrated Wordmark (Logo Only)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>Logo (Light Theme)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.logoUrl}
                      onChange={(e) => setField("logoUrl", e.target.value)}
                      placeholder="No logo chosen"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsPickerOpen(true)}
                    >
                      Browse
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Logo (Dark Theme)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={form.logoDarkUrl}
                      onChange={(e) => setField("logoDarkUrl", e.target.value)}
                      placeholder="Falls back to light logo"
                      className="flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsDarkPickerOpen(true)}
                    >
                      Browse
                    </Button>
                  </div>
                </div>
              </div>

              {(form.logoUrl || form.logoDarkUrl) && (
                <div className="grid gap-4 sm:grid-cols-2 p-3 bg-muted/40 rounded-lg border">
                  {form.logoUrl && (
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Light Preview</span>
                      <div className="h-12 bg-white flex items-center justify-center p-2 rounded border">
                        <img src={form.logoUrl} alt="Light logo preview" className="h-8 max-w-full object-contain" />
                      </div>
                    </div>
                  )}
                  {form.logoDarkUrl ? (
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Dark Preview</span>
                      <div className="h-12 bg-black flex items-center justify-center p-2 rounded border border-zinc-800">
                        <img src={form.logoDarkUrl} alt="Dark logo preview" className="h-8 max-w-full object-contain" />
                      </div>
                    </div>
                  ) : form.logoUrl ? (
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-bold text-muted-foreground">Dark Preview (Fallback)</span>
                      <div className="h-12 bg-black flex items-center justify-center p-2 rounded border border-zinc-800">
                        <img src={form.logoUrl} alt="Dark logo preview fallback" className="h-8 max-w-full object-contain" />
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </section>

          {/* Default Theme Preference Section */}
          <section className="space-y-4 border-t pt-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Default Color Scheme
              </h3>
              <p className="text-xs text-muted-foreground">
                Choose the default theme mode presented to first-time visitors who have not explicitly chosen a preference.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="defaultThemeMode">Default Scheme (Page Load)</Label>
                <select
                  id="defaultThemeMode"
                  value={form.defaultThemeMode}
                  onChange={(e) => setField("defaultThemeMode", e.target.value)}
                  className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="system">System Preference (Dynamic)</option>
                  <option value="light">Always Light Mode</option>
                  <option value="dark">Always Dark Mode</option>
                </select>
              </div>
            </div>
          </section>

          {/* Dark Mode Color Overrides Section */}
          <section className="space-y-4 border-t pt-6">
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Dark Mode Color Overrides
              </h3>
              <p className="text-xs text-muted-foreground">
                Optional. Customize specific key brand colors for Dark Mode. If left empty, these will automatically fall back to their standard light-mode palette equivalents.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { key: "colorPrimaryDark", label: "Primary (Dark)", lightKey: "colorPrimary" },
                { key: "colorPrimaryForegroundDark", label: "Primary text (Dark)", lightKey: "colorPrimaryForeground" },
                { key: "colorSecondaryDark", label: "Secondary (Dark)", lightKey: "colorSecondary" },
                { key: "colorSecondaryForegroundDark", label: "Secondary text (Dark)", lightKey: "colorSecondaryForeground" },
                { key: "colorAccentDark", label: "Accent (Dark)", lightKey: "colorAccent" },
                { key: "colorAccentForegroundDark", label: "Accent text (Dark)", lightKey: "colorAccentForeground" },
                { key: "colorMutedDark", label: "Muted (Dark)", lightKey: "colorMuted" },
                { key: "colorMutedForegroundDark", label: "Muted text (Dark)", lightKey: "colorMutedForeground" },
                { key: "colorDestructiveDark", label: "Destructive (Dark)", lightKey: "colorDestructive" },
                { key: "colorDestructiveForegroundDark", label: "Destructive text (Dark)", lightKey: "colorDestructiveForeground" },
              ].map((field) => {
                const value = form[field.key] ?? "";
                const hex = value ? hslToHex(value) : "#000000";
                return (
                  <div
                    key={field.key}
                    className="flex items-center gap-3 rounded-md border border-border p-3 bg-muted/20"
                  >
                    <input
                      type="color"
                      value={hex}
                      onChange={(e) => setField(field.key, hexToHsl(e.target.value))}
                      className="h-10 w-12 cursor-pointer rounded border border-border bg-transparent"
                      aria-label={field.label}
                    />
                    <div className="flex-1 min-w-0">
                      <Label className="text-xs font-medium" htmlFor={`color-${field.key}`}>
                        {field.label}
                      </Label>
                      <div className="flex gap-1.5 mt-1">
                        <Input
                          id={`color-${field.key}`}
                          value={value}
                          onChange={(e) => setField(field.key, e.target.value)}
                          placeholder="Fallback (Standard)"
                          className="h-8 text-xs font-mono flex-1"
                        />
                        {value && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            onClick={() => setField(field.key, "")}
                          >
                            Reset
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </CardContent>
        <CardFooter className="flex justify-between border-t p-6">
          <p className="text-xs text-muted-foreground">
            {isDirty ? "You have unsaved changes." : "All changes saved."}
          </p>
          <Button type="submit" disabled={update.isPending || !isDirty}>
            {update.isPending ? "Saving..." : "Save site settings"}
          </Button>
        </CardFooter>
      </form>

      <FeaturedImagePicker
        open={isPickerOpen}
        onOpenChange={setIsPickerOpen}
        onSelect={(url) => setField("logoUrl", url)}
        dialogTitle="Select Light Theme Logo"
      />
      <FeaturedImagePicker
        open={isDarkPickerOpen}
        onOpenChange={setIsDarkPickerOpen}
        onSelect={(url) => setField("logoDarkUrl", url)}
        dialogTitle="Select Dark Theme Logo"
      />
    </Card>
  );
}
