import { useRef, useState } from "react";
import {
    BookOpen,
    Download,
    FlaskConical,
    RotateCcw,
    ShieldOff,
    Upload,
    X,
} from "lucide-react";

import DictionaryTester from "@/components/dictionary/DictionaryTester";
import SuppressedPane from "@/components/dictionary/SuppressedPane";
import VocabularyPane from "@/components/dictionary/VocabularyPane";
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
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API, apiGet, apiPost, apiPut } from "@/lib/api";
import { buildDictDerived, dictFromApiResponse } from "@/lib/types";
import type { AppDict, DictionaryApiResponse } from "@/lib/types";

type DictTab = "vocabulary" | "suppressed" | "test";

interface LibrarySettingsSheetProps {
    open: boolean;
    onClose: () => void;
    dict: AppDict;
    onDictChange: (next: AppDict) => void;
}

interface NavTab {
    id: DictTab;
    label: string;
    icon: typeof BookOpen;
    count?: number;
}

/**
 * Library settings slide-over (right-side Sheet). Side-nav on md+
 * (settings-style), horizontal tab strip on mobile. Header + body
 * (nav + pane content) + footer (Export / Import / Reset). The three
 * panes (Vocabulary, Suppressed terms, Test extraction) live under
 * `components/dictionary/`.
 *
 * Was a centered Dialog before; lifted to a Sheet so users can keep
 * the main view visible while editing vocab — particularly useful for
 * the Test extraction tab, which lets users preview tag extraction
 * against the dictionary they're editing. The sm:max-w-2xl/lg:max-w-3xl
 * /xl:max-w-4xl ladder keeps the slide-over narrower than the
 * underlying view so context isn't completely obscured.
 *
 * Cookies used to be a fourth tab here; they moved to a dedicated
 * CookiesSheet opened from the Settings dropdown because auth state
 * has no conceptual reason to live next to tag editing.
 */
export default function LibrarySettingsSheet({
    open,
    onClose,
    dict,
    onDictChange,
}: LibrarySettingsSheetProps) {
    const [tab, setTab] = useState<DictTab>("vocabulary");
    // Quick-fill: jump to a tab and pre-populate its add input
    const [quickFill, setQuickFill] = useState<{
        tab: DictTab;
        value?: string;
    } | null>(null);
    const [resetOpen, setResetOpen] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);

    async function reloadDict() {
        const data = await apiGet<DictionaryApiResponse>(API.dictionary);
        onDictChange(dictFromApiResponse(data));
    }

    // Vocabulary reorder. Bulk-replaces via PUT /api/dictionary so the
    // backend re-inserts in the new order; ids are renumbered as a side
    // effect, so we reload to get fresh ids. Order matters: when two
    // entries share an alias (or partially share one), last-write-wins in
    // buildDictDerived, so the entry that appears LATER in the list wins
    // on alias lookup. Users reorder when a contested alias is mapping to
    // the wrong canonical.
    async function handleVocabReorder(
        newOrder: AppDict["vocabulary"],
    ): Promise<void> {
        await apiPut(API.dictionary, {
            vocabulary: newOrder.map(({ canonical, aliases }) => ({
                canonical,
                aliases,
            })),
            suppressed: dict.suppressed.map(({ term }) => ({ term })),
        });
        await reloadDict();
    }

    async function handleExport() {
        const data = await apiGet<DictionaryApiResponse>(API.dictionary);
        const blob = new Blob(
            [
                JSON.stringify(
                    {
                        vocabulary: data.vocabulary,
                        suppressed: data.suppressed,
                    },
                    null,
                    2,
                ),
            ],
            { type: "application/json" },
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "asmr-tag-dictionary.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    }

    const importRef = useRef<HTMLInputElement>(null);
    async function handleImportFile(file: File) {
        try {
            const text = await file.text();
            const imported = JSON.parse(text);
            if (
                !Array.isArray(imported.vocabulary) ||
                !Array.isArray(imported.suppressed)
            )
                throw new Error("Missing 'vocabulary' or 'suppressed' arrays");
            await apiPut(API.dictionary, imported);
            await reloadDict();
        } catch (err) {
            setImportError(
                err instanceof Error ? err.message : String(err),
            );
        }
    }

    async function performReset() {
        setResetOpen(false);
        await apiPost(API.dictionaryReset, {});
        await reloadDict();
    }

    function handleQuickFix(action: "vocab" | "suppress", token: string) {
        if (action === "suppress") {
            setQuickFill({ tab: "suppressed", value: token });
            setTab("suppressed");
        } else {
            setQuickFill({ tab: "vocabulary", value: token });
            setTab("vocabulary");
        }
    }

    const tabs: NavTab[] = [
        {
            id: "vocabulary",
            label: "Vocabulary",
            icon: BookOpen,
            count: dict.vocabulary.length,
        },
        {
            id: "suppressed",
            label: "Suppressed terms",
            icon: ShieldOff,
            count: dict.suppressed.length,
        },
        { id: "test", label: "Test extraction", icon: FlaskConical },
    ];

    return (
        <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
            <SheetContent
                className="w-full sm:max-w-2xl lg:max-w-3xl xl:max-w-4xl overflow-hidden"
                showCloseButton={false}
            >
                <SheetTitle className="sr-only">Dictionary</SheetTitle>
                <SheetDescription className="sr-only">
                    Manage canonical tags, suppressed terms, and test
                    extraction against the dictionary.
                </SheetDescription>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-sm font-medium tracking-wide text-foreground">
                        Dictionary
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {dict.vocabulary.length.toLocaleString()} tag
                        {dict.vocabulary.length === 1 ? "" : "s"}
                    </span>
                    {dict.suppressed.length > 0 && (
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            · {dict.suppressed.length.toLocaleString()} suppressed
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors p-1 -m-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                        aria-label="Close dictionary"
                        title="Close"
                    >
                        <X size={18} aria-hidden />
                    </button>
                </div>

                {/* Body: nav + pane */}
                <Tabs
                    value={tab}
                    onValueChange={(v) => setTab(v as DictTab)}
                    orientation="vertical"
                    className="flex flex-1 min-h-0 flex-col md:flex-row"
                >
                    <TabsList
                        className={
                            "shrink-0 h-auto p-0 bg-transparent rounded-none gap-0 " +
                            "flex flex-row overflow-x-auto border-b border-border px-2 " +
                            "md:flex-col md:items-stretch md:overflow-x-visible md:overflow-y-auto " +
                            "md:w-52 md:border-b-0 md:border-r md:p-3 md:gap-1"
                        }
                    >
                        {tabs.map((t) => (
                            <TabsTrigger
                                key={t.id}
                                value={t.id}
                                className={
                                    "shrink-0 flex items-center gap-2 whitespace-nowrap " +
                                    "px-3 py-2.5 text-sm font-medium tracking-wide rounded-md border border-transparent " +
                                    "text-muted-foreground hover:text-foreground hover:bg-muted/60 " +
                                    "data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:border-accent " +
                                    "md:w-full md:justify-start transition-colors"
                                }
                            >
                                <t.icon size={14} aria-hidden />
                                <span>{t.label}</span>
                                {typeof t.count === "number" && (
                                    <span className="font-mono text-xs tabular-nums text-muted-foreground/80 md:ml-auto">
                                        {t.count.toLocaleString()}
                                    </span>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    <div className="flex-1 min-h-0 flex flex-col">
                        <TabsContent
                            value="vocabulary"
                            className="flex-1 min-h-0 mt-0 flex flex-col data-[state=inactive]:hidden"
                        >
                            <VocabularyPane
                                vocabulary={dict.vocabulary}
                                quickFill={
                                    quickFill?.tab === "vocabulary"
                                        ? quickFill.value
                                        : undefined
                                }
                                onQuickFillConsumed={() => setQuickFill(null)}
                                onChange={(vocabulary) => {
                                    onDictChange({
                                        ...dict,
                                        vocabulary,
                                        ...buildDictDerived(
                                            vocabulary,
                                            dict.suppressed,
                                        ),
                                    });
                                }}
                                onReorder={handleVocabReorder}
                            />
                        </TabsContent>
                        <TabsContent
                            value="suppressed"
                            className="flex-1 min-h-0 mt-0 flex flex-col data-[state=inactive]:hidden"
                        >
                            <SuppressedPane
                                suppressed={dict.suppressed}
                                quickFill={
                                    quickFill?.tab === "suppressed"
                                        ? quickFill.value
                                        : undefined
                                }
                                onQuickFillConsumed={() => setQuickFill(null)}
                                onChange={(suppressed) => {
                                    onDictChange({
                                        ...dict,
                                        suppressed,
                                        ...buildDictDerived(
                                            dict.vocabulary,
                                            suppressed,
                                        ),
                                    });
                                }}
                            />
                        </TabsContent>
                        <TabsContent
                            value="test"
                            className="flex-1 min-h-0 mt-0 flex flex-col data-[state=inactive]:hidden"
                        >
                            <DictionaryTester
                                dict={dict}
                                onQuickFix={handleQuickFix}
                            />
                        </TabsContent>
                    </div>
                </Tabs>

                {/* Footer */}
                <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        className="gap-1.5"
                    >
                        <Download size={14} aria-hidden />
                        Export
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => importRef.current?.click()}
                        className="gap-1.5"
                    >
                        <Upload size={14} aria-hidden />
                        Import
                    </Button>
                    <input
                        ref={importRef}
                        type="file"
                        accept=".json"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleImportFile(f);
                            e.target.value = "";
                        }}
                    />
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setResetOpen(true)}
                        className="gap-1.5 ml-auto border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                        <RotateCcw size={14} aria-hidden />
                        Reset to defaults
                    </Button>
                </div>
            </SheetContent>

            <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Reset dictionary to built-in defaults?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            All custom entries (vocabulary and suppressed terms)
                            will be lost. This can&apos;t be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={performReset}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Reset
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={importError !== null}
                onOpenChange={(o) => !o && setImportError(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Import failed</AlertDialogTitle>
                        <AlertDialogDescription>
                            {importError}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction
                            onClick={() => setImportError(null)}
                        >
                            OK
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    );
}
