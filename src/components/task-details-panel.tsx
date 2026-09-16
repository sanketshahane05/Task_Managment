"use client";
import { useEffect, type ReactNode } from "react";

export default function TaskDetailsPanel({ children, onClose, inactive = false }: { children: ReactNode; onClose: () => void; inactive?: boolean }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKey = (event: KeyboardEvent) => { if (!inactive && event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", handleKey); };
  }, [inactive, onClose]);
  return <div role="dialog" aria-modal="true" aria-labelledby="task-details-heading" aria-hidden={inactive || undefined} className={`fixed inset-0 z-30 bg-black/40 ${inactive ? "pointer-events-none" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ml-auto flex h-dvh w-full flex-col bg-white text-slate-900 shadow-2xl sm:w-[min(760px,90vw)]">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4"><h2 id="task-details-heading" className="font-bold">Task details</h2><button autoFocus type="button" aria-label="Close task details" onClick={onClose} className="rounded-lg px-3 py-1 text-xl text-slate-500 hover:bg-slate-100">×</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
    </div>
  </div>;
}

