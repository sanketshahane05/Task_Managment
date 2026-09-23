type NotificationTask = {
  id: string; title: string; projectId: string; assigneeId: string; assigneeIds?: string[]; createdById: string;
  parentId: string | null; status: string; dueDate?: string; assignedAt?: string;
  createdAt?: string; archivedAt?: string; reviewState?: string;
};
type NotificationNote = { taskId: string; authorId: string; createdAt: string; readBy?: string[] };
export type WorkNotification = {
  id: string; taskId: string; projectId: string; title: string; label: string;
  kind: "Deadlines" | "Messages" | "Assignments" | "Reviews";
  date: string; urgent: boolean;
};

// Inputs must come from the authenticated workspace response, never an unrestricted task list.
export function buildNotifications(tasks: NotificationTask[], notes: NotificationNote[], user: { id: string; role: string }, now: Date): WorkNotification[] {
  const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = dateKey(now);
  const upcoming = new Date(now); upcoming.setDate(upcoming.getDate() + 3);
  const weekAgo = now.getTime() - 7 * 86400000;
  const manager = user.role === "Admin" || user.role === "Manager";
  const alerts: WorkNotification[] = [];
  for (const task of tasks) {
    if (task.archivedAt) continue;
    const mine = (task.assigneeIds?.length ? task.assigneeIds : [task.assigneeId]).includes(user.id);
    const delegated = user.role === "Senior Employee" && task.createdById === user.id && Boolean(task.parentId);
    const add = (kind: WorkNotification["kind"], label: string, date: string, urgent = false) => alerts.push({ id: `${kind}:${task.id}`, taskId: task.id, projectId: task.projectId, title: task.title, kind, label, date, urgent });
    const unread = notes.filter(note => note.taskId === task.id && note.authorId !== user.id && !note.readBy?.includes(user.id));
    if (unread.length) add("Messages", `${unread.length} unread message${unread.length === 1 ? "" : "s"}`, unread.map(note => note.createdAt).sort().at(-1)!);
    if (task.status === "Completed") continue;
    if ((manager || mine || delegated) && task.dueDate && task.dueDate <= dateKey(upcoming)) {
      add("Deadlines", task.dueDate < today ? "Overdue" : task.dueDate === today ? "Due today" : "Due in the next 3 days", task.dueDate, task.dueDate <= today);
    }
    const assigned = task.assignedAt || task.createdAt;
    if (mine && assigned && Date.parse(assigned) >= weekAgo && Date.parse(assigned) <= now.getTime()) add("Assignments", "Assigned to you in the last 7 days", assigned);
    if (task.reviewState === "pending" && !mine && (manager || delegated)) add("Reviews", "Waiting for your review", task.assignedAt || task.createdAt || today, true);
    if (task.reviewState === "changes_requested" && mine) add("Reviews", "Changes requested", task.assignedAt || task.createdAt || today, true);
  }
  return alerts.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.kind === "Deadlines" && b.kind === "Deadlines" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id));
}

