import ConversionPanel from "@/components/ConversionPanel";
import { Checkbox } from "@/components/ui/checkbox";
import { FORMAT_VALUES } from "@/lib/audioFormats";
import {
    type IngestConvertSettings,
    qualityForFormat,
    saveIngestConvert,
} from "@/lib/ingestConvert";
import type { ConvertFormat, ConvertQuality } from "@/lib/types";

interface IngestConvertSectionProps {
    value: IngestConvertSettings;
    onChange: (next: IngestConvertSettings) => void;
    /** Unique per mount — two of these can be on screen at once (a Drive tab
     *  and an expanded post's external links). */
    idPrefix: string;
    /** Reveals the explicit kbps override, same gate the Convert panel uses. */
    powerMode?: boolean;
}

/**
 * Convert-on-download controls, shared by the Google Drive tab, the per-link
 * Download buttons under a Patreon post, and any optional source tab.
 *
 * Off by default: the source file is usually what you want, and converting
 * is lossy work you can always do later from the Convert panel. When on, it
 * reuses that same panel so the controls and presets are identical wherever
 * a conversion is configured.
 */
export default function IngestConvertSection({
    value,
    onChange,
    idPrefix,
    powerMode = false,
}: IngestConvertSectionProps) {
    function update(patch: Partial<IngestConvertSettings>) {
        const next = { ...value, ...patch };
        onChange(next);
        saveIngestConvert(next);
    }

    return (
        <div className="flex flex-col gap-3">
            <label
                htmlFor={`${idPrefix}-convert`}
                className="flex items-center gap-2 cursor-pointer select-none w-fit"
            >
                <Checkbox
                    id={`${idPrefix}-convert`}
                    checked={value.enabled}
                    onCheckedChange={(v) => update({ enabled: v === true })}
                />
                <span className="text-sm text-muted-foreground">Convert after downloading</span>
            </label>

            {value.enabled ? (
                <ConversionPanel
                    formats={FORMAT_VALUES}
                    format={value.format}
                    quality={value.quality}
                    onFormatChange={(f: ConvertFormat) =>
                        // FLAC only has `lossless`; carry the quality across
                        // so the request can't be rejected for a mismatch.
                        update({ format: f, quality: qualityForFormat(f, value.quality) })
                    }
                    onQualityChange={(q: ConvertQuality) => update({ quality: q })}
                    powerMode={powerMode}
                    bitrateKbps={value.bitrateKbps}
                    onBitrateChange={(kbps) => update({ bitrateKbps: kbps })}
                />
            ) : (
                <p className="text-xs text-muted-foreground/80 leading-relaxed">
                    The file is saved exactly as the source serves it. Turn this on to re-encode on
                    arrival, or convert later from the file library.
                </p>
            )}
        </div>
    );
}
