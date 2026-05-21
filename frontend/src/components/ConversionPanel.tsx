import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { QUALITY_LABELS, QUALITY_VALUES } from "@/lib/audioFormats";
import type { ConvertFormat, ConvertQuality } from "@/lib/types";

interface ConversionPanelProps {
    formats: ConvertFormat[];
    format: ConvertFormat;
    quality: ConvertQuality;
    deleteOriginal: boolean;
    onFormatChange: (f: ConvertFormat) => void;
    onQualityChange: (q: ConvertQuality) => void;
    onDeleteChange: (v: boolean) => void;
    checkboxId: string;
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
}: ConversionPanelProps) {
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
