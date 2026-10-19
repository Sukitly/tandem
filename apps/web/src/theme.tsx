import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type ThemeChoice, userPreferences } from "@/app/user-preferences.ts";
import { usePreference } from "@/lib/preferences.ts";

export type { ThemeChoice } from "@/app/user-preferences.ts";

interface ThemeControl {
  choice: ThemeChoice;
  setChoice(choice: ThemeChoice): void;
}

const ThemeContext = createContext<ThemeControl>({ choice: "system", setChoice: () => {} });

export function useTheme(): ThemeControl {
  return useContext(ThemeContext);
}

/** Light or dark: the system's unless the user chose one. Applied as the `dark` class on the root element. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = usePreference(userPreferences.theme);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = (): void => {
      const dark = choice === "dark" || (choice === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);

  const control = useMemo(() => ({ choice, setChoice }), [choice, setChoice]);
  return <ThemeContext.Provider value={control}>{children}</ThemeContext.Provider>;
}
