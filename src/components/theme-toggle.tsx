"use client";

import { useRef, useSyncExternalStore } from "react";
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
  // Every theme-color meta, not the first: layout.tsx declares one per
  // media query, and querySelector always returns the light one.
  const colour = dark ? brand.themeColor.dark : brand.themeColor.light;
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", colour));
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
  // Another tab writing localStorage does not touch THIS document's
  // dataset.theme, so re-applying is what makes the change visible here.
  // Subscribing without applying looked like cross-tab sync and did nothing.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return;
    const next = (event.newValue as Theme | null) ?? "system";
    applyTheme(next);
    onChange();
  };
  media.addEventListener("change", onSystemChange);
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = (): Theme => (document.documentElement.dataset.theme as Theme) || "system";

/** On the server there is no document; "system" is what ThemeScript assumes too. */
const getServerSnapshot = (): Theme => "system";

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function choose(next: Theme) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Private mode can refuse storage. The choice still applies this session.
    }
    applyTheme(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  /**
   * role="radiogroup" promises the ARIA radio pattern: ONE tab stop for the
   * group, and arrow keys to move selection within it. Declaring the role
   * without this is worse than using plain buttons — a screen reader announces
   * "System, 1 of 3" and the keys the user then reaches for do nothing.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = OPTIONS.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = index === last ? 0 : index + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = index === 0 ? last : index - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    }
    if (next === null) return;
    event.preventDefault();
    choose(OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  // The selected radio is the group's single tab stop. Before hydration the
  // store reports "system", so index 0 is focusable and the group is never
  // unreachable by keyboard.
  const selectedIndex = Math.max(
    0,
    OPTIONS.findIndex((option) => option.value === theme),
  );

  return (
    <div role="radiogroup" aria-label="Colour theme" className="border-faint-2 inline-flex border">
      {OPTIONS.map((option, index) => {
        const Icon = option.icon;
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={index === selectedIndex ? 0 : -1}
            onClick={() => choose(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
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
