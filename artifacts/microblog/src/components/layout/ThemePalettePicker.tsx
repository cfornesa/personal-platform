import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemePreviewTile } from "@/components/layout/ThemePreviewTile";
import {
  PALETTES,
  THEMES,
  getPalette,
  type PaletteColors,
  type ThemeId,
} from "@/lib/site-themes";

const COLOR_FIELDS: Array<{
  key: keyof PaletteColors;
  label: string;
}> = [
  { key: "colorBackground", label: "Background (Light)" },
  { key: "colorForeground", label: "Foreground (Light)" },
  { key: "colorBackgroundDark", label: "Background (Dark)" },
  { key: "colorForegroundDark", label: "Foreground (Dark)" },
  { key: "colorPrimary", label: "Primary" },
  { key: "colorPrimaryForeground", label: "Primary text" },
  { key: "colorSecondary", label: "Secondary" },
  { key: "colorSecondaryForeground", label: "Secondary text" },
  { key: "colorAccent", label: "Accent" },
  { key: "colorAccentForeground", label: "Accent text" },
  { key: "colorMuted", label: "Muted" },
  { key: "colorMutedForeground", label: "Muted text" },
  { key: "colorDestructive", label: "Destructive" },
  { key: "colorDestructiveForeground", label: "Destructive text" },
];

const PREVIEW_SWATCH_KEYS: Array<keyof PaletteColors> = [
  "colorBackground",
  "colorForeground",
  "colorPrimary",
  "colorSecondary",
  "colorAccent",
  "colorMuted",
  "colorDestructive",
];

function parseHsl(input: string): { h: number; s: number; l: number } | null {
  const match = input.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  return { h: Number(match[1]), s: Number(match[2]), l: Number(match[3]) };
}

function formatHsl(h: number, s: number, l: number): string {
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

export function hslToHex(input: string): string {
  const parsed = parseHsl(input);
  if (!parsed) return "#000000";
  const { h, s, l } = parsed;
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): string {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return formatHsl(0, 0, 0);
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      case b: h = ((r - g) / d + 4); break;
    }
    h *= 60;
  }
  return formatHsl(h, s * 100, l * 100);
}

export interface ThemePalettePickerProps {
  /** The active theme id (one of THEMES). */
  theme: string;
  /** The active palette id (one of PALETTES). */
  palette: string;
  /** Per-color overrides — sourced from the parent's form state so the
   *  preview tiles reflect any in-progress edits. */
  colors: PaletteColors;
  onPickTheme: (themeId: string) => void;
  onPickPalette: (paletteId: string) => void;
  onChangeColor: (key: keyof PaletteColors, value: string) => void;
  onResetDefaults: () => void;
  /** Label on the reset button. Lets the owner card and per-user card
   *  customize messaging (e.g. "Reset to site defaults"). */
  resetLabel?: string;
}

/**
 * Presentational theme + palette + per-color picker.
 *
 * The grid of theme tiles, palette swatches, and per-field color inputs are
 * all rendered here. The parent owns form state (so palette swaps that
 * preserve custom edits, theme reset semantics, and the eventual save can
 * be handled identically across the owner's site card and any per-user
 * card) and passes the relevant callbacks in.
 */
export function ThemePalettePicker({
  theme,
  palette,
  colors,
  onPickTheme,
  onPickPalette,
  onChangeColor,
  onResetDefaults,
  resetLabel = "Reset to Bauhaus defaults",
}: ThemePalettePickerProps) {
  const activePalette = getPalette(palette);
  const fallback = activePalette?.colors ?? colors;

  // Render preview tiles using whichever colors the parent currently holds,
  // falling back to the active palette's stock colors for any missing key.
  const previewPaletteColors: PaletteColors = {
    colorBackground: colors.colorBackground ?? fallback.colorBackground,
    colorForeground: colors.colorForeground ?? fallback.colorForeground,
    colorBackgroundDark: colors.colorBackgroundDark ?? fallback.colorBackgroundDark,
    colorForegroundDark: colors.colorForegroundDark ?? fallback.colorForegroundDark,
    colorPrimary: colors.colorPrimary ?? fallback.colorPrimary,
    colorPrimaryForeground: colors.colorPrimaryForeground ?? fallback.colorPrimaryForeground,
    colorSecondary: colors.colorSecondary ?? fallback.colorSecondary,
    colorSecondaryForeground: colors.colorSecondaryForeground ?? fallback.colorSecondaryForeground,
    colorAccent: colors.colorAccent ?? fallback.colorAccent,
    colorAccentForeground: colors.colorAccentForeground ?? fallback.colorAccentForeground,
    colorMuted: colors.colorMuted ?? fallback.colorMuted,
    colorMutedForeground: colors.colorMutedForeground ?? fallback.colorMutedForeground,
    colorDestructive: colors.colorDestructive ?? fallback.colorDestructive,
    colorDestructiveForeground:
      colors.colorDestructiveForeground ?? fallback.colorDestructiveForeground,
    colorPrimaryDark: colors.colorPrimaryDark ?? fallback.colorPrimaryDark,
    colorPrimaryForegroundDark: colors.colorPrimaryForegroundDark ?? fallback.colorPrimaryForegroundDark,
    colorSecondaryDark: colors.colorSecondaryDark ?? fallback.colorSecondaryDark,
    colorSecondaryForegroundDark: colors.colorSecondaryForegroundDark ?? fallback.colorSecondaryForegroundDark,
    colorAccentDark: colors.colorAccentDark ?? fallback.colorAccentDark,
    colorAccentForegroundDark: colors.colorAccentForegroundDark ?? fallback.colorAccentForegroundDark,
    colorMutedDark: colors.colorMutedDark ?? fallback.colorMutedDark,
    colorMutedForegroundDark: colors.colorMutedForegroundDark ?? fallback.colorMutedForegroundDark,
    colorDestructiveDark: colors.colorDestructiveDark ?? fallback.colorDestructiveDark,
    colorDestructiveForegroundDark: colors.colorDestructiveForegroundDark ?? fallback.colorDestructiveForegroundDark,
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Theme & Palette
        </h3>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <Label className="text-xs font-semibold uppercase tracking-wide">Theme</Label>
            <p className="text-xs text-muted-foreground">
              Borders, fonts, shadows, radius — previews use the current palette
            </p>
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {THEMES.map((t) => {
              const selected = theme === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPickTheme(t.id)}
                  aria-pressed={selected}
                  className={`group text-left rounded-md border overflow-hidden transition-all duration-200 ${
                    selected
                      ? "border-primary ring-4 ring-primary/20 scale-[1.02] shadow-lg"
                      : "border-border hover:border-foreground/40 hover:scale-[1.01]"
                  }`}
                >
                  <ThemePreviewTile
                    themeId={t.id as ThemeId}
                    palette={previewPaletteColors}
                  />
                  <div className={`border-t border-border p-2.5 transition-colors duration-200 ${selected ? "bg-accent/10" : "bg-background"}`}>
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-semibold">{t.label}</div>
                      {selected && (
                        <span className="inline-flex items-center gap-0.5 rounded bg-primary px-1.5 py-0.5 text-[9px] font-black text-primary-foreground uppercase tracking-wider">
                          ✓ Active
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {t.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <Label className="text-xs font-semibold uppercase tracking-wide">Palette</Label>
            <p className="text-xs text-muted-foreground">
              14 colors — custom edits below are preserved
            </p>
          </div>
          <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {PALETTES.map((p) => {
              const selected = palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPickPalette(p.id)}
                  aria-pressed={selected}
                  className={`text-left rounded-md border p-3 transition-colors ${
                    selected
                      ? "border-foreground bg-accent/40"
                      : "border-border bg-background hover:bg-muted/40"
                  }`}
                >
                  <div className="text-sm font-semibold">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {p.description}
                  </div>
                  <div className="mt-2 flex gap-1">
                    {PREVIEW_SWATCH_KEYS.map((k) => (
                      <span
                        key={k}
                        className="inline-block h-4 w-4 rounded-full border border-border"
                        style={{ backgroundColor: `hsl(${p.colors[k]})` }}
                        aria-hidden="true"
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>

          {activePalette && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Live palette preview
              </p>
              <div className="flex flex-wrap gap-2">
                {PREVIEW_SWATCH_KEYS.map((k) => (
                  <div key={k} className="flex items-center gap-2">
                    <span
                      className="inline-block h-6 w-6 rounded-full border border-border"
                      style={{
                        backgroundColor: `hsl(${colors[k] ?? activePalette.colors[k]})`,
                      }}
                      aria-hidden="true"
                    />
                    <span className="text-xs font-mono text-muted-foreground">
                      {k.replace(/^color/, "").replace(/Foreground$/, "")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Color Palette (per-field)
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Click a swatch to override any individual color. Edits here survive when you
              switch palettes — only stock palette colors get replaced.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onResetDefaults}>
            {resetLabel}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {COLOR_FIELDS.map((field) => {
            const value = colors[field.key] ?? "";
            const hex = hslToHex(value);
            return (
              <div
                key={field.key}
                className="flex items-center gap-3 rounded-md border border-border p-3"
              >
                <input
                  type="color"
                  value={hex}
                  onChange={(e) => onChangeColor(field.key, hexToHsl(e.target.value))}
                  className="h-10 w-12 cursor-pointer rounded border border-border bg-transparent"
                  aria-label={field.label}
                />
                <div className="flex-1 min-w-0">
                  <Label className="text-xs font-medium" htmlFor={`color-${field.key}`}>
                    {field.label}
                  </Label>
                  <Input
                    id={`color-${field.key}`}
                    value={value}
                    onChange={(e) => onChangeColor(field.key, e.target.value)}
                    placeholder="0 100% 50%"
                    className="h-8 text-xs font-mono mt-1"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
