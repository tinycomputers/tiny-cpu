import { useEffect, useState } from "react";

const KEY = "cpu-theme";

function current(): "light" | "dark" {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

/** Switches between the light and dark token sets; the choice is kept in localStorage when available. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => (typeof document === "undefined" ? "dark" : current()));

  // Restore the saved choice once the page is interactive.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") {
        document.documentElement.setAttribute("data-theme", saved);
        setTheme(saved);
      }
    } catch {
      // blocked storage: keep the default theme
    }
  }, []);
  return (
    <button
      type="button"
      className="rounded-md border border-[var(--line)] px-2 py-1 text-sm text-[var(--fg)]"
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
      onClick={() => {
        const next = theme === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // private windows and blocked storage: the theme still changes for this page
        }
        setTheme(next);
      }}
    >
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );
}
