"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { brand } from "@/config/brand";
import { THEME_STORAGE_KEY } from "@/components/theme-script";
import { cn } from "@/lib/utils";

type Theme = "system" | "light" | "dark";

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const THEME_EVENT = "ai-radar:theme";

function applyTheme(theme: Theme) {
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && system);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? brand.themeColor.dark : brand.themeColor.light);
}

/**
 * The theme lives on <html>, put there before first paint by ThemeScript.
 * That element is the source of truth, so this subscribes to it rather than
 * copying it into React state inside an effect — which is both a lint error
 * and a second source of truth that can disagree with the first.
 */
function subscribe(onChange: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if ((document.documentElement.dataset.theme as Theme) === "system") {
      applyTheme("system");
    }
    onChange();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const getSnapshot = (): Theme => (document.documentElement.dataset.theme as Theme) || "system";

/** On the server there is no document; "system" is what ThemeScript assumes too. */
const getServerSnapshot = (): Theme => "system";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function choose(next: Theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode can refuse storage. The choice still applies this session.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <div role="radiogroup" aria-label="Colour theme" className="border-faint-2 inline-flex border">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(option.value)}
            className={cn(
              "focus-visible:ring-org border-faint-2 flex items-center gap-2 border-r px-3 py-2 text-[13px] font-semibold last:border-r-0 focus-visible:ring-2 focus-visible:outline-none",
              selected ? "bg-ink text-paper" : "text-soft hover:bg-faint",
            )}
          >
            <Icon aria-hidden className="size-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
