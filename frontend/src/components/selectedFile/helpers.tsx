import { AlertTriangle, Check, File, Loader2, Music2, PenLine, Repeat } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { METADATA_COMPATIBLE_EXTS, NEEDS_CONVERSION_EXTS } from "@/lib/audioFormats";

export const MAX_BYTES = 255;

// eslint-disable-next-line react-refresh/only-export-components -- shared module: small helpers ride alongside the icon/field components used only here
export function getExt(name: string): string {
    const m = name.match(/(\.[^.]+)$/);
    return m ? m[1] : "";
}

// eslint-disable-next-line react-refresh/only-export-components -- see getExt note
export function byteLength(str: string): number {
    return new TextEncoder().encode(str).length;
}

export function FileIcon({ ext }: { ext: string }) {
    if (NEEDS_CONVERSION_EXTS.has(ext))
        return (
            <AlertTriangle
                size={18}
                aria-hidden
                className="text-warning shrink-0 mt-0.5"
            />
        );
    if (METADATA_COMPATIBLE_EXTS.has(ext))
        return (
            <Music2
                size={18}
                aria-hidden
                className="text-success shrink-0 mt-0.5"
            />
        );
    return (
        <File
            size={18}
            aria-hidden
            className="text-muted-foreground shrink-0 mt-0.5"
        />
    );
}

interface ActionButtonProps {
    kind: "rename" | "convert";
    busy: boolean;
    done: boolean;
    disabled?: boolean;
    onClick: () => void;
}

export function ActionButton({
    kind,
    busy,
    done,
    disabled,
    onClick,
}: ActionButtonProps) {
    const label =
        kind === "rename"
            ? busy
                ? "Renaming"
                : done
                  ? "Renamed"
                  : "Rename file"
            : busy
              ? "Converting"
              : done
                ? "Converted"
                : "Convert file";
    const Icon = kind === "rename" ? PenLine : Repeat;
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

export function MetaField({
    id,
    label,
    value,
    onChange,
    placeholder,
    disabled,
}: MetaFieldProps) {
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
