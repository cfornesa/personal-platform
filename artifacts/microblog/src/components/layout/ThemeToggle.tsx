import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSiteSettings } from "@/hooks/use-site-settings";

type ThemeMode = "light" | "dark";

export function ThemeToggle() {
  const { data: siteSettings } = useSiteSettings();

  const [mode, setMode] = useState<ThemeMode>(() => {
    // Read from localStorage, fallback to bootstrap-configured class name
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("theme-mode");
      if (stored === "light" || stored === "dark") {
        return stored;
      }
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "light";
  });

  useEffect(() => {
    const root = document.documentElement;
    if (mode === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [mode]);

  // Sync with defaultThemeMode if no user preference exists
  useEffect(() => {
    const stored = localStorage.getItem("theme-mode");
    if (stored === "light" || stored === "dark") {
      return;
    }

    if (siteSettings?.defaultThemeMode) {
      if (siteSettings.defaultThemeMode === "dark") {
        setMode("dark");
      } else if (siteSettings.defaultThemeMode === "light") {
        setMode("light");
      } else if (siteSettings.defaultThemeMode === "system") {
        setMode(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      }
    }
  }, [siteSettings?.defaultThemeMode]);

  // Listen to system preference changes if no user-preference is set and default is system
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      const stored = localStorage.getItem("theme-mode");
      if (!stored && (!siteSettings?.defaultThemeMode || siteSettings.defaultThemeMode === "system")) {
        setMode(e.matches ? "dark" : "light");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [siteSettings?.defaultThemeMode]);

  const setExplicitMode = (next: ThemeMode) => {
    setMode(next);
    localStorage.setItem("theme-mode", next);
  };

  return (
    <div className="fixed bottom-6 left-6 z-50 flex items-center gap-2 group">
      {/* Floating Toggle Button */}
      <button
        onClick={() => setExplicitMode(mode === "light" ? "dark" : "light")}
        aria-label={`Switch to ${mode === "light" ? "dark" : "light"} mode`}
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border border-border shadow-lg transition-all duration-300",
          "bg-background/90 backdrop-blur-md text-foreground",
          "hover:scale-110 hover:shadow-xl hover:bg-muted active:scale-95",
          "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
        )}
      >
        <span className="relative h-5 w-5 flex items-center justify-center">
          {/* Moon Icon (visible in light mode) */}
          <Moon
            className={cn(
              "h-5 w-5 transition-all duration-500 absolute",
              mode === "dark" ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
            )}
          />
          {/* Sun Icon (visible in dark mode) */}
          <Sun
            className={cn(
              "h-5 w-5 transition-all duration-500 absolute text-amber-500",
              mode === "light" ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
            )}
          />
        </span>
      </button>

      {/* Floating Tooltip Label */}
      <span
        className={cn(
          "pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          "px-2.5 py-1.5 rounded-md border border-border text-xs font-medium shadow-md bg-popover text-popover-foreground backdrop-blur-sm select-none"
        )}
      >
        {mode === "light" ? "Dark Mode" : "Light Mode"}
      </span>
    </div>
  );
}
