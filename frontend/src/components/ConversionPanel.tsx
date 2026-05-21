import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { QUALITY_LABELS, QUALITY_VALUES } from "@/lib/audioFormats";
import type { ConvertFormat, ConvertQuality } from "@/lib/types";

/** Allowed range for the power-mode bitrate override. Mirrors the
 *  backend's BITRATE_OVERRIDE_{MIN,MAX}_KBPS in backend/main.py — keep in
 *  sync if those change. */
export const BITRATE_OVERRIDE_MIN_KBPS = 32;
export const BITRATE_OVERRIDE_MAX_KBPS = 320;
export const BITRATE_OVERRIDE_STEP_KBPS = 8;

/** Nominal kbps each preset produces (LAME / libvorbis VBR averages).
 *  Used as the slider's resting position when no override is set, so the
 *  thumb starts where the preset currently lands and a touch becomes a
 *  meaningful override. The numbers track the comments in backend/main.py
 *  QUALITY_FLAGS — update both together. */
const PRESET_NOMINAL_KBPS: Record<"mp3" | "ogg", Record<ConvertQuality, number>> = {
    mp3: { low: 130, standard: 160, high: 190, best: 245 },
    ogg: { low: 128, standard: 192, high: 224, best: 320 },
};

interface ConversionPanelProps {
    formats: ConvertFormat[];
    format: ConvertFormat;
    quality: ConvertQuality;
    deleteOriginal: boolean;
    onFormatChange: (f: ConvertFormat) => void;
    onQualityChange: (q: ConvertQuality) => void;
    onDeleteChange: (v: boolean) => void;
    checkboxId: string;
    /** When true, show an explicit kbps override input below the Quality
     *  picker. Overrides the preset's VBR target for the lossy codecs
     *  (MP3, OGG); the input is read-only-disabled for FLAC, which has
     *  no bitrate concept. `null` here means "use the preset"; a number
     *  means "send that kbps as a CBR target." */
    powerMode?: boolean;
    bitrateKbps?: number | null;
    onBitrateChange?: (kbps: number | null) => void;
}

/**
 * Shared format + quality + delete-original controls. Used by FileBrowser's
 * batch panel and by SelectedFilePanel for both required-conversion and
 * optional-conversion flows. Active toggle state uses bg-accent (matching
 * Patreon panel filter chips), not bg-primary, so the chrome stays calm and
 * the primary teal stays reserved for the Rename / Convert CTA below.
 */
export default function ConversionPanel({
    formats,
    format,
    quality,
    deleteOriginal,
    onFormatChange,
    onQualityChange,
    onDeleteChange,
    checkboxId,
    powerMode = false,
    bitrateKbps = null,
    onBitrateChange,
}: ConversionPanelProps) {
    const showBitrate = powerMode && !!onBitrateChange;
    const isLossy = format === "mp3" || format === "ogg";
    const presetKbps = isLossy ? PRESET_NOMINAL_KBPS[format][quality] : null;
    const sliderValue =
        bitrateKbps ??
        presetKbps ??
        Math.round((BITRATE_OVERRIDE_MIN_KBPS + BITRATE_OVERRIDE_MAX_KBPS) / 2);
    const toggleItemClass =
        "text-sm px-3 py-1.5 h-auto rounded-none! border-r border-border last:border-r-0 bg-background text-muted-foreground hover:text-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-accent uppercase";
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium tracking-wide text-muted-foreground w-24 shrink-0">
                    Output format
                </span>
                <ToggleGroup
                    type="single"
                    value={format}
                    onValueChange={(v) => v && onFormatChange(v as ConvertFormat)}
                    className="border border-border rounded-md overflow-hidden gap-0"
                >
                    {formats.map((fmt) => (
                        <ToggleGroupItem key={fmt} value={fmt} className={toggleItemClass}>
                            {fmt}
                        </ToggleGroupItem>
                    ))}
                </ToggleGroup>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium tracking-wide text-muted-foreground w-24 shrink-0">
                    Quality
                </span>
                {format === "flac" ? (
                    <span className="text-sm text-success border border-success/30 rounded-md px-2.5 py-1.5">
                        Lossless (CD quality)
                    </span>
                ) : (
                    // Chip layout matching PatreonPanel's "Also include"
                    // group — separated rounded pills with their own
                    // borders, not a segmented control. The Conversion
                    // surface uses the same filter-chip language so the
                    // controls read as the same kind of toggle wherever
                    // they appear.
                    <ToggleGroup
                        type="single"
                        value={quality}
                        onValueChange={(v) => v && onQualityChange(v as ConvertQuality)}
                        className="flex flex-wrap gap-1.5"
                    >
                        {QUALITY_VALUES.map((q) => (
                            <ToggleGroupItem
                                key={q}
                                value={q}
                                className="text-sm px-3 py-1.5 h-auto rounded-md border border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground/30 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-transparent"
                            >
                                {QUALITY_LABELS[q]}
                            </ToggleGroupItem>
                        ))}
                    </ToggleGroup>
                )}
            </div>

            {showBitrate && (
                <div className="flex items-start gap-3 flex-wrap">
                    <span className="text-sm font-medium tracking-wide text-muted-foreground w-24 shrink-0 pt-2">
                        Bitrate
                    </span>
                    <div className="flex flex-col gap-2 flex-1 min-w-[16rem] max-w-md">
                        {!isLossy ? (
                            <span className="text-xs text-muted-foreground leading-relaxed">
                                FLAC keeps every detail of the original, so there&apos;s no bitrate
                                to set.
                            </span>
                        ) : (
                            <>
                                <div className="flex items-baseline gap-2 font-mono text-sm">
                                    <span
                                        className={
                                            bitrateKbps == null
                                                ? "text-muted-foreground"
                                                : "text-foreground tabular-nums"
                                        }
                                    >
                                        {sliderValue}
                                    </span>
                                    <span className="text-xs text-muted-foreground">kbps</span>
                                    <span className="text-xs text-muted-foreground/70 ml-auto">
                                        {bitrateKbps == null ? "using preset" : "custom override"}
                                    </span>
                                </div>
                                <Slider
                                    value={[sliderValue]}
                                    min={BITRATE_OVERRIDE_MIN_KBPS}
                                    max={BITRATE_OVERRIDE_MAX_KBPS}
                                    step={BITRATE_OVERRIDE_STEP_KBPS}
                                    onValueChange={(values) => {
                                        const v = values[0];
                                        if (typeof v === "number") onBitrateChange?.(v);
                                    }}
                                    aria-label="Custom bitrate in kbps"
                                />
                                <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                    <span>
                                        Drag to set a fixed bitrate, or use the preset above.
                                    </span>
                                    {bitrateKbps != null && (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="ghost"
                                            className="h-auto px-2 py-1 text-xs"
                                            onClick={() => onBitrateChange?.(null)}
                                        >
                                            Use preset
                                        </Button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            <label
                htmlFor={checkboxId}
                className="flex items-center gap-2 cursor-pointer select-none w-fit"
            >
                <Checkbox
                    id={checkboxId}
                    checked={deleteOriginal}
                    onCheckedChange={(v) => onDeleteChange(v === true)}
                />
                <span className="text-sm text-muted-foreground">
                    Delete original after converting
                </span>
            </label>
        </div>
    );
}
