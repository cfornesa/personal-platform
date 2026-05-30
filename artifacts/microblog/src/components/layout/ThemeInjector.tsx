import { useEffect } from "react";
import { useSiteSettings } from "@/hooks/use-site-settings";
import { DEFAULT_THEME_ID, THEMES, getPalette, type PaletteColors } from "@/lib/site-themes";

const KNOWN_THEMES = new Set<string>(THEMES.map((t) => t.id));
const STYLE_ID = "site-settings-theme";

function buildCss(data: NonNullable<ReturnType<typeof useSiteSettings>["data"]>): string {
  const stockColors = getPalette(data.palette)?.colors;

  const vDark = (
    darkVal: string | undefined | null,
    stockKey: keyof PaletteColors,
    lightVal: string
  ): string => {
    if (darkVal && typeof darkVal === "string" && darkVal.trim().length > 0) {
      return darkVal;
    }
    if (stockColors && stockColors[stockKey]) {
      return stockColors[stockKey];
    }
    return lightVal;
  };

  return `
:root {
  --background: ${data.colorBackground};
  --foreground: ${data.colorForeground};
  --card: ${data.colorBackground};
  --card-foreground: ${data.colorForeground};
  --popover: ${data.colorBackground};
  --popover-foreground: ${data.colorForeground};
  --primary: ${data.colorPrimary};
  --primary-foreground: ${data.colorPrimaryForeground};
  --secondary: ${data.colorSecondary};
  --secondary-foreground: ${data.colorSecondaryForeground};
  --accent: ${data.colorAccent};
  --accent-foreground: ${data.colorAccentForeground};
  --muted: ${data.colorMuted};
  --muted-foreground: ${data.colorMutedForeground};
  --destructive: ${data.colorDestructive};
  --destructive-foreground: ${data.colorDestructiveForeground};
  --input: ${data.colorBackground};
  --ring: ${data.colorSecondary};
}
.dark {
  --background: ${data.colorBackgroundDark};
  --foreground: ${data.colorForegroundDark};
  --card: ${data.colorBackgroundDark};
  --card-foreground: ${data.colorForegroundDark};
  --popover: ${data.colorBackgroundDark};
  --popover-foreground: ${data.colorForegroundDark};
  --primary: ${vDark(data.colorPrimaryDark, "colorPrimaryDark", data.colorPrimary)};
  --primary-foreground: ${vDark(data.colorPrimaryForegroundDark, "colorPrimaryForegroundDark", data.colorPrimaryForeground)};
  --secondary: ${vDark(data.colorSecondaryDark, "colorSecondaryDark", data.colorSecondary)};
  --secondary-foreground: ${vDark(data.colorSecondaryForegroundDark, "colorSecondaryForegroundDark", data.colorSecondaryForeground)};
  --accent: ${vDark(data.colorAccentDark, "colorAccentDark", data.colorAccent)};
  --accent-foreground: ${vDark(data.colorAccentForegroundDark, "colorAccentForegroundDark", data.colorAccentForeground)};
  --muted: ${vDark(data.colorMutedDark, "colorMutedDark", data.colorMuted)};
  --muted-foreground: ${vDark(data.colorMutedForegroundDark, "colorMutedForegroundDark", data.colorMutedForeground)};
  --destructive: ${vDark(data.colorDestructiveDark, "colorDestructiveDark", data.colorDestructive)};
  --destructive-foreground: ${vDark(data.colorDestructiveForegroundDark, "colorDestructiveForegroundDark", data.colorDestructiveForeground)};
  --input: ${data.colorBackgroundDark};
  --ring: ${vDark(data.colorSecondaryDark, "colorSecondaryDark", data.colorSecondary)};
}`.trim();
}

export function ThemeInjector() {
  const { data } = useSiteSettings();

  useEffect(() => {
    if (!data) return;

    const css = buildCss(data);

    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    if (el.textContent !== css) {
      el.textContent = css;
    }
  }, [data]);

  useEffect(() => {
    const themeId = data?.theme && KNOWN_THEMES.has(data.theme) ? data.theme : DEFAULT_THEME_ID;
    if (document.documentElement.getAttribute("data-theme") !== themeId) {
      document.documentElement.setAttribute("data-theme", themeId);
    }
  }, [data?.theme]);

  useEffect(() => {
    if (data?.siteTitle) {
      document.title = data.siteTitle;
    }
  }, [data?.siteTitle]);

  return null;
}
