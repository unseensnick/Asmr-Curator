import { useEffect, useRef, useState } from "react";

import CopyButton from "@/components/CopyButton";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

/** Duration of the "filename generated" pulse animation. Sized to match
 *  the CSS keyframes — bumping requires updating both. */
const OUTPUT_PULSE_MS = 600;

interface OutputPanelProps {
    outputDash: string;
    outputPipe: string;
    stripBrackets: boolean;
    onStripBracketsChange: (v: boolean) => void;
}

/**
 * Read-and-copy surface. Always visible beside the source panels. Shows two
 * format variants of the same composed filename:
 *
 *   - Filename (dash-separated): for renaming files on disk.
 *   - Tag string (pipe-separated): for ID3 tag fields, post body, comments.
 *
 * Generation is triggered exclusively by the Generate button in TagsEditor;
 * this panel has no Regenerate button of its own. Each output row pulses
 * its border briefly when the value changes so a Generate on the middle
 * column gives an out-of-the-corner-of-the-eye acknowledgement on the
 * right column. aria-live announces the same change to screen readers.
 */
export default function OutputPanel({
    outputDash,
    outputPipe,
    stripBrackets,
    onStripBracketsChange,
}: OutputPanelProps) {
    return (
        <div className="flex flex-col gap-6">
            <OutputRow
                labelId="output-filename-label"
                label="Filename"
                separator="-"
                value={outputDash}
                emptyText="Filename will appear here."
            />

            <div className="flex flex-col gap-2">
                <OutputRow
                    labelId="output-tagstring-label"
                    label="Tag string"
                    separator="|"
                    value={outputPipe}
                    emptyText="Tag string will appear here. Paste into ID3 fields, post body, or comments."
                />
                <label
                    htmlFor="output-strip-brackets"
                    className="flex items-center gap-2 mt-1 cursor-pointer select-none w-fit"
                >
                    <Checkbox
                        id="output-strip-brackets"
                        checked={stripBrackets}
                        onCheckedChange={(v) => onStripBracketsChange(v === true)}
                    />
                    <span className="text-xs text-muted-foreground">
                        Drop [bracket] markers from the edges of the title
                    </span>
                </label>
            </div>
        </div>
    );
}

interface OutputRowProps {
    labelId: string;
    label: string;
    /** The literal character that joins title/tags/suffix in this row's
     *  value. Rendered as a small mono badge next to the label so the eye
     *  learns which row produces which separator without parsing the value. */
    separator: string;
    value: string;
    emptyText: string;
}

function OutputRow({ labelId, label, separator, value, emptyText }: OutputRowProps) {
    const [pulsing, setPulsing] = useState(false);
    const prev = useRef(value);

    useEffect(() => {
        if (value && value !== prev.current) {
            setPulsing(true);
            const t = window.setTimeout(() => setPulsing(false), OUTPUT_PULSE_MS);
            prev.current = value;
            return () => window.clearTimeout(t);
        }
        prev.current = value;
    }, [value]);

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
                <span
                    id={labelId}
                    className="text-sm font-medium tracking-wide text-muted-foreground inline-flex items-center gap-2"
                >
                    {label}
                    <span
                        aria-hidden
                        className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground/80"
                    >
                        {separator}
                    </span>
                </span>
                <CopyButton text={value} disabled={!value} />
            </div>
            <div
                aria-labelledby={labelId}
                aria-live="polite"
                className={cn(
                    "bg-muted/40 border rounded-md p-3 sm:p-3.5 min-h-14 font-mono text-sm leading-relaxed break-all text-foreground motion-safe:transition-colors motion-safe:duration-500",
                    pulsing ? "border-primary/60" : "border-border",
                )}
            >
                {value || <span className="text-muted-foreground/70 italic">{emptyText}</span>}
            </div>
        </div>
    );
}
