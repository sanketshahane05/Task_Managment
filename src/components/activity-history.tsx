"use client";
import { useCallback, useEffect, useState } from "react";
type Event = {id: number; entity_label: string; actor_name: string; action: string; created_at: string; changes: Record<string, {before: unknown; after: unknown}>};
const labels: Record<string,string> = {assignee_id:'Primary assignee',assignee_ids:'Assigned team',project_id:'Project',parent_id:'Parent task',start_date:'Start date',due_date:'Due date',archived_at:'Archived',review_state:'Review status',review_note:'Review feedback'};
const display = (value: unknown) => value === null || value === undefined ? 'Not set' : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);
export default function ActivityHistory({ taskId }: {taskId?: string}) {
  const [events,setEvents]=useState<Event[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [busy,setBusy]=useState(true);
  const [error,setError]=useState('');
  const load=useCallback(async (before?:string, signal?:AbortSignal) => {
    try {
      const params=new URLSearchParams({view:'activity'});
      if(taskId)params.set('taskId',taskId);
      if(before)params.set('before',before);
      const response=await fetch(`/api/workspace?${params}`,{cache:'no-store',signal});
      const result=await response.json();
      if(!response.ok)throw Error(result.error || 'Unable to load activity.');
      setError('');
      setEvents(previous=>before?[...previous,...result.events]:result.events);setCursor(result.nextCursor);
    }catch(e){if(!signal?.aborted)setError(e instanceof Error?e.message:'Unable to load activity.');}
    finally{if(!signal?.aborted)setBusy(false);}
  },[taskId]);
  // Fetch completion updates state asynchronously; abort cancels the subscription on unmount.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{const controller=new AbortController();void load(undefined,controller.signal);return()=>controller.abort();},[load]);
  return <section className="mt-5 space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Activity history</h2><button disabled={busy} onClick={()=>{setBusy(true);void load();}} className="text-sm font-semibold text-indigo-600 disabled:opacity-50">Refresh</button></div>
    <p className="text-xs text-slate-500">Recorded changes, newest first. History begins when tracking is enabled. Daily updates remain separate.</p>
    {error&&<p role="alert" className="text-sm text-orange-500">{error}</p>}
    {!events.length&&!busy&&!error&&<p className="text-sm text-slate-500">No recorded changes yet.</p>}
    <ol className="space-y-3">{events.map(event=><li key={event.id} className="rounded-xl border border-slate-200 bg-white p-4"><p className="break-words font-semibold">{event.entity_label}</p><p className="mt-1 text-xs text-slate-500">{event.actor_name} · {event.action === 'insert' ? 'Created' : 'Updated'} · <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time></p><dl className="mt-3 space-y-2 text-sm">{Object.entries(event.changes).map(([field,change])=><div key={field} className="break-words"><dt className="font-semibold text-slate-600">{labels[field] || field.charAt(0).toUpperCase()+field.slice(1)}</dt><dd className="text-slate-500">{field==='description'||field==='review_note'?'Updated':`${display(change.before)} → ${display(change.after)}`}</dd></div>)}</dl></li>)}</ol>
    {busy&&<p role="status" className="text-sm text-slate-500">Loading activity…</p>}
    {cursor&&<button disabled={busy} onClick={()=>{setBusy(true);void load(cursor);}} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Load older changes</button>}
  </section>;
}

