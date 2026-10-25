import type { ReactNode } from "react";

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-[var(--line)] bg-[var(--panel)]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <h2 className="text-sm font-semibold tracking-wide text-[var(--muted)] uppercase">{title}</h2>
        {aside}
      </header>
      <div className="min-w-0 flex-1 p-3">{children}</div>
    </section>
  );
}
