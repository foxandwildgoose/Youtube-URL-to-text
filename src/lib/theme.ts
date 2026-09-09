import { create } from "zustand";

export const THEME_KEY = "intertext-theme";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_MODES: readonly ThemeMode[] = ["system", "light", "dark"];

export function isThemeMode(value: string | null | undefined): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

export function parseThemeMode(value: string | null | undefined): ThemeMode {
  return isThemeMode(value) ? value : "system";
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function themeColor(resolved: ResolvedTheme): string {
  return resolved === "dark" ? "#14110E" : "#F6F3EE";
}

export function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode, dark = prefersDark()): ResolvedTheme {
  const resolved = resolveTheme(mode, dark);
  if (typeof document === "undefined") return resolved;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
  root.classList.toggle("dark", resolved === "dark");
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", themeColor(resolved));
  return resolved;
}

type ThemeState = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "system",
  setMode: (mode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_KEY, mode);
    }
    applyTheme(mode);
    set({ mode });
  },
}));

export function hydrateTheme(): ThemeMode {
  const mode =
    typeof window === "undefined"
      ? "system"
      : parseThemeMode(window.localStorage.getItem(THEME_KEY));
  applyTheme(mode);
  useThemeStore.setState({ mode });
  return mode;
}

export const THEME_BOOT_SCRIPT = `(function(){try{var m=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(m!=="light"&&m!=="dark"&&m!=="system")m="system";var d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);var t=d?"dark":"light";var e=document.documentElement;e.setAttribute("data-theme",t);e.style.colorScheme=t;e.classList.toggle("dark",d);var n=document.querySelector('meta[name="theme-color"]');if(n)n.setAttribute("content",d?"#14110E":"#F6F3EE");}catch(e){document.documentElement.setAttribute("data-theme","light");}})();`;
