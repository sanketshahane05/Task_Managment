begin;

alter table public.tasks add column if not exists assignee_ids uuid[] not null default '{}'::uuid[];
update public.tasks set assignee_ids = array[assignee_id] where cardinality(assignee_ids) = 0;
create index if not exists tasks_assignee_ids_idx on public.tasks using gin (assignee_ids);

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
      select 1 from unnest(new.assignee_ids) id
      left join public.profiles profile on profile.id = id
      where profile.id is null or not profile.active or profile.role not in ('Senior Employee','Employee')
    ) then raise exception 'Choose only active employees' using errcode = '23514'; end if;
  end if;
  new.assignee_id := (new.assignee_ids)[1];
  return new;
end;
$$;
drop trigger if exists normalize_task_assignees_before_write on public.tasks;
create trigger normalize_task_assignees_before_write before insert or update of assignee_id, assignee_ids on public.tasks
for each row execute function public.normalize_task_assignees();

create or replace function public.is_task_assignee(target_id text, target_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks task
    where task.id = target_id and target_user = any(case when cardinality(task.assignee_ids) > 0 then task.assignee_ids else array[task.assignee_id] end)
  );
$$;
revoke all on function public.is_task_assignee(text,uuid) from public;
grant execute on function public.is_task_assignee(text,uuid) to authenticated;

create or replace function public.can_read_task(target_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() is not null and exists (
    select 1 from public.tasks task where task.id = target_id and (
      public.current_role() in ('Admin','Manager') or public.is_task_assignee(task.id)
      or (public.current_role() = 'Senior Employee' and task.created_by_id = auth.uid())
    )
  );
$$;

create or replace function public.can_delegate_task(parent_task_id text, target_project_id text, target_assignee_ids uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_role() = 'Senior Employee'
    and public.is_task_assignee(parent_task_id)
    and exists (select 1 from public.tasks where id = parent_task_id and project_id = target_project_id and archived_at is null)
    and cardinality(target_assignee_ids) > 0
    and not exists (
      select 1 from unnest(target_assignee_ids) id left join public.profiles profile on profile.id=id
      where profile.id is null or not profile.active or profile.role <> 'Employee'
    );
$$;
revoke all on function public.can_delegate_task(text,text,uuid[]) from public;
grant execute on function public.can_delegate_task(text,text,uuid[]) to authenticated;

alter policy tasks_read on public.tasks using (public.can_read_task(id));
alter policy tasks_insert on public.tasks with check (
  created_by_id = auth.uid() and (
    public.current_role() in ('Admin','Manager')
    or public.can_delegate_task(parent_id, project_id, assignee_ids)
  )
);
alter policy tasks_update on public.tasks
  using (public.can_read_task(id))
  with check (public.can_read_task(id));

create or replace function public.protect_employee_task_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_task_assignee(old.id) and public.current_role() in ('Senior Employee','Employee') then
    new.description := old.description; new.title := old.title; new.project_id := old.project_id;
    new.due := old.due; new.priority := old.priority; new.assignee_id := old.assignee_id;
    new.assignee_ids := old.assignee_ids; new.created_by_id := old.created_by_id;
    new.parent_id := old.parent_id; new.created_at := old.created_at; new.assigned_at := old.assigned_at;
    new.due_date := old.due_date; new.start_date := old.start_date; new.archived_at := old.archived_at;
  end if;
  return new;
end;
$$;

alter policy progress_insert on public.progress_logs with check (
  employee_id = auth.uid() and public.current_role() in ('Senior Employee','Employee')
  and public.is_task_assignee(task_id)
);

alter policy notes_insert on public.notes with check (
  author_id = auth.uid() and public.can_read_task(task_id) and (
    public.current_role() in ('Admin','Manager') or public.is_task_assignee(task_id)
    or exists (select 1 from public.tasks task where task.id=task_id and public.current_role()='Senior Employee' and task.created_by_id=auth.uid())
  )
);

create or replace function public.review_task(target_task_id text, decision text, feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare target public.tasks%rowtype; actor_role public.app_role; completion_value public.task_status;
begin
  actor_role := public.current_role();
  if auth.uid() is null or actor_role is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into target from public.tasks where id=target_task_id for update;
  if not found or target.archived_at is not null or not public.can_read_task(target_task_id) then raise exception 'Active task not found' using errcode='42501'; end if;
  if decision='submit' then
    if not public.is_task_assignee(target_task_id) or actor_role not in ('Employee','Senior Employee') then raise exception 'Only an assignee can submit work' using errcode='42501'; end if;
    if target.review_state='pending' or target.status::text in ('Complete','Completed') then raise exception 'Task already submitted or completed'; end if;
    update public.tasks set review_state='pending',review_note='',reviewed_by=null,reviewed_at=null,status='In progress' where id=target_task_id;
  elsif decision in ('approve','request_changes') then
    if target.review_state <> 'pending' then raise exception 'Task is not awaiting review'; end if;
    if not (actor_role in ('Admin','Manager') or (actor_role='Senior Employee' and target.created_by_id=auth.uid() and not public.is_task_assignee(target_task_id))) then raise exception 'You cannot review this task' using errcode='42501'; end if;
    if decision='request_changes' and length(trim(feedback))=0 then raise exception 'Explain the changes required'; end if;
    if length(feedback)>5000 then raise exception 'Feedback is too long'; end if;
    if decision='approve' then
      if exists (with recursive descendants as (select id,status from public.tasks where parent_id=target_task_id union all select task.id,task.status from public.tasks task join descendants item on task.parent_id=item.id) select 1 from descendants where status::text not in ('Complete','Completed')) then raise exception 'Complete all subtasks before approving the parent task'; end if;
      select enumlabel::public.task_status into completion_value from pg_enum where enumtypid='public.task_status'::regtype and enumlabel in ('Completed','Complete') order by (enumlabel='Completed') desc limit 1;
      update public.tasks set review_state='approved',review_note=trim(feedback),reviewed_by=auth.uid(),reviewed_at=now(),status=completion_value,progress=100,completed_at=now() where id=target_task_id;
    else
      update public.tasks set review_state='changes_requested',review_note=trim(feedback),reviewed_by=auth.uid(),reviewed_at=now(),status='In progress',completed_at=null where id=target_task_id;
    end if;
  else raise exception 'Invalid review decision'; end if;
end;
$$;

create or replace function public.can_attach_task(target text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.current_role() is not null and exists(
   select 1 from public.tasks task where task.id=target and task.archived_at is null and (
     public.current_role() in ('Admin','Manager') or public.is_task_assignee(task.id)
     or (public.current_role()='Senior Employee' and task.created_by_id=auth.uid())
   )
 );
$$;

create or replace function public.record_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb := case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  after_row jsonb := to_jsonb(new);
  fields text[]; field text; delta jsonb := '{}'::jsonb; actor uuid := auth.uid(); actor_label text;
begin
  fields := case when tg_table_name='tasks' then array['title','description','assignee_ids','project_id','parent_id','priority','start_date','due_date','status','progress','archived_at','review_state','review_note'] else array['name','role','active'] end;
  foreach field in array fields loop
    if before_row->field is distinct from after_row->field then
      if field in ('description','review_note') then
        delta := delta || jsonb_build_object(field,jsonb_build_object('before',null,'after','Updated'));
      elsif field='assignee_ids' then
        delta := delta || jsonb_build_object(field,jsonb_build_object(
          'before',coalesce((select jsonb_agg(profile.name order by profile.name) from public.profiles profile where profile.id::text in (select jsonb_array_elements_text(coalesce(before_row->'assignee_ids','[]'::jsonb)))),'[]'::jsonb),
          'after',coalesce((select jsonb_agg(profile.name order by profile.name) from public.profiles profile where profile.id=any(new.assignee_ids)),'[]'::jsonb)
        ));
      else
        delta := delta || jsonb_build_object(field,jsonb_build_object('before',before_row->field,'after',after_row->field));
      end if;
    end if;
  end loop;
  if delta='{}'::jsonb then return new; end if;
  select name into actor_label from public.profiles where id=actor;
  insert into public.activity_events(entity_type,entity_id,entity_label,actor_id,actor_name,action,changes)
  values(case when tg_table_name='tasks' then 'task' else 'profile' end,after_row->>'id',coalesce(after_row->>'title',after_row->>'name'),actor,coalesce(actor_label,'System / service'),lower(tg_op),delta);
  return new;
end;
$$;

create or replace function public.create_next_recurring_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare next_start date; next_due date;
begin
  if new.status::text in ('Complete','Completed') and old.status::text not in ('Complete','Completed') and new.recurrence <> 'none' and new.archived_at is null then
    next_start := case new.recurrence when 'daily' then new.start_date + 1 when 'weekly' then new.start_date + 7 else (new.start_date + interval '1 month')::date end;
    next_due := case new.recurrence when 'daily' then new.due_date + 1 when 'weekly' then new.due_date + 7 else (new.due_date + interval '1 month')::date end;
    insert into public.tasks(id,title,project_id,description,due,priority,status,progress,assignee_id,assignee_ids,created_by_id,parent_id,blocked_by_id,assigned_at,due_date,start_date,milestone,milestone_date,recurrence)
    values('task-'||gen_random_uuid()::text,new.title,new.project_id,new.description,next_due::text,new.priority,'Not started',0,new.assignee_id,new.assignee_ids,new.created_by_id,new.parent_id,null,now(),next_due,next_start,new.milestone,case when new.milestone then next_due else null end,new.recurrence);
  end if;
  return new;
end;
$$;

commit;

