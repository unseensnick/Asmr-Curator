import { apiGet, API } from "@/lib/api";
import type { AppDict, DictionaryApiResponse } from "@/lib/types";
import { dictFromApiResponse, emptyDict } from "@/lib/types";
import { sanitizeFilename } from "@/lib/utils";
import { useEffect, useState } from "react";


import DictionaryModal from "@/components/DictionaryModal";
import FileBrowser from "@/components/FileBrowser";
import FilenameOutput from "@/components/FilenameOutput";
import OCRUploader from "@/components/OCRUploader";
import PatreonPanel from "@/components/PatreonPanel";
import TagsEditor from "@/components/TagsEditor";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type SourceMode = "screenshot" | "patreon";

export default function App() {
  // ── Theme ─────────────────────────────────────────────────────────────────
  // Temporarily force dark mode. Replace with a real toggle later.
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

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
    setOutputDash([title, ...tags, sfx].map(sanitizeFilename).filter(Boolean).join(" - "));
    setOutputPipe([pipeTitle, ...tags, sfx].join(" | "));
  }

  // ── Dictionary load ───────────────────────────────────────────────────────
  useEffect(() => {
    apiGet<DictionaryApiResponse>(API.dictionary).then((data) => {
      setDict(dictFromApiResponse(data));
    });
  }, []);

  // ── Layout ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-275 mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="inline-block text-[10px] tracking-[0.2em] uppercase text-primary border border-primary/30 px-2.5 py-0.5 rounded-sm mb-3">
          ASMR Toolkit
        </div>
        <h1 className="text-4xl font-bold tracking-tight bg-linear-to-br from-foreground via-primary to-primary/60 bg-clip-text text-transparent mb-2">
          Filename Generator
        </h1>
        <p className="text-sm text-muted-foreground">
          Paste a screenshot to extract, then review and generate
        </p>
      </header>

      {/* Top row — input source (screenshot OR patreon) + output cards */}
      <div className="flex gap-4 mb-4 min-h-85">
        <Tabs
          value={sourceMode}
          onValueChange={(v) => setSourceMode(v as SourceMode)}
          className="flex-1 flex flex-col gap-2 min-h-0"
        >
          <TabsList
            variant="line"
            className="h-auto p-0 gap-0 bg-transparent justify-start rounded-none border-b border-border w-full"
          >
            <TabsTrigger
              value="screenshot"
              className="px-3.5 py-2 text-[10px] font-bold tracking-[0.14em] uppercase whitespace-nowrap rounded-none flex items-center gap-1.5"
            >
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              Screenshot
            </TabsTrigger>
            <TabsTrigger
              value="patreon"
              className="px-3.5 py-2 text-[10px] font-bold tracking-[0.14em] uppercase whitespace-nowrap rounded-none flex items-center gap-1.5"
            >
              <span className="size-1.5 rounded-full bg-primary shrink-0" />
              Patreon URL
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="screenshot"
            className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
          >
            <OCRUploader
              dict={dict}
              onExtracted={(t, newTags, artist) => {
                setTitle(t);
                setTags(newTags);
                setExtractedArtist(artist);
              }}
            />
          </TabsContent>

          <TabsContent
            value="patreon"
            className="flex-1 mt-0 min-h-0 flex flex-col data-[state=inactive]:hidden"
          >
            <PatreonPanel
              dict={dict}
              onExtracted={(t, newTags, artist) => {
                setTitle(t);
                setTags(newTags);
                setExtractedArtist(artist);
              }}
            />
          </TabsContent>
        </Tabs>

        <FilenameOutput
          outputDash={outputDash}
          outputPipe={outputPipe}
          onRegenerate={generate}
          stripBrackets={stripBrackets}
          onStripBracketsChange={setStripBrackets}
        />
      </div>

      <div className="mb-4">
        <FileBrowser outputDash={outputDash} outputPipe={outputPipe} extractedArtist={extractedArtist} />
      </div>

      {/* TagsEditor */}
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

      <DictionaryModal
        open={dictOpen}
        onClose={() => setDictOpen(false)}
        dict={dict}
        onDictChange={setDict}
      />
    </div>
  );
}
