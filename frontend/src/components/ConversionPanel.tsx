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
  return (
    <>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] text-muted-foreground w-20 shrink-0">Output format</span>
        <ToggleGroup
          type="single"
          value={format}
          onValueChange={(v) => v && onFormatChange(v as ConvertFormat)}
          className="border border-input rounded-3xl overflow-hidden gap-0"
        >
          {formats.map((fmt) => (
            <ToggleGroupItem
              key={fmt}
              value={fmt}
              className="text-[10px] tracking-[0.06em] px-2.5 py-1 h-auto rounded-none! border-r border-input last:border-r-0 bg-card text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground uppercase"
            >
              {fmt}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] text-muted-foreground w-20 shrink-0">Quality</span>
        {format === "flac" ? (
          <span className="text-[10px] text-success border border-success/30 rounded px-2 py-1">
            Lossless (CD quality)
          </span>
        ) : (
          <ToggleGroup
            type="single"
            value={quality}
            onValueChange={(v) => v && onQualityChange(v as ConvertQuality)}
            className="border border-input rounded-3xl overflow-hidden gap-0"
          >
            {QUALITY_VALUES.map((q) => (
              <ToggleGroupItem
                key={q}
                value={q}
                className="text-[10px] tracking-[0.06em] px-2.5 py-1 h-auto rounded-none! border-r border-input last:border-r-0 bg-card text-muted-foreground hover:bg-primary/10 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {QUALITY_LABELS[q]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Checkbox
          id={checkboxId}
          checked={deleteOriginal}
          onCheckedChange={(v) => onDeleteChange(v === true)}
        />
        <label htmlFor={checkboxId} className="text-[10px] text-muted-foreground cursor-pointer select-none">
          Delete original after converting
        </label>
      </div>
    </>
  );
}
