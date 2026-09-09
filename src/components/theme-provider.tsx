import { useEffect, type ReactNode } from "react";
import { hydrateTheme, useThemeStore } from "@/lib/theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const mode = useThemeStore((s) => s.mode);

  useEffect(() => {
    hydrateTheme();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (useThemeStore.getState().mode === "system") hydrateTheme();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.themeMode = mode;
  }, [mode]);

  return children;
}
