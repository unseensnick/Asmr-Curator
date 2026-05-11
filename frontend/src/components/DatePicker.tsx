import { format, parseISO } from "date-fns";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
    /** ISO `YYYY-MM-DD` value, or empty string when no date is set. */
    value: string;
    /** Called with an ISO `YYYY-MM-DD` string or `""` when cleared. */
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

/**
 * Shadcn-style date picker — Popover trigger button + react-day-picker
 * Calendar inside the popover. Per the docs, there is no `DatePicker` root
 * component; this is the composed recipe.
 *
 * Wire shape: the parent works with ISO `YYYY-MM-DD` strings (which is what
 * the backend's date-bound query params expect). The internal Date roundtrip
 * lives here.
 */
export default function DatePicker({
    value,
    onChange,
    placeholder = "Pick a date",
    disabled = false,
    className,
}: DatePickerProps) {
    const selected = useMemo(
        () => (value ? safeParse(value) : undefined),
        [value],
    );

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    disabled={disabled}
                    className={cn(
                        "w-full justify-start text-left text-xs font-normal gap-2 h-8 px-2.5",
                        !selected && "text-muted-foreground",
                        className,
                    )}
                >
                    <CalendarIcon className="size-3.5 opacity-60" />
                    {selected ? format(selected, "PPP") : <span>{placeholder}</span>}
                    {selected && (
                        <span
                            role="button"
                            tabIndex={0}
                            aria-label="Clear date"
                            className="ml-auto inline-flex items-center justify-center size-4 rounded-sm text-muted-foreground hover:text-destructive transition-colors"
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                onChange("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onChange("");
                                }
                            }}
                        >
                            <X className="size-3" />
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                    mode="single"
                    selected={selected}
                    onSelect={(d) => onChange(d ? format(d, "yyyy-MM-dd") : "")}
                    autoFocus
                />
            </PopoverContent>
        </Popover>
    );
}

function safeParse(iso: string): Date | undefined {
    try {
        const parsed = parseISO(iso);
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    } catch {
        return undefined;
    }
}
