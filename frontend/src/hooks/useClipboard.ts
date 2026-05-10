import { useState } from "react";

export function useClipboard(duration = 2000) {
  const [copied, setCopied] = useState(false);
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), duration);
    });
  }
  return { copied, copy };
}
