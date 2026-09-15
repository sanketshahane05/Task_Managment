create or replace function public.archive_task_tree(target_task_id text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_role public.app_role;
  task_creator uuid;
  archived_ids text[];
begin
  select role into actor_role from public.profiles where id = auth.uid() and active;
  select created_by_id into task_creator from public.tasks where id = target_task_id and archived_at is null;
  if actor_role is null or task_creator is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  if actor_role not in ('Admin', 'Manager') and task_creator <> auth.uid() then
    raise exception 'Only the creator or an administrator can archive this task' using errcode = '42501';
  end if;

  with recursive task_tree as (
    select id from public.tasks where id = target_task_id and archived_at is null
    union all
    select child.id from public.tasks child join task_tree parent on child.parent_id = parent.id where child.archived_at is null
  ), updated as (
    update public.tasks set archived_at = now() where id in (select id from task_tree) returning id
  )
  select array_agg(id) into archived_ids from updated;

  return coalesce(archived_ids, array[]::text[]);
end;
$$;

revoke all on function public.archive_task_tree(text) from public;
grant execute on function public.archive_task_tree(text) to authenticated;

