begin;

create or replace function public.normalize_task_assignees()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.assignee_ids := (
    select array_agg(item.id order by item.first_position)
    from (
      select id, min(position) first_position
      from unnest(coalesce(new.assignee_ids, '{}'::uuid[])) with ordinality entry(id, position)
      where id is not null group by id
    ) item
  );
  if cardinality(new.assignee_ids) = 0 then
    new.assignee_ids := array[new.assignee_id];
  end if;
  if tg_op = 'INSERT' or new.assignee_ids is distinct from old.assignee_ids then
    if exists (
      select 1 from unnest(new.assignee_ids) assignee(id)
      left join public.profiles profile on profile.id = assignee.id
      where profile.id is null or not profile.active
        or (profile.role not in ('Senior Employee','Employee') and assignee.id <> auth.uid())
    ) then raise exception 'Choose only active eligible users' using errcode = '23514'; end if;
  end if;
  new.assignee_id := (new.assignee_ids)[1];
  return new;
end;
$$;

create or replace function public.can_assign_task_to_self(parent_task_id text, target_project_id text, target_assignee_ids uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(target_assignee_ids) = 1
    and target_assignee_ids[1] = auth.uid()
    and (
      parent_task_id is null
      or exists (
        select 1 from public.tasks parent
        where parent.id = parent_task_id
          and parent.project_id = target_project_id
          and parent.archived_at is null
          and public.is_task_assignee(parent.id)
      )
    );
$$;
revoke all on function public.can_assign_task_to_self(text,text,uuid[]) from public;
grant execute on function public.can_assign_task_to_self(text,text,uuid[]) to authenticated;

alter policy tasks_insert on public.tasks with check (
  created_by_id = auth.uid() and (
    public.current_role() in ('Admin','Manager')
    or public.can_assign_task_to_self(parent_id, project_id, assignee_ids)
    or public.can_delegate_task(parent_id, project_id, assignee_ids)
  )
);

commit;
