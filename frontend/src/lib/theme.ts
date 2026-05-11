/**
 * Two-mode theme system: light / dark.
 *
 * First-load behaviour:
 *   - If the user has previously toggled, their choice is in localStorage and wins.
 *   - Otherwise, we follow the OS via `prefers-color-scheme`.
 *
 * After first toggle, we stop listening to OS changes — the user has explicitly chosen.
 *
 * The actual class-on-<html> application happens in two places:
 *   1. The inline <script> in index.html (runs before React, prevents FOUC).
 *   2. ThemeToggle.tsx (responds to user clicks).
 *
 * This module only houses the pure helpers.
 */

const STORAGE_KEY = "theme";

export type ThemeMode = "light" | "dark";

function isThemeMode(v: unknown): v is ThemeMode {
    return v === "light" || v === "dark";
}

/** Read the user's last explicit choice from localStorage, or null if none. */
export function getStoredTheme(): ThemeMode | null {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return isThemeMode(v) ? v : null;
    } catch {
        return null;
    }
}

/** Compute what the theme should be on this load: stored choice wins, else OS preference. */
export function getInitialTheme(): ThemeMode {
    const stored = getStoredTheme();
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Apply (or remove) the `.dark` class on <html>. */
export function applyTheme(mode: ThemeMode): void {
    const root = document.documentElement;
    if (mode === "dark") {
        root.classList.add("dark");
    } else {
        root.classList.remove("dark");
    }
}

/** Persist the user's choice so it survives reload. */
export function setStoredTheme(mode: ThemeMode): void {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {
        // localStorage unavailable (private mode, quota exceeded) — non-fatal.
    }
}
