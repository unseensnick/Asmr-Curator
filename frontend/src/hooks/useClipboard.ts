import { useEffect, useRef, useState } from "react";

export function useClipboard(duration = 2000) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // clipboard.writeText rejects in insecure contexts and when the document
  // isn't focused — fall back to console so the rejection isn't swallowed
  // and the user sees nothing happen.
  function copy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), duration);
      })
      .catch((err) => {
        console.warn("Clipboard copy failed:", err);
      });
  }

  // Cancel the pending state-reset if the consuming component unmounts —
  // otherwise React logs a "setState on unmounted component" warning.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return { copied, copy };
}
