import { useEffect, useState } from "react";
import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    Cookie,
    Info,
    Loader2,
    Trash2,
} from "lucide-react";

import AsyncButton from "@/components/AsyncButton";
import StatusLine from "@/components/StatusLine";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
    clearGoogleCookies,
    getGoogleCookieStatus,
    getPatreonCookieStatus,
    setPatreonCookie,
} from "@/lib/api";
import type { GoogleCookieStatus, PatreonCookieStatus } from "@/lib/types";
import { getErrorMessage } from "@/lib/utils";

interface CookiePaneProps {
    /** Whether the pane is visible. Used to defer status fetch until needed. */
    open: boolean;
}

type PatreonStatus = PatreonCookieStatus | null;
type GoogleStatus = GoogleCookieStatus | null;

/**
 * Sessions tab: shows the status of both the Patreon session cookie
 * (used by `patreon-dl`) and the Google cookies (used by the Drive
 * scrape). The browser extension syncs both with one click and is the
 * recommended path. Manual paste is supported for Patreon only; Google
 * cookies are an array of structured entries that can't be pasted by
 * hand. Clearing either works from here.
 */
export default function CookiePane({ open }: CookiePaneProps) {
    const [patreonStatus, setPatreonStatus] = useState<PatreonStatus>(null);
    const [googleStatus, setGoogleStatus] = useState<GoogleStatus>(null);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{
        type: "success" | "error";
        msg: string;
    } | null>(null);
    const [clearPatreonOpen, setClearPatreonOpen] = useState(false);
    const [clearGoogleOpen, setClearGoogleOpen] = useState(false);

    // Refresh both statuses whenever the pane becomes visible.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        Promise.allSettled([
            getPatreonCookieStatus(),
            getGoogleCookieStatus(),
        ]).then(([p, g]) => {
            if (cancelled) return;
            setPatreonStatus(
                p.status === "fulfilled" ? p.value : { set: false, length: 0 },
            );
            setGoogleStatus(
                g.status === "fulfilled"
                    ? g.value
                    : { set: false, count: 0, length: 0 },
            );
        });
        return () => {
            cancelled = true;
        };
    }, [open]);

    async function handleSavePatreon() {
        const trimmed = draft.trim();
        if (!trimmed) return;
        setSaving(true);
        setFeedback(null);
        try {
            const next = await setPatreonCookie(trimmed);
            setPatreonStatus(next);
            setDraft("");
            setFeedback({
                type: "success",
                msg: `Patreon cookie saved. ${next.length} characters stored locally.`,
            });
        } catch (err) {
            setFeedback({ type: "error", msg: getErrorMessage(err) });
        } finally {
            setSaving(false);
        }
    }

    async function performClearPatreon() {
        setClearPatreonOpen(false);
        setSaving(true);
        setFeedback(null);
        try {
            const next = await setPatreonCookie("");
            setPatreonStatus(next);
            setFeedback({ type: "success", msg: "Patreon cookie cleared." });
        } catch (err) {
            setFeedback({ type: "error", msg: getErrorMessage(err) });
        } finally {
            setSaving(false);
        }
    }

    async function performClearGoogle() {
        setClearGoogleOpen(false);
        setSaving(true);
        setFeedback(null);
        try {
            const next = await clearGoogleCookies();
            setGoogleStatus(next);
            setFeedback({ type: "success", msg: "Google cookies cleared." });
        } catch (err) {
            setFeedback({ type: "error", msg: getErrorMessage(err) });
        } finally {
            setSaving(false);
        }
    }

    return (
        <>
        <div className="flex flex-col flex-1 min-h-0">
            {/* Top: help + status rows */}
            <div className="shrink-0 px-6 pt-5 pb-3 flex flex-col gap-4">
                <p className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                    <Info
                        size={14}
                        aria-hidden
                        className="shrink-0 mt-1 text-muted-foreground/70"
                    />
                    <span>
                        The Patreon URL panel needs your Patreon session
                        cookie. The Drive download flow needs your Google
                        cookies. The{" "}
                        <strong className="text-foreground font-medium">
                            browser extension
                        </strong>{" "}
                        syncs both with one click and is the recommended way;
                        see "How do I sync my cookies?" below.
                    </span>
                </p>

                <div className="grid grid-cols-[minmax(0,5rem)_1fr_auto] gap-x-3 gap-y-2 items-center">
                    <StatusRow
                        label="Patreon"
                        status={
                            patreonStatus === null
                                ? "checking"
                                : patreonStatus.set
                                  ? {
                                        kind: "connected",
                                        detail: `${patreonStatus.length.toLocaleString()} characters stored`,
                                    }
                                  : "not-connected"
                        }
                        onClear={
                            patreonStatus?.set
                                ? () => setClearPatreonOpen(true)
                                : undefined
                        }
                        busy={saving}
                    />
                    <StatusRow
                        label="Google"
                        status={
                            googleStatus === null
                                ? "checking"
                                : googleStatus.set
                                  ? {
                                        kind: "connected",
                                        detail: `${googleStatus.count.toLocaleString()} cookie${
                                            googleStatus.count === 1 ? "" : "s"
                                        } stored`,
                                    }
                                  : "not-connected"
                        }
                        onClear={
                            googleStatus?.set
                                ? () => setClearGoogleOpen(true)
                                : undefined
                        }
                        busy={saving}
                    />
                </div>
            </div>

            {/* Scrollable middle: textarea + help drawer */}
            <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-3 flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <label
                        htmlFor="cookie-value"
                        className="text-sm font-medium tracking-wide text-muted-foreground"
                    >
                        Patreon cookie (manual paste)
                    </label>
                    <Textarea
                        id="cookie-value"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="patreon_device_id=...; session_id=...; cf_clearance=...; ..."
                        className="font-mono text-sm min-h-32 leading-relaxed wrap-break-word"
                        spellCheck={false}
                    />
                    <p className="text-xs text-muted-foreground/80">
                        Google cookies can't be pasted by hand (they're an
                        array of structured entries). Use the browser
                        extension to sync both at once.
                    </p>
                </div>

                {feedback && (
                    <StatusLine
                        tone={
                            feedback.type === "success" ? "success" : "error"
                        }
                    >
                        {feedback.msg}
                    </StatusLine>
                )}

                <Collapsible>
                    <CollapsibleTrigger asChild>
                        <button
                            type="button"
                            className="group/cookiehelp flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors py-1 px-1 -mx-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 w-fit"
                        >
                            <ChevronDown
                                size={14}
                                aria-hidden
                                className="transition-transform motion-safe:duration-200 motion-safe:ease-out group-data-[state=closed]/cookiehelp:-rotate-90"
                            />
                            How do I sync my cookies?
                        </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="overflow-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:slide-in-from-top-1 data-[state=closed]:slide-out-to-top-1">
                        <div className="mt-2 bg-muted/40 border border-border rounded-md p-4 text-sm text-muted-foreground leading-relaxed flex flex-col gap-4">
                            <section className="flex flex-col gap-2">
                                <h4 className="text-foreground font-medium text-sm">
                                    Recommended: browser extension
                                </h4>
                                <p>
                                    The extension at{" "}
                                    <code className="font-mono text-foreground/80">
                                        extension/
                                    </code>{" "}
                                    syncs your Patreon and Google session
                                    cookies in one click. Both are needed for
                                    the app's two main workflows (Patreon
                                    URL fetch, Drive download).
                                </p>
                                <ol className="list-decimal pl-5 space-y-1.5">
                                    <li>
                                        Open{" "}
                                        <code className="font-mono text-foreground/80">
                                            chrome://extensions
                                        </code>{" "}
                                        (or{" "}
                                        <code className="font-mono text-foreground/80">
                                            about:debugging#/runtime/this-firefox
                                        </code>{" "}
                                        on Firefox), enable Developer mode,
                                        and load the unpacked{" "}
                                        <code className="font-mono text-foreground/80">
                                            extension/
                                        </code>{" "}
                                        directory.
                                    </li>
                                    <li>
                                        Log into{" "}
                                        <a
                                            href="https://www.patreon.com"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary underline-offset-2 hover:underline"
                                        >
                                            patreon.com
                                        </a>{" "}
                                        and a Google account (for example{" "}
                                        <a
                                            href="https://accounts.google.com"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary underline-offset-2 hover:underline"
                                        >
                                            accounts.google.com
                                        </a>
                                        ) in the same browser profile.
                                    </li>
                                    <li>
                                        Visit any Patreon page. Click the
                                        floating{" "}
                                        <strong className="text-foreground">
                                            Sync Patreon cookie
                                        </strong>{" "}
                                        pill (or open the extension popup and
                                        click{" "}
                                        <strong className="text-foreground">
                                            Sync Patreon + Google cookies
                                        </strong>
                                        ).
                                    </li>
                                    <li>
                                        Re-sync when fetches start failing
                                        (Patreon sessions last about a month,
                                        Google about two weeks).
                                    </li>
                                </ol>
                                <p className="text-muted-foreground/80">
                                    Full install + permissions docs:{" "}
                                    <code className="font-mono text-foreground/80">
                                        extension/README.md
                                    </code>
                                    .
                                </p>
                            </section>

                            <section className="flex flex-col gap-2 pt-3 border-t border-border">
                                <h4 className="text-foreground font-medium text-sm">
                                    Manual fallback (Patreon only)
                                </h4>
                                <p>
                                    Google cookies are an array of structured
                                    entries; they can't be pasted as plain
                                    text and must be synced via the extension.
                                    For Patreon only, copy the cookie string
                                    from DevTools:
                                </p>
                                <ol className="list-decimal pl-5 space-y-1.5">
                                    <li>
                                        Open{" "}
                                        <a
                                            href="https://www.patreon.com"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-primary underline-offset-2 hover:underline"
                                        >
                                            patreon.com
                                        </a>{" "}
                                        in a new tab and log in.
                                    </li>
                                    <li>
                                        Open DevTools (
                                        <kbd className="font-mono text-xs px-1.5 py-0.5 rounded bg-card border border-border text-foreground/80">
                                            F12
                                        </kbd>
                                        ) and switch to the{" "}
                                        <strong className="text-foreground">
                                            Network
                                        </strong>{" "}
                                        tab.
                                    </li>
                                    <li>
                                        Filter to{" "}
                                        <strong className="text-foreground">
                                            Doc
                                        </strong>{" "}
                                        and reload the page so the document
                                        request appears.
                                    </li>
                                    <li>
                                        Click the document request,{" "}
                                        <strong className="text-foreground">
                                            Headers
                                        </strong>
                                        , scroll to{" "}
                                        <strong className="text-foreground">
                                            Request Headers
                                        </strong>
                                        , right-click the{" "}
                                        <code className="font-mono text-foreground/80">
                                            cookie:
                                        </code>{" "}
                                        line,{" "}
                                        <strong className="text-foreground">
                                            Copy value
                                        </strong>
                                        .
                                    </li>
                                    <li>
                                        Paste the entire value into the box
                                        above and click{" "}
                                        <strong className="text-foreground">
                                            Save Patreon cookie
                                        </strong>
                                        . Don&apos;t include the leading{" "}
                                        <code className="font-mono text-foreground/80">
                                            cookie:
                                        </code>{" "}
                                        label.
                                    </li>
                                </ol>
                                <p className="text-muted-foreground/80">
                                    More on the manual Patreon path:{" "}
                                    <a
                                        href="https://github.com/patrickkfkan/patreon-dl/wiki/How-to-obtain-Cookie"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-primary underline-offset-2 hover:underline"
                                    >
                                        patreon-dl wiki
                                    </a>
                                    .
                                </p>
                            </section>
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            </div>

            {/* Sticky bottom: save Patreon */}
            <div className="shrink-0 px-6 pt-3 pb-5 border-t border-border">
                <AsyncButton
                    onClick={handleSavePatreon}
                    disabled={!draft.trim()}
                    loading={saving}
                    loadingLabel="Saving"
                    className="h-12 w-full gap-2 text-base"
                >
                    <Cookie size={18} aria-hidden />
                    Save Patreon cookie
                </AsyncButton>
            </div>
        </div>

        <AlertDialog
            open={clearPatreonOpen}
            onOpenChange={setClearPatreonOpen}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Clear the saved Patreon cookie?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        The Patreon URL fetch flow will stop working until you
                        sync a new cookie.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={performClearPatreon}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Clear
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
            open={clearGoogleOpen}
            onOpenChange={setClearGoogleOpen}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Clear the saved Google cookies?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        The Drive download flow will stop working until you
                        sync new cookies via the browser extension.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={performClearGoogle}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Clear
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}

interface StatusRowProps {
    label: string;
    status:
        | "checking"
        | "not-connected"
        | { kind: "connected"; detail: string };
    onClear?: () => void;
    busy: boolean;
}

function StatusRow({ label, status, onClear, busy }: StatusRowProps) {
    return (
        <>
            <span className="text-sm font-medium tracking-wide text-muted-foreground">
                {label}
            </span>
            <StatusBody status={status} />
            <div className="justify-self-end">
                {onClear && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onClear}
                        disabled={busy}
                        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                        <Trash2 size={12} aria-hidden />
                        Clear
                    </Button>
                )}
            </div>
        </>
    );
}

function StatusBody({ status }: { status: StatusRowProps["status"] }) {
    if (status === "checking") {
        return (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} aria-hidden className="animate-spin" />
                Checking
            </span>
        );
    }
    if (status === "not-connected") {
        return (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertCircle size={14} aria-hidden />
                Not connected
            </span>
        );
    }
    return (
        <span className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 size={14} aria-hidden />
            <span>
                Connected,{" "}
                <span className="font-mono tabular-nums">{status.detail}</span>
            </span>
        </span>
    );
}
