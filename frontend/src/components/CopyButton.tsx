import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useClipboard } from "@/hooks/useClipboard";

interface CopyButtonProps {
  text: string;
  className?: string;
}

export default function CopyButton({ text, className }: CopyButtonProps) {
  const { copied, copy } = useClipboard();

  return (
    <Button size="sm" onClick={() => copy(text)} className={className}>
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
