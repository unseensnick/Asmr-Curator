import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { applyTheme, getInitialTheme, setStoredTheme, type ThemeMode } from "@/lib/theme";

/**
 * Two-state theme toggle. Sun in light mode, Moon in dark mode.
 *
 * The initial render's class on <html> is set by the inline script in
 * index.html (synchronous, pre-React, no FOUC). This component owns
 * subsequent toggles and writes the user's choice to localStorage.
 */
export default function ThemeToggle() {
    const [mode, setMode] = useState<ThemeMode>(() => getInitialTheme());

    // Keep <html> class in sync with state — covers the case where some
    // other code path updates `mode` (currently only the toggle, but future-proof).
    useEffect(() => {
        applyTheme(mode);
    }, [mode]);

    function toggle() {
        const next: ThemeMode = mode === "dark" ? "light" : "dark";
        setMode(next);
        setStoredTheme(next);
    }

    const nextLabel = mode === "dark" ? "light" : "dark";

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={toggle}
                    aria-label={`Switch to ${nextLabel} mode`}
                    className="relative"
                >
                    <Sun
                        className={`size-4 transition-all duration-300 ${
                            mode === "dark" ? "scale-0 -rotate-90" : "scale-100 rotate-0"
                        }`}
                    />
                    <Moon
                        className={`absolute size-4 transition-all duration-300 ${
                            mode === "dark" ? "scale-100 rotate-0" : "scale-0 rotate-90"
                        }`}
                    />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Switch to {nextLabel} mode</TooltipContent>
        </Tooltip>
    );
}
