"use client";

type AssigneeOption = { id: string; name: string; activeTasks: number };

export default function AssigneeMultiSelect({ options, selectedIds, onChange }: {
  options: AssigneeOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const selected = options.filter((option) => selectedIds.includes(option.id));
  const label = selected.length === 0
    ? "Select employees"
    : selected.length <= 2
      ? selected.map((option) => option.name).join(", ")
      : `${selected.length} employees selected`;

  return <details className="group relative rounded-lg border border-slate-300 bg-white text-slate-900 open:z-20">
    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
      <span className={selected.length ? "truncate" : "text-slate-500"}>{label}</span>
      <span aria-hidden="true" className="shrink-0 text-xs transition-transform group-open:rotate-180">▼</span>
    </summary>
    <fieldset className="absolute left-0 right-0 top-[calc(100%+0.35rem)] max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
      <legend className="sr-only">Assign employees</legend>
      {options.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No eligible employees.</p>}
      {options.map((option) => <label key={option.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
        <input
          type="checkbox"
          checked={selectedIds.includes(option.id)}
          onChange={(event) => onChange(event.target.checked
            ? [...new Set([...selectedIds, option.id])]
            : selectedIds.filter((id) => id !== option.id))}
          className="h-4 w-4 accent-amber-500"
        />
        <span className="min-w-0 flex-1 truncate font-medium">{option.name}</span>
        <span className="shrink-0 text-xs text-slate-500">{option.activeTasks} active</span>
      </label>)}
    </fieldset>
  </details>;
}

