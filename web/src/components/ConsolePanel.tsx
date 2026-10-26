export function ConsolePanel({ text, status }: { text: string; status: string }) {
  return (
    <div className="flex flex-col gap-2">
      <pre className="min-h-16 overflow-auto rounded-md bg-[var(--bg)] p-2 font-mono text-sm whitespace-pre-wrap text-[var(--fg)]">
        {text || <span className="text-[var(--muted)]">(no output yet)</span>}
      </pre>
      <p className="font-mono text-xs text-[var(--muted)]">{status}</p>
    </div>
  );
}
