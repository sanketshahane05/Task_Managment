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

