/** Convert-on-download settings, shared by every ingest path that offers it.
 *
 *  The Google Drive tab, the per-link Download buttons under a fetched
 *  Patreon post, and any optional source tab all offer it, so the choice and
 *  its persistence live here rather than in any one component.
 *
 *  Formats deliberately match `outputFormats` in `audio-formats.json`, the
 *  same set `/api/convert` produces. An earlier version of this offered M4A
 *  and Opus, inherited from a download path that passed them through
 *  untouched. The backend rejected both, because ingest conversion runs
 *  through ffmpeg's preset table, and `.m4a` is a format this app converts
 *  *from*.
 *
 *  Persisted client-side. Unlike the server-side ingest settings there is no
 *  server-side group for this, and it's a per-user preference rather than
 *  something the backend needs between requests.
 */

import type { ConvertFormat, ConvertQuality } from "@/lib/types";

export interface IngestConvertSettings {
    /** Off means "keep whatever the source served" — no ffmpeg at all. */
    enabled: boolean;
    format: ConvertFormat;
    quality: ConvertQuality;
    /** Power-mode CBR override; null uses the preset. */
    bitrateKbps: number | null;
}

const STORAGE_KEY = "ingest.convert";

export const DEFAULT_INGEST_CONVERT: IngestConvertSettings = {
    enabled: false,
    format: "mp3",
    quality: "high",
    bitrateKbps: null,
};

/** FLAC's only preset is `lossless`; the lossy codecs use the usual four.
 *  Sending `high` for FLAC is rejected by the backend, so switching format
 *  has to carry the quality with it. */
export function qualityForFormat(format: ConvertFormat, current: ConvertQuality): ConvertQuality {
    if (format === "flac") return "lossless" as ConvertQuality;
    return current === ("lossless" as ConvertQuality) ? "high" : current;
}

export function loadIngestConvert(): IngestConvertSettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_INGEST_CONVERT;
        const parsed = JSON.parse(raw) as Partial<IngestConvertSettings>;
        const format = (parsed.format ?? DEFAULT_INGEST_CONVERT.format) as ConvertFormat;
        return {
            enabled: parsed.enabled === true,
            format,
            quality: qualityForFormat(
                format,
                (parsed.quality ?? DEFAULT_INGEST_CONVERT.quality) as ConvertQuality,
            ),
            bitrateKbps: typeof parsed.bitrateKbps === "number" ? parsed.bitrateKbps : null,
        };
    } catch {
        return DEFAULT_INGEST_CONVERT;
    }
}

export function saveIngestConvert(value: IngestConvertSettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
        // non-fatal — the choice just won't survive a reload
    }
}

/** Request fields for the ingest endpoints. Disabled → `best`, which the
 *  backend treats as "skip ffmpeg entirely". */
export function toIngestConvertRequest(s: IngestConvertSettings): {
    audioFormat: string;
    audioQuality?: string;
    bitrateKbps?: number | null;
} {
    if (!s.enabled) return { audioFormat: "best" };
    return {
        audioFormat: s.format,
        audioQuality: s.quality,
        bitrateKbps: s.bitrateKbps,
    };
}
