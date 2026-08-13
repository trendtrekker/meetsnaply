"use client";

import { useState } from "react";
import { Check, Link2 } from "lucide-react";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions); the link is
      // still visible in the title attribute so this stays recoverable.
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={url}
      className="inline-flex items-center gap-2 rounded-full border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold transition-colors hover:bg-surface-muted"
    >
      {copied ? (
        <Check className="size-4 text-success" />
      ) : (
        <Link2 className="size-4 text-text-muted" />
      )}
      <span className="hidden sm:inline">
        {copied ? "Copied" : "Copy link"}
      </span>
    </button>
  );
}
