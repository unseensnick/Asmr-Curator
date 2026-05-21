import { useEffect, useState } from "react";
import { BookOpen, CircleHelp, Cookie, Moon, Settings2, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { API, apiGet } from "@/lib/api";
import { applyTheme, getInitialTheme, setStoredTheme, type ThemeMode } from "@/lib/theme";

interface SystemInfo {
    model: string;
    version: string;
}

interface HeaderProps {
    /** Vocabulary count from App-level dict state. */
    dictTagCount: number;
    /** Open the Library settings modal (vocabulary, suppressed, test). */
    onOpenLibrarySettings: () => void;
    /** Optional pre-warm: kick off the Dictionary chunk fetch on hover /
     *  focus of the Dictionary button so the slide-in animation starts
     *  immediately on click instead of waiting for the lazy chunk. */
    onPrefetchLibrarySettings?: () => void;
    /** Open the standalone Cookies modal. */
    onOpenCookies: () => void;
    /** Open the Help reference sheet. */
    onOpenHelp: () => void;
    /** App-level power mode flag; controls auto-expand of "More options" disclosures. */
    powerMode: boolean;
    onPowerModeChange: (next: boolean) => void;
}

/** localStorage flag: cleared on first Help open so the discovery dot
 *  next to the ? icon disappears after the user has seen the panel once. */
const HELP_SEEN_KEY = "app.helpSeen";

/**
 * Single-row app chrome. Brand mark left; Library settings action and
 * Settings menu right. The Settings menu contains theme + power mode
 * toggles, a Manage cookies entry, and read-only system info (model,
 * version). Absorbs the old bottom StatusBar. Cookie-missing nags are
 * deliberately not surfaced here — the inline first-failure prompt in
 * the Patreon panel covers that signal where the user actually hits it.
 */
export default function Header({
    dictTagCount,
    onOpenLibrarySettings,
    onPrefetchLibrarySettings,
    onOpenCookies,
    onOpenHelp,
    powerMode,
    onPowerModeChange,
}: HeaderProps) {
    const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
    const [info, setInfo] = useState<SystemInfo | null>(null);
    const [helpSeen, setHelpSeen] = useState<boolean>(() => {
        try {
            return localStorage.getItem(HELP_SEEN_KEY) === "true";
        } catch {
            return false;
        }
    });

    function handleOpenHelp() {
        if (!helpSeen) {
            setHelpSeen(true);
            try {
                localStorage.setItem(HELP_SEEN_KEY, "true");
            } catch {
                // non-fatal
            }
        }
        onOpenHelp();
    }

    useEffect(() => {
        applyTheme(theme);
    }, [theme]);

    useEffect(() => {
        let cancelled = false;
        apiGet<SystemInfo>(API.systemInfo)
            .then((data) => {
                if (!cancelled) setInfo(data);
            })
            .catch(() => {
                if (!cancelled) setInfo({ model: "unknown", version: "unknown" });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    function toggleTheme(checked: boolean) {
        const next: ThemeMode = checked ? "dark" : "light";
        setTheme(next);
        setStoredTheme(next);
    }

    const isDark = theme === "dark";

    return (
        <header className="flex items-center justify-between gap-4 px-1 pb-5 mb-8 lg:mb-10 border-b border-border">
            <div className="flex flex-col gap-0.5 min-w-0">
                <h1 className="font-display text-2xl lg:text-3xl font-semibold tracking-tight text-foreground">
                    ASMR Curator
                </h1>
                <p className="font-display text-base italic text-muted-foreground/80 leading-snug">
                    A quiet place for your audio library.
                </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={handleOpenHelp}
                            aria-label="Help and reference"
                            className="relative"
                        >
                            <CircleHelp size={16} aria-hidden />
                            {!helpSeen && (
                                // First-run discovery dot. Clears on first open and
                                // does not return; we trust the user to remember the
                                // button is here.
                                <span
                                    aria-hidden
                                    className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary"
                                />
                            )}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Help and reference</TooltipContent>
                </Tooltip>
                <Button
                    variant="outline"
                    onClick={onOpenLibrarySettings}
                    onMouseEnter={onPrefetchLibrarySettings}
                    onFocus={onPrefetchLibrarySettings}
                    className="gap-2"
                    aria-label="Open dictionary"
                >
                    <BookOpen size={14} aria-hidden />
                    <span>Dictionary</span>
                    <span aria-hidden className="opacity-40">
                        ·
                    </span>
                    <span className="font-mono text-xs tabular-nums">{dictTagCount}</span>
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Settings"
                            className="relative"
                        >
                            <Settings2 size={16} aria-hidden />
                            {powerMode && (
                                <span
                                    aria-hidden
                                    className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground/60"
                                />
                            )}
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-64">
                        <DropdownMenuCheckboxItem checked={isDark} onCheckedChange={toggleTheme}>
                            <span className="flex items-center gap-2">
                                {isDark ? (
                                    <Moon size={14} aria-hidden />
                                ) : (
                                    <Sun size={14} aria-hidden />
                                )}
                                Dark mode
                            </span>
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuCheckboxItem
                            checked={powerMode}
                            onCheckedChange={onPowerModeChange}
                        >
                            <span className="flex flex-col gap-0.5">
                                <span>Power mode</span>
                                <span className="text-xs font-normal text-muted-foreground leading-relaxed">
                                    Show advanced filters and log details by default.
                                </span>
                            </span>
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={onOpenCookies}>
                            <Cookie size={14} aria-hidden />
                            Manage cookies
                        </DropdownMenuItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="font-mono">
                            Model {info?.model ?? "loading"}
                        </DropdownMenuLabel>
                        <DropdownMenuLabel className="font-mono">
                            Version {info?.version ?? "loading"}
                        </DropdownMenuLabel>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
