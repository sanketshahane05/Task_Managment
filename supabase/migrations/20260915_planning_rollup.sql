create or replace function public.restore_task_tree(target_task_id text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  task_creator uuid;
  restored_ids text[];
begin
  select role into actor_role from public.profiles where id = auth.uid() and active;
  select created_by_id into task_creator from public.tasks where id = target_task_id and archived_at is not null;
  if actor_role is null or task_creator is null then
    raise exception 'Archived task not found' using errcode = 'P0002';
  end if;
  if actor_role not in ('Admin', 'Manager') and task_creator <> auth.uid() then
    raise exception 'Only the creator or an administrator can restore this task' using errcode = '42501';
  end if;

  with recursive descendants as (
    select id from public.tasks where id = target_task_id and archived_at is not null
    union all
    select child.id from public.tasks child join descendants parent on child.parent_id = parent.id where child.archived_at is not null
  ), ancestors as (
    select parent.id, parent.parent_id
    from public.tasks child join public.tasks parent on parent.id = child.parent_id
    where child.id = target_task_id and parent.archived_at is not null
    union all
    select parent.id, parent.parent_id
    from public.tasks parent join ancestors child on parent.id = child.parent_id
    where parent.archived_at is not null
  ), updated as (
    update public.tasks
    set archived_at = null
    where id in (select id from descendants union select id from ancestors)
    returning id
  )
  select array_agg(id) into restored_ids from updated;

  return coalesce(restored_ids, array[]::text[]);
end;
$$;

revoke all on function public.restore_task_tree(text) from public;
grant execute on function public.restore_task_tree(text) to authenticated;


begin;

alter table public.tasks add column if not exists blocked_by_id text references public.tasks(id) on delete set null;
create index if not exists tasks_blocked_by_id_idx on public.tasks(blocked_by_id);

create or replace function public.prevent_task_dependency_cycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.blocked_by_id = new.id then raise exception 'A task cannot depend on itself'; end if;
  if new.blocked_by_id is not null and exists (
    with recursive blockers as (
      select id, blocked_by_id from public.tasks where id = new.blocked_by_id
      union all select task.id, task.blocked_by_id from public.tasks task join blockers on task.id = blockers.blocked_by_id
    ) select 1 from blockers where id = new.id
  ) then raise exception 'This dependency would create a cycle'; end if;
  return new;
end;
$$;

drop trigger if exists prevent_task_dependency_cycle_before_write on public.tasks;
create trigger prevent_task_dependency_cycle_before_write before insert or update of blocked_by_id on public.tasks
for each row execute function public.prevent_task_dependency_cycle();

create or replace function public.enforce_task_completion_requirements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status::text in ('Complete', 'Completed') and old.status::text not in ('Complete', 'Completed') then
    if new.blocked_by_id is not null and exists (
      select 1 from public.tasks blocker
      where blocker.id = new.blocked_by_id
        and blocker.archived_at is null
        and blocker.status::text not in ('Complete', 'Completed')
    ) then
      raise exception 'Complete the blocking task before completing this task';
    end if;
    if exists (
      select 1 from public.tasks child
      where child.parent_id = new.id
        and child.archived_at is null
        and child.status::text not in ('Complete', 'Completed')
    ) then
      raise exception 'Complete all active subtasks before completing the parent task';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_task_completion_requirements_before_update on public.tasks;
create trigger enforce_task_completion_requirements_before_update
before update on public.tasks
for each row execute function public.enforce_task_completion_requirements();

commit;


begin;

alter table public.tasks add column if not exists milestone boolean not null default false;
alter table public.tasks add column if not exists milestone_date date;
alter table public.tasks add column if not exists recurrence text not null default 'none';

alter table public.tasks drop constraint if exists tasks_recurrence_check;
alter table public.tasks add constraint tasks_recurrence_check check (recurrence in ('none','daily','weekly','monthly'));

create index if not exists tasks_milestone_date_idx on public.tasks(milestone_date) where milestone;

create or replace function public.create_next_recurring_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  next_start date;
  next_due date;
begin
  if new.status::text in ('Complete','Completed') and old.status::text not in ('Complete','Completed') and new.recurrence <> 'none' and new.archived_at is null then
    next_start := case new.recurrence when 'daily' then new.start_date + 1 when 'weekly' then new.start_date + 7 else (new.start_date + interval '1 month')::date end;
    next_due := case new.recurrence when 'daily' then new.due_date + 1 when 'weekly' then new.due_date + 7 else (new.due_date + interval '1 month')::date end;
    insert into public.tasks(id,title,project_id,description,due,priority,status,progress,assignee_id,created_by_id,parent_id,blocked_by_id,assigned_at,due_date,start_date,milestone,milestone_date,recurrence)
    values('task-' || gen_random_uuid()::text,new.title,new.project_id,new.description,next_due::text,new.priority,'Not started',0,new.assignee_id,new.created_by_id,new.parent_id,null,now(),next_due,next_start,new.milestone,case when new.milestone then next_due else null end,new.recurrence);
  end if;
  return new;
end;
$$;

drop trigger if exists create_next_recurring_task_after_completion on public.tasks;
create trigger create_next_recurring_task_after_completion after update on public.tasks
for each row execute function public.create_next_recurring_task();

commit;

