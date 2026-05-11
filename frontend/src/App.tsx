import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";

import DictionaryModal from "@/components/DictionaryModal";
import FileBrowser from "@/components/FileBrowser";
import OutputPanel from "@/components/OutputPanel";
import PatreonPanel from "@/components/PatreonPanel";
import ScreenshotPanel from "@/components/ScreenshotPanel";
import StatusBar from "@/components/StatusBar";
import TagsEditor from "@/components/TagsEditor";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, API } from "@/lib/api";
import {
    dictFromApiResponse,
    emptyDict,
} from "@/lib/types";
import type { AppDict, DictionaryApiResponse } from "@/lib/types";
import { sanitizeFilename } from "@/lib/utils";

type SourceMode = "screenshot" | "patreon";

export default function App() {
    // Theme is applied by the inline <script> in index.html before React mounts,
    // and managed by <ThemeToggle /> thereafter. No bootstrap needed here.

    // ── Shared state ──────────────────────────────────────────────────────────
    const [title, setTitle] = useState("");
    const [tags, setTags] = useState<string[]>([]);
    const [suffix, setSuffix] = useState("F4A");
    const [dict, setDict] = useState<AppDict>(emptyDict());
    const [outputDash, setOutputDash] = useState("");
    const [outputPipe, setOutputPipe] = useState("");
    const [stripBrackets, setStripBrackets] = useState(true);
    const [dictOpen, setDictOpen] = useState(false);
    const [extractedArtist, setExtractedArtist] = useState("");
    const [sourceMode, setSourceMode] = useState<SourceMode>("screenshot");

    // ── Filename generation ───────────────────────────────────────────────────
    function generate() {
        const sfx = suffix.trim() || "F4A";
        const pipeTitle = stripBrackets
            ? title.replace(/^\s*\[[^\]]{1,50}\]\s*/g, "").trim()
            : title;
        setOutputDash(
            [title, ...tags, sfx]
                .map(sanitizeFilename)
                .filter(Boolean)
                .join(" - "),
        );
        setOutputPipe([pipeTitle, ...tags, sfx].join(" | "));
    }

    // ── Dictionary load ───────────────────────────────────────────────────────
    useEffect(() => {
        apiGet<DictionaryApiResponse>(API.dictionary).then((data) => {
            setDict(dictFromApiResponse(data));
        });
    }, []);

    function handleExtracted(
        newTitle: string,
        newTags: string[],
        artist: string,
    ) {
        setTitle(newTitle);
        setTags(newTags);
        setExtractedArtist(artist);
    }

    // ── Layout ────────────────────────────────────────────────────────────────
    // Stagger uses `[animation-delay:Nms] fill-mode-backwards` so each section
    // starts hidden, then fades + slides in 80 ms after its predecessor. One
    // orchestrated reveal on mount > scattered hover-tricks elsewhere.
    return (
        <div className="max-w-screen-2xl mx-auto px-6 sm:px-8 lg:px-12 xl:px-16 py-8 lg:py-10">
            {/* Header strip */}
            <header className="flex items-start justify-between gap-4 pb-6 mb-10 lg:mb-12 border-b border-border animate-in fade-in slide-in-from-bottom-2 duration-500 fill-mode-backwards">
                <div className="space-y-2">
                    <h1 className="text-3xl lg:text-4xl font-display font-semibold tracking-tight text-foreground">
                        ASMR Workbench
                    </h1>
                    <p className="text-sm text-muted-foreground max-w-prose">
                        Extract metadata from screenshots or Patreon, normalise
                        tags, rename with ID3, and convert audio — all on your
                        own machine.
                    </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDictOpen(true)}
                        title="Tag Dictionary"
                        className="gap-1.5"
                    >
                        <BookOpen size={14} />
                        <span className="hidden sm:inline">Dictionary</span>
                    </Button>
                    <ThemeToggle />
                </div>
            </header>

            {/* Source + output: grid with breathing room */}
            <section className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[5fr_4fr] gap-6 lg:gap-10 mb-10 lg:mb-12 animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:80ms] fill-mode-backwards">
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
                            value="screenshot"
                            className="px-4 py-2.5 text-xs font-display font-medium tracking-[0.04em] whitespace-nowrap rounded-none flex items-center gap-2"
                        >
                            <span className="size-1.5 rounded-full bg-primary shrink-0" />
                            Screenshot
                        </TabsTrigger>
                        <TabsTrigger
                            value="patreon"
                            className="px-4 py-2.5 text-xs font-display font-medium tracking-[0.04em] whitespace-nowrap rounded-none flex items-center gap-2"
                        >
                            <span className="size-1.5 rounded-full bg-primary shrink-0" />
                            Patreon URL
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent
                        value="screenshot"
                        className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
                    >
                        <ScreenshotPanel
                            dict={dict}
                            onExtracted={handleExtracted}
                        />
                    </TabsContent>

                    <TabsContent
                        value="patreon"
                        className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
                    >
                        <PatreonPanel
                            dict={dict}
                            onExtracted={handleExtracted}
                        />
                    </TabsContent>
                </Tabs>

                <OutputPanel
                    outputDash={outputDash}
                    outputPipe={outputPipe}
                    onRegenerate={generate}
                    stripBrackets={stripBrackets}
                    onStripBracketsChange={setStripBrackets}
                />
            </section>

            {/* TagsEditor — primary workflow */}
            <section className="mb-10 lg:mb-12 animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:160ms] fill-mode-backwards">
                <TagsEditor
                    title={title}
                    onTitleChange={setTitle}
                    tags={tags}
                    onTagsChange={setTags}
                    suffix={suffix}
                    onSuffixChange={setSuffix}
                    dict={dict}
                    onGenerate={generate}
                    onOpenDictionary={() => setDictOpen(true)}
                />
            </section>

            {/* FileBrowser — collapsible, server-side file listing */}
            <section className="animate-in fade-in slide-in-from-bottom-2 duration-500 [animation-delay:240ms] fill-mode-backwards">
                <FileBrowser
                    outputDash={outputDash}
                    outputPipe={outputPipe}
                    extractedArtist={extractedArtist}
                />
            </section>

            <DictionaryModal
                open={dictOpen}
                onClose={() => setDictOpen(false)}
                dict={dict}
                onDictChange={setDict}
            />

            <StatusBar dictTagCount={dict.vocabulary.length} />
        </div>
    );
}
