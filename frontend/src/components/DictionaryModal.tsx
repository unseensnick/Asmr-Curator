import { useRef, useState } from "react";
import {
    BookOpen,
    Cookie,
    Download,
    FlaskConical,
    RotateCcw,
    ShieldOff,
    Upload,
    X,
} from "lucide-react";
import CookiePane from "@/components/dictionary/CookiePane";
import DictionaryTester from "@/components/dictionary/DictionaryTester";
import SuppressedPane from "@/components/dictionary/SuppressedPane";
import VocabularyPane from "@/components/dictionary/VocabularyPane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, apiPost, apiPut, API } from "@/lib/api";
import { buildDictDerived, dictFromApiResponse } from "@/lib/types";
import type { AppDict, DictionaryApiResponse } from "@/lib/types";

type DictTab = "vocabulary" | "suppressed" | "test" | "cookie";

interface DictionaryModalProps {
    open: boolean;
    onClose: () => void;
    dict: AppDict;
    onDictChange: (next: AppDict) => void;
}

/**
 * Shell for the 4-tab Tag Dictionary modal: header, tab strip, the
 * currently-active pane, and the export/import/reset footer.
 *
 * Each tab body lives in its own file under `components/dictionary/`:
 *   - VocabularyPane    — canonical tags + aliases CRUD
 *   - SuppressedPane    — terms dropped from output
 *   - DictionaryTester  — paste text, see how tags get normalised
 *   - CookiePane        — Patreon session cookie management
 */
export default function DictionaryModal({
    open,
    onClose,
    dict,
    onDictChange,
}: DictionaryModalProps) {
    const [tab, setTab] = useState<DictTab>("vocabulary");
    // Quick-fill: navigate to a tab and pre-populate its add input
    const [quickFill, setQuickFill] = useState<{
        tab: DictTab;
        value?: string;
    } | null>(null);

    async function reloadDict() {
        const data = await apiGet<DictionaryApiResponse>(API.dictionary);
        onDictChange(dictFromApiResponse(data));
    }

    // ── Export ────────────────────────────────────────────────────────────────
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

    // ── Import ────────────────────────────────────────────────────────────────
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
            alert(
                "Import failed: " +
                    (err instanceof Error ? err.message : String(err)),
            );
        }
    }

    // ── Reset ─────────────────────────────────────────────────────────────────
    async function handleReset() {
        if (
            !confirm(
                "Reset dictionary to built-in defaults? All custom entries will be lost.",
            )
        )
            return;
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

    const tabs: { id: DictTab; label: string; count?: number }[] = [
        {
            id: "vocabulary",
            label: "Vocabulary",
            count: dict.vocabulary.length,
        },
        {
            id: "suppressed",
            label: "Suppressed Terms",
            count: dict.suppressed.length,
        },
        { id: "test", label: "Test" },
        { id: "cookie", label: "Patreon Cookie" },
    ];

    return (
        <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
            <DialogContent
                className="w-full max-w-225 sm:max-w-225 h-[88vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden"
                showCloseButton={false}
            >
                {/* Screen-reader-only title + description for radix a11y.
                    The visible header below carries its own styling, so the
                    DialogTitle/Description are hidden via sr-only. */}
                <DialogTitle className="sr-only">Tag Dictionary</DialogTitle>
                <DialogDescription className="sr-only">
                    Manage canonical tags, suppressed terms, test the
                    dictionary, and configure the Patreon session cookie.
                </DialogDescription>

                {/* Header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
                    <span className="text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                        Tag Dictionary
                    </span>
                    <div className="flex gap-1.5 ml-1">
                        <Badge
                            variant="outline"
                            className="text-[10px] border-primary/30 text-primary"
                        >
                            {dict.vocabulary.length} tags
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                            {dict.suppressed.length} suppressed
                        </Badge>
                    </div>
                    <button
                        className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
                        onClick={onClose}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Tab bar */}
                <Tabs value={tab} onValueChange={(v) => setTab(v as DictTab)}>
                    <TabsList
                        variant="line"
                        className="border-b border-border px-4 w-full rounded-none justify-start h-auto gap-0 bg-transparent overflow-x-auto shrink-0"
                    >
                        {tabs.map((t) => (
                            <TabsTrigger
                                key={t.id}
                                value={t.id}
                                className="flex items-center gap-1.5 px-3.5 py-3 text-[11px] tracking-[0.06em] whitespace-nowrap rounded-none"
                            >
                                {t.id === "vocabulary" && <BookOpen size={12} />}
                                {t.id === "suppressed" && <ShieldOff size={12} />}
                                {t.id === "test" && <FlaskConical size={12} />}
                                {t.id === "cookie" && <Cookie size={12} />}
                                {t.label}
                                {t.count !== undefined && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground tabular-nums">
                                        {t.count}
                                    </span>
                                )}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </Tabs>

                {/* Pane body */}
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {tab === "vocabulary" && (
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
                        />
                    )}
                    {tab === "suppressed" && (
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
                    )}
                    {tab === "test" && (
                        <DictionaryTester
                            dict={dict}
                            onQuickFix={handleQuickFix}
                        />
                    )}
                    {tab === "cookie" && (
                        <CookiePane open={open && tab === "cookie"} />
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center gap-2 px-5 py-3 border-t border-border shrink-0 flex-wrap">
                    <span className="text-[10px] text-muted-foreground tracking-[0.08em] mr-1">
                        Dictionary
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleExport}
                        className="text-[11px] gap-1.5"
                    >
                        <Download size={13} />
                        Export JSON
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => importRef.current?.click()}
                        className="text-[11px] gap-1.5"
                    >
                        <Upload size={13} />
                        Import JSON
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
                        onClick={handleReset}
                        className="text-[11px] gap-1.5 ml-auto text-destructive/70 hover:text-destructive hover:border-destructive/50"
                    >
                        <RotateCcw size={13} />
                        Reset defaults
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
