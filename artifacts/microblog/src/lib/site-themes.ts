/**
 * Site themes and palettes catalog.
 *
 * Two independent dimensions of site customization:
 *  - **Theme** controls structure: borders, shadows, font families, weight,
 *    radius, heading case/tracking. Implemented as `[data-theme="..."]`
 *    scoped CSS in `index.css`.
 *  - **Palette** controls the 14 color values (light + dark backgrounds,
 *    foregrounds, primary/secondary/accent/muted/destructive). Stored on
 *    `site_settings` and injected as CSS variables by `<ThemeInjector />`.
 *
 * Both are 9 options each (9 × 9 = 81 baseline combinations). The owner can
 * also override individual color fields, in which case those custom values
 * are preserved when the palette changes (smart merge).
 */

export type ThemeId =
  | "bauhaus"
  | "traditional"
  | "minimalist"
  | "academic"
  | "airy"
  | "nature"
  | "comfort"
  | "audacious"
  | "artistic";

export type PaletteId =
  | "bauhaus"
  | "monochrome"
  | "newsprint"
  | "ocean"
  | "forest"
  | "sunset"
  | "sepia"
  | "high-contrast"
  | "pastel";

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  description: string;
}

export interface PaletteColors {
  colorBackground: string;
  colorForeground: string;
  colorBackgroundDark: string;
  colorForegroundDark: string;

  colorPrimary: string;
  colorPrimaryForeground: string;
  colorPrimaryDark: string;
  colorPrimaryForegroundDark: string;

  colorSecondary: string;
  colorSecondaryForeground: string;
  colorSecondaryDark: string;
  colorSecondaryForegroundDark: string;

  colorAccent: string;
  colorAccentForeground: string;
  colorAccentDark: string;
  colorAccentForegroundDark: string;

  colorMuted: string;
  colorMutedForeground: string;
  colorMutedDark: string;
  colorMutedForegroundDark: string;

  colorDestructive: string;
  colorDestructiveForeground: string;
  colorDestructiveDark: string;
  colorDestructiveForegroundDark: string;
}

export interface PaletteDefinition {
  id: PaletteId;
  label: string;
  description: string;
  colors: PaletteColors;
}

export const PALETTE_COLOR_KEYS: ReadonlyArray<keyof PaletteColors> = [
  "colorBackground",
  "colorForeground",
  "colorBackgroundDark",
  "colorForegroundDark",
  "colorPrimary",
  "colorPrimaryForeground",
  "colorPrimaryDark",
  "colorPrimaryForegroundDark",
  "colorSecondary",
  "colorSecondaryForeground",
  "colorSecondaryDark",
  "colorSecondaryForegroundDark",
  "colorAccent",
  "colorAccentForeground",
  "colorAccentDark",
  "colorAccentForegroundDark",
  "colorMuted",
  "colorMutedForeground",
  "colorMutedDark",
  "colorMutedForegroundDark",
  "colorDestructive",
  "colorDestructiveForeground",
  "colorDestructiveDark",
  "colorDestructiveForegroundDark",
] as const;

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: "bauhaus",
    label: "Bauhaus",
    description: "Heavy borders, hard shadows, all-caps headings.",
  },
  {
    id: "traditional",
    label: "Traditional",
    description: "Serif body, hairline borders, conservative spacing.",
  },
  {
    id: "minimalist",
    label: "Minimalist",
    description: "No borders, no shadows, generous whitespace.",
  },
  {
    id: "academic",
    label: "Academic",
    description: "Old-style serif, subtle borders, scholarly feel.",
  },
  {
    id: "airy",
    label: "Airy",
    description: "Light weights, soft shadows, rounded corners.",
  },
  {
    id: "nature",
    label: "Nature",
    description: "Friendly Nunito sans, soft shadows, generous radius.",
  },
  {
    id: "comfort",
    label: "Comfort",
    description: "Quicksand, pillowy radius, gentle elevation.",
  },
  {
    id: "audacious",
    label: "Audacious",
    description: "Bebas Neue display, oversized borders, hard shadows.",
  },
  {
    id: "artistic",
    label: "Artistic",
    description: "Caveat handwriting, hand-drawn feel, slight tilt.",
  },
] as const;

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: "bauhaus",
    label: "Bauhaus",
    description: "Strict tricolor — red, blue, yellow on black & white.",
    colors: {
      colorBackground: "0 0% 100%",
      colorForeground: "0 0% 0%",
      colorBackgroundDark: "0 0% 0%",
      colorForegroundDark: "0 0% 100%",
      colorPrimary: "0 100% 50%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "0 100% 50%",
      colorPrimaryForegroundDark: "0 0% 100%",
      colorSecondary: "240 100% 50%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "240 100% 50%",
      colorSecondaryForegroundDark: "0 0% 100%",
      colorAccent: "60 100% 50%",
      colorAccentForeground: "0 0% 0%",
      colorAccentDark: "60 100% 50%",
      colorAccentForegroundDark: "0 0% 0%",
      colorMuted: "60 100% 50%",
      colorMutedForeground: "0 0% 0%",
      colorMutedDark: "0 0% 15%",
      colorMutedForegroundDark: "0 0% 70%",
      colorDestructive: "0 100% 50%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 100% 50%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
  {
    id: "monochrome",
    label: "Monochrome",
    description: "Pure greyscale, no chroma.",
    colors: {
      colorBackground: "0 0% 100%",
      colorForeground: "0 0% 8%",
      colorBackgroundDark: "0 0% 8%",
      colorForegroundDark: "0 0% 98%",
      colorPrimary: "0 0% 15%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "0 0% 90%",
      colorPrimaryForegroundDark: "0 0% 10%",
      colorSecondary: "0 0% 40%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "0 0% 70%",
      colorSecondaryForegroundDark: "0 0% 10%",
      colorAccent: "0 0% 92%",
      colorAccentForeground: "0 0% 10%",
      colorAccentDark: "0 0% 20%",
      colorAccentForegroundDark: "0 0% 95%",
      colorMuted: "0 0% 96%",
      colorMutedForeground: "0 0% 35%",
      colorMutedDark: "0 0% 15%",
      colorMutedForegroundDark: "0 0% 80%",
      colorDestructive: "0 65% 45%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 65% 55%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
  {
    id: "newsprint",
    label: "Newsprint",
    description: "Cream paper with black ink and a single accent red.",
    colors: {
      colorBackground: "40 30% 96%",
      colorForeground: "0 0% 12%",
      colorBackgroundDark: "0 0% 10%",
      colorForegroundDark: "40 25% 92%",
      colorPrimary: "0 0% 12%",
      colorPrimaryForeground: "40 30% 96%",
      colorPrimaryDark: "40 25% 92%",
      colorPrimaryForegroundDark: "0 0% 10%",
      colorSecondary: "0 60% 35%",
      colorSecondaryForeground: "40 30% 96%",
      colorSecondaryDark: "0 70% 50%",
      colorSecondaryForegroundDark: "0 0% 10%",
      colorAccent: "40 60% 80%",
      colorAccentForeground: "0 0% 12%",
      colorAccentDark: "40 50% 30%",
      colorAccentForegroundDark: "40 25% 92%",
      colorMuted: "40 25% 88%",
      colorMutedForeground: "0 0% 30%",
      colorMutedDark: "0 0% 20%",
      colorMutedForegroundDark: "40 25% 80%",
      colorDestructive: "0 70% 40%",
      colorDestructiveForeground: "40 30% 96%",
      colorDestructiveDark: "0 75% 50%",
      colorDestructiveForegroundDark: "0 0% 10%",
    },
  },
  {
    id: "ocean",
    label: "Ocean",
    description: "Cool blues with teal accents.",
    colors: {
      colorBackground: "200 60% 98%",
      colorForeground: "215 60% 15%",
      colorBackgroundDark: "215 50% 12%",
      colorForegroundDark: "200 50% 95%",
      colorPrimary: "210 80% 45%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "205 90% 60%",
      colorPrimaryForegroundDark: "215 50% 10%",
      colorSecondary: "190 70% 40%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "190 80% 55%",
      colorSecondaryForegroundDark: "215 50% 10%",
      colorAccent: "175 70% 55%",
      colorAccentForeground: "215 60% 12%",
      colorAccentDark: "175 80% 40%",
      colorAccentForegroundDark: "200 50% 95%",
      colorMuted: "200 40% 92%",
      colorMutedForeground: "215 30% 35%",
      colorMutedDark: "215 35% 20%",
      colorMutedForegroundDark: "200 40% 80%",
      colorDestructive: "0 70% 50%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 80% 60%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
  {
    id: "forest",
    label: "Forest",
    description: "Deep greens with earth-tone secondaries.",
    colors: {
      colorBackground: "90 30% 96%",
      colorForeground: "130 40% 12%",
      colorBackgroundDark: "130 30% 10%",
      colorForegroundDark: "90 25% 92%",
      colorPrimary: "140 50% 30%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "140 50% 55%",
      colorPrimaryForegroundDark: "130 30% 10%",
      colorSecondary: "30 40% 40%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "30 50% 55%",
      colorSecondaryForegroundDark: "130 30% 10%",
      colorAccent: "70 60% 50%",
      colorAccentForeground: "130 40% 12%",
      colorAccentDark: "70 40% 25%",
      colorAccentForegroundDark: "90 25% 92%",
      colorMuted: "90 25% 90%",
      colorMutedForeground: "130 25% 30%",
      colorMutedDark: "130 20% 20%",
      colorMutedForegroundDark: "90 25% 80%",
      colorDestructive: "0 65% 45%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 70% 55%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
  {
    id: "sunset",
    label: "Sunset",
    description: "Warm orange and pink dusk gradient.",
    colors: {
      colorBackground: "30 80% 97%",
      colorForeground: "15 50% 15%",
      colorBackgroundDark: "15 40% 12%",
      colorForegroundDark: "30 60% 92%",
      colorPrimary: "15 85% 55%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "15 90% 65%",
      colorPrimaryForegroundDark: "15 40% 10%",
      colorSecondary: "340 75% 55%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "340 80% 65%",
      colorSecondaryForegroundDark: "15 40% 10%",
      colorAccent: "45 90% 60%",
      colorAccentForeground: "15 50% 15%",
      colorAccentDark: "45 80% 35%",
      colorAccentForegroundDark: "30 60% 92%",
      colorMuted: "30 60% 92%",
      colorMutedForeground: "15 40% 35%",
      colorMutedDark: "15 30% 22%",
      colorMutedForegroundDark: "30 60% 85%",
      colorDestructive: "0 75% 45%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 80% 55%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
  {
    id: "sepia",
    label: "Sepia",
    description: "Aged paper with brown ink.",
    colors: {
      colorBackground: "35 50% 92%",
      colorForeground: "25 50% 18%",
      colorBackgroundDark: "25 30% 10%",
      colorForegroundDark: "35 40% 88%",
      colorPrimary: "25 60% 35%",
      colorPrimaryForeground: "35 50% 92%",
      colorPrimaryDark: "30 60% 65%",
      colorPrimaryForegroundDark: "25 30% 10%",
      colorSecondary: "35 45% 45%",
      colorSecondaryForeground: "35 50% 95%",
      colorSecondaryDark: "35 50% 60%",
      colorSecondaryForegroundDark: "25 30% 10%",
      colorAccent: "40 65% 70%",
      colorAccentForeground: "25 50% 18%",
      colorAccentDark: "40 50% 25%",
      colorAccentForegroundDark: "35 40% 88%",
      colorMuted: "35 40% 86%",
      colorMutedForeground: "25 30% 35%",
      colorMutedDark: "25 25% 18%",
      colorMutedForegroundDark: "35 40% 80%",
      colorDestructive: "0 60% 40%",
      colorDestructiveForeground: "35 50% 92%",
      colorDestructiveDark: "0 70% 50%",
      colorDestructiveForegroundDark: "25 30% 10%",
    },
  },
  {
    id: "high-contrast",
    label: "High contrast",
    description: "Maximum contrast for accessibility.",
    colors: {
      colorBackground: "0 0% 100%",
      colorForeground: "0 0% 0%",
      colorBackgroundDark: "0 0% 0%",
      colorForegroundDark: "0 0% 100%",
      colorPrimary: "240 100% 35%",
      colorPrimaryForeground: "0 0% 100%",
      colorPrimaryDark: "240 100% 70%",
      colorPrimaryForegroundDark: "0 0% 0%",
      colorSecondary: "280 100% 30%",
      colorSecondaryForeground: "0 0% 100%",
      colorSecondaryDark: "280 100% 65%",
      colorSecondaryForegroundDark: "0 0% 0%",
      colorAccent: "50 100% 50%",
      colorAccentForeground: "0 0% 0%",
      colorAccentDark: "50 100% 50%",
      colorAccentForegroundDark: "0 0% 0%",
      colorMuted: "0 0% 90%",
      colorMutedForeground: "0 0% 0%",
      colorMutedDark: "0 0% 20%",
      colorMutedForegroundDark: "0 0% 100%",
      colorDestructive: "0 100% 35%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 100% 60%",
      colorDestructiveForegroundDark: "0 0% 0%",
    },
  },
  {
    id: "pastel",
    label: "Pastel",
    description: "Soft, low-saturation washes.",
    colors: {
      colorBackground: "320 30% 98%",
      colorForeground: "280 30% 20%",
      colorBackgroundDark: "280 20% 15%",
      colorForegroundDark: "320 30% 95%",
      colorPrimary: "330 60% 70%",
      colorPrimaryForeground: "280 50% 15%",
      colorPrimaryDark: "330 50% 40%",
      colorPrimaryForegroundDark: "320 30% 95%",
      colorSecondary: "200 55% 70%",
      colorSecondaryForeground: "200 50% 15%",
      colorSecondaryDark: "200 45% 40%",
      colorSecondaryForegroundDark: "320 30% 95%",
      colorAccent: "60 60% 75%",
      colorAccentForeground: "60 50% 15%",
      colorAccentDark: "60 40% 30%",
      colorAccentForegroundDark: "320 30% 95%",
      colorMuted: "320 25% 92%",
      colorMutedForeground: "280 25% 35%",
      colorMutedDark: "280 15% 22%",
      colorMutedForegroundDark: "320 20% 85%",
      colorDestructive: "0 65% 65%",
      colorDestructiveForeground: "0 0% 100%",
      colorDestructiveDark: "0 50% 45%",
      colorDestructiveForegroundDark: "0 0% 100%",
    },
  },
] as const;

export const DEFAULT_THEME_ID: ThemeId = "bauhaus";
export const DEFAULT_PALETTE_ID: PaletteId = "bauhaus";

export function getPalette(id: string | undefined): PaletteDefinition | undefined {
  return PALETTES.find((p) => p.id === id);
}

export function getTheme(id: string | undefined): ThemeDefinition | undefined {
  return THEMES.find((t) => t.id === id);
}

/**
 * Apply a palette change to a form, preserving any custom edits.
 *
 * For each of the 14 color keys, if the current form value matches the
 * previous palette's value for that key, we replace it with the new
 * palette's value. Otherwise we keep the user's customization.
 */
export function smartMergePalette<T extends Partial<PaletteColors>>(
  form: T,
  previousPaletteId: string | undefined,
  nextPaletteId: string,
): T {
  const prev = getPalette(previousPaletteId)?.colors;
  const next = getPalette(nextPaletteId)?.colors;
  if (!next) return form;
  const result: T = { ...form };
  for (const key of PALETTE_COLOR_KEYS) {
    const current = form[key];
    // No previous palette known (e.g. server stored a custom palette id we no
    // longer recognise) → just adopt the new palette wholesale, since we have
    // nothing to compare against.
    if (!prev) {
      (result as Record<string, string>)[key] = next[key];
      continue;
    }
    if (current === prev[key]) {
      (result as Record<string, string>)[key] = next[key];
    }
  }
  return result;
}
