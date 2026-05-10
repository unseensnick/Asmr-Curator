import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiGet, apiPost, API } from "@/lib/api";
import { FORMAT_EXT, METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";
import type { ConvertFormat, ConvertQuality, FileEntry, RenameSep, SearchMode } from "@/lib/types";
import { sanitizeFilename, getErrorMessage } from "@/lib/utils";
import ConversionPanel from "@/components/ConversionPanel";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  File,
  ListChecks,
  Music2,
  PenLine,
  RefreshCw,
  Repeat,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface FileBrowserProps {
  outputDash: string;
  outputPipe: string;
  extractedArtist: string;
}

interface SearchResponse {
  files: FileEntry[];
}

interface RenameResponse {
  path: string;
  new_name: string;
}

interface ConvertResponse {
  path: string;
  new_name: string;
}

const MAX_BYTES = 255;

function getExt(name: string): string {
  const m = name.match(/(\.[^.]+)$/);
  return m ? m[1] : "";
}


function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

function FileIcon({ ext }: { ext: string }) {
  if (NEEDS_CONVERSION_EXTS.has(ext))
    return <AlertTriangle size={18} className="text-amber-400 shrink-0" />;
  if (METADATA_COMPATIBLE_EXTS.has(ext))
    return <Music2 size={18} className="text-green-400 shrink-0" />;
  return <File size={18} className="text-muted-foreground shrink-0" />;
}

export default function FileBrowser({ outputDash, outputPipe, extractedArtist }: FileBrowserProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [searchMode, setSearchMode] = useState<SearchMode>("filename");
  const [selected, setSelected] = useState<FileEntry | null>(null);
  const [renameSep, setRenameSep] = useState<RenameSep>("dash");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renamed, setRenamedState] = useState(false);

  // Metadata fields — pre-populated from outputPipe, individually editable
  const [metaTitle, setMetaTitle] = useState("");
  const [metaArtist, setMetaArtist] = useState("");
  const [metaAlbum, setMetaAlbum] = useState("");
  const [metaAlbumArtist, setMetaAlbumArtist] = useState("");
  const [linkArtists, setLinkArtists] = useState(
    () => localStorage.getItem("linkArtists") !== "false",
  );

  // Conversion state — format/quality persist across sessions via localStorage
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>(() => {
    const stored = localStorage.getItem("convertFormat") as ConvertFormat;
    return stored && stored in FORMAT_EXT ? stored : "mp3";
  });
  const [convertQuality, setConvertQuality] = useState<ConvertQuality>(
    () => (localStorage.getItem("convertQuality") as ConvertQuality) || "high",
  );
  const [deleteOriginal, setDeleteOriginal] = useState(false);
  const [converting, setConverting] = useState(false);
  const [converted, setConverted] = useState(false);
  const [showOptionalConvert, setShowOptionalConvert] = useState(false);

  // Batch convert state
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentFile: string;
    results: Array<{ name: string; ok: boolean; error?: string }>;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const extractedArtistRef = useRef(extractedArtist);
  useEffect(() => { extractedArtistRef.current = extractedArtist; }, [extractedArtist]);

  // Sync title from the pipe-format output; artist/album fields are user-filled
  useEffect(() => {
    setMetaTitle(outputPipe);
  }, [outputPipe]);

  // Pre-populate artist from OCR extraction when a file is selected
  useEffect(() => {
    if (extractedArtistRef.current) setMetaArtist(extractedArtistRef.current);
  }, [selected?.path]);

  // Persist preferences
  useEffect(() => {
    localStorage.setItem("convertFormat", convertFormat);
  }, [convertFormat]);
  useEffect(() => {
    localStorage.setItem("convertQuality", convertQuality);
  }, [convertQuality]);
  useEffect(() => {
    localStorage.setItem("linkArtists", String(linkArtists));
  }, [linkArtists]);

  // ── Load files ────────────────────────────────────────────────────────────

  async function loadFiles(q: string, mode: SearchMode) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("search_in", mode);
      const data = await apiGet<SearchResponse>(`${API.search}?${params.toString()}`);
      setFiles(data.files);
    } catch (e) {
      setError("Could not load files: " + getErrorMessage(e) + " — check AUDIO_ROOT in devcontainer.json");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles("", "filename");
  }, []);

  function handleQueryChange(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadFiles(val, searchMode), 300);
  }

  function handleModeChange(mode: SearchMode) {
    setSearchMode(mode);
    loadFiles(query, mode);
  }

  // ── Rename preview ────────────────────────────────────────────────────────

  function getNewName(): string | null {
    const text = renameSep === "dash" ? outputDash : outputPipe;
    if (!text || !selected) return null;
    return sanitizeFilename(text) + getExt(selected.name);
  }

  const newName = getNewName();
  const bytes = newName ? byteLength(newName) : 0;
  const bytesOver = bytes > MAX_BYTES;
  const bytesWarn = bytes > 200 && !bytesOver;

  // ── Derived state ─────────────────────────────────────────────────────────

  // Always check extension directly — never trust server flag alone
  const needsConversion = !!selected && (
    !!selected.needs_conversion || NEEDS_CONVERSION_EXTS.has(selected.ext)
  );

  // For optional conversion on compatible files, exclude the current format
  const optionalConvertFormats = (["mp3", "flac", "ogg"] as ConvertFormat[]).filter(
    (fmt) => !selected || FORMAT_EXT[fmt] !== selected.ext,
  );

  // Ensure convertFormat is valid when showing optional conversion
  const safeConvertFormat =
    !needsConversion && FORMAT_EXT[convertFormat] === selected?.ext
      ? optionalConvertFormats[0] ?? "mp3"
      : convertFormat;

  // ── Rename action ─────────────────────────────────────────────────────────

  async function handleRename() {
    if (!newName || !selected || bytesOver || needsConversion) return;
    setRenaming(true);
    setError("");
    try {
      const data = await apiPost<RenameResponse>(API.rename, {
        path: selected.path,
        new_name: newName,
        metadata: {
          title: metaTitle,
          artist: metaArtist,
          album: metaAlbum,
          album_artist: linkArtists ? metaArtist : metaAlbumArtist,
        },
      });
      setSelected({ ...selected, path: data.path, name: data.new_name });
      setRenamedState(true);
      setTimeout(() => setRenamedState(false), 2500);
      await loadFiles(query, searchMode);
    } catch (e) {
      setError("Rename failed: " + getErrorMessage(e));
    } finally {
      setRenaming(false);
    }
  }

  // ── Convert action ────────────────────────────────────────────────────────

  async function handleConvert() {
    if (!selected) return;
    setConverting(true);
    setError("");
    try {
      const quality = convertFormat === "flac" ? "lossless" : convertQuality;
      const data = await apiPost<ConvertResponse>(API.convert, {
        path: selected.path,
        output_format: convertFormat,
        quality,
        delete_original: deleteOriginal,
      });
      const newExt = FORMAT_EXT[convertFormat];
      setSelected({
        ...selected,
        name: data.new_name,
        ext: newExt,
        path: data.path,
        needs_conversion: false,
      });
      setConverted(true);
      setShowOptionalConvert(false);
      setTimeout(() => setConverted(false), 2500);
      await loadFiles(query, searchMode);
    } catch (e) {
      setError("Conversion failed: " + getErrorMessage(e));
    } finally {
      setConverting(false);
    }
  }

  // ── Batch convert ─────────────────────────────────────────────────────────

  function selectAllConvertible() {
    const paths = files
      .filter((f) => NEEDS_CONVERSION_EXTS.has(f.ext) || !!f.needs_conversion)
      .map((f) => f.path);
    setBatchSelected(new Set(paths));
  }

  async function handleBatchConvert() {
    const filesToConvert = files.filter((f) => batchSelected.has(f.path));
    if (!filesToConvert.length) return;
    const quality = convertFormat === "flac" ? "lossless" : convertQuality;
    const results: Array<{ name: string; ok: boolean; error?: string }> = [];
    setBatchProgress({ current: 0, total: filesToConvert.length, currentFile: "", results: [] });
    for (let i = 0; i < filesToConvert.length; i++) {
      const file = filesToConvert[i];
      setBatchProgress({ current: i + 1, total: filesToConvert.length, currentFile: file.name, results: [...results] });
      try {
        await apiPost<ConvertResponse>("/api/convert", {
          path: file.path,
          output_format: convertFormat,
          quality,
          delete_original: deleteOriginal,
        });
        results.push({ name: file.name, ok: true });
      } catch (e) {
        results.push({ name: file.name, ok: false, error: getErrorMessage(e) });
      }
    }
    setBatchProgress({ current: filesToConvert.length, total: filesToConvert.length, currentFile: "", results: [...results] });
    setBatchSelected(new Set());
    await loadFiles(query, searchMode);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Card className="rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
      {/* Card title */}
      <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-4">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
        File to Rename
        <span className="opacity-45 text-[9px] tracking-[0.08em]">
          — server-side · any browser
        </span>
      </div>

      {/* Error banner */}
      {error && (
        <Alert variant="destructive" className="mb-3 py-2 text-[11px]">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Search row */}
      <div className="flex gap-2 items-center mb-3">
        <Input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search… (leave empty to show all)"
          className="flex-1 min-w-0"
        />

        <ToggleGroup
          type="single"
          value={searchMode}
          onValueChange={(v) => v && handleModeChange(v as SearchMode)}
          className="shrink-0 border border-input rounded-3xl overflow-hidden gap-0"
        >
          {(["filename", "folder", "both"] as SearchMode[]).map((mode) => (
            <ToggleGroupItem
              key={mode}
              value={mode}
              title={
                mode === "filename"
                  ? "Search filenames"
                  : mode === "folder"
                    ? "Search folder names"
                    : "Search both"
              }
              className="text-[10px] tracking-[0.06em] px-2.5 py-1.5 h-auto rounded-none! border-r border-input last:border-r-0 bg-secondary text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
            >
              {mode === "filename" ? "file" : mode}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {!loading && files.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
            {files.length} file{files.length !== 1 ? "s" : ""}
          </span>
        )}

        <Button
          size="sm"
          variant={batchMode ? "default" : "ghost"}
          onClick={() => { setBatchMode((v) => !v); setBatchSelected(new Set()); setBatchProgress(null); }}
          className="shrink-0 px-2.5"
          title="Batch convert mode"
        >
          <ListChecks size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => loadFiles(query, searchMode)}
          className="shrink-0 px-2.5"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </Button>
      </div>

      {/* File list */}
      <div className="bg-secondary border border-input rounded-md overflow-y-auto max-h-50">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <span className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
            Scanning all folders…
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            No matching files
          </div>
        ) : (
          files.map((file) => {
            const isSelected = selected?.path === file.path;
            const isBatchSelected = batchSelected.has(file.path);
            const fileNeedsConversion =
              !!file.needs_conversion || NEEDS_CONVERSION_EXTS.has(file.ext);
            return (
              <div
                key={file.path}
                onClick={() => {
                  if (batchMode) {
                    setBatchSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(file.path)) next.delete(file.path);
                      else next.add(file.path);
                      return next;
                    });
                  } else {
                    setSelected(isSelected ? null : file);
                  }
                }}
                className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer border-b border-border last:border-b-0 transition-colors ${
                  batchMode
                    ? isBatchSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-card"
                    : isSelected ? "bg-primary/10 border-l-2 border-l-primary" : "hover:bg-card"
                }`}
              >
                {batchMode && (
                  <Checkbox
                    checked={isBatchSelected}
                    onCheckedChange={() => {
                      setBatchSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0"
                  />
                )}
                <FileIcon ext={file.ext} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-foreground truncate">{file.name}</div>
                  {file.folder && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {file.folder}
                    </div>
                  )}
                </div>
                {fileNeedsConversion && (
                  <span className="text-[9px] text-amber-400 border border-amber-400/40 rounded px-1.5 py-0.5 shrink-0">
                    convert
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Batch convert panel */}
      {batchMode && (
        <div className="mt-3 border border-border rounded-lg p-3 bg-secondary/50">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-foreground">
              {batchSelected.size} file{batchSelected.size !== 1 ? "s" : ""} selected
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={selectAllConvertible}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Select convertible
              </button>
              {batchSelected.size > 0 && (
                <button
                  onClick={() => setBatchSelected(new Set())}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <ConversionPanel
            formats={["mp3", "flac", "ogg"]}
            format={convertFormat}
            quality={convertQuality}
            deleteOriginal={deleteOriginal}
            onFormatChange={setConvertFormat}
            onQualityChange={setConvertQuality}
            onDeleteChange={setDeleteOriginal}
            checkboxId="delete-original-batch"
          />

          {/* Progress / results */}
          {batchProgress && (
            <div className="mb-3">
              {batchProgress.currentFile ? (
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="w-3 h-3 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin shrink-0" />
                  {batchProgress.current}/{batchProgress.total} — {batchProgress.currentFile}
                </div>
              ) : (
                <div className="text-[10px] text-green-400">
                  Done — {batchProgress.results.filter((r) => r.ok).length} converted
                  {batchProgress.results.filter((r) => !r.ok).length > 0 &&
                    `, ${batchProgress.results.filter((r) => !r.ok).length} failed`}
                </div>
              )}
              {batchProgress.results.filter((r) => !r.ok).map((r, i) => (
                <div key={i} className="text-[10px] text-destructive mt-1 truncate">
                  ✗ {r.name}: {r.error}
                </div>
              ))}
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={batchSelected.size === 0 || (batchProgress !== null && !!batchProgress.currentFile)}
            onClick={handleBatchConvert}
          >
            <Repeat size={16} />
            Convert {batchSelected.size} file{batchSelected.size !== 1 ? "s" : ""}
          </Button>

          {batchProgress && !batchProgress.currentFile && (
            <button
              onClick={() => setBatchProgress(null)}
              className="w-full mt-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors text-center"
            >
              Clear results
            </button>
          )}
        </div>
      )}

      {/* Selected file panel */}
      {selected && (
        <div className="mt-3 border border-border rounded-lg p-3 bg-secondary/50">
          {/* Selected file info */}
          <div className="flex items-center gap-2.5 mb-3">
            <FileIcon ext={selected.ext} />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-foreground font-medium truncate">
                {selected.name}
              </div>
              {selected.folder && (
                <div className="text-[10px] text-muted-foreground truncate">
                  {selected.folder}/{selected.name}
                </div>
              )}
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              title="Deselect"
            >
              <X size={14} />
            </button>
          </div>

          {needsConversion ? (
            /* ── Required conversion panel ────────────────────────────────── */
            <>
              <div className="flex items-center gap-1.5 text-[11px] text-amber-400 mb-3 bg-amber-400/10 border border-amber-400/25 rounded px-2.5 py-2">
                <AlertTriangle size={13} className="shrink-0" />
                This format must be converted before it can be renamed
              </div>

              <ConversionPanel
                formats={["mp3", "flac", "ogg"]}
                format={convertFormat}
                quality={convertQuality}
                deleteOriginal={deleteOriginal}
                onFormatChange={setConvertFormat}
                onQualityChange={setConvertQuality}
                onDeleteChange={setDeleteOriginal}
                checkboxId="delete-original-required"
              />
              <Button
                className={`w-full gap-2 ${converted
                    ? "bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/20"
                    : ""
                  }`}
                disabled={converting}
                onClick={handleConvert}
              >
                {converting ? (
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : converted ? (
                  <Check size={16} />
                ) : (
                  <Repeat size={16} />
                )}
                {converting ? "Converting…" : converted ? "Converted!" : "Convert File"}
              </Button>
            </>
          ) : (
            /* ── Rename panel ─────────────────────────────────────────────── */
            <>
              {/* Separator choice */}
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-[10px] text-muted-foreground tracking-[0.06em]">
                  Use separator:
                </span>
                <ToggleGroup
                  type="single"
                  value={renameSep}
                  onValueChange={(v) => v && setRenameSep(v as RenameSep)}
                  className="border border-input rounded-3xl overflow-hidden gap-0"
                >
                  {(["dash", "pipe"] as RenameSep[]).map((sep) => (
                    <ToggleGroupItem
                      key={sep}
                      value={sep}
                      className="text-[10px] tracking-[0.06em] px-2.5 py-1 h-auto rounded-none! border-r border-input last:border-r-0 bg-card text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
                    >
                      {sep === "dash" ? "— dash" : "| pipe"}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Metadata fields */}
              <div className="grid grid-cols-[5rem_1fr] gap-x-2.5 gap-y-1.5 mb-2.5 items-center">
                <span className="text-[10px] text-muted-foreground">Title</span>
                <Input
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder="Track title"
                  className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Artist</span>
                <Input
                  value={metaArtist}
                  onChange={(e) => setMetaArtist(e.target.value)}
                  placeholder="Artist name"
                  className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Album</span>
                <Input
                  value={metaAlbum}
                  onChange={(e) => setMetaAlbum(e.target.value)}
                  placeholder="Album name"
                  className="h-6 text-[11px] px-2"
                />
                <span className="text-[10px] text-muted-foreground">Album Artist</span>
                <Input
                  value={linkArtists ? metaArtist : metaAlbumArtist}
                  onChange={(e) => setMetaAlbumArtist(e.target.value)}
                  placeholder="Album artist"
                  disabled={linkArtists}
                  className="h-6 text-[11px] px-2 disabled:opacity-40"
                />
                <div className="col-span-2 flex items-center gap-2">
                  <Checkbox
                    id="link-artists"
                    checked={linkArtists}
                    onCheckedChange={(v) => setLinkArtists(v === true)}
                  />
                  <label
                    htmlFor="link-artists"
                    className="text-[10px] text-muted-foreground cursor-pointer select-none"
                  >
                    Same as Artist
                  </label>
                </div>
              </div>

              {/* Rename preview */}
              <div className="text-[11px] bg-card border border-border rounded px-2.5 py-2 mb-1.5 min-h-8 break-all leading-relaxed">
                {newName ? (
                  <>
                    <span className="text-muted-foreground">→ </span>
                    <span className="text-green-400">{newName}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground italic">
                    Generate a filename above first
                  </span>
                )}
              </div>

              {/* Byte counter */}
              {newName && (
                <p
                  className={`text-[10px] mb-2.5 ${bytesOver
                      ? "text-destructive"
                      : bytesWarn
                        ? "text-yellow-400"
                        : "text-muted-foreground"
                    }`}
                >
                  {bytes} / {MAX_BYTES} bytes
                  {bytesOver
                    ? " — too long, remove some tags"
                    : bytesWarn
                      ? " — approaching limit"
                      : ""}
                </p>
              )}

              {/* Rename button */}
              <Button
                className={`w-full gap-2 ${renamed
                    ? "bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/20"
                    : ""
                  }`}
                disabled={!newName || bytesOver || renaming || needsConversion}
                onClick={handleRename}
              >
                {renaming ? (
                  <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                ) : renamed ? (
                  <Check size={16} />
                ) : (
                  <PenLine size={16} />
                )}
                {renaming ? "Renaming…" : renamed ? "Renamed!" : "Rename File"}
              </Button>

              {/* Optional conversion section */}
              <div className="mt-3 border-t border-border pt-3">
                <button
                  onClick={() => setShowOptionalConvert((v) => !v)}
                  className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
                >
                  {showOptionalConvert ? (
                    <ChevronDown size={12} className="shrink-0" />
                  ) : (
                    <ChevronRight size={12} className="shrink-0" />
                  )}
                  Convert to a different format
                  <span className="ml-1 text-[9px] opacity-50">(optional)</span>
                </button>

                {showOptionalConvert && (
                  <div className="mt-2.5">
                    <ConversionPanel
                      formats={optionalConvertFormats}
                      format={safeConvertFormat}
                      quality={convertQuality}
                      deleteOriginal={deleteOriginal}
                      onFormatChange={setConvertFormat}
                      onQualityChange={setConvertQuality}
                      onDeleteChange={setDeleteOriginal}
                      checkboxId="delete-original-optional"
                    />
                    <Button
                      className={`w-full gap-2 ${converted
                          ? "bg-green-500/20 border-green-500/40 text-green-400 hover:bg-green-500/20"
                          : ""
                        }`}
                      disabled={converting}
                      onClick={handleConvert}
                    >
                      {converting ? (
                        <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      ) : converted ? (
                        <Check size={16} />
                      ) : (
                        <Repeat size={16} />
                      )}
                      {converting ? "Converting…" : converted ? "Converted!" : "Convert File"}
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
