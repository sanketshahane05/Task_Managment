"use client";

type Task = {
  id: string;
  projectId: string;
  status: "Not started" | "In progress" | "Completed";
  progress: number;
  dueDate?: string;
};

type ProgressLog = { createdAt: string };
type Project = { id: string; name: string };

const COLORS = ["#94a3b8", "#6366f1", "#10b981"];

export default function DashboardCharts({ tasks, projects, progressLogs }: { tasks: Task[]; projects: Project[]; progressLogs: ProgressLog[] }) {
  const statusCounts = ["Not started", "In progress", "Completed"].map(status => tasks.filter(task => task.status === status).length);
  const total = Math.max(tasks.length, 1);
  let offset = 0;
  const stops = statusCounts.map((count, index) => {
    const start = offset;
    offset += count / total * 100;
    return `${COLORS[index]} ${start}% ${offset}%`;
  }).join(", ");

  const projectProgress = projects.map(project => {
    const items = tasks.filter(task => task.projectId === project.id);
    return { name: project.name, count: items.length, progress: items.length ? Math.round(items.reduce((sum, task) => sum + task.progress, 0) / items.length) : 0 };
  }).filter(project => project.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);

  const today = new Date();
  const activity = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
    return { label: date.toLocaleDateString(undefined, { weekday: "short" }), count: progressLogs.filter(log => log.createdAt.slice(0, 10) === key).length };
  });
  const maxActivity = Math.max(...activity.map(day => day.count), 1);
  const points = activity.map((day, index) => `${8 + index * 14},${62 - day.count / maxActivity * 48}`).join(" ");

  return <section className="mt-6 grid gap-4 xl:grid-cols-3" aria-label="Workspace charts">
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div><h3 className="font-bold">Task status</h3><p className="mt-1 text-xs text-slate-500">Current visible workload</p></div>
      <div className="mt-5 flex items-center gap-6">
        <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: tasks.length ? `conic-gradient(${stops})` : "#e2e8f0" }}><div className="grid h-20 w-20 place-items-center rounded-full bg-white text-center"><span><strong className="block text-2xl">{tasks.length}</strong><small className="text-slate-500">tasks</small></span></div></div>
        <ul className="space-y-2 text-sm">{["Not started", "In progress", "Completed"].map((status, index) => <li key={status} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS[index] }} /><span className="text-slate-600">{status}</span><strong>{statusCounts[index]}</strong></li>)}</ul>
      </div>
    </article>

    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div><h3 className="font-bold">Project progress</h3><p className="mt-1 text-xs text-slate-500">Average completion by project</p></div>
      <div className="mt-5 space-y-3">{projectProgress.length ? projectProgress.map(project => <div key={project.name}><div className="mb-1 flex justify-between gap-3 text-xs"><span className="truncate font-semibold">{project.name}</span><span className="text-slate-500">{project.progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-600" style={{ width: `${project.progress}%` }} /></div></div>) : <p className="text-sm text-slate-500">Project progress will appear when tasks are added.</p>}</div>
    </article>

    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div><h3 className="font-bold">Daily updates</h3><p className="mt-1 text-xs text-slate-500">Updates submitted in the last 7 days</p></div>
      <div className="mt-4">
        <svg viewBox="0 0 100 70" className="h-36 w-full" role="img" aria-label={`Daily updates: ${activity.map(day => `${day.label} ${day.count}`).join(", ")}`}>
          <path d="M8 62 H92" stroke="#cbd5e1" strokeWidth="1" />
          <polyline points={points} fill="none" stroke="#e79a3f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          {activity.map((day, index) => <g key={day.label}><circle cx={8 + index * 14} cy={62 - day.count / maxActivity * 48} r="2.5" fill="#e79a3f" /><text x={8 + index * 14} y="69" textAnchor="middle" fontSize="4" fill="currentColor">{day.label.slice(0, 1)}</text>{day.count > 0 && <text x={8 + index * 14} y={57 - day.count / maxActivity * 48} textAnchor="middle" fontSize="4" fill="currentColor">{day.count}</text>}</g>)}
        </svg>
      </div>
    </article>
  </section>;
}

