import { Download, FileAudio, FileText, Globe, Keyboard, MousePointerClick, X } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";

interface HelpSheetProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Right-side reference card. Not a tutorial — no forced walkthrough, no
 * modal-on-load, no step-by-step overlay. The user opens this when they
 * want to know "what does this do" or "how do I set this up"; otherwise
 * the app stays quiet.
 *
 * Content is static prose grouped into a handful of cards. Update in
 * place when the workflow shifts; this is not generated from the code.
 */
export default function HelpSheet({ open, onClose }: HelpSheetProps) {
    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent className="w-full sm:max-w-xl overflow-hidden" showCloseButton={false}>
                <SheetTitle className="sr-only">Help</SheetTitle>
                <SheetDescription className="sr-only">
                    Quick reference for the three workflows, first-time setup, and discoverability
                    tips.
                </SheetDescription>

                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Help &amp; reference
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close help"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                <div className="overflow-y-auto px-5 py-5 flex flex-col gap-5">
                    {/* Intro */}
                    <section className="flex flex-col gap-2">
                        <h2 className="text-sm font-medium tracking-wide text-foreground">
                            What this does
                        </h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            ASMR Curator pulls audio out of Patreon (including Drive-hosted links)
                            and writes consistent filenames against a tag dictionary you control.
                            Everything runs locally; nothing leaves your machine.
                        </p>
                    </section>

                    {/* Three workflows */}
                    <section className="flex flex-col gap-3">
                        <h2 className="text-sm font-medium tracking-wide text-foreground">
                            Three ways to start
                        </h2>
                        <div className="flex flex-col gap-2.5">
                            <HelpCard
                                icon={<Globe size={14} aria-hidden />}
                                title="Patreon URL"
                                body="Paste a post or creator URL. The fetcher downloads the audio and pre-fills title, tags, and artist from the post metadata. Needs a Patreon cookie."
                            />
                            <HelpCard
                                icon={<FileText size={14} aria-hidden />}
                                title="Screenshot"
                                body="Drop or paste a screenshot of a post the fetcher can't read. A vision model extracts title and tags. Fallback when the URL path fails."
                            />
                            <HelpCard
                                icon={<FileAudio size={14} aria-hidden />}
                                title="File already on disk"
                                body="Drop files into the Downloads folder yourself, then open the File library below. Use Rename and Move to file them into the curated library."
                            />
                        </div>
                    </section>

                    {/* Setup */}
                    <section className="flex flex-col gap-3">
                        <h2 className="text-sm font-medium tracking-wide text-foreground">
                            First-time setup
                        </h2>
                        <ol className="flex flex-col gap-2 text-sm text-muted-foreground leading-relaxed">
                            <li>
                                <span className="text-foreground/90 font-medium">
                                    1. Install the browser extension
                                </span>{" "}
                                (Chromium or Firefox 121+) or open Manage cookies in Settings to
                                paste them manually.
                            </li>
                            <li>
                                <span className="text-foreground/90 font-medium">
                                    2. Sign in to Patreon and Google
                                </span>{" "}
                                in the same browser profile the extension lives in.
                            </li>
                            <li>
                                <span className="text-foreground/90 font-medium">
                                    3. Click Sync cookies once.
                                </span>{" "}
                                The popup confirms how many cookies were synced. Patreon and Drive
                                workflows now work until the session expires (~30 days for Patreon,
                                ~14 for Google).
                            </li>
                        </ol>
                    </section>

                    {/* Discoverability */}
                    <section className="flex flex-col gap-3">
                        <h2 className="text-sm font-medium tracking-wide text-foreground">
                            Tips that aren&apos;t obvious
                        </h2>
                        <div className="flex flex-col gap-2.5">
                            <HelpCard
                                icon={<MousePointerClick size={14} aria-hidden />}
                                title="Right-click a tag chip"
                                body="Add it to your dictionary as a new canonical, or as an alias of an existing one. Novel (warm-amber) chips are tags the dictionary doesn't recognise yet."
                            />
                            <HelpCard
                                icon={<Keyboard size={14} aria-hidden />}
                                title="Cmd / Ctrl + Enter"
                                body="Fires Generate filename from inside the title or format input. Useful when you're working through a batch and want to skip the mouse."
                            />
                            <HelpCard
                                icon={<Download size={14} aria-hidden />}
                                title="Power mode"
                                body="Toggle in Settings. Auto-expands More options on the source panels, surfaces raw LLM output on screenshot fetches, and turns on advanced filters."
                            />
                        </div>
                    </section>
                </div>
            </SheetContent>
        </Sheet>
    );
}

function HelpCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
    return (
        <div className="flex flex-col gap-1 px-3 py-2.5 rounded-md border border-border bg-background">
            <div className="flex items-center gap-2 text-foreground/90">
                <span className="text-muted-foreground/80">{icon}</span>
                <span className="text-sm font-medium">{title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
        </div>
    );
}
