import {
    AlertTriangle,
    Check,
    File,
    Loader2,
    Music2,
    PenLine,
    Repeat,
    RotateCcw,
    Tags,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";

// Pure utilities live in ./utils so this module exports components only and
// the react-refresh HMR rule stays satisfied.

export function FileIcon({ ext }: { ext: string }) {
    if (NEEDS_CONVERSION_EXTS.has(ext))
        return <AlertTriangle size={18} aria-hidden className="text-warning shrink-0 mt-0.5" />;
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return <Music2 size={18} aria-hidden className="text-success shrink-0 mt-0.5" />;
    return <File size={18} aria-hidden className="text-muted-foreground shrink-0 mt-0.5" />;
}

/** Tertiary "put this back the way it was generated" control. Used where an
 *  editable field has diverged from the value derived from the tag editor. */
export function ResetLink({ onClick, label }: { onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className="inline-flex items-center gap-1 min-h-9 px-2 -mx-2 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        >
            <RotateCcw size={12} aria-hidden />
            Reset
        </button>
    );
}

const ACTION_LABELS = {
    rename: { busy: "Renaming", done: "Renamed", idle: "Rename file", Icon: PenLine },
    convert: { busy: "Converting", done: "Converted", idle: "Convert file", Icon: Repeat },
    metadata: { busy: "Saving", done: "Saved", idle: "Save metadata", Icon: Tags },
} as const;

interface ActionButtonProps {
    kind: keyof typeof ACTION_LABELS;
    busy: boolean;
    done: boolean;
    disabled?: boolean;
    onClick: () => void;
}

export function ActionButton({ kind, busy, done, disabled, onClick }: ActionButtonProps) {
    const { busy: busyLabel, done: doneLabel, idle, Icon } = ACTION_LABELS[kind];
    const label = busy ? busyLabel : done ? doneLabel : idle;
    return (
        <Button
            onClick={onClick}
            disabled={disabled || busy}
            className="h-12 w-full gap-2 text-base"
        >
            {busy ? (
                <Loader2 size={16} aria-hidden className="animate-spin" />
            ) : done ? (
                <Check size={18} aria-hidden />
            ) : (
                <Icon size={18} aria-hidden />
            )}
            {label}
        </Button>
    );
}

interface MetaFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
}

export function MetaField({ id, label, value, onChange, placeholder, disabled }: MetaFieldProps) {
    return (
        <>
            <label
                htmlFor={id}
                className="text-sm font-medium tracking-wide text-muted-foreground sm:text-right"
            >
                {label}
            </label>
            <Input
                id={id}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                className="h-9 disabled:opacity-50"
            />
        </>
    );
}
