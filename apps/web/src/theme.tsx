import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { preferences } from "@/lib/preferences.ts";

export type ThemeChoice = "system" | "light" | "dark";

/** Also read by the inline script in `index.html`, which applies the theme before the page first paints. */
const THEME_KEY = "tandem.theme";

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
  const [choice, setChoice] = useState<ThemeChoice>(() => readChoice());

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

  return (
    <ThemeContext.Provider
      value={{
        choice,
        setChoice: (next) => {
          preferences.setItem(THEME_KEY, next);
          setChoice(next);
        },
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

function readChoice(): ThemeChoice {
  const stored = preferences.getItem(THEME_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}
