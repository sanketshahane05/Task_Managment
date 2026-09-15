"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import TaskDetailsPanel from "@/components/task-details-panel";
import NotificationCenter from "@/components/notification-center";
import { buildNotifications } from "@/lib/notifications";
import ActivityHistory from "@/components/activity-history";
import SavedFilters from "@/components/saved-filters";
import WorkOverview from "@/components/work-overview";
import { downloadCsv } from "@/lib/report-export";
import TaskAttachments from "@/components/task-attachments";
import ThemeToggle from "@/components/theme-toggle";
import DashboardCharts from "@/components/dashboard-charts";
import { isSupabaseConfigured, supabase } from "@/lib/supabase/browser";

type Role = "Admin" | "Manager" | "Senior Employee" | "Employee";
type TaskStatus = "Not started" | "In progress" | "Completed";
type Modal = "user" | "project" | "task" | null;

type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
};

type Project = {
  id: string;
  name: string;
  description: string;
};

type Task = {
  id: string;
  title: string;
  projectId: string;
  description: string;
  due: string;
  priority: "High" | "Medium" | "Low";
  status: TaskStatus;
  progress: number;
  assigneeId: string;
  createdById: string;
  parentId: string | null;
  createdAt?: string;
  assignedAt?: string;
  dueDate?: string;
  startDate?: string;
  completedAt?: string;
  archivedAt?: string;
  reviewEnabled?: boolean;
  reviewState?: "none" | "pending" | "changes_requested" | "approved";
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

type Note = {
  id: string;
  taskId: string;
  text: string;
  authorId: string;
  createdAt: string;
  readBy?: string[];
};

type ProgressLog = {
  id: string;
  taskId: string;
  employeeId: string;
  description: string;
  status: TaskStatus;
  progress: number;
  createdAt: string;
};

const isWorker = (role?: Role) => role === "Senior Employee" || role === "Employee";
const ARCHIVE_PAGE_SIZE = 10;
const localDateInput = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};

const formatReportDateInput = (date: Date) => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
};

const parseReportDateInput = (value: string, endOfDay = false) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const date = new Date(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  );
  return date.getFullYear() === Number(yearText)
    && date.getMonth() === Number(monthText) - 1
    && date.getDate() === Number(dayText)
    ? date
    : null;
};

export default function Home() {
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [archivePage, setArchivePage] = useState(1);
  const [archiveCollapsed, setArchiveCollapsed] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [progressLogs, setProgressLogs] = useState<ProgressLog[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(() => !isSupabaseConfigured);
  const [now, setNow] = useState(() => Date.now());
  const [taskFilters, setTaskFilters] = useState({ search: "", project: "", status: "", priority: "", assignee: "", due: "" });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [activeSection, setActiveSection] = useState("dashboard");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [invitingUser, setInvitingUser] = useState(false);
  const [newUserRole, setNewUserRole] = useState<Role>("Employee");

  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDescription, setNewProjectDescription] = useState("");

  const [reviewFeedback, setReviewFeedback] = useState<Record<string, string>>({});
  const [reviewBusy, setReviewBusy] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskFormError, setTaskFormError] = useState("");
  const [savingTask, setSavingTask] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDescription, setNewTaskDescription] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskAssigneeId, setNewTaskAssigneeId] = useState("");
  const [newTaskStart, setNewTaskStart] = useState(localDateInput);
  const [newTaskDue, setNewTaskDue] = useState(localDateInput);
  const [newTaskPriority, setNewTaskPriority] = useState<Task["priority"]>(
    "Medium",
  );
  const [newTaskParentId, setNewTaskParentId] = useState("");

  const [noteTaskId, setNoteTaskId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatProjectId, setChatProjectId] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [chatError, setChatError] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [noteText, setNoteText] = useState("");
  const [reportPeriod, setReportPeriod] = useState<"Daily" | "Weekly" | "Monthly" | "Custom">("Daily");
  const [customReportStart, setCustomReportStart] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return formatReportDateInput(date);
  });
  const [customReportEnd, setCustomReportEnd] = useState(() => formatReportDateInput(new Date()));
  const [profileName, setProfileName] = useState("");
  const [profilePassword, setProfilePassword] = useState("");
  const [profilePasswordConfirm, setProfilePasswordConfirm] = useState("");
  const [employeeEdits, setEmployeeEdits] = useState<
    Record<string, { description: string; status: TaskStatus; progress: number }>
  >({});

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [chatOpen, noteTaskId, notes.length]);

  const apiRequest = async (action: string, payload: Record<string, unknown> = {}) => {
    const response = await fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "The request could not be completed.");
    return result;
  };

  const loadWorkspace = useCallback(async () => {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error ?? "Unable to load workspace.");
    setUsers(data.users ?? []);
    setProjects(data.projects ?? []);
    setArchivedProjects(data.archivedProjects ?? []);
    setTasks(data.tasks ?? []);
    setArchivedTasks(data.archivedTasks ?? []);
    setNotes(data.notes ?? []);
    setProgressLogs(data.progressLogs ?? []);
    setCurrentUserId(data.currentUser?.id ?? null);
    setProfileName(data.currentUser?.name ?? "");
  }, []);

  useEffect(() => {
    const client = supabase;
    if (!isSupabaseConfigured || !client) {
      return;
    }
    let active = true;
    const bootstrap = async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (session && active) await loadWorkspace();
      } catch (error) {
        if (active) setNotice(error instanceof Error ? error.message : "Unable to load workspace.");
      } finally {
        if (active) setHydrated(true);
      }
    };
    void bootstrap();
    const { data: authListener } = client.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setChatOpen(false);
        setNoteTaskId(null);
        setActiveSection("dashboard");
        setCurrentUserId(null);
        setUsers([]);
        setProjects([]);
        setTasks([]);
        setNotes([]);
        setProgressLogs([]);
      }
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [loadWorkspace]);

  useEffect(() => {
    const client = supabase;
    if (!currentUserId || !client) return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        await loadWorkspace();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Unable to refresh workspace.");
      } finally {
        refreshing = false;
      }
    };
    const interval = window.setInterval(() => { void refresh(); }, 5000);
    window.addEventListener("focus", refresh);
    const channel = client
      .channel(`workspace-updates-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "progress_logs" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, refresh)
      .subscribe();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void client.removeChannel(channel);
    };
  }, [currentUserId, loadWorkspace]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const currentUser = users.find((user) => user.id === currentUserId) ?? null;
  const employees = users.filter((user) => user.active && (currentUser?.role === "Senior Employee" ? user.role === "Employee" : isWorker(user.role)));
  const visibleTasks = useMemo(() => {
    if (!currentUser || !isWorker(currentUser.role)) return tasks;

    const visibleIds = new Set(
      tasks
        .filter((task) => task.assigneeId === currentUser.id || (currentUser.role === "Senior Employee" && task.createdById === currentUser.id))
        .map((task) => task.id),
    );

    let addedParent = true;
    while (addedParent) {
      addedParent = false;
      tasks.forEach((task) => {
        if (visibleIds.has(task.id) && task.parentId && !visibleIds.has(task.parentId)) {
          visibleIds.add(task.parentId);
          addedParent = true;
        }
      });
    }

    return tasks.filter((task) => visibleIds.has(task.id));
  }, [currentUser, tasks]);
  const completedCount = visibleTasks.filter((task) => task.status === "Completed").length;
  const pendingCount = visibleTasks.length - completedCount;
  const averageProgress = visibleTasks.length
    ? Math.round(visibleTasks.reduce((sum, task) => sum + task.progress, 0) / visibleTasks.length)
    : 0;

  const getUserName = (id: string) =>
    users.find((user) => user.id === id)?.name ?? "Unassigned";
  const getProjectName = (id: string) =>
    [...projects, ...archivedProjects].find((project) => project.id === id)?.name ?? "Unknown project";
  const getProjectStatus = (projectId: string): TaskStatus => {
    const projectTasks = visibleTasks.filter((task) => task.projectId === projectId);
    if (projectTasks.length === 0) return "Not started";
    if (projectTasks.every((task) => task.status === "Completed")) return "Completed";
    if (projectTasks.some((task) => task.status === "In progress" || task.progress > 0)) {
      return "In progress";
    }
    return "Not started";
  };
  const projectStatusClass = (status: TaskStatus) => {
    if (status === "Completed") return "bg-emerald-50 text-emerald-700";
    if (status === "In progress") return "bg-indigo-50 text-indigo-700";
    return "bg-slate-100 text-slate-600";
  };

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return "Not recorded";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  };
  const formatDateOnly = (dateValue?: string) => {
    if (!dateValue) return "Not recorded";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(dateValue)
      ? new Date(`${dateValue}T00:00:00`)
      : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return dateValue;
    return date.toLocaleDateString("en-IN", { dateStyle: "medium" });
  };
  const getAssignedAt = (task: Task) => task.assignedAt ?? task.createdAt;
  const getTaskDaysFromAssignment = (task: Task) => {
    const assignedAt = Date.parse(getAssignedAt(task) ?? "");
    if (Number.isNaN(assignedAt)) return "Not recorded";
    const endAt = task.completedAt ? Date.parse(task.completedAt) : now;
    if (Number.isNaN(endAt)) return "Not recorded";
    return `${Math.max(0, Math.ceil((endAt - assignedAt) / (24 * 60 * 60 * 1000)))} days`;
  };

  const isNewMessage = (note: Note) => {
    if (!currentUser || note.authorId === currentUser.id) return false;
    if (note.readBy?.includes(currentUser.id)) return false;
    return true;
  };

  const markMessagesRead = (taskId: string) => {
    if (!currentUser) return;
    void apiRequest("mark_messages_read", { taskId }).then(() => {
      setNotes((current) => current.map((note) => note.taskId === taskId
        ? { ...note, readBy: Array.from(new Set([...(note.readBy ?? []), currentUser.id])) }
        : note));
    }).catch((error) => {
      setChatError(error instanceof Error ? error.message : "Unable to update message status.");
    });
  };

  const toggleMessages = (taskId: string) => {
    setSelectedTaskId(null);
    markMessagesRead(taskId);
    setNoteTaskId(taskId);
    setChatProjectId(tasks.find((task) => task.id === taskId)?.projectId ?? "");
    setChatOpen(true);
    setNoteText("");
    setChatError("");
  };

  const latestTaskCreatedTime = (task: Task, allTasks: Task[]): number => {
    const ownTime = Date.parse(task.createdAt ?? "");
    const childTimes = allTasks
      .filter((child) => child.parentId === task.id)
      .map((child) => latestTaskCreatedTime(child, allTasks));
    return Math.max(Number.isNaN(ownTime) ? Number.NEGATIVE_INFINITY : ownTime, ...childTimes);
  };

  const sortTasksNewestFirst = (items: Task[], considerSubtasks = false) =>
    [...items].sort((first, second) => {
      const firstTime = considerSubtasks ? latestTaskCreatedTime(first, visibleTasks) : Date.parse(first.createdAt ?? "");
      const secondTime = considerSubtasks ? latestTaskCreatedTime(second, visibleTasks) : Date.parse(second.createdAt ?? "");
      if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) {
        return (second.createdAt ?? "").localeCompare(first.createdAt ?? "") || first.title.localeCompare(second.title);
      }
      return secondTime - firstTime || first.title.localeCompare(second.title);
    });

  const sectionTarget = (item: string) => {
    const targets: Record<string, string> = {
      Dashboard: "dashboard",
      "User management": "user-management",
      "Team tasks": "tasks",
      "My daily updates": "tasks",
      Projects: "projects",
      Archive: "archive",
      Chats: "chats",
      Notifications: "notifications",
      Activity: "activity",
      "My Work": "my-work",
      Workload: "workload",

      "My profile": "profile",
    };
    return targets[item] ?? "dashboard";
  };

  const navigateTo = (item: string) => {
    if (item === "Chats") { setChatOpen(true); return; }
    setActiveSection(sectionTarget(item));
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const openTaskFromOverview = (taskId: string) => {
    setChatOpen(false);
    setActiveSection("tasks");
    setSelectedTaskId(taskId);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const openProjectTasks = (projectId: string) => {
    setTaskFilters({ search: "", project: projectId, status: "", priority: "", assignee: "", due: "" });
    setSelectedTaskId(null);
    setChatOpen(false);
    navigateTo("My daily updates");
  };

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setLoginError("Production authentication is not configured yet.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail.trim(), password: loginPassword });
    if (error) {
      setLoginError("Invalid credentials or inactive user.");
      return;
    }
    try {
      await loadWorkspace();
      setLoginError("");
    } catch (error) {
      await supabase.auth.signOut();
      setLoginError(error instanceof Error ? error.message : "Unable to load workspace.");
    }
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim() || invitingUser) return;
    try {
      setInvitingUser(true);
      await apiRequest("invite_user", { name: newUserName, email: newUserEmail, role: newUserRole });
      await loadWorkspace();
      setNewUserName("");
      setNewUserEmail("");

      setNewUserRole("Employee");
      setModal(null);
      setNotice("Invitation sent. The user will choose their own password.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to invite user.");
    } finally { setInvitingUser(false); }
  };

  const updateUserRole = async (userId: string, role: Role) => {
    try {
      await apiRequest("update_user", { userId, role });
      await loadWorkspace();
      setNotice("User role updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update user role.");
    }
  };

  const updateOwnProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || !supabase) return;
    const nextName = profileName.trim();
    if (!nextName) {
      setNotice("Your name cannot be empty.");
      return;
    }
    if (profilePassword && profilePassword.length < 6) {
      setNotice("Your new password must be at least 6 characters.");
      return;
    }
    if (profilePassword !== profilePasswordConfirm) {
      setNotice("The password confirmation does not match.");
      return;
    }

    try {
      if (profilePassword) {
        const { error } = await supabase.auth.updateUser({ password: profilePassword });
        if (error) throw error;
      }
      await apiRequest("update_profile", { name: nextName });
      await loadWorkspace();
      setProfilePassword("");
      setProfilePasswordConfirm("");
      setNotice(profilePassword ? "Name and password updated." : "Name updated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update profile.");
    }
  };

  const toggleUser = async (userId: string) => {
    const user = users.find((item) => item.id === userId);
    if (!user) return;
    try {
      await apiRequest("update_user", { userId, active: !user.active });
      await loadWorkspace();
      setNotice(user.active ? "User deactivated." : "User activated.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update user status.");
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProjectName.trim()) return;
    try {
      await apiRequest("create_project", { name: newProjectName, description: newProjectDescription });
      await loadWorkspace();
      setNewProjectName("");
      setNewProjectDescription("");
      setModal(null);
      setNotice("Project created successfully.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to create project.");
    }
  };

  const openTaskForm = (parent?: Task) => {
    setSelectedTaskId(null);
    const today = localDateInput();
    setEditingTaskId(null);
    setTaskFormError("");
    setNewTaskTitle("");
    setNewTaskDescription("");
    setNewTaskParentId(parent?.id ?? "");
    setNewTaskProjectId(parent?.projectId ?? projects[0]?.id ?? "");
    setNewTaskAssigneeId(parent && employees.some((user) => user.id === parent.assigneeId) ? parent.assigneeId : employees[0]?.id ?? "");
    setNewTaskPriority(parent?.priority ?? "Medium");
    setNewTaskStart(today);
    setNewTaskDue(parent?.dueDate && parent.dueDate >= today ? parent.dueDate : today);
    setModal("task");
  };

  const openEditTask = (task: Task) => {
    setSelectedTaskId(null);
    setEditingTaskId(task.id);
    setTaskFormError("");
    setNewTaskTitle(task.title);
    setNewTaskDescription(task.description);
    setNewTaskParentId(task.parentId ?? "");
    setNewTaskProjectId(task.projectId);
    setNewTaskAssigneeId(task.assigneeId);
    setNewTaskPriority(task.priority);
    setNewTaskStart(task.startDate ?? task.assignedAt?.slice(0, 10) ?? localDateInput());
    setNewTaskDue(task.dueDate ?? localDateInput());
    setModal("task");
  };

  const createTask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentUser || savingTask || !newTaskTitle.trim()) return;
    setTaskFormError("");

    const projectId = newTaskProjectId || projects[0]?.id;
    const assigneeId = newTaskAssigneeId || employees[0]?.id;
    if (!projectId || !assigneeId) {
      setTaskFormError("Create an employee and project before adding a task.");
      return;
    }

    if (!newTaskStart || !newTaskDue || newTaskDue < newTaskStart) {
      setTaskFormError("Due date must be on or after the start date.");
      return;
    }

    const parentTask = tasks.find((task) => task.id === newTaskParentId);
    const parentId = parentTask?.projectId === projectId ? parentTask.id : null;
    if (currentUser.role === "Senior Employee" && (!parentTask || parentTask.assigneeId !== currentUser.id || !parentId)) { setNotice("Select one of your assigned tasks as the parent."); return; }

    setSavingTask(true);
    try {
      await apiRequest(editingTaskId ? "edit_task" : "create_task", { ...(editingTaskId ? { taskId: editingTaskId } : {}), title: newTaskTitle, description: newTaskDescription, projectId, assigneeId, parentId, priority: newTaskPriority, dueDate: newTaskDue, startDate: newTaskStart });
      await loadWorkspace();
      setNewTaskTitle("");
      setNewTaskDescription("");
      setNewTaskParentId("");
      setModal(null);
      setNotice(editingTaskId ? "Task changes saved." : "Task created and assigned.");
      setEditingTaskId(null);
    } catch (error) {
      setTaskFormError(error instanceof Error ? error.message : "Unable to save task.");
    } finally { setSavingTask(false); }
  };

  const addNote = async (taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    const canAddNote = currentUser?.role === "Manager" ||
      (isWorker(currentUser?.role) && task?.assigneeId === currentUser?.id) || (currentUser?.role === "Senior Employee" && task?.createdById === currentUser.id);
    if (!currentUser || !canAddNote || !noteText.trim() || sendingMessage) return;
    setSendingMessage(true);
    setChatError("");
    try {
      await apiRequest("add_note", { taskId, text: noteText });
      await loadWorkspace();
      setNoteText("");
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setSendingMessage(false);
    }
  };

  const getEmployeeEdit = (task: Task) =>
    employeeEdits[task.id] ?? {
      description: "",
      status: task.status,
      progress: task.progress,
    };

  const updateEmployeeEdit = (
    task: Task,
    changes: Partial<{ description: string; status: TaskStatus; progress: number }>,
  ) => {
    setEmployeeEdits((current) => ({
      ...current,
      [task.id]: { ...getEmployeeEdit(task), ...changes },
    }));
  };

  const saveEmployeeUpdate = async (task: Task) => {
    if (!currentUser || !isWorker(currentUser.role)) return;
    const edit = getEmployeeEdit(task);
    const progress = Math.min(100, Math.max(0, edit.progress));
    try {
      await apiRequest("save_employee_update", { taskId: task.id, description: edit.description, status: edit.status, progress });
      await loadWorkspace();
      setEmployeeEdits((current) => { const next = { ...current }; delete next[task.id]; return next; });
      setNotice("Daily task update saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save daily update.");
    }
  };

  const getTaskDescendants = (taskId: string, source: Task[] = tasks) => {
    const descendants: Task[] = [];
    const collect = (parentId: string) => {
      source.filter((task) => task.parentId === parentId).forEach((child) => {
        descendants.push(child);
        collect(child.id);
      });
    };
    collect(taskId);
    return descendants;
  };

  const canArchiveTask = (task: Task) => {
    return Boolean(currentUser && (["Admin", "Manager"].includes(currentUser.role) || task.createdById === currentUser.id));
  };

  const archiveTask = async (task: Task) => {
    if (!canArchiveTask(task)) {
      setNotice("Only the creator, a manager, or an administrator can archive this task.");
      return;
    }
    const descendants = getTaskDescendants(task.id);
    const detail = descendants.length ? ` and ${descendants.length} descendant subtask${descendants.length === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Archive “${task.title}”${detail}?`)) return;
    try {
      await apiRequest("archive_task", { taskId: task.id });
      await loadWorkspace();
      setNotice("Task moved to Archive.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to archive task.");
    }
  };

  const deleteTask = async (task: Task) => {
    if (currentUser?.role !== "Admin") return;
    const descendants = getTaskDescendants(task.id);
    const detail = descendants.length ? ` and ${descendants.length} subtask${descendants.length === 1 ? "" : "s"}` : "";
    if (!window.confirm(`Permanently remove “${task.title}”${detail}? Messages, updates, attachments, and history linked to this work will also be removed.`)) return;
    try {
      await apiRequest("delete_task", { taskId: task.id });
      setSelectedTaskId(null);
      await loadWorkspace();
      setNotice("Task and linked records removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove task.");
    }
  };

  const deleteProject = async (project: Project) => {
    if (currentUser?.role !== "Admin") return;
    const projectTaskCount = tasks.filter(task => task.projectId === project.id).length;
    const detail = projectTaskCount ? ` It contains ${projectTaskCount} task${projectTaskCount === 1 ? "" : "s"}, which will also be permanently removed.` : "";
    if (!window.confirm(`Permanently remove project “${project.name}”?${detail}`)) return;
    try {
      await apiRequest("delete_project", { projectId: project.id });
      await loadWorkspace();
      setNotice("Project and linked work removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to remove project.");
    }
  };

  const archiveProject = async (project: Project) => {
    if (currentUser?.role !== "Admin") return;
    const count = tasks.filter(task => task.projectId === project.id).length;
    if (!window.confirm(`Archive project “${project.name}” and its ${count} active task${count === 1 ? "" : "s"}?`)) return;
    try {
      await apiRequest("archive_project", { projectId: project.id });
      await loadWorkspace();
      setNotice("Project and its work moved to Archive.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to archive project.");
    }
  };

  const reviewTask = async (taskId: string, decision: "submit" | "approve" | "request_changes") => {
    if (reviewBusy) return;
    setReviewBusy(taskId);
    try {
      await apiRequest("review_task", { taskId, decision, feedback: reviewFeedback[taskId] ?? "" });
      await loadWorkspace();
      setEmployeeEdits((current) => { const next = { ...current }; delete next[taskId]; return next; });
      setNotice(decision === "submit" ? "Task submitted for review." : decision === "approve" ? "Task approved and completed." : "Changes requested.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to update review."); }
    finally { setReviewBusy(null); }
  };

  const renderUpdateHistory = (taskId: string) => {
    const updates = progressLogs.filter((log) => log.taskId === taskId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const latest = updates[0];
    if (!latest) return <p className="mt-4 text-xs text-slate-400">No daily updates yet.</p>;
    return (
      <details className="group mt-4 rounded-xl border border-slate-200 bg-slate-50">
        <summary className="cursor-pointer rounded-xl p-4 marker:text-indigo-600">
          <span className="text-xs font-bold uppercase tracking-wide text-indigo-700">Latest update</span>
          <span className="ml-3 text-xs text-slate-500">{formatTimestamp(latest.createdAt)} · {getUserName(latest.employeeId)}</span>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{latest.description || "Status and progress updated."}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs"><span className="font-semibold text-slate-600">{latest.status} · {latest.progress}%</span><span className="font-semibold text-indigo-600 group-open:hidden">Show all updates ({updates.length})</span><span className="hidden font-semibold text-indigo-600 group-open:inline">Hide history</span></div>
        </summary>
        <ol aria-label="Daily update history, newest first" className="divide-y divide-slate-100 border-t border-slate-200 bg-white px-4">
          {updates.map((log) => <li key={log.id} className="grid gap-2 py-4 sm:grid-cols-[180px_1fr]">
            <div><time dateTime={log.createdAt} className="text-xs font-semibold text-slate-600">{formatTimestamp(log.createdAt)}</time><p className="mt-1 text-xs text-slate-500">{getUserName(log.employeeId)}</p></div>
            <div className="min-w-0"><p className="whitespace-pre-wrap break-words text-sm text-slate-800">{log.description || "Status and progress updated."}</p><p className="mt-2 text-xs font-semibold text-indigo-600">{log.status} · {log.progress}%</p></div>
          </li>)}
        </ol>
      </details>
    );
  };

  const renderTask = (task: Task, depth = 0, detailed = false): React.ReactNode => {
    const children = sortTasksNewestFirst(boardTasks.filter((child) => child.parentId === task.id));
    const canEditTask = isWorker(currentUser?.role) && task.assigneeId === currentUser?.id;
    const canReview = currentUser && (["Admin", "Manager"].includes(currentUser.role) || (currentUser.role === "Senior Employee" && task.createdById === currentUser.id && task.assigneeId !== currentUser.id));
    const edit = canEditTask ? getEmployeeEdit(task) : null;
    const taskNotes = notes.filter((note) => note.taskId === task.id);
    const canAddSubtask = (["Admin", "Manager"].includes(currentUser?.role ?? "") && !task.parentId) || (currentUser?.role === "Senior Employee" && task.assigneeId === currentUser.id);
    const canManage = ["Admin", "Manager"].includes(currentUser?.role ?? "");
    const unreadCount = taskNotes.filter(isNewMessage).length;
    const openDetails = () => { setChatOpen(false); setSelectedTaskId(task.id); };
    if (!detailed) return (
      <div key={task.id} className={depth ? "ml-2 border-l-2 border-indigo-100 pl-3 sm:ml-5" : ""}>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <button onClick={openDetails} className="min-w-0 flex-1 break-words text-left text-base font-bold leading-relaxed text-slate-900 hover:text-indigo-600">{task.title}</button>
            {(canAddSubtask || canManage || canArchiveTask(task)) && <details className="relative shrink-0" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) event.currentTarget.open = false; }}><summary aria-label={"Actions for " + task.title} className="cursor-pointer list-none rounded-lg px-3 py-1 text-lg font-bold text-slate-500 hover:bg-slate-100">⋯</summary><div className="absolute right-0 z-10 mt-1 w-44 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">{canAddSubtask && <button onClick={() => openTaskForm(task)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">Add subtask</button>}{canManage && <button onClick={() => openEditTask(task)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100">Edit / reassign</button>}{canArchiveTask(task) && <button onClick={() => archiveTask(task)} className="block w-full rounded-lg px-3 py-2 text-left text-sm text-amber-700 hover:bg-slate-100">Archive</button>}</div></details>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-indigo-50 px-2 py-1 font-semibold text-indigo-700">{task.status}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{task.priority}</span>{task.reviewState && task.reviewState !== "none" && <button onClick={openDetails} className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">{task.reviewState === "pending" ? "Awaiting review" : task.reviewState === "changes_requested" ? "Changes requested" : "Approved"}</button>}</div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500"><span>{getUserName(task.assigneeId)}</span><span>Due {task.dueDate ? formatDateOnly(task.dueDate) : task.due}</span><span className="flex items-center gap-2"><span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-indigo-600" style={{width: task.progress + "%"}} /></span><span className="font-semibold text-indigo-600">{task.progress}%</span></span></div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-indigo-600"><button onClick={openDetails}>View details</button>{children.length > 0 && <button aria-expanded={Boolean(expandedTasks[task.id])} onClick={() => setExpandedTasks((current) => ({...current,[task.id]: !current[task.id]}))}>{expandedTasks[task.id] ? "▾" : "▸"} {children.length} subtasks</button>}<button onClick={() => toggleMessages(task.id)}>{unreadCount ? unreadCount + " unread messages" : "Chat · " + taskNotes.length}</button></div>
        </article>
        {children.length > 0 && expandedTasks[task.id] && <div className="mt-3 space-y-3">{children.map((child) => renderTask(child, depth + 1))}</div>}
      </div>
    );


    return (
      <div key={task.id} className={depth ? "ml-2 border-l-2 border-indigo-100 pl-3 sm:ml-5" : ""}>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="w-full break-words text-lg font-semibold leading-relaxed text-slate-900">{task.title}</h4>
                <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">
                  {task.status}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                  {task.priority}
                </span>
                <span className="rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-700">
                  {task.parentId ? "Subtask" : "Task"}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-500">{task.description}</p>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Project: {getProjectName(task.projectId)}</span>
                <span>Start: {task.startDate ? formatDateOnly(task.startDate) : formatDateOnly(task.assignedAt)}</span>
                <span>Due: {task.dueDate ? formatDateOnly(task.dueDate) : task.due}</span>
                <span>Assigned to: <strong className="font-semibold text-slate-600">{getUserName(task.assigneeId)}</strong></span>
                <span>Assigned by: <strong className="font-semibold text-slate-600">{getUserName(task.createdById)}</strong></span>
              </div>
            </div>
            <div className="w-full shrink-0 lg:w-32 lg:text-right">
              <p className="text-sm font-semibold text-indigo-600">{task.progress}%</p>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div
                  className="h-2 rounded-full bg-indigo-600"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
            <button onClick={() => toggleMessages(task.id)} className={taskNotes.some(isNewMessage) ? "rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white" : "rounded-lg bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700"}>
              {taskNotes.some(isNewMessage) ? "New messages" : "Open chat"} · {taskNotes.length}
            </button>
            {(((["Admin", "Manager"].includes(currentUser?.role ?? "")) && !task.parentId) || (currentUser?.role === "Senior Employee" && task.assigneeId === currentUser.id)) && <button type="button" onClick={() => openTaskForm(task)} className="rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">+ Subtask</button>}
            {["Admin", "Manager"].includes(currentUser?.role ?? "") && <button type="button" onClick={() => openEditTask(task)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Edit / reassign</button>}
            {canArchiveTask(task) && <button onClick={() => archiveTask(task)} className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">Archive task</button>}
            <details className="text-xs text-slate-500"><summary className="cursor-pointer font-medium">Timeline</summary><div className="mt-2 flex flex-wrap gap-3"><span>Assigned: {formatDateOnly(getAssignedAt(task))}</span><span>Created: {formatTimestamp(task.createdAt)}</span><span>Elapsed: {getTaskDaysFromAssignment(task)}</span><span>Completed: {formatTimestamp(task.completedAt)}</span></div></details>
          </div>

          {task.reviewState && task.reviewState !== "none" && <div className="mt-4 rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-sm text-indigo-700"><p className="font-semibold">{task.reviewState === "pending" ? "Awaiting review" : task.reviewState === "approved" ? "Approved" : "Changes requested"}</p>{task.reviewNote && <p className="mt-1 whitespace-pre-wrap break-words">{task.reviewNote}</p>}{task.reviewedBy && <p className="mt-1 text-xs">{getUserName(task.reviewedBy)} · {formatTimestamp(task.reviewedAt)}</p>}</div>}
          {task.reviewEnabled && canEditTask && task.status !== "Completed" && task.reviewState !== "pending" && <button disabled={Boolean(reviewBusy)} onClick={() => reviewTask(task.id, "submit")} className="mt-4 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Submit for review</button>}
          {canReview && task.reviewState === "pending" && <div className="mt-4 space-y-2"><label className="block text-sm font-semibold text-slate-600">Review feedback<textarea maxLength={5000} value={reviewFeedback[task.id] ?? ""} onChange={(event) => setReviewFeedback((current) => ({ ...current, [task.id]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm" placeholder="Explain any changes needed" /></label><div className="flex gap-2"><button disabled={Boolean(reviewBusy)} onClick={() => reviewTask(task.id, "approve")} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Approve</button><button disabled={Boolean(reviewBusy) || !reviewFeedback[task.id]?.trim()} onClick={() => reviewTask(task.id, "request_changes")} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40">Request changes</button></div></div>}
          {renderUpdateHistory(task.id)}

          {canEditTask && edit && task.status !== "Completed" && task.reviewState !== "pending" && (
            <div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-3">
              <label className="block text-sm font-semibold text-slate-700 md:col-span-2">Today’s update
              <span className="mt-1 block text-xs font-normal text-slate-500">Describe what you worked on, results, or blockers. The task description stays unchanged.</span>
              <textarea
                value={edit.description}
                onChange={(event) => updateEmployeeEdit(task, { description: event.target.value })}
                rows={2}
                className="mt-2 w-full rounded-lg border px-3 py-2 text-sm font-normal outline-none focus:border-indigo-500"
                placeholder="For example: Finished extraction; testing the JSON output."
                maxLength={5000}
              />
              </label>
              <div className="space-y-2">
                <select
                  aria-label="Task status"
                  value={edit.status}
                  onChange={(event) => updateEmployeeEdit(task, { status: event.target.value as TaskStatus })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option>Not started</option>
                  <option>In progress</option>
                  {!task.reviewEnabled && <option>Completed</option>}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Task progress"
                    type="range"
                    min="0"
                    max="100"
                    value={edit.progress}
                    onChange={(event) => updateEmployeeEdit(task, { progress: Number(event.target.value) })}
                    className="w-full accent-indigo-600"
                  />
                  <span className="w-10 text-right text-sm font-semibold">{edit.progress}%</span>
                </div>
                <button
                  onClick={() => saveEmployeeUpdate(task)}
                  className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                >
                  Save daily update
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    );
  };

  const renderArchivedTask = (task: Task, depth = 0): React.ReactNode => {
    return (
      <div key={task.id} className={depth ? "ml-6 border-l-2 border-amber-200 pl-4" : ""}>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">{task.title}</p>
              <p className="mt-1 text-xs font-medium text-amber-700">{task.parentId ? "Archived subtask" : "Archived task"} · {getProjectName(task.projectId)}</p>
              <p className="mt-2 text-sm text-slate-600">{task.description}</p>
            </div>
            <div className="flex items-center gap-2"><span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">Archived</span>{currentUser?.role === "Admin" && <button onClick={() => deleteTask(task)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Remove permanently</button>}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Assigned to: <strong className="font-semibold text-slate-700">{getUserName(task.assigneeId)}</strong></span>
            <span>Created: {formatTimestamp(task.createdAt)}</span>
            <span>Archived: {formatTimestamp(task.archivedAt)}</span>
          </div>
        </div>
      </div>
    );
  };

  const archivedTaskRows: Array<{ task: Task; depth: number }> = [];
  const appendArchivedTaskRows = (task: Task, depth: number) => {
    archivedTaskRows.push({ task, depth });
    sortTasksNewestFirst(archivedTasks.filter((child) => child.parentId === task.id))
      .forEach((child) => appendArchivedTaskRows(child, depth + 1));
  };
  sortTasksNewestFirst(archivedTasks.filter((task) => !task.parentId))
    .forEach((task) => appendArchivedTaskRows(task, 0));
  const archivePageCount = Math.max(1, Math.ceil(archivedTaskRows.length / ARCHIVE_PAGE_SIZE));
  const safeArchivePage = Math.min(archivePage, archivePageCount);
  const archivePageRows = archivedTaskRows.slice(
    (safeArchivePage - 1) * ARCHIVE_PAGE_SIZE,
    safeArchivePage * ARCHIVE_PAGE_SIZE,
  );

  if (!hydrated) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Loading Task Management...</main>;
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-white">
        <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white p-8 text-slate-900 shadow-2xl">
          <div className="flex items-center gap-3">
            <img src="/mellivo-logo.png" alt="Mellivo logo" className="h-12 w-12 rounded-2xl border border-slate-200 bg-white object-contain p-1" />
            <div><p className="font-bold tracking-[0.18em]">MELLIVO</p><p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Task Management</p></div>
          </div>
          <h1 className="mt-8 text-2xl font-bold">Production setup required</h1>
          <p className="mt-3 leading-6 text-slate-600">Connect this deployment to Supabase before inviting real users. Add the public project URL and publishable key as Vercel environment variables, then redeploy.</p>
          <div className="mt-5 rounded-xl bg-slate-950 p-4 font-mono text-sm text-indigo-100">NEXT_PUBLIC_SUPABASE_URL<br />NEXT_PUBLIC_SUPABASE_ANON_KEY</div>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-indigo-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl shadow-indigo-950/30 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-600 via-indigo-700 to-slate-950 p-10 text-white lg:flex">
            <div>
              <div className="flex items-center gap-3">
                <img src="/mellivo-logo.png" alt="Mellivo logo" className="h-12 w-12 rounded-2xl bg-white object-contain p-1 shadow-lg" />
                <div>
                  <p className="text-lg font-bold tracking-[0.22em]">MELLIVO</p>
                  <p className="text-xs font-medium uppercase tracking-[0.18em] text-indigo-200">Task Management</p>
                </div>
              </div>
              <div className="mt-20 max-w-sm">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-indigo-200">Mellivo workspace</p>
                <h2 className="mt-4 text-4xl font-bold leading-tight">Move every project forward with clarity.</h2>
                <p className="mt-5 text-sm leading-6 text-indigo-100">A focused workspace for projects, tasks, team updates, and measurable progress.</p>
              </div>
            </div>
            <p className="text-xs text-indigo-200">Secure workspace access · Mellivo</p>
          </div>
          <div className="p-7 sm:p-10">
            <div className="flex items-center gap-3 lg:hidden">
              <img src="/mellivo-logo.png" alt="Mellivo logo" className="h-11 w-11 rounded-xl border border-slate-200 bg-white object-contain p-1 shadow-sm" />
              <div>
                <p className="font-bold tracking-[0.18em] text-slate-900">MELLIVO</p>
                <p className="text-xs font-medium uppercase tracking-wider text-indigo-600">Task Management</p>
              </div>
            </div>
            <div className="mt-8 lg:mt-0">
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">Welcome back</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">Sign in to your workspace</h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">Use your Mellivo credentials to continue managing projects and progress.</p>
            </div>
            <form onSubmit={login} className="mt-8 space-y-5">
              <label className="block text-sm font-semibold text-slate-700">
                Work email
                <input
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  type="email"
                  placeholder="you@company.com"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
              <label className="block text-sm font-semibold text-slate-700">
                Password
                <input
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  type="password"
                  placeholder="Enter your password"
                  className="mt-2 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                />
              </label>
              {loginError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{loginError}</p>}
              <button className="w-full rounded-xl bg-indigo-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700">Sign in to Mellivo</button><a href="/auth/forgot-password" className="block text-center text-sm font-semibold text-indigo-600">Forgot password?</a>
            </form>
          </div>
        </div>
      </main>
    );
  }

  const filtersActive = Object.values(taskFilters).some(Boolean);
  const today = new Date(now);
  const todayKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  const matchingTasks = visibleTasks.filter((task) => {
    const query = taskFilters.search.trim().toLowerCase();
    return (!query || [task.title, task.description].some((value) => value.toLowerCase().includes(query)))
      && (!taskFilters.project || task.projectId === taskFilters.project)
      && (!taskFilters.status || task.status === taskFilters.status)
      && (!taskFilters.priority || task.priority === taskFilters.priority)
      && (!taskFilters.assignee || task.assigneeId === taskFilters.assignee)
      && (!taskFilters.due
        || (taskFilters.due === "overdue" && Boolean(task.dueDate) && task.dueDate! < todayKey && task.status !== "Completed")
        || (taskFilters.due === "today" && task.dueDate === todayKey)
        || (taskFilters.due === "upcoming" && Boolean(task.dueDate) && task.dueDate! > todayKey)
        || (taskFilters.due === "none" && !task.dueDate));
  });
  // Keep ancestors of matching subtasks so the task hierarchy remains readable.
  const boardTaskIds = new Set(matchingTasks.map((task) => task.id));
  const taskById = new Map(visibleTasks.map((task) => [task.id, task]));
  for (const task of matchingTasks) {
    let parentId = task.parentId;
    const visited = new Set<string>([task.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = taskById.get(parentId);
      if (!parent) break;
      boardTaskIds.add(parent.id);
      parentId = parent.parentId;
    }
  }
  const boardTasks = visibleTasks.filter((task) => boardTaskIds.has(task.id));
  const rootTasks = boardTasks.filter((task) => !task.parentId || !boardTaskIds.has(task.parentId));
  const boardProjects = projects.filter((project) => (!taskFilters.project || project.id === taskFilters.project)
    && (!filtersActive || boardTasks.some((task) => task.projectId === project.id)));
  const setTaskFilter = (key: keyof typeof taskFilters, value: string) => setTaskFilters((filters) => ({ ...filters, [key]: value }));
  const reportRange = (() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    if (reportPeriod === "Monthly") {
      start.setDate(1);
    } else if (reportPeriod === "Weekly") {
      const daysSinceMonday = start.getDay() === 0 ? 6 : start.getDay() - 1;
      start.setDate(start.getDate() - daysSinceMonday);
    } else if (reportPeriod === "Custom") {
      const customStart = parseReportDateInput(customReportStart);
      const customEnd = parseReportDateInput(customReportEnd, true);
      if (customStart) start.setTime(customStart.getTime());
      if (customEnd) end.setTime(customEnd.getTime());
    }
    return {
      start,
      end,
      valid: reportPeriod !== "Custom"
        || (Boolean(parseReportDateInput(customReportStart))
          && Boolean(parseReportDateInput(customReportEnd, true))
          && start <= end),
    };
  })();
  const reportTaskIds = new Set(visibleTasks.map((task) => task.id));
  const reportLogs = progressLogs
    .filter((log) => reportTaskIds.has(log.taskId))
    .filter((log) => currentUser.role !== "Employee" || log.employeeId === currentUser.id)
    .filter((log) => reportRange.valid && new Date(log.createdAt) >= reportRange.start && new Date(log.createdAt) <= reportRange.end)
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt));
  const latestReportByTask = Array.from(
    reportLogs.reduce((latest, log) => {
      if (!latest.has(log.taskId)) latest.set(log.taskId, log);
      return latest;
    }, new Map<string, ProgressLog>()).values(),
  );
  const reportAverageProgress = latestReportByTask.length
    ? Math.round(latestReportByTask.reduce((sum, log) => sum + log.progress, 0) / latestReportByTask.length)
    : 0;
  const reportCompletedCount = latestReportByTask.filter((log) => log.status === "Completed").length;
  const reportPeriodLabel = reportPeriod === "Daily"
    ? "today"
    : reportPeriod === "Weekly"
      ? "this week"
      : reportPeriod === "Monthly"
        ? "this month"
        : reportRange.valid
          ? `${customReportStart} to ${customReportEnd}`
          : "the selected date range";

  const chatTask = visibleTasks.find((task) => task.id === noteTaskId);
  const chatTasks = visibleTasks.filter((task) => !chatProjectId || task.projectId === chatProjectId);
  const chatNotes = notes.filter((note) => note.taskId === chatTask?.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const canSendChat = Boolean(chatTask && (currentUser.role === "Manager" || (isWorker(currentUser.role) && chatTask.assigneeId === currentUser.id) || (currentUser.role === "Senior Employee" && chatTask.createdById === currentUser.id)));
  const notifications = buildNotifications(visibleTasks, notes, currentUser, new Date(now));
  const workloadUsers = users.filter(user => user.active && user.id !== currentUser.id && (
    currentUser.role === "Admin"
      ? user.role !== "Admin"
      : currentUser.role === "Manager"
        ? user.role === "Senior Employee" || user.role === "Employee"
        : currentUser.role === "Senior Employee" && user.role === "Employee"
  ));
  const navigationItems = [
    "Dashboard",
    "My Work",
    isWorker(currentUser.role) ? "My daily updates" : "Team tasks",
    "Chats",
    "Notifications",
    ...(["Admin", "Manager", "Senior Employee"].includes(currentUser.role) ? ["Workload"] : []),
    "Activity",
    "Archive",
    ...(currentUser.role === "Admin" ? ["User management"] : []),
  ];
  const selectedSection = activeSection === "profile" || navigationItems.some((item) => sectionTarget(item) === activeSection)
    ? activeSection : "dashboard";

  return (
    <main className="workspace-theme min-h-screen bg-background text-slate-900">
        <div className="flex min-h-screen flex-col xl:flex-row">
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-slate-200/80 bg-white/90 p-4 backdrop-blur xl:block">
          <div className="flex items-center gap-3">
            <img src="/mellivo-logo.png" alt="Mellivo logo" className="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-contain p-1 shadow-sm" />
            <div>
              <p className="font-bold tracking-[0.18em] text-slate-950">MELLIVO</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-indigo-600">Task Management</p>
            </div>
          </div>
          <button type="button" onClick={() => navigateTo("My profile")} aria-label={`Open profile settings for ${currentUser.name}`} aria-current={selectedSection === "profile" ? "page" : undefined} className={`mt-6 flex w-full items-center justify-between rounded-2xl border bg-gradient-to-br from-indigo-50 to-white p-3 text-left shadow-sm hover:border-indigo-300 ${selectedSection === "profile" ? "border-indigo-400 ring-2 ring-indigo-100" : "border-indigo-100"}`}>
            <span><span className="block font-semibold">{currentUser.name}</span><span className="mt-1 block text-sm text-indigo-700">{currentUser.role}</span></span>
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-full bg-white text-lg text-indigo-600 shadow-sm">⚙</span>
          </button>
          <nav className="mt-6 space-y-1">
            {navigationItems.map((item) => (
              <a key={item} href={`#${sectionTarget(item)}`} onClick={(event) => { event.preventDefault(); navigateTo(item); }} aria-current={(item === "Chats" ? chatOpen : selectedSection === sectionTarget(item)) ? "page" : undefined} className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors ${(item === "Chats" ? chatOpen : selectedSection === sectionTarget(item)) ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"}`}>{item}{item === "Notifications" && notifications.length > 0 ? ` (${notifications.length})` : ""}</a>
            ))}
          </nav>
          <button
            onClick={async () => { await supabase?.auth.signOut(); setCurrentUserId(null); }}
            className="mt-6 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
          >
            Sign out
          </button>
          <ThemeToggle />
        </aside>

        <div className="border-b border-slate-200/80 bg-white/95 p-4 shadow-sm backdrop-blur xl:hidden">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2.5">
                <img src="/mellivo-logo.png" alt="Mellivo logo" className="h-9 w-9 rounded-xl border border-slate-200 bg-white object-contain p-1 shadow-sm" />
                <div>
                  <h1 className="text-sm font-bold tracking-[0.16em] text-slate-950">MELLIVO</h1>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">Task Management</p>
                </div>
              </div>
              <button type="button" onClick={() => navigateTo("My profile")} className="mt-1 flex items-center gap-2 text-sm text-slate-500 hover:text-indigo-700"><span>{currentUser.name} · {currentUser.role}</span><span aria-hidden="true">⚙</span></button>
            </div>
            <button
              onClick={async () => { await supabase?.auth.signOut(); setCurrentUserId(null); }}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700"
            >
              Sign out
            </button>
          </div>
          <nav className="mt-4 flex flex-wrap gap-2">
            {navigationItems.map((item) => (
              <a key={item} href={`#${sectionTarget(item)}`} onClick={(event) => { event.preventDefault(); navigateTo(item); }} aria-current={(item === "Chats" ? chatOpen : selectedSection === sectionTarget(item)) ? "page" : undefined} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${(item === "Chats" ? chatOpen : selectedSection === sectionTarget(item)) ? "border-indigo-600 bg-indigo-600 text-white shadow-sm" : "border-slate-200 bg-slate-50 text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"}`}>
                {item}{item === "Notifications" && notifications.length > 0 ? ` (${notifications.length})` : ""}
              </a>
            ))}
          </nav>
          <ThemeToggle />
        </div>

        <section className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6 md:p-8">
          <div className="mx-auto w-full max-w-7xl">
            {notice && (
              <button onClick={() => setNotice("")} className="mb-6 w-full rounded-lg bg-emerald-50 px-4 py-3 text-left text-sm text-emerald-800">{notice} <span className="float-right">×</span></button>
            )}
            {(selectedSection === "my-work" || selectedSection === "workload") && <WorkOverview tasks={visibleTasks} userId={currentUser.id} users={workloadUsers} workload={selectedSection === "workload"} onOpen={openTaskFromOverview} onChat={toggleMessages} unread={id=>notes.filter(note=>note.taskId===id&&isNewMessage(note)).length} />}
            {selectedSection === "activity" && <ActivityHistory key={currentUser.id} />}
            <div id="notifications" hidden={selectedSection !== "notifications"}>
              <NotificationCenter notifications={notifications} projectName={getProjectName} onOpen={(notification) => {
                if (notification.kind === "Messages") { toggleMessages(notification.taskId); }
                else { setChatOpen(false); setSelectedTaskId(notification.taskId); }
              }} />
            </div>
            <div id="dashboard" hidden={selectedSection !== "dashboard"}>
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
              <div>
                <p className="text-sm text-slate-500">{new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
                <h2 className="mt-1 flex flex-wrap items-center gap-3 text-3xl font-bold">
                  Good morning, {currentUser.name.split(" ")[0]}
                  <img
                    src="/honey-badger.gif"
                    alt="Honey badger"
                    className="h-10 w-10 rounded-xl object-cover shadow-sm"
                  />
                </h2>
                <p className="mt-2 text-slate-500">Manage work based on your role and responsibilities.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentUser.role === "Admin" && (
                  <>
                    <button onClick={() => setModal("user")} className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">+ New user</button>
                    <button onClick={() => setModal("project")} className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700">+ Create project</button>
                    <button onClick={() => openTaskForm()} className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700">+ Create task</button>
                  </>
                )}
                {currentUser.role === "Manager" && (
                  <button onClick={() => openTaskForm()} className="rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700">+ Create task</button>
                )}
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 2xl:grid-cols-5">
              <div className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Projects</p><p className="mt-2 text-3xl font-bold text-indigo-600">{projects.length}</p></div>
              <div className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Visible tasks</p><p className="mt-2 text-3xl font-bold">{visibleTasks.length}</p></div>
              <div className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Pending</p><p className="mt-2 text-3xl font-bold text-orange-500">{pendingCount}</p></div>
              <div className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Completed</p><p className="mt-2 text-3xl font-bold text-green-600">{completedCount}</p></div>
              <div className="rounded-xl bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">Average progress</p><p className="mt-2 text-3xl font-bold text-indigo-600">{averageProgress}%</p></div>
            </div>

            <DashboardCharts tasks={visibleTasks} projects={projects} progressLogs={progressLogs} />

            </div>

            <div id="profile" hidden={selectedSection !== "profile"} className="rounded-xl bg-white p-6 shadow-sm">
              <div>
                <h3 className="text-xl font-bold">My profile</h3>
                <p className="mt-1 text-sm text-slate-500">Update your display name or change your password. Your role and permissions are managed by an administrator.</p>
              </div>
              <form onSubmit={updateOwnProfile} className="mt-5 grid gap-4 md:grid-cols-2">
                  <label className="block text-sm font-semibold text-slate-700">
                    Display name
                    <input value={profileName} onChange={(event) => setProfileName(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 font-normal" />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Work email
                    <input value={currentUser.email} disabled className="mt-1 w-full rounded-lg border bg-slate-50 px-3 py-2.5 font-normal text-slate-500" />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    New password
                    <input type="password" value={profilePassword} onChange={(event) => setProfilePassword(event.target.value)} placeholder="Leave blank to keep current password" className="mt-1 w-full rounded-lg border px-3 py-2.5 font-normal" />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Confirm new password
                    <input type="password" value={profilePasswordConfirm} onChange={(event) => setProfilePasswordConfirm(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2.5 font-normal" />
                  </label>
                  <div className="md:col-span-2">
                    <button className="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">Save profile changes</button>
                  </div>
              </form>
            </div>

            {currentUser.role === "Admin" && (
              <div id="user-management" hidden={selectedSection !== "user-management"} className="rounded-xl bg-white p-6 shadow-sm">
                <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold">User management</h3><p className="mt-1 text-sm text-slate-500">Create users and manage access roles.</p></div><button onClick={() => setModal("user")} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-indigo-600">+ Add user</button></div>
                <div className="mt-5 hidden overflow-x-auto xl:block"><table className="w-full text-left text-sm"><thead className="border-b text-xs uppercase text-slate-400"><tr><th className="pb-3">User</th><th className="pb-3">Email</th><th className="pb-3">Role</th><th className="pb-3">Status</th><th className="pb-3">Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id} className="border-b last:border-0"><td className="py-4 font-semibold">{user.name}</td><td className="py-4 text-slate-500">{user.email}</td><td className="py-4"><select value={user.role} onChange={(event) => updateUserRole(user.id, event.target.value as Role)} className="rounded-lg border px-3 py-2"><option>Admin</option><option>Manager</option><option>Senior Employee</option><option>Employee</option></select></td><td className="py-4"><span className={`rounded-full px-2 py-1 text-xs ${user.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{user.active ? "Active" : "Inactive"}</span></td><td className="py-4"><button onClick={() => toggleUser(user.id)} className="text-sm font-semibold text-indigo-600">{user.active ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>
                <div className="mt-5 space-y-3 xl:hidden">{users.map((user) => <div key={user.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{user.name}</p><p className="mt-1 break-all text-sm text-slate-500">{user.email}</p></div><span className={`rounded-full px-2 py-1 text-xs ${user.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{user.active ? "Active" : "Inactive"}</span></div><div className="mt-4 grid grid-cols-2 gap-3"><label className="text-xs font-medium text-slate-500">Role<select value={user.role} onChange={(event) => updateUserRole(user.id, event.target.value as Role)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-slate-700"><option>Admin</option><option>Manager</option><option>Senior Employee</option><option>Employee</option></select></label><button onClick={() => toggleUser(user.id)} className="self-end rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-indigo-600">{user.active ? "Deactivate" : "Activate"}</button></div></div>)}</div>
              </div>
            )}

            <div id="projects" hidden={selectedSection !== "dashboard"} className="mt-6 rounded-xl bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold">Projects <span className="text-base font-medium text-slate-400">({projects.length})</span></h3><p className="mt-1 text-sm text-slate-500">{currentUser.role === "Admin" ? "Admin controls project creation." : "Projects connected to your tasks."}</p></div>{currentUser.role === "Admin" && <button onClick={() => setModal("project")} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-indigo-600">+ Add project</button>}</div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">{projects.map((project) => { const projectTasks = tasks.filter((task) => task.projectId === project.id); const subtaskCount = projectTasks.filter((task) => task.parentId).length; const projectStatus = getProjectStatus(project.id); return <article key={project.id} className="rounded-lg border border-slate-200 p-4 transition hover:border-indigo-400"><button type="button" onClick={() => openProjectTasks(project.id)} aria-label={`Open tasks for ${project.name}`} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"><span className="flex items-start justify-between gap-3"><span className="block break-words font-semibold">{project.name}</span><span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${projectStatusClass(projectStatus)}`}>{projectStatus}</span></span><span className="mt-2 block text-sm text-slate-500">{project.description}</span><span className="mt-3 block text-xs text-indigo-600">{projectTasks.length} tasks · {subtaskCount} subtasks</span></button>{currentUser.role === "Admin" && <button type="button" onClick={() => archiveProject(project)} className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Archive project</button>}</article>; })}</div>
            </div>

            <div id="tasks" hidden={selectedSection !== "tasks"} className="rounded-xl bg-slate-100 p-6">
              <div className="flex items-center justify-between"><div><h3 className="text-xl font-bold">{isWorker(currentUser.role) ? "My daily updates" : "Team task board"}</h3><p className="mt-1 text-sm text-slate-500">{currentUser.role === "Manager" ? "Create tasks, subtasks, messages, and assignments for employees." : currentUser.role === "Admin" ? "Create, edit, assign, archive, or remove work across the workspace." : isWorker(currentUser.role) ? "Update your daily progress and messages. Senior employees can delegate subtasks." : "View all work across the workspace."}</p></div>{["Admin", "Manager"].includes(currentUser.role) && <button onClick={() => openTaskForm()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">+ New task</button>}</div>
              <SavedFilters key={currentUser.id} userId={currentUser.id} filters={taskFilters} onSelect={setTaskFilters} />
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">Search tasks<input type="search" value={taskFilters.search} onChange={(event) => setTaskFilter("search", event.target.value)} placeholder="Title or description" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal" /></label>
                {([
                  ["project", "Project", projects.map((project) => [project.id, project.name])],
                  ["status", "Status", ["Not started", "In progress", "Completed"].map((value) => [value, value])],
                  ["priority", "Priority", ["High", "Medium", "Low"].map((value) => [value, value])],
                  ["assignee", "Assignee", users.filter((user) => visibleTasks.some((task) => task.assigneeId === user.id)).map((user) => [user.id, user.name])],
                  ["due", "Due date", [["overdue", "Overdue"], ["today", "Due today"], ["upcoming", "Upcoming"], ["none", "No due date"]]],
                ] as const).map(([key, label, options]) => (
                  <label key={key} className="text-xs font-semibold text-slate-600">{label}<select value={taskFilters[key]} onChange={(event) => setTaskFilter(key, event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-normal"><option value="">All</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <p>{matchingTasks.length} of {visibleTasks.length} tasks/subtasks{boardTasks.length > matchingTasks.length ? " · Parent tasks included for context" : ""}</p>
                {filtersActive && <button type="button" onClick={() => setTaskFilters({ search: "", project: "", status: "", priority: "", assignee: "", due: "" })} className="font-semibold text-indigo-600 hover:text-indigo-800">Clear filters</button>}
              </div>
              <div className="mt-5 space-y-6">
                {boardProjects.map((project) => (
                  <div key={project.id} className="space-y-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1"><h4 className="font-bold text-indigo-950">{project.name}</h4><span className="text-xs text-slate-500">{boardTasks.filter((task) => task.projectId === project.id).length} tasks / subtasks</span></div>
                    {sortTasksNewestFirst(rootTasks.filter((task) => task.projectId === project.id), true).map((task) => renderTask(task))}
                    {!boardTasks.some((task) => task.projectId === project.id) && <p className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">No tasks in this project yet.</p>}
                  </div>
                ))}
                {!boardProjects.length && <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500">No tasks match these filters.</p>}
              </div>
            </div>

            <div id="archive" hidden={selectedSection !== "archive"} className="rounded-xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold">Archive <span className="text-base font-medium text-slate-400">({archivedTasks.length + archivedProjects.length})</span></h3>
                  <p className="mt-1 text-sm text-slate-500">Archived projects, tasks, and subtasks. Only administrators can remove them permanently.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setArchiveCollapsed((collapsed) => !collapsed)}
                  aria-expanded={!archiveCollapsed}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-indigo-700 hover:border-indigo-200 hover:bg-indigo-50"
                >
                  {archiveCollapsed ? "Maximize" : "Minimize"}
                </button>
              </div>
              {!archiveCollapsed && archivedProjects.length > 0 && <div className="mt-5 grid gap-3 sm:grid-cols-2">{archivedProjects.map(project => <article key={project.id} className="rounded-xl border border-amber-200 bg-amber-50/50 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{project.name}</p><p className="mt-1 text-xs text-amber-700">Archived project</p><p className="mt-2 text-sm text-slate-600">{project.description}</p></div>{currentUser.role === "Admin" && <button onClick={() => deleteProject(project)} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">Remove permanently</button>}</div></article>)}</div>}
              {!archiveCollapsed && (archivedTasks.length > 0 ? (
                <>
                  <div className="mt-5 space-y-3">
                    {archivePageRows.map(({ task, depth }) => renderArchivedTask(task, depth))}
                  </div>
                  <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-medium text-slate-500">Page {safeArchivePage} of {archivePageCount} · showing up to {ARCHIVE_PAGE_SIZE} tasks/subtasks</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setArchivePage((page) => Math.max(1, page - 1))}
                        disabled={safeArchivePage === 1}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        onClick={() => setArchivePage((page) => Math.min(archivePageCount, page + 1))}
                        disabled={safeArchivePage === archivePageCount}
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                !archivedProjects.length && <p className="mt-5 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500">No archived projects, tasks, or subtasks yet.</p>
              ))}
            </div>

            {!isWorker(currentUser.role) && (
            <div id="reports" hidden={selectedSection !== "dashboard"} className="mt-8 rounded-xl bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h3 className="text-xl font-bold">Reports</h3>
                  <p className="mt-1 text-sm text-slate-500">Review daily, weekly, monthly, or custom-range progress reports and update logs.</p>
                </div>
                <div className="flex flex-wrap gap-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Report period">
                  {(["Daily", "Weekly", "Monthly", "Custom"] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      role="tab"
                      aria-selected={reportPeriod === period}
                      onClick={() => setReportPeriod(period)}
                      className={reportPeriod === period ? "rounded-md bg-white px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm" : "rounded-md px-4 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800"}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>

              {reportPeriod === "Custom" && (
                <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-sm font-semibold text-slate-700">
                      Start date
                      <input type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={customReportStart} onChange={(event) => setCustomReportStart(event.target.value)} className="mt-1 w-full rounded-lg border border-indigo-100 bg-white px-3 py-2.5 font-normal" />
                    </label>
                    <label className="block text-sm font-semibold text-slate-700">
                      End date
                      <input type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={customReportEnd} onChange={(event) => setCustomReportEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-indigo-100 bg-white px-3 py-2.5 font-normal" />
                    </label>
                  </div>
                  <p className="mt-3 text-xs text-indigo-700">Enter dates in DD/MM/YYYY format.</p>
                  {!reportRange.valid && <p className="mt-2 text-sm font-medium text-red-700">Enter valid dates and choose a range where the start date is not after the end date.</p>}
                </div>
              )}

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">{reportPeriod} updates</p>
                  <p className="mt-2 text-2xl font-bold text-indigo-950">{reportLogs.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tasks updated</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{latestReportByTask.length}</p>
                </div>
                <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Average progress</p>
                  <p className="mt-2 text-2xl font-bold text-emerald-950">{reportAverageProgress}%</p>
                </div>
                <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Completed tasks</p>
                  <p className="mt-2 text-2xl font-bold text-amber-950">{reportCompletedCount}</p>
                </div>
              </div>

              <div className="mt-6">
                <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h4 className="text-lg font-bold">{reportPeriod} progress log</h4><button disabled={!reportLogs.length} onClick={()=>downloadCsv("mellivo-progress.csv", [["Task","Employee","Date","Status","Progress","Update"],...reportLogs.map(log=>[visibleTasks.find(task=>task.id===log.taskId)?.title??log.taskId,getUserName(log.employeeId),log.createdAt,log.status,log.progress,log.description])])} className="mt-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Export CSV</button>
                    <p className="mt-1 text-sm text-slate-500">Timestamped employee progress updates for {reportPeriodLabel}.</p>
                  </div>
                  <span className="text-xs font-medium text-slate-400">Newest updates first</span>
                </div>
                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
                  {reportLogs.length ? (
                    <table className="w-full table-fixed text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="w-[14%] px-3 py-3">Time</th>
                          <th className="w-[16%] px-3 py-3">Project</th>
                          <th className="w-[18%] px-3 py-3">Task</th>
                          <th className="w-[13%] px-3 py-3">Employee</th>
                          <th className="w-[12%] px-3 py-3">Status</th>
                          <th className="w-[10%] px-3 py-3">Progress</th>
                          <th className="w-[17%] px-3 py-3">Update</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportLogs.map((log) => {
                          const task = tasks.find((item) => item.id === log.taskId);
                          return (
                            <tr key={log.id} className="border-t border-slate-200 align-top hover:bg-slate-50">
                              <td className="break-words px-3 py-3 text-xs text-slate-500">{formatTimestamp(log.createdAt)}</td>
                              <td className="break-words px-3 py-3 text-xs text-slate-600">{task ? getProjectName(task.projectId) : "Unknown project"}</td>
                              <td className="break-words px-3 py-3 font-semibold text-slate-800">{task?.title ?? "Unknown task"}</td>
                              <td className="break-words px-3 py-3 text-xs font-semibold text-slate-700">{getUserName(log.employeeId)}</td>
                              <td className="break-words px-3 py-3"><span className="rounded-full bg-indigo-50 px-2 py-1 text-xs text-indigo-700">{log.status}</span></td>
                              <td className="px-3 py-3 text-xs font-bold text-indigo-700">{log.progress}%</td>
                              <td className="break-words px-3 py-3 text-xs text-slate-600">{log.description}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <p className="p-6 text-center text-sm text-slate-500">No progress updates recorded for {reportPeriodLabel}.</p>
                  )}
                </div>
              </div>
            </div>
            )}

            <p className="mt-6 text-center text-xs text-slate-400">Workspace data is protected by Supabase authentication and database policies.</p>
          </div>
        </section>
      </div>

      {selectedTaskId && visibleTasks.some((task) => task.id === selectedTaskId) && <TaskDetailsPanel onClose={() => setSelectedTaskId(null)}>{notice && <p role="status" className="mb-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700">{notice}</p>}{renderTask(visibleTasks.find((task) => task.id === selectedTaskId)!, 0, true)}<TaskAttachments key={`files-${selectedTaskId}`} taskId={selectedTaskId} canUpload={Boolean(visibleTasks.find(task=>task.id===selectedTaskId && !task.archivedAt && (["Admin","Manager"].includes(currentUser.role)||task.assigneeId===currentUser.id||(currentUser.role==="Senior Employee"&&task.createdById===currentUser.id))))} /><ActivityHistory key={`activity-${selectedTaskId}`} taskId={selectedTaskId} /></TaskDetailsPanel>}

      {chatOpen && (
        <aside role="dialog" aria-label="Task chats" className="fixed bottom-3 right-3 z-30 flex h-[min(640px,85dvh)] w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl border border-indigo-100 bg-white shadow-2xl sm:bottom-5 sm:right-5 sm:w-[400px]">
          <div className="flex items-center justify-between bg-indigo-600 px-4 py-3 text-white"><div><h2 className="font-bold">Task chats</h2><p className="text-xs text-indigo-100">Keep the conversation with the work</p></div><button aria-label="Close chat" onClick={() => setChatOpen(false)} className="rounded-lg px-3 py-1 text-xl hover:bg-indigo-500">×</button></div>
          <div className="grid gap-2 border-b border-slate-100 p-3">
            <label className="text-xs font-semibold text-slate-500">Project<select disabled={sendingMessage} value={chatProjectId} onChange={(event) => { setChatProjectId(event.target.value); setNoteTaskId(null); setNoteText(""); setChatError(""); }} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800"><option value="">All projects</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-500">Task<select disabled={sendingMessage} value={chatTask?.id ?? ""} onChange={(event) => event.target.value ? toggleMessages(event.target.value) : setNoteTaskId(null)} className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800"><option value="">Select a task</option>{chatTasks.map((task) => <option key={task.id} value={task.id}>{task.parentId ? "↳ " : ""}{task.title}</option>)}</select></label>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4" aria-live="polite">
            {chatTask && <p className="break-words text-center text-xs font-semibold text-slate-500">{chatTask.title}</p>}
            {!chatTask ? <p className="py-10 text-center text-sm text-slate-500">Select a project and task to open a conversation.</p> : !chatNotes.length ? <p className="py-10 text-center text-sm text-slate-500">No messages yet. Start the conversation.</p> : chatNotes.map((note) => (
              <div key={note.id} className={note.authorId === currentUser.id ? "ml-8 text-right" : "mr-8"}>
                <p className="mb-1 text-[11px] font-semibold text-slate-500">{note.authorId === currentUser.id ? "You" : getUserName(note.authorId)}</p>
                <p className={note.authorId === currentUser.id ? "inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-indigo-600 px-3 py-2 text-left text-sm text-white" : "inline-block max-w-full whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800"}>{note.text}</p>
                <p className="mt-1 text-[10px] text-slate-400">{formatTimestamp(note.createdAt)}</p>
              </div>
            ))}<div ref={chatEndRef} />
          </div>
          {chatTask && <div className="max-h-52 overflow-y-auto px-3"><TaskAttachments key={chatTask.id} taskId={chatTask.id} canUpload={canSendChat} /></div>}
          {chatError && <p role="alert" className="px-3 pt-2 text-xs text-red-600">{chatError}</p>}
          <form onSubmit={(event) => { event.preventDefault(); if (chatTask) void addNote(chatTask.id); }} className="flex items-end gap-2 border-t border-slate-100 p-3">
            <textarea aria-label="Message" disabled={!canSendChat || sendingMessage} maxLength={5000} rows={2} value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder={chatTask && !canSendChat ? "Read-only conversation" : "Write a message…"} className="min-w-0 flex-1 resize-none rounded-xl border border-slate-200 p-2 text-sm disabled:bg-slate-50" />
            <button disabled={!canSendChat || sendingMessage || !noteText.trim()} className="rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">{sendingMessage ? "Sending…" : "Send"}</button>
          </form>
        </aside>
      )}

      {modal === "user" && currentUser.role === "Admin" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Invite new user</h2><p className="mt-1 text-sm text-slate-500">Send an email invitation so the user can choose a password.</p></div><button onClick={() => setModal(null)} className="text-xl text-slate-400">×</button></div><form onSubmit={createUser} className="mt-6 space-y-4"><input value={newUserName} onChange={(event) => setNewUserName(event.target.value)} placeholder="Full name" className="w-full rounded-lg border px-4 py-3" /><input value={newUserEmail} onChange={(event) => setNewUserEmail(event.target.value)} type="email" placeholder="Email address" className="w-full rounded-lg border px-4 py-3" /><select value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as Role)} className="w-full rounded-lg border px-4 py-3"><option>Admin</option><option>Manager</option><option>Senior Employee</option><option>Employee</option></select><button disabled={invitingUser} className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{invitingUser ? "Sending…" : "Send invitation"}</button></form></div></div>
      )}

      {modal === "project" && currentUser.role === "Admin" && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Create new project</h2><p className="mt-1 text-sm text-slate-500">Admin-only project creation.</p></div><button onClick={() => setModal(null)} className="text-xl text-slate-400">×</button></div><form onSubmit={createProject} className="mt-6 space-y-4"><input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Project name" className="w-full rounded-lg border px-4 py-3" /><textarea value={newProjectDescription} onChange={(event) => setNewProjectDescription(event.target.value)} placeholder="Project description" rows={3} className="w-full resize-none rounded-lg border px-4 py-3" /><button className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white">Create project</button></form></div></div>
      )}

      {modal === "task" && ["Admin", "Manager", "Senior Employee"].includes(currentUser.role) && (
        <div className="fixed inset-0 z-20 flex items-center justify-center overflow-y-auto bg-slate-900/40 p-4"><div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">{editingTaskId ? "Edit task" : "Create task or subtask"}</h2><p className="mt-1 text-sm text-slate-500">Assign work to a team member. Senior employees can assign subtasks to employees.</p></div><button onClick={() => setModal(null)} className="text-xl text-slate-400">×</button></div><form onSubmit={createTask} className="mt-6 space-y-4">{taskFormError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{taskFormError}</p>}<input autoFocus value={newTaskTitle} onChange={(event) => setNewTaskTitle(event.target.value)} placeholder="Task title" className="w-full rounded-lg border px-4 py-3" /><textarea value={newTaskDescription} onChange={(event) => setNewTaskDescription(event.target.value)} placeholder="Task description" rows={3} className="w-full resize-none rounded-lg border px-4 py-3" /><div className="grid gap-4 md:grid-cols-2"><select aria-label="Task project" disabled={Boolean(editingTaskId) || currentUser.role === "Senior Employee"} value={newTaskProjectId || projects[0]?.id} onChange={(event) => { setNewTaskProjectId(event.target.value); setNewTaskParentId(""); }} className="rounded-lg border px-4 py-3">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><select aria-label="Assign to" value={newTaskAssigneeId || employees[0]?.id} onChange={(event) => setNewTaskAssigneeId(event.target.value)} className="rounded-lg border px-4 py-3">{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} ({visibleTasks.filter(task => task.assigneeId === employee.id && task.status !== "Completed").length} active)</option>)}</select><select aria-label="Parent task" disabled={Boolean(editingTaskId) || currentUser.role === "Senior Employee"} value={newTaskParentId} onChange={(event) => setNewTaskParentId(event.target.value)} className="rounded-lg border px-4 py-3"><option value="">Top-level task</option>{tasks.filter((task) => (currentUser.role === "Senior Employee" ? task.assigneeId === currentUser.id : !task.parentId) && task.projectId === (newTaskProjectId || projects[0]?.id)).map((task) => <option key={task.id} value={task.id}>Subtask of: {task.title}</option>)}</select><select value={newTaskPriority} onChange={(event) => setNewTaskPriority(event.target.value as Task["priority"])} className="rounded-lg border px-4 py-3"><option>High</option><option>Medium</option><option>Low</option></select></div><label className="block text-sm font-semibold text-slate-700">Start date<input required type="date" value={newTaskStart} onChange={(event) => { setNewTaskStart(event.target.value); if (event.target.value > newTaskDue) setNewTaskDue(event.target.value); }} className="mt-1 w-full rounded-lg border px-4 py-3 font-normal" /></label><label className="block text-sm font-semibold text-slate-700">Due date<input required min={newTaskStart} type="date" value={newTaskDue} onChange={(event) => setNewTaskDue(event.target.value)} className="mt-1 w-full rounded-lg border px-4 py-3 font-normal" /></label>{employees.length === 0 && <p className="text-sm text-amber-700">No eligible employees are available. Ask an admin to create an Employee account.</p>}<button disabled={employees.length === 0 || savingTask} className="w-full rounded-lg bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-40">{savingTask ? "Saving…" : editingTaskId ? "Save changes" : "Create and assign task"}</button></form></div></div>
      )}
    </main>
  );
}

