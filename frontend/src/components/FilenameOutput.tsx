import { RefreshCw, FileText, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import CopyButton from "@/components/CopyButton";

interface FilenameOutputProps {
  outputDash: string;
  outputPipe: string;
  onRegenerate: () => void;
  stripBrackets: boolean;
  onStripBracketsChange: (v: boolean) => void;
}


export default function FilenameOutput({
  outputDash,
  outputPipe,
  onRegenerate,
  stripBrackets,
  onStripBracketsChange,
}: FilenameOutputProps) {
  return (
    <div className="flex flex-col gap-4 flex-1">
      {/* ── Dash card ── */}
      <Card className="flex-1 rounded-xl border border-border shadow-none ring-0 p-5 gap-0">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          Filename
          <span className="opacity-45 text-[9px] tracking-[0.08em]">
            — dash separator
          </span>
        </div>

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
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-[0.14em] uppercase text-muted-foreground mb-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[#818cf8] shrink-0" />
          Metadata
          <span className="opacity-45 text-[9px] tracking-[0.08em]">
            — pipe separator
          </span>
        </div>

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
            <div className="bg-secondary border border-[#818cf8]/35 rounded-lg p-3.5 text-sm text-foreground leading-7 break-all min-h-13">
              {outputPipe}
            </div>
            <div className="flex gap-2 mt-2.5 flex-wrap items-center">
              <CopyButton
                text={outputPipe}
                className="bg-[#818cf8]/15 border border-[#818cf8]/30 text-[#818cf8] hover:bg-[#818cf8]/25 hover:text-[#818cf8]"
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
