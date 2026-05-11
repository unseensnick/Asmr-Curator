import { RefreshCw, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import CopyButton from "@/components/CopyButton";
import SectionLabel from "@/components/SectionLabel";

interface OutputPanelProps {
  outputDash: string;
  outputPipe: string;
  onRegenerate: () => void;
  stripBrackets: boolean;
  onStripBracketsChange: (v: boolean) => void;
}


export default function OutputPanel({
  outputDash,
  outputPipe,
  onRegenerate,
  stripBrackets,
  onStripBracketsChange,
}: OutputPanelProps) {
  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* ── Dash card ── */}
      <Card className="flex-1 rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
        <SectionLabel tone="primary" hint="— dash separator" className="mb-4">
          Filename
        </SectionLabel>

        {!outputDash ? (
          <div className="min-h-20 flex flex-col items-center justify-center gap-2 bg-secondary border border-dashed border-border rounded-lg text-muted-foreground text-xs text-center p-5">
            <FileText size={28} className="opacity-25" />
            <span>
              Fill in the details below
              <br />
              and click Generate
            </span>
          </div>
        ) : (
          <>
            <div className="bg-secondary border border-primary/35 rounded-lg p-3.5 text-sm text-foreground leading-7 break-all min-h-13">
              {outputDash}
            </div>
            <div className="flex gap-2 mt-2.5 flex-wrap items-center">
              <CopyButton text={outputDash} />
              <Button
                size="sm"
                variant="outline"
                onClick={onRegenerate}
                className="gap-1.5"
              >
                <RefreshCw size={14} />
                Regenerate
              </Button>
            </div>
          </>
        )}
      </Card>

      {/* ── Pipe card ── */}
      <Card className="flex-1 rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
        <SectionLabel tone="info" hint="— pipe separator" className="mb-4">
          Metadata
        </SectionLabel>

        {!outputPipe ? (
          <div className="min-h-20 flex flex-col items-center justify-center gap-2 bg-secondary border border-dashed border-border rounded-lg text-muted-foreground text-xs text-center p-5">
            <FolderOpen size={28} className="opacity-25" />
            <span>
              Fill in the details below
              <br />
              and click Generate
            </span>
          </div>
        ) : (
          <>
            <div className="bg-secondary border border-info/35 rounded-lg p-3.5 text-sm text-foreground leading-7 break-all min-h-13">
              {outputPipe}
            </div>
            <div className="flex gap-2 mt-2.5 flex-wrap items-center">
              <CopyButton
                text={outputPipe}
                className="bg-info/15 border border-info/30 text-info hover:bg-info/25 hover:text-info"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={onRegenerate}
                className="gap-1.5"
              >
                <RefreshCw size={14} />
                Regenerate
              </Button>
            </div>
          </>
        )}

        {/* Strip brackets option — always visible in pipe card */}
        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none w-fit">
          <Checkbox
            checked={stripBrackets}
            onCheckedChange={(v) => onStripBracketsChange(v === true)}
          />
          <span className="text-[10px] text-muted-foreground tracking-[0.06em]">
            Strip leading [brackets] from metadata title
          </span>
        </label>
      </Card>
    </div>
  );
}
