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

