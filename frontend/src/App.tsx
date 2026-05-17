import { useEffect, useState } from "react";

import CookiesModal from "@/components/CookiesModal";
import FileBrowser from "@/components/FileBrowser";
import Header from "@/components/Header";
import LibraryConfigModal from "@/components/LibraryConfigModal";
import OutputPanel from "@/components/OutputPanel";
import PatreonPanel from "@/components/PatreonPanel";
import ScreenshotPanel from "@/components/ScreenshotPanel";
import TagsEditor from "@/components/TagsEditor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, API } from "@/lib/api";
import {
    dictFromApiResponse,
    emptyDict,
} from "@/lib/types";
import type { AppDict, DictionaryApiResponse } from "@/lib/types";
import { sanitizeFilename } from "@/lib/utils";

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
    const [extractedArtist, setExtractedArtist] = useState("");
    const [sourceMode, setSourceMode] = useState<SourceMode>("patreon");
    const [powerMode, setPowerMode] = useState<boolean>(() => loadPowerMode());

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
        // Strip any number of leading and trailing [bracket] markers (and the
        // whitespace around them) regardless of contents. Mid-title brackets
        // are left alone — they're usually part of the actual title.
        const pipeTitle = stripBrackets
            ? title
                .replace(/^(?:\s*\[[^\]]*\]\s*)+/, "")
                .replace(/(?:\s*\[[^\]]*\]\s*)+$/, "")
                .trim()
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


    return (
        <div className="max-w-[160rem] mx-auto px-6 sm:px-8 lg:px-12 xl:px-16 py-8 lg:py-10">
            <Header
                dictTagCount={dict.vocabulary.length}
                onOpenLibrarySettings={() => setLibraryOpen(true)}
                onOpenCookies={() => setCookiesOpen(true)}
                powerMode={powerMode}
                onPowerModeChange={setPowerMode}
            />

            {/* Page grid: 1-col mobile → 2-col lg → 3-col dashboard at xl+.
                Source order is Source → Output → Tags → Library so the lg
                tier puts Source and Output side-by-side without overrides.
                At xl the order utilities reshuffle Tags into the middle
                slot. items-start lets the Source column grow vertically
                (results list) without dragging the other columns taller. */}
            <section className="mt-8 lg:mt-10 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-[3fr_4fr_3fr] gap-6 lg:gap-10 items-start">
                <div className="flex flex-col min-h-0">
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
                                onOpenCookies={() => setCookiesOpen(true)}
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

                <div className="xl:order-3 flex flex-col">
                    <OutputPanel
                        outputDash={outputDash}
                        outputPipe={outputPipe}
                        stripBrackets={stripBrackets}
                        onStripBracketsChange={setStripBrackets}
                    />
                </div>

                <div className="lg:col-span-2 xl:col-span-1 xl:order-2 flex flex-col">
                    <TagsEditor
                        title={title}
                        onTitleChange={setTitle}
                        tags={tags}
                        onTagsChange={setTags}
                        suffix={suffix}
                        onSuffixChange={setSuffix}
                        artist={extractedArtist}
                        dict={dict}
                        onGenerate={generate}
                    />
                </div>

                <div className="lg:col-span-2 xl:col-span-3 xl:order-4">
                    <FileBrowser
                        outputDash={outputDash}
                        outputPipe={outputPipe}
                        extractedArtist={extractedArtist}
                        defaultOpen={false}
                    />
                </div>
            </section>

            <LibraryConfigModal
                open={libraryOpen}
                onClose={() => setLibraryOpen(false)}
                dict={dict}
                onDictChange={setDict}
            />
            <CookiesModal
                open={cookiesOpen}
                onClose={() => setCookiesOpen(false)}
            />
        </div>
    );
}
