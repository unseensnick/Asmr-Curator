import audioFormatsConfig from "./audio-formats.json";
import type { ConvertFormat, ConvertQuality, OutputFormat } from "./types";

export const METADATA_COMPATIBLE_EXTS = new Set<string>(audioFormatsConfig.metadataCompatibleExts);
export const NEEDS_CONVERSION_EXTS = new Set<string>(audioFormatsConfig.needsConversionExts);
export const OUTPUT_FORMATS = audioFormatsConfig.outputFormats as OutputFormat[];

export const FORMAT_EXT: Record<ConvertFormat, string> = Object.fromEntries(
    audioFormatsConfig.outputFormats.map((f) => [f.value, f.ext]),
) as Record<ConvertFormat, string>;

export const QUALITY_LABELS: Record<ConvertQuality, string> = Object.fromEntries(
    audioFormatsConfig.qualityLevels.map((q) => [q.value, q.label]),
) as Record<ConvertQuality, string>;

export const FORMAT_VALUES = audioFormatsConfig.outputFormats.map(
    (f) => f.value,
) as ConvertFormat[];
export const QUALITY_VALUES = audioFormatsConfig.qualityLevels.map(
    (q) => q.value,
) as ConvertQuality[];
