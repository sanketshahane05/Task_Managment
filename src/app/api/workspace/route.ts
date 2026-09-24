import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const roleSchema = z.enum(["Admin", "Manager", "Senior Employee", "Employee"]);
const statusSchema = z.enum(["Not started", "In progress", "Completed"]);
const prioritySchema = z.enum(["High", "Medium", "Low"]);
const recurrenceSchema = z.enum(["none", "daily", "weekly", "monthly"]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("invite_user"), name: z.string().trim().min(2).max(120), email: z.email().max(254), role: roleSchema }),
  z.object({ action: z.literal("create_user"), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), password: z.string().min(8).max(128), role: roleSchema }),
  z.object({ action: z.literal("update_user"), userId: z.string().uuid(), role: roleSchema.optional(), active: z.boolean().optional() }),
  z.object({ action: z.literal("update_profile"), name: z.string().trim().min(2).max(120) }),
  z.object({ action: z.literal("create_project"), name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).default("") }),
  z.object({ action: z.literal("delete_project"), projectId: z.string().min(1) }),
  z.object({ action: z.literal("archive_project"), projectId: z.string().min(1) }),
  z.object({ action: z.literal("restore_project"), projectId: z.string().min(1) }),
  z.object({ action: z.literal("create_task"), title: z.string().trim().min(2).max(200), description: z.string().trim().max(5000).default(""), projectId: z.string().min(1), assigneeIds: z.array(z.string().uuid()).min(1).max(50), parentId: z.string().nullable().optional(), blockedById: z.string().nullable().optional(), milestone: z.boolean().default(false), milestoneDate: z.iso.date().nullable().optional(), recurrence: recurrenceSchema.default("none"), priority: prioritySchema, startDate: z.iso.date(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
  z.object({ action: z.literal("edit_task"), taskId: z.string().min(1), title: z.string().trim().min(2).max(200), description: z.string().trim().max(5000), assigneeIds: z.array(z.string().uuid()).min(1).max(50), blockedById: z.string().nullable().optional(), milestone: z.boolean().default(false), milestoneDate: z.iso.date().nullable().optional(), recurrence: recurrenceSchema.default("none"), priority: prioritySchema, startDate: z.iso.date(), dueDate: z.iso.date() }),
  z.object({ action: z.literal("delete_task"), taskId: z.string().min(1) }),
  z.object({ action: z.literal("restore_task"), taskId: z.string().min(1) }),
  z.object({ action: z.literal("add_note"), taskId: z.string().min(1), text: z.string().trim().min(1).max(5000) }),
  z.object({ action: z.literal("mark_messages_read"), taskId: z.string().min(1) }),
  z.object({ action: z.literal("save_employee_update"), taskId: z.string().min(1), description: z.string().trim().max(5000), status: statusSchema, progress: z.number().int().min(0).max(100) }),
  z.object({ action: z.literal("review_task"), taskId: z.string().min(1), decision: z.enum(["submit", "approve", "request_changes"]), feedback: z.string().trim().max(5000).default("") }),
  z.object({ action: z.literal("archive_task"), taskId: z.string().min(1) }),
]);

type ProfileRow = { id: string; name: string; role: "Admin" | "Manager" | "Senior Employee" | "Employee"; active: boolean };
type TaskStatus = "Not started" | "In progress" | "Completed";

function taskStatusFromRow(value: unknown): TaskStatus {
  if (value === "Completed" || value === "Complete") return "Completed";
  if (value === "In progress") return "In progress";
  return "Not started";
}

function isCompletedStatus(value: unknown) {
  return value === "Completed" || value === "Complete";
}

function userFromProfile(profile: ProfileRow) {
  return { id: profile.id, name: profile.name, email: "", role: profile.role, active: profile.active };
}
function projectFromRow(project: Record<string, unknown>) {
  return { id: project.id, name: project.name, description: project.description };
}
function taskFromRow(task: Record<string, unknown>) {
  const assigneeIds = Array.isArray(task.assignee_ids) && task.assignee_ids.length ? task.assignee_ids : [task.assignee_id];
  return { id: task.id, title: task.title, projectId: task.project_id, description: task.description, due: task.due, priority: task.priority, status: taskStatusFromRow(task.status), progress: task.progress, assigneeId: task.assignee_id, assigneeIds, createdById: task.created_by_id, parentId: task.parent_id, blockedById: task.blocked_by_id, milestone: task.milestone ?? false, milestoneDate: task.milestone_date, recurrence: task.recurrence ?? "none", createdAt: task.created_at, assignedAt: task.assigned_at, dueDate: task.due_date, startDate: task.start_date, completedAt: task.completed_at, archivedAt: task.archived_at, reviewEnabled: "review_state" in task, reviewState: task.review_state ?? "none", reviewNote: task.review_note ?? "", reviewedBy: task.reviewed_by, reviewedAt: task.reviewed_at };
}
function noteFromRow(note: Record<string, unknown>) {
  return { id: note.id, taskId: note.task_id, text: note.text, authorId: note.author_id, createdAt: note.created_at, readBy: note.read_by ?? [] };
}
function progressFromRow(log: Record<string, unknown>) {
  return { id: log.id, taskId: log.task_id, employeeId: log.employee_id, description: log.description, status: taskStatusFromRow(log.status), progress: log.progress, createdAt: log.created_at };
}
async function getContext() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) throw new Error("Supabase is not configured.");
  const client = await createSupabaseServerClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) throw new Error("Authentication required.");
  const { data: profile, error: profileError } = await client.from("profiles").select("id, name, role, active").eq("id", authData.user.id).single<ProfileRow>();
  if (profileError || !profile || !profile.active) throw new Error("Active profile required.");
  return { client, user: authData.user, profile };
}
function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function removeTaskAttachments(client: Awaited<ReturnType<typeof createSupabaseServerClient>>, taskIds: string[]) {
  for (const taskId of taskIds) {
    while (true) {
      const { data, error } = await client.storage.from("task-attachments").list(taskId, { limit: 100, offset: 0 });
      if (error || !data?.length) break;
      const paths = data.map(file => `${taskId}/${file.name}`);
      const { error: removeError } = await client.storage.from("task-attachments").remove(paths);
      if (removeError || data.length < 100) break;
    }
  }
}

export async function GET(request: Request) {
  try {
    const { client, user, profile } = await getContext();
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "activity") {
      const before = params.get("before");
      if (before && !/^\d+$/.test(before)) return fail("Invalid activity cursor.");
      let query = client.from("activity_events").select("*").order("id", { ascending: false }).limit(51);
      if (params.get("taskId")) query = query.eq("entity_type", "task").eq("entity_id", params.get("taskId")!);
      if (before) query = query.lt("id", before);
      const { data, error } = await query;
      if (error) return fail(error.code === "42P01" || error.code === "PGRST205" ? "Activity history needs its database migration applied." : "Unable to load activity history.", 503);
      const events = (data ?? []).slice(0, 50);
      return NextResponse.json({ events, nextCursor: (data?.length ?? 0) > 50 ? String(events.at(-1)!.id) : null }, { headers: { "Cache-Control": "no-store" } });
    }
    const [profiles, projects, tasks, notes, progressLogs] = await Promise.all([
      client.from("profiles").select("id, name, role, active").order("name"),
      client.from("projects").select("*").order("created_at", { ascending: false }),
      client.from("tasks").select("*").order("created_at", { ascending: true }),
      client.from("notes").select("*").order("created_at", { ascending: false }),
      client.from("progress_logs").select("*").order("created_at", { ascending: false }),
    ]);
    const queryError = [profiles, projects, tasks, notes, progressLogs].find((result) => result.error)?.error;
    if (queryError) return fail(queryError.message, 500);
    const emailById = new Map<string, string>();
    if (profile.role === "Admin" && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createSupabaseAdminClient();
      const { data: authUsers } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      (authUsers?.users ?? []).forEach((authUser) => {
        if (authUser.email) emailById.set(authUser.id, authUser.email);
      });
    }
    const users = (profiles.data ?? []).map((item) => ({ ...userFromProfile(item as ProfileRow), email: emailById.get(item.id) ?? (item.id === user.id ? user.email ?? "" : "") }));
    const activeTasks = (tasks.data ?? []).filter((task) => !task.archived_at);
    const archivedTasks = (tasks.data ?? []).filter((task) => Boolean(task.archived_at));
    const allProjects = (projects.data ?? []).map(projectFromRow);
    const archivedProjectIds = new Set(allProjects.filter(project => {
      const rows = (tasks.data ?? []).filter(task => task.project_id === project.id);
      return rows.length > 0 && rows.every(task => Boolean(task.archived_at));
    }).map(project => project.id));
    return NextResponse.json({ currentUser: { ...userFromProfile(profile), email: user.email ?? "" }, users, projects: allProjects.filter(project => !archivedProjectIds.has(String(project.id))), archivedProjects: allProjects.filter(project => archivedProjectIds.has(String(project.id))), tasks: activeTasks.map(taskFromRow), archivedTasks: archivedTasks.map(taskFromRow), notes: (notes.data ?? []).map(noteFromRow), progressLogs: (progressLogs.data ?? []).map(progressFromRow) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Unable to load workspace.", 401);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getContext();
    const body = actionSchema.safeParse(await request.json());
    if (!body.success) return fail("The submitted data is invalid.");
    const input = body.data;

    if (input.action === "invite_user") {
      if (context.profile.role !== "Admin") return fail("Only admins can invite users.", 403);
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("Configure the server service key to send invitations.", 503);
      const admin = createSupabaseAdminClient();
      const origin = process.env.APP_URL || "https://mellivo-task-manager.vercel.app";
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email.toLowerCase(), { data: { name: input.name }, redirectTo: `${origin}/auth/set-password` });
      if (error || !data.user) return fail(error?.message || "Unable to send invitation.");
      const { error: profileError } = await context.client.from("profiles").update({ name: input.name, role: input.role, active: true }).eq("id", data.user.id);
      if (profileError) return fail("Invitation sent, but the requested role could not be applied. Update the user role in User management.", 500);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "create_user") {
      if (context.profile.role !== "Admin") return fail("Only admins can create users.", 403);
      if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return fail("The server service key is not configured.", 500);
      const admin = createSupabaseAdminClient();
      const { data, error } = await admin.auth.admin.createUser({ email: input.email.toLowerCase(), password: input.password, email_confirm: true, user_metadata: { name: input.name } });
      if (error || !data.user) return fail(error?.message ?? "Unable to create user.");
      const { data: profile, error: profileError } = await admin.from("profiles").update({ name: input.name, role: input.role, active: true }).eq("id", data.user.id).select("id, name, role, active").single();
      if (profileError || !profile) {
        await admin.auth.admin.deleteUser(data.user.id);
        return fail(profileError?.message ?? "Unable to create profile.", 500);
      }
      return NextResponse.json({ user: { ...userFromProfile(profile as ProfileRow), email: input.email.toLowerCase() } });
    }

    if (input.action === "update_user") {
      if (context.profile.role !== "Admin") return fail("Only admins can update users.", 403);
      const changes = { ...(input.role ? { role: input.role } : {}), ...(typeof input.active === "boolean" ? { active: input.active } : {}) };
      const { error } = await context.client.from("profiles").update(changes).eq("id", input.userId);
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "update_profile") {
      const { error } = await context.client.from("profiles").update({ name: input.name }).eq("id", context.user.id);
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "create_project") {
      if (context.profile.role !== "Admin") return fail("Only admins can create projects.", 403);
      const { error } = await context.client.from("projects").insert({ id: `project-${crypto.randomUUID()}`, name: input.name, description: input.description || "A new project for your team." });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "delete_project") {
      if (context.profile.role !== "Admin") return fail("Only admins can remove projects.", 403);
      const { data: projectTasks, error: taskLookupError } = await context.client.from("tasks").select("id").eq("project_id", input.projectId);
      if (taskLookupError) return fail(taskLookupError.message, 500);
      const { data: activeProjectTask } = await context.client.from("tasks").select("id").eq("project_id", input.projectId).is("archived_at", null).limit(1).maybeSingle();
      if (activeProjectTask) return fail("Archive the project before removing it.");
      await removeTaskAttachments(context.client, (projectTasks ?? []).map(task => task.id));
      const { data, error } = await context.client.from("projects").delete().eq("id", input.projectId).select("id").single();
      if (error || !data) return fail(error?.message ?? "Project not found.", error?.code === "PGRST116" ? 404 : 400);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "archive_project") {
      if (context.profile.role !== "Admin") return fail("Only admins can archive projects.", 403);
      const { data: rows, error: lookupError } = await context.client.from("tasks").select("id").eq("project_id", input.projectId).is("archived_at", null);
      if (lookupError) return fail(lookupError.message, 500);
      if (!rows?.length) return fail("This project has no active tasks to archive.");
      const { data, error } = await context.client.from("tasks").update({ archived_at: new Date().toISOString() }).eq("project_id", input.projectId).is("archived_at", null).select("id");
      if (error) return fail(error.message);
      if (!data?.length) return fail("No project tasks were archived.");
      return NextResponse.json({ ok: true });
    }

    if (input.action === "restore_project") {
      if (context.profile.role !== "Admin") return fail("Only admins can restore projects.", 403);
      const { data, error } = await context.client.from("tasks").update({ archived_at: null }).eq("project_id", input.projectId).not("archived_at", "is", null).select("id");
      if (error) return fail(error.message);
      if (!data?.length) return fail("Archived project not found.", 404);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "create_task") {
      if (!["Admin", "Manager", "Senior Employee"].includes(context.profile.role)) return fail("You cannot create tasks.", 403);
      const assigneeIds = [...new Set(input.assigneeIds)];
      const { data: assignees } = await context.client.from("profiles").select("id, role, active").in("id", assigneeIds);
      if (assignees?.length !== assigneeIds.length || assignees.some((assignee) => !assignee.active)) return fail("Choose only active users.");
      const assignsOtherUsers = assigneeIds.some((id) => id !== context.user.id);
      const invalidOtherAssignee = assignees.some((assignee) => assignee.id !== context.user.id && !["Senior Employee", "Employee"].includes(assignee.role));
      if (invalidOtherAssignee) return fail("You may assign administrators and managers only to themselves.", 403);
      if (context.profile.role === "Employee" && assignsOtherUsers) return fail("Employees may assign tasks and subtasks only to themselves.", 403);
      if (input.parentId) {
        const { data: parent } = await context.client.from("tasks").select("project_id, assignee_id, assignee_ids, archived_at").eq("id", input.parentId).single();
        if (!parent || parent.archived_at || parent.project_id !== input.projectId) return fail("Invalid parent task.", 403);
        const parentAssignees = parent.assignee_ids?.length ? parent.assignee_ids : [parent.assignee_id];
        if (["Senior Employee", "Employee"].includes(context.profile.role) && !parentAssignees.includes(context.user.id)) return fail("You may add subtasks only to work assigned to you.", 403);
        if (context.profile.role === "Senior Employee" && assignsOtherUsers && assignees.some((assignee) => assignee.id !== context.user.id && assignee.role !== "Employee")) return fail("You may delegate only to employees.", 403);
      } else if (context.profile.role === "Senior Employee" && assignsOtherUsers) return fail("Senior employees must select an assigned parent task when delegating work.", 403);
      if (input.blockedById) {
        const { data: blocker } = await context.client.from("tasks").select("id, project_id, archived_at").eq("id", input.blockedById).single();
        if (!blocker || blocker.archived_at || blocker.project_id !== input.projectId) return fail("Choose an active dependency in the same project.");
      }
      if (input.dueDate < input.startDate) return fail("Due date must be on or after the start date.");
      const taskClient = context.client;
      const planningFields = input.blockedById || input.milestone || input.recurrence !== "none" ? { blocked_by_id: input.blockedById || null, milestone: input.milestone, milestone_date: input.milestone ? input.milestoneDate || input.dueDate : null, recurrence: input.recurrence } : {};
      const { error } = await taskClient.from("tasks").insert({ id: `task-${crypto.randomUUID()}`, title: input.title, description: input.description || "No description yet.", project_id: input.projectId, assignee_id: assigneeIds[0], assignee_ids: assigneeIds, created_by_id: context.user.id, parent_id: input.parentId || null, ...planningFields, priority: input.priority, due: input.dueDate, due_date: input.dueDate, start_date: input.startDate, status: "Not started", progress: 0 });
      if (error) return fail(error.code === "PGRST204" ? "Multiple assignees need the latest database migration applied." : error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "delete_task") {
      if (context.profile.role !== "Admin") return fail("Only admins can remove tasks.", 403);
      const { data: taskRows, error: tasksError } = await context.client.from("tasks").select("id, parent_id");
      if (tasksError) return fail(tasksError.message, 500);
      const rows = (taskRows ?? []) as Array<{ id: string; parent_id: string | null }>;
      const target = (taskRows ?? []).find(row => row.id === input.taskId) as { id: string; parent_id: string | null; archived_at?: string | null } | undefined;
      if (!target) return fail("Task not found.", 404);
      const { data: archivedTarget } = await context.client.from("tasks").select("id").eq("id", input.taskId).not("archived_at", "is", null).maybeSingle();
      if (!archivedTarget) return fail("Archive the task before removing it.");
      const removeIds = [input.taskId];
      for (let index = 0; index < removeIds.length; index += 1) {
        rows.filter(row => row.parent_id === removeIds[index]).forEach(child => removeIds.push(child.id));
      }
      await removeTaskAttachments(context.client, removeIds);
      const { error } = await context.client.from("tasks").delete().in("id", removeIds);
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true, removedTaskIds: removeIds });
    }

    if (input.action === "restore_task") {
      const { data, error } = await context.client.rpc("restore_task_tree", { target_task_id: input.taskId });
      if (error) return fail(error.message);
      if (!data?.length) return fail("Archived task not found.", 404);
      return NextResponse.json({ ok: true, restoredTaskIds: data });
    }

    if (input.action === "edit_task") {
      if (!["Admin", "Manager"].includes(context.profile.role)) return fail("Only admins and managers can edit assignments.", 403);
      if (input.dueDate < input.startDate) return fail("Due date must be on or after the start date.");
      const assigneeIds = [...new Set(input.assigneeIds)];
      const { data: assignees } = await context.client.from("profiles").select("id, role, active").in("id", assigneeIds);
      if (assignees?.length !== assigneeIds.length || assignees.some((assignee) => !assignee.active || (assignee.id !== context.user.id && !["Senior Employee", "Employee"].includes(assignee.role)))) return fail("Choose only active eligible users.");
      const { data: task } = await context.client.from("tasks").select("*").eq("id", input.taskId).single();
      if (!task || task.archived_at) return fail("Active task not found.", 404);
      if (task.review_state === "pending" || isCompletedStatus(task.status)) return fail("Request changes before editing submitted work, or create a follow-up task for completed work.");
      if (input.blockedById === input.taskId) return fail("A task cannot depend on itself.");
      if (input.blockedById) {
        const { data: blocker } = await context.client.from("tasks").select("id, project_id, archived_at").eq("id", input.blockedById).single();
        if (!blocker || blocker.archived_at || blocker.project_id !== task.project_id) return fail("Choose an active dependency in the same project.");
      }
      const planningFields = "blocked_by_id" in task || input.blockedById || input.milestone || input.recurrence !== "none" ? { blocked_by_id: input.blockedById || null, milestone: input.milestone, milestone_date: input.milestone ? input.milestoneDate || input.dueDate : null, recurrence: input.recurrence } : {};
      const previousAssignees = task.assignee_ids?.length ? task.assignee_ids : [task.assignee_id];
      const assignmentsChanged = previousAssignees.length !== assigneeIds.length || previousAssignees.some((id: string) => !assigneeIds.includes(id));
      const { data, error } = await context.client.from("tasks").update({ title: input.title, description: input.description, assignee_id: assigneeIds[0], assignee_ids: assigneeIds, ...planningFields, priority: input.priority, start_date: input.startDate, due_date: input.dueDate, due: input.dueDate, ...(assignmentsChanged ? { assigned_at: new Date().toISOString() } : {}) }).eq("id", input.taskId).is("archived_at", null).select("id").single();
      if (error || !data) return fail(error?.code === "PGRST204" ? "Multiple assignees need the latest database migration applied." : error?.message ?? "Unable to edit task.");
      return NextResponse.json({ ok: true });
    }

    if (input.action === "add_note") {
      const { data: task, error: taskError } = await context.client.from("tasks").select("assignee_id, assignee_ids, created_by_id").eq("id", input.taskId).single();
      if (taskError || !task) return fail("Task not found.", 404);
      const taskAssignees = task.assignee_ids?.length ? task.assignee_ids : [task.assignee_id];
      if (!["Admin", "Manager"].includes(context.profile.role) && !taskAssignees.includes(context.user.id) && !(context.profile.role === "Senior Employee" && task.created_by_id === context.user.id)) return fail("You cannot message this task.", 403);
      const { error } = await context.client.from("notes").insert({ id: `note-${crypto.randomUUID()}`, task_id: input.taskId, text: input.text, author_id: context.user.id, read_by: [context.user.id] });
      if (error) return fail(error.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "mark_messages_read") {
      const { error } = await context.client.rpc("mark_task_messages_read", { target_task_id: input.taskId });
      if (error) return fail(error.message, 403);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "save_employee_update") {
      if (!["Employee", "Senior Employee"].includes(context.profile.role)) return fail("Only employees can save daily updates.", 403);
      const { data: task, error: taskError } = await context.client.from("tasks").select("*").eq("id", input.taskId).single();
      const taskAssignees = task?.assignee_ids?.length ? task.assignee_ids : task ? [task.assignee_id] : [];
      if (taskError || !task || !taskAssignees.includes(context.user.id)) return fail("Task not found.", 404);
      const createdAt = new Date().toISOString();
      const completedAt = input.status === "Completed" ? task.completed_at ?? createdAt : null;
      const update = { status: input.status, progress: input.progress, completed_at: completedAt };
      const { error: updateError } = await context.client.from("tasks").update(update).eq("id", input.taskId);

      if (updateError) return fail(updateError.message);
      const log = { id: `progress-${crypto.randomUUID()}`, task_id: input.taskId, employee_id: context.user.id, description: input.description, status: input.status, progress: input.progress, created_at: createdAt };
      const { error: logError } = await context.client.from("progress_logs").insert(log);

      if (logError) return fail(logError.message);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "review_task") {
      const { error } = await context.client.rpc("review_task", { target_task_id: input.taskId, decision: input.decision, feedback: input.feedback });
      if (error) return fail(error.message, 403);
      return NextResponse.json({ ok: true });
    }

    if (input.action === "archive_task") {
      const { data: taskRows, error: tasksError } = await context.client.from("tasks").select("id, parent_id, status, archived_at, created_by_id");
      if (tasksError) return fail(tasksError.message, 500);
      const rows = (taskRows ?? []) as Array<{ id: string; parent_id: string | null; status: string; archived_at: string | null; created_by_id: string }>;
      const task = rows.find((row) => row.id === input.taskId);
      if (!task || task.archived_at) return fail("Task not found.", 404);
      if (!["Admin", "Manager"].includes(context.profile.role) && task.created_by_id !== context.user.id) return fail("Only the creator or an administrator can archive this task.", 403);
      const descendants: typeof rows = [];
      const collectDescendants = (parentId: string) => {
        rows.filter((row) => row.parent_id === parentId).forEach((child) => {
          descendants.push(child);
          collectDescendants(child.id);
        });
      };
      collectDescendants(task.id);
      const archiveIds = [task.id, ...descendants.map((child) => child.id)];
      const { data: archivedRows, error: archiveError } = await context.client.rpc("archive_task_tree", { target_task_id: input.taskId });
      if (archiveError) return fail(archiveError.code === "PGRST202" ? "Task archiving needs its database migration applied." : archiveError.message, archiveError.code === "PGRST202" ? 503 : 403);
      if (!archivedRows?.length) return fail("The task could not be archived.");
      return NextResponse.json({ ok: true, archivedTaskIds: archiveIds });
    }

    return fail("Unsupported action.");
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Request failed.", 500);
  }
}

