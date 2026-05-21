import { lazy, Suspense, useEffect, useState } from "react";

import CookiesSheet from "@/components/CookiesSheet";
import FileBrowser from "@/components/FileBrowser";
import Header from "@/components/Header";
import HelpSheet from "@/components/HelpSheet";
import OutputPanel from "@/components/OutputPanel";
import PatreonPanel from "@/components/PatreonPanel";
import ScreenshotPanel from "@/components/ScreenshotPanel";
import TagsEditor from "@/components/TagsEditor";

// LibrarySettingsSheet is heavy (Dictionary modal + Vocabulary/Suppressed
// panes + DictionaryTester) and only renders when the user opens it via
// the Header. React.lazy moves it out of the initial chunk; Suspense
// fallback is null because the Sheet's open animation already covers
// the brief load.
const LibrarySettingsSheet = lazy(() => import("@/components/LibrarySettingsSheet"));
// BulkEditSheet will grow heavy as phases 4-7 land the per-file table,
// shared form, and rename-preview pane. Lazy from the start so the
// initial chunk doesn't carry it.
const BulkEditSheet = lazy(() => import("@/components/BulkEditSheet"));
import type { BulkEditRoot } from "@/components/BulkEditSheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API, apiGet, apiPatch, apiPost } from "@/lib/api";
import type { AppDict, DictionaryApiResponse, FileEntry, VocabEntry } from "@/lib/types";
import { dictFromApiResponse, emptyDict } from "@/lib/types";
import { getErrorMessage, sanitizeFilename, stripOuterBrackets } from "@/lib/utils";

type SourceMode = "patreon" | "screenshot";

const POWER_MODE_KEY = "app.powerMode";

function loadPowerMode(): boolean {
    try {
        return localStorage.getItem(POWER_MODE_KEY) === "true";
    } catch {
        return false;
    }
}

export default function App() {
    // Theme is applied by the inline <script> in index.html before React mounts,
    // and managed inside <Header /> via the Settings dropdown.

    // ── Shared state ──────────────────────────────────────────────────────────
    const [title, setTitle] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [suffix, setSuffix] = useState("F4A");
    const [dict, setDict] = useState<AppDict>(emptyDict());
    const [outputDash, setOutputDash] = useState("");
    const [outputPipe, setOutputPipe] = useState("");
    const [stripBrackets, setStripBrackets] = useState(true);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [cookiesOpen, setCookiesOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    // BulkEditSheet state. Files + root are populated by the FileBrowser's
    // "Bulk edit" toolbar button at the moment of open, so the sheet always
    // mounts with the current selection snapshot — later edits to the
    // selection in the FileBrowser don't trail into an already-open sheet.
    const [bulkEditOpen, setBulkEditOpen] = useState(false);
    const [bulkEditFiles, setBulkEditFiles] = useState<FileEntry[]>([]);
    const [bulkEditRoot, setBulkEditRoot] = useState<BulkEditRoot>("library");

    function openBulkEdit(selectionFiles: FileEntry[], selectionRoot: BulkEditRoot) {
        setLibraryOpen(false);
        setCookiesOpen(false);
        setHelpOpen(false);
        setBulkEditFiles(selectionFiles);
        setBulkEditRoot(selectionRoot);
        setBulkEditOpen(true);
    }

    /**
     * Drop a path from the working selection without closing the sheet.
     * The BulkEditSheet's local per-file edits + shared values persist
     * because the sheet is always-mounted; the parent just shrinks the
     * `files` prop, so the row goes away but its edit (if any) stays
     * cached in case the user re-adds the file later.
     */
    function removeBulkEditFile(path: string) {
        setBulkEditFiles((prev) => prev.filter((f) => f.path !== path));
    }
    const [extractedArtist, setExtractedArtist] = useState("");
    const [sourceMode, setSourceMode] = useState<SourceMode>("patreon");
    const [powerMode, setPowerMode] = useState<boolean>(() => loadPowerMode());
    // Surfaced when the cold-load dictionary fetch fails. Without it the
    // app would silently come up with an empty vocabulary and the user
    // would assume the whole thing is broken — the librarian-voice
    // banner says the backend isn't responding and offers a retry.
    const [dictLoadError, setDictLoadError] = useState<string | null>(null);
    // After a Patreon Apply the user can click "Rename and move <file>" to
    // jump straight to the FileBrowser Downloads tab with the downloaded
    // file pre-selected. Lifted state because PatreonPanel and FileBrowser
    // live in different columns and need to coordinate.
    const [bridgeRequest, setBridgeRequest] = useState<{ path: string; filename: string } | null>(
        null,
    );

    // Persist power mode so the toggle survives reloads.
    useEffect(() => {
        try {
            localStorage.setItem(POWER_MODE_KEY, String(powerMode));
        } catch {
            // non-fatal
        }
    }, [powerMode]);

    // ── Filename generation ───────────────────────────────────────────────────
    function generate() {
        const sfx = suffix.trim() || "F4A";
        // Brackets-in-filename, stripped-from-ID3 rule. Canonical in
        // `stripOuterBrackets`; the dashed filename output keeps them
        // verbatim, the piped tag-string for ID3 drops them.
        const pipeTitle = stripBrackets ? stripOuterBrackets(title) : title;
        setOutputDash([title, ...tags, sfx].map(sanitizeFilename).filter(Boolean).join(" - "));
        setOutputPipe([pipeTitle, ...tags, sfx].join(" | "));
    }

    // ── Dictionary load ───────────────────────────────────────────────────────
    //
    // No synchronous setState in the effect body — only in the async
    // .then / .catch callbacks. The retry button clears the banner
    // synchronously from its click handler (which is allowed) so the
    // visual disappears immediately on click; the .then will also clear
    // it when the retry succeeds. `react-hooks/set-state-in-effect`
    // would flag any synchronous set here.
    function fetchDictionary() {
        apiGet<DictionaryApiResponse>(API.dictionary)
            .then((data) => {
                setDict(dictFromApiResponse(data));
                setDictLoadError(null);
            })
            .catch((e) => {
                // Surface, don't swallow. An empty vocabulary with no
                // explanation reads as "the app is broken" to the
                // sleepy persona — librarian voice + a Retry button
                // beats a silent empty state every time.
                setDictLoadError("Couldn't reach the dictionary. " + getErrorMessage(e));
            });
    }
    useEffect(() => {
        fetchDictionary();
    }, []);

    function handleExtracted(newTitle: string, newTags: string[], artist: string) {
        setTitle(newTitle);
        setTags(newTags);
        setExtractedArtist(artist);
    }

    // Promote an unrecognised tag chip to the dictionary. Two flavours,
    // wired into TagChip's right-click menu:
    //
    //   - `promoteToCanonical(text)` creates a new vocabulary entry with
    //     `text` as the canonical and no aliases. Same wire as
    //     VocabularyPane's `handleAdd`.
    //   - `promoteToAlias(text, canonical)` appends `text` to an existing
    //     canonical's aliases via PATCH /api/vocabulary/{id}. Takes the
    //     full entry (not just the id) to avoid a stale-closure read of
    //     `dict.vocabulary` here in App.
    //
    // Both update local dict state on success so the chip's "not in your
    // dictionary yet" tint clears the next render without a round-trip.
    async function promoteToCanonical(text: string): Promise<void> {
        const row = await apiPost<VocabEntry>(API.vocabulary, {
            canonical: text,
            aliases: [],
        });
        setDict((prev) => ({
            ...prev,
            vocabulary: [...prev.vocabulary, row],
        }));
    }

    async function promoteToAlias(text: string, canonical: VocabEntry): Promise<void> {
        const row = await apiPatch<VocabEntry>(API.vocabEntry(canonical.id), {
            canonical: canonical.canonical,
            aliases: [...canonical.aliases, text],
        });
        setDict((prev) => ({
            ...prev,
            vocabulary: prev.vocabulary.map((x) => (x.id === row.id ? row : x)),
        }));
    }

    return (
        <div className="max-w-[160rem] 2xl:max-w-none mx-auto px-6 sm:px-8 lg:px-12 xl:px-16 2xl:px-20 py-8 lg:py-10">
            <Header
                dictTagCount={dict.vocabulary.length}
                onOpenLibrarySettings={() => {
                    // Mutually exclusive — having more than one right-side
                    // sheet open at once is undefined stacking and the
                    // Radix focus scopes fight each other.
                    setCookiesOpen(false);
                    setHelpOpen(false);
                    setBulkEditOpen(false);
                    setLibraryOpen(true);
                }}
                onOpenCookies={() => {
                    setLibraryOpen(false);
                    setHelpOpen(false);
                    setBulkEditOpen(false);
                    setCookiesOpen(true);
                }}
                onOpenHelp={() => {
                    setLibraryOpen(false);
                    setCookiesOpen(false);
                    setBulkEditOpen(false);
                    setHelpOpen(true);
                }}
                powerMode={powerMode}
                onPowerModeChange={setPowerMode}
            />

            {/* Cold-load dictionary error. Shows once if the initial
             *  /api/dictionary fetch fails; clears on successful retry.
             *  Quiet warning surface — destructive color is reserved
             *  for dangerous actions, not "thing didn't load." */}
            {dictLoadError && (
                <div className="mt-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground/90">
                    <span className="flex-1 leading-relaxed">
                        {dictLoadError} Tags won&apos;t match canonical forms until this resolves.
                    </span>
                    <button
                        type="button"
                        onClick={() => {
                            // Clear the banner immediately for feedback;
                            // .then will set it back to null on success
                            // and .catch will re-populate on failure.
                            setDictLoadError(null);
                            fetchDictionary();
                        }}
                        className="font-medium text-foreground hover:text-primary transition-colors underline-offset-4 hover:underline"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Top trio: 1-col mobile → 2-col lg → 3-col dashboard at xl+.
                Visual flow is Source → Edit → Output at every breakpoint.
                Base-level `order-*` utilities apply at every size so the
                empty Output column never lands between Source and Edit on
                mobile (1-col stack) or at lg (2-col).
                items-start lets the Source column grow vertically (results
                list) without dragging the other columns taller.
                The proportional 3:4:3 grid scales with the container at
                every breakpoint, including ultrawide — the container cap
                is removed at 2xl+ so the trio fills the available width
                rather than centering narrow with background on each side.
                FileBrowser sits in its own section below so its layout
                stays independent from the trio. */}
            <section className="mt-8 lg:mt-10 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[3fr_4fr_3fr] gap-6 lg:gap-10 2xl:gap-12 items-start">
                <div className="order-1 flex flex-col min-h-0">
                    <Tabs
                        value={sourceMode}
                        onValueChange={(v) => setSourceMode(v as SourceMode)}
                        className="flex flex-col gap-3 min-h-0"
                    >
                        <TabsList
                            variant="line"
                            className="h-auto p-0 gap-0 bg-transparent justify-start rounded-none border-b border-border w-full"
                        >
                            <TabsTrigger
                                value="patreon"
                                className="px-4 py-2.5 text-xs font-medium tracking-[0.04em] whitespace-nowrap rounded-none"
                            >
                                Patreon URL
                            </TabsTrigger>
                            <TabsTrigger
                                value="screenshot"
                                className="px-4 py-2.5 text-xs font-medium tracking-[0.04em] whitespace-nowrap rounded-none"
                            >
                                Screenshot
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent
                            value="patreon"
                            className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
                        >
                            <PatreonPanel
                                dict={dict}
                                onExtracted={handleExtracted}
                                powerMode={powerMode}
                                onOpenCookies={() => {
                                    setLibraryOpen(false);
                                    setHelpOpen(false);
                                    setBulkEditOpen(false);
                                    setCookiesOpen(true);
                                }}
                                onBridgeToDownloads={(path, filename) =>
                                    setBridgeRequest({ path, filename })
                                }
                            />
                        </TabsContent>

                        <TabsContent
                            value="screenshot"
                            className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
                        >
                            <ScreenshotPanel
                                dict={dict}
                                onExtracted={handleExtracted}
                                powerMode={powerMode}
                                isActive={sourceMode === "screenshot"}
                            />
                        </TabsContent>
                    </Tabs>
                </div>

                <div className="order-3 lg:col-span-2 xl:col-span-1 flex flex-col">
                    <OutputPanel
                        outputDash={outputDash}
                        outputPipe={outputPipe}
                        stripBrackets={stripBrackets}
                        onStripBracketsChange={setStripBrackets}
                    />
                </div>

                <div className="order-2 flex flex-col">
                    <TagsEditor
                        title={title}
                        onTitleChange={setTitle}
                        tags={tags}
                        onTagsChange={setTags}
                        suffix={suffix}
                        onSuffixChange={setSuffix}
                        artist={extractedArtist}
                        dict={dict}
                        onPromoteToCanonical={promoteToCanonical}
                        onPromoteToAlias={promoteToAlias}
                        onGenerate={generate}
                    />
                </div>
            </section>

            {/* FileBrowser lives outside the top grid so its layout is
                decoupled from the trio's column tracks. Both surfaces
                expand to the full container width on ultrawide, which
                is the right shape for a dense file list. */}
            <section className="mt-6 lg:mt-10">
                <FileBrowser
                    outputDash={outputDash}
                    outputPipe={outputPipe}
                    extractedArtist={extractedArtist}
                    defaultOpen={false}
                    bridgeRequest={bridgeRequest}
                    onBridgeConsumed={() => setBridgeRequest(null)}
                    onOpenBulkEdit={openBulkEdit}
                />
            </section>

            <Suspense fallback={null}>
                {libraryOpen && (
                    <LibrarySettingsSheet
                        open={libraryOpen}
                        onClose={() => setLibraryOpen(false)}
                        dict={dict}
                        onDictChange={setDict}
                    />
                )}
                {/* Always-mounted, no `key` reset. Per-file edits + shared
                    values + load-from-cache results all live inside the
                    sheet; keying on the selection would wipe them every
                    time the user adds / removes files. Keying on `open`
                    would wipe them on every close+reopen. Instead, edits
                    are path-keyed so the user can drop a file mid-batch
                    (X button on the row), pick up extras from the
                    FileBrowser, and come back without retyping. State
                    only resets on successful submit. */}
                <BulkEditSheet
                    open={bulkEditOpen}
                    onClose={() => setBulkEditOpen(false)}
                    files={bulkEditFiles}
                    root={bulkEditRoot}
                    dict={dict}
                    onRemoveFile={removeBulkEditFile}
                />
            </Suspense>
            <CookiesSheet open={cookiesOpen} onClose={() => setCookiesOpen(false)} />
            <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
    );
}
