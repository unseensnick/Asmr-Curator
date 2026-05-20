import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClipboard } from "@/hooks/useClipboard";

interface CopyButtonProps {
    text: string;
    className?: string;
    /** Disable the button when there is no text to copy (empty output state). */
    disabled?: boolean;
}

export default function CopyButton({ text, className, disabled }: CopyButtonProps) {
    const { copied, copy } = useClipboard();

    return (
        <Button
            size="sm"
            onClick={() => copy(text)}
            className={className}
            disabled={disabled}
            aria-label={copied ? "Copied to clipboard" : "Copy to clipboard"}
        >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? "Copied!" : "Copy"}
        </Button>
    );
}
