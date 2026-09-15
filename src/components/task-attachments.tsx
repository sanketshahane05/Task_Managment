"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/browser";

type FileRow = { name: string; created_at: string | null; metadata?: { size?: number; mimetype?: string } | null };
type Preview = { name: string; url: string; kind: "image" | "pdf" | "text" | "unsupported" };

const displayName = (value: string) => value.replace(/^[a-f0-9-]{36}_/, "");
const previewKind = (file: FileRow): Preview["kind"] => {
  const mime = file.metadata?.mimetype?.toLowerCase() ?? "";
  const extension = displayName(file.name).split(".").pop()?.toLowerCase();
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "webp"].includes(extension ?? "")) return "image";
  if (mime === "application/pdf" || extension === "pdf") return "pdf";
  if (mime.startsWith("text/") || ["txt", "csv"].includes(extension ?? "")) return "text";
  return "unsupported";
};

export default function TaskAttachments({ taskId, canUpload }: { taskId: string; canUpload: boolean }) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  const load = useCallback(async (start = 0) => {
    if (!supabase) return;
    const { data, error } = await supabase.storage.from("task-attachments").list(taskId, { limit: 50, offset: start, sortBy: { column: "created_at", order: "desc" } });
    if (error) { setError(error.message); return; }
    setError("");
    setFiles(previous => start ? [...previous, ...(data || [])] : data || []);
    setOffset(start + 50);
    setMore(data?.length === 50);
  }, [taskId]);

  // Storage resolves asynchronously before load updates component state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  const signedUrl = async (file: FileRow, download = false) => {
    if (!supabase) return null;
    const { data, error } = await supabase.storage.from("task-attachments").createSignedUrl(`${taskId}/${file.name}`, 300, download ? { download: displayName(file.name) } : undefined);
    if (error) { setError(error.message); return null; }
    return data.signedUrl;
  };

  const openPreview = async (file: FileRow) => {
    const url = await signedUrl(file);
    if (url) setPreview({ name: displayName(file.name), url, kind: previewKind(file) });
  };

  const download = async (file: FileRow) => {
    const url = await signedUrl(file, true);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = displayName(file.name);
    link.rel = "noopener noreferrer";
    link.click();
  };

  return <>
    <details className="my-3 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">Attachments ({files.length}{more ? "+" : ""})</summary>
      <div className="mt-3 space-y-3">
        {canUpload && <label className="block text-xs text-slate-500">Add screenshot or document · maximum 10 MB<input aria-label="Upload task attachment" disabled={busy} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv,.docx,.xlsx" className="mt-2 block w-full text-xs" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ""; if (!file || !supabase) return; if (file.size > 10485760) { setError("Choose a file smaller than 10 MB."); return; } setBusy(true); setError(""); try { const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-150); const { error } = await supabase.storage.from("task-attachments").upload(`${taskId}/${crypto.randomUUID()}_${safe}`, file, { upsert: false }); if (error) throw error; await load(); } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "Upload failed."); } finally { setBusy(false); } }} /></label>}
        {error && <p role="alert" className="text-xs text-orange-600">{error}</p>}
        {busy && <p role="status" className="text-xs">Uploading…</p>}
        <ul className="space-y-2">{files.map(file => <li key={file.name} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5"><button className="break-all text-left text-sm font-semibold text-indigo-600 hover:underline" onClick={() => void openPreview(file)}>{displayName(file.name)}</button><p className="mt-1 text-xs text-slate-500">{Math.ceil((file.metadata?.size || 0) / 1024)} KB · {new Date(file.created_at || 0).toLocaleDateString()}</p><div className="mt-2 flex gap-3"><button className="text-xs font-semibold text-indigo-600" onClick={() => void openPreview(file)}>Preview</button><button className="text-xs font-semibold text-slate-600" onClick={() => void download(file)}>Download</button></div></li>)}</ul>
        {!files.length && !error && <p className="text-xs text-slate-500">No attachments yet.</p>}
        <div className="flex gap-4">{more && <button className="text-sm text-indigo-600" onClick={() => void load(offset)}>Load more files</button>}<button className="text-xs text-slate-500" onClick={() => void load()}>Refresh files</button></div>
      </div>
    </details>

    {preview && <div role="dialog" aria-modal="true" aria-label={`Preview ${preview.name}`} className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) setPreview(null); }}><div className="flex h-[min(85dvh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"><header className="flex items-center justify-between gap-4 border-b border-slate-200 px-4 py-3"><div className="min-w-0"><h2 className="truncate font-bold">{preview.name}</h2><p className="text-xs text-slate-500">Secure preview · link expires in 5 minutes</p></div><button aria-label="Close attachment preview" onClick={() => setPreview(null)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xl">×</button></header><div className="min-h-0 flex-1 bg-slate-100 p-3">{preview.kind === "image" && <img src={preview.url} alt={preview.name} className="h-full w-full object-contain" />}{preview.kind === "pdf" && <iframe title={preview.name} src={preview.url} className="h-full w-full rounded-lg bg-white" />}{preview.kind === "text" && <iframe title={preview.name} src={preview.url} sandbox="" className="h-full w-full rounded-lg bg-white" />}{preview.kind === "unsupported" && <div className="grid h-full place-items-center text-center"><div><p className="font-semibold">Preview is unavailable for this file type.</p><p className="mt-2 text-sm text-slate-500">Download the file to open it in its associated application.</p></div></div>}</div><footer className="flex justify-end gap-3 border-t border-slate-200 p-3"><a href={preview.url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold">Open in new tab</a></footer></div></div>}
  </>;
}

