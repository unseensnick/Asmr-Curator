import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Cookie, Trash2 } from "lucide-react";
import AsyncButton from "@/components/AsyncButton";
import StatusLine from "@/components/StatusLine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getPatreonCookieStatus, setPatreonCookie } from "@/lib/api";
import { getErrorMessage } from "@/lib/utils";

interface CookiePaneProps {
    /** Whether the pane is visible — used to defer status fetch until needed. */
    open: boolean;
}

/**
 * Patreon cookie tab body. Lets the user paste, save, or clear the
 * session cookie used by `patreon-dl`. Includes a collapsible
 * step-by-step walkthrough for grabbing the cookie from DevTools.
 */
export default function CookiePane({ open }: CookiePaneProps) {
    const [status, setStatus] = useState<{
        set: boolean;
        length: number;
    } | null>(null);
    const [draft, setDraft] = useState("");
    const [saving, setSaving] = useState(false);
    const [feedback, setFeedback] = useState<{
        type: "success" | "error";
        msg: string;
    } | null>(null);
    const [helpOpen, setHelpOpen] = useState(false);

    // Refresh status whenever the pane becomes visible.
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        getPatreonCookieStatus()
            .then((s) => {
                if (!cancelled) setStatus(s);
            })
            .catch(() => {
                if (!cancelled) setStatus({ set: false, length: 0 });
            });
        return () => {
            cancelled = true;
        };
    }, [open]);

    async function handleSave() {
        const trimmed = draft.trim();
        if (!trimmed) return;
        setSaving(true);
        setFeedback(null);
        try {
            const next = await setPatreonCookie(trimmed);
            setStatus(next);
            setDraft("");
            setFeedback({
                type: "success",
                msg: `Saved — ${next.length} chars stored locally`,
            });
        } catch (err) {
            setFeedback({ type: "error", msg: getErrorMessage(err) });
        } finally {
            setSaving(false);
        }
    }

    async function handleClear() {
        if (!confirm("Clear the saved Patreon cookie?")) return;
        setSaving(true);
        setFeedback(null);
        try {
            const next = await setPatreonCookie("");
            setStatus(next);
            setFeedback({ type: "success", msg: "Cookie cleared" });
        } catch (err) {
            setFeedback({ type: "error", msg: getErrorMessage(err) });
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Fixed top: description + status */}
            <div className="shrink-0 px-5 pt-5">
                <p className="text-[11px] text-muted-foreground bg-secondary border border-border rounded-md px-3 py-2 mb-4 leading-relaxed">
                    The Patreon URL panel uses your browser session cookie to
                    download posts via{" "}
                    <code className="text-primary">patreon-dl</code>. The cookie
                    is stored locally in{" "}
                    <code className="text-primary">data/dictionary.db</code>. It
                    expires periodically — refresh it from your browser when the
                    URL fetch starts failing.
                </p>

                {/* Status badge */}
                <div className="mb-3 flex items-center gap-2">
                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground">
                        Status
                    </span>
                    {status === null ? (
                        <Badge variant="outline" className="text-[10px]">
                            Loading…
                        </Badge>
                    ) : status.set ? (
                        <Badge
                            variant="outline"
                            className="text-[10px] border-success/40 text-success"
                        >
                            ✓ Cookie is set ({status.length} chars)
                        </Badge>
                    ) : (
                        <Badge
                            variant="outline"
                            className="text-[10px] border-destructive/40 text-destructive/80"
                        >
                            ✗ Not set
                        </Badge>
                    )}
                    {status?.set && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleClear}
                            disabled={saving}
                            className="ml-auto text-[11px] gap-1.5 text-destructive/70 hover:text-destructive hover:border-destructive/50"
                        >
                            <Trash2 size={12} />
                            Clear
                        </Button>
                    )}
                </div>
            </div>

            {/* Scrollable middle: textarea + help */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-3">
                <label className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground block mb-2">
                    New cookie value
                </label>
                <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="patreon_device_id=…; session_id=…; cf_clearance=…; …"
                    className="font-mono text-[11px] min-h-32 leading-relaxed wrap-break-word"
                    spellCheck={false}
                />

                {/* Inline feedback after save */}
                {feedback && (
                    <StatusLine
                        tone={feedback.type === "success" ? "success" : "error"}
                        className="mt-2"
                    >
                        {feedback.msg}
                    </StatusLine>
                )}

                {/* Help drawer */}
                <button
                    className="mt-5 flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-primary transition-colors tracking-[0.06em] select-none"
                    onClick={() => setHelpOpen((v) => !v)}
                >
                    {helpOpen ? (
                        <ChevronDown size={12} />
                    ) : (
                        <ChevronRight size={12} />
                    )}
                    How do I get my cookie?
                </button>

                {helpOpen && (
                    <div className="mt-2 bg-secondary border border-border rounded-md p-4 text-[11px] text-muted-foreground leading-relaxed">
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
                                <kbd className="text-[10px] px-1 py-0.5 rounded border border-border bg-background">
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
                                <strong className="text-foreground">Doc</strong>{" "}
                                and reload the page so the document request
                                appears.
                            </li>
                            <li>
                                Click the document request →{" "}
                                <strong className="text-foreground">
                                    Headers
                                </strong>{" "}
                                → scroll to{" "}
                                <strong className="text-foreground">
                                    Request Headers
                                </strong>{" "}
                                → right-click the
                                <code className="text-primary mx-1">
                                    cookie:
                                </code>
                                line →{" "}
                                <strong className="text-foreground">
                                    Copy value
                                </strong>
                                .
                            </li>
                            <li>
                                Paste the entire value above and click{" "}
                                <strong className="text-foreground">
                                    Save
                                </strong>
                                . Don&apos;t include the leading{" "}
                                <code className="text-primary">cookie:</code>{" "}
                                label.
                            </li>
                        </ol>
                        <p className="mt-3 text-muted-foreground/80">
                            See the{" "}
                            <a
                                href="https://github.com/patrickkfkan/patreon-dl/wiki/How-to-obtain-Cookie"
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline-offset-2 hover:underline"
                            >
                                patreon-dl wiki
                            </a>{" "}
                            for screenshots.
                        </p>
                    </div>
                )}
            </div>

            {/* Fixed bottom: save button */}
            <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border">
                <AsyncButton
                    onClick={handleSave}
                    disabled={!draft.trim()}
                    loading={saving}
                    loadingLabel="Saving…"
                    className="w-full gap-2"
                >
                    <Cookie size={14} />
                    Save cookie
                </AsyncButton>
            </div>
        </div>
    );
}
