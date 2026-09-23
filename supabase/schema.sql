create type public.app_role as enum ('Admin', 'Manager', 'Senior Employee', 'Employee');
create type public.task_status as enum ('Not started', 'In progress', 'Completed');
create type public.task_priority as enum ('High', 'Medium', 'Low');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role public.app_role not null default 'Employee',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.projects (
  id text primary key,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.tasks (
  id text primary key,
  title text not null,
  project_id text not null references public.projects(id) on delete cascade,
  description text not null default '',
  due text not null default '',
  priority public.task_priority not null default 'Medium',
  status public.task_status not null default 'Not started',
  progress integer not null default 0 check (progress between 0 and 100),
  assignee_id uuid not null references public.profiles(id),
  created_by_id uuid not null references public.profiles(id),
  parent_id text references public.tasks(id) on delete set null,
  blocked_by_id text references public.tasks(id) on delete set null,
  milestone boolean not null default false,
  milestone_date date,
  recurrence text not null default 'none' check (recurrence in ('none','daily','weekly','monthly')),
  created_at timestamptz not null default now(),
  assigned_at timestamptz not null default now(),
  due_date date,
  start_date date default current_date,
  completed_at timestamptz,
  archived_at timestamptz
);

create index tasks_blocked_by_id_idx on public.tasks(blocked_by_id);
create index tasks_milestone_date_idx on public.tasks(milestone_date) where milestone;

create or replace function public.prevent_task_dependency_cycle()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.blocked_by_id = new.id then raise exception 'A task cannot depend on itself'; end if;
  if new.blocked_by_id is not null and exists (
    with recursive blockers as (
      select id,blocked_by_id from public.tasks where id=new.blocked_by_id
      union all select task.id,task.blocked_by_id from public.tasks task join blockers on task.id=blockers.blocked_by_id
    ) select 1 from blockers where id=new.id
  ) then raise exception 'This dependency would create a cycle'; end if;
  return new;
end;
$$;
create trigger prevent_task_dependency_cycle_before_write before insert or update of blocked_by_id on public.tasks
for each row execute function public.prevent_task_dependency_cycle();

create or replace function public.enforce_task_completion_requirements()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status::text in ('Complete','Completed') and old.status::text not in ('Complete','Completed') then
    if new.blocked_by_id is not null and exists(select 1 from public.tasks blocker where blocker.id=new.blocked_by_id and blocker.archived_at is null and blocker.status::text not in ('Complete','Completed')) then raise exception 'Complete the blocking task before completing this task'; end if;
    if exists(select 1 from public.tasks child where child.parent_id=new.id and child.archived_at is null and child.status::text not in ('Complete','Completed')) then raise exception 'Complete all active subtasks before completing the parent task'; end if;
  end if;
  return new;
end;
$$;
create trigger enforce_task_completion_requirements_before_update before update on public.tasks
for each row execute function public.enforce_task_completion_requirements();

create or replace function public.create_next_recurring_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare next_start date; next_due date;
begin
  if new.status::text in ('Complete','Completed') and old.status::text not in ('Complete','Completed') and new.recurrence<>'none' and new.archived_at is null then
    next_start:=case new.recurrence when 'daily' then new.start_date+1 when 'weekly' then new.start_date+7 else (new.start_date+interval '1 month')::date end;
    next_due:=case new.recurrence when 'daily' then new.due_date+1 when 'weekly' then new.due_date+7 else (new.due_date+interval '1 month')::date end;
    insert into public.tasks(id,title,project_id,description,due,priority,status,progress,assignee_id,created_by_id,parent_id,blocked_by_id,assigned_at,due_date,start_date,milestone,milestone_date,recurrence)
    values('task-'||gen_random_uuid()::text,new.title,new.project_id,new.description,next_due::text,new.priority,'Not started',0,new.assignee_id,new.created_by_id,new.parent_id,null,now(),next_due,next_start,new.milestone,case when new.milestone then next_due else null end,new.recurrence);
  end if;
  return new;
end;
$$;
create trigger create_next_recurring_task_after_completion after update on public.tasks
for each row execute function public.create_next_recurring_task();

create table public.notes (
  id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  text text not null,
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  read_by uuid[] not null default '{}'
);

create table public.progress_logs (
  id text primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  employee_id uuid not null references public.profiles(id),
  description text not null,
  status public.task_status not null,
  progress integer not null check (progress between 0 and 100),
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active = true $$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(coalesce(new.email, 'user'), '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() = old.id and public.current_role() <> 'Admin' then
    new.role := old.role;
    new.active := old.active;
  end if;
  return new;
end;
$$;

create trigger protect_profile_fields_before_update
  before update on public.profiles
  for each row execute procedure public.protect_profile_fields();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.notes enable row level security;
alter table public.progress_logs enable row level security;

create policy profiles_read on public.profiles for select to authenticated
  using (active = true or id = auth.uid() or public.current_role() = 'Admin');
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.current_role() = 'Admin')
  with check (id = auth.uid() or public.current_role() = 'Admin');

create policy projects_read on public.projects for select to authenticated using (true);
create policy projects_insert on public.projects for insert to authenticated
  with check (public.current_role() = 'Admin');
create policy projects_update on public.projects for update to authenticated
  using (public.current_role() = 'Admin') with check (public.current_role() = 'Admin');
create policy projects_delete on public.projects for delete to authenticated
  using (public.current_role() = 'Admin');

create policy tasks_read on public.tasks for select to authenticated
  using (public.current_role() in ('Admin', 'Manager') or assignee_id = auth.uid());
create policy tasks_insert on public.tasks for insert to authenticated
  with check (public.current_role() = 'Manager' and created_by_id = auth.uid());
create policy tasks_update on public.tasks for update to authenticated
  using (public.current_role() in ('Admin', 'Manager') or assignee_id = auth.uid())
  with check (public.current_role() in ('Admin', 'Manager') or assignee_id = auth.uid());

create or replace function public.protect_employee_task_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() = old.assignee_id and public.current_role() in ('Senior Employee', 'Employee') then
    new.description := old.description;
    new.title := old.title;
    new.project_id := old.project_id;
    new.due := old.due;
    new.priority := old.priority;
    new.assignee_id := old.assignee_id;
    new.created_by_id := old.created_by_id;
    new.parent_id := old.parent_id;
    new.created_at := old.created_at;
    new.assigned_at := old.assigned_at;
    new.due_date := old.due_date;
    new.start_date := old.start_date;
    new.archived_at := old.archived_at;
  end if;
  return new;
end;
$$;

create trigger protect_employee_task_fields_before_update
  before update on public.tasks
  for each row execute procedure public.protect_employee_task_fields();

create policy notes_read on public.notes for select to authenticated
  using (
    public.current_role() in ('Admin', 'Manager')
    or exists (select 1 from public.tasks where tasks.id = notes.task_id and tasks.assignee_id = auth.uid())
  );
create policy notes_insert on public.notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and (public.current_role() = 'Manager' or exists (select 1 from public.tasks where tasks.id = task_id and tasks.assignee_id = auth.uid()))
  );

create policy progress_read on public.progress_logs for select to authenticated
  using (public.current_role() in ('Admin', 'Manager') or employee_id = auth.uid());
create policy progress_insert on public.progress_logs for insert to authenticated
  with check (
    employee_id = auth.uid()
    and public.current_role() = 'Employee'
    and exists (select 1 from public.tasks where tasks.id = task_id and tasks.assignee_id = auth.uid())
  );

create or replace function public.can_delegate_task(parent_task_id text, target_project_id text, target_assignee_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_role() = 'Senior Employee'
    and exists (select 1 from public.tasks where id = parent_task_id and assignee_id = auth.uid() and project_id = target_project_id and archived_at is null)
    and exists (select 1 from public.profiles where id = target_assignee_id and role = 'Employee' and active);
$$;
revoke all on function public.can_delegate_task(text, text, uuid) from public;
grant execute on function public.can_delegate_task(text, text, uuid) to authenticated;

create or replace function public.can_read_task(target_id text)
returns boolean language sql stable security definer set search_path = public
as $$
  select public.current_role() is not null and exists (
    select 1 from public.tasks t where t.id = target_id and (
      public.current_role() in ('Admin', 'Manager') or t.assignee_id = auth.uid()
      or (public.current_role() = 'Senior Employee' and t.created_by_id = auth.uid())
    )
  );
$$;
revoke all on function public.can_read_task(text) from public;
grant execute on function public.can_read_task(text) to authenticated;

create or replace function public.archive_task_tree(target_task_id text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare actor_role public.app_role; task_creator uuid; archived_ids text[];
begin
  select role into actor_role from public.profiles where id = auth.uid() and active;
  select created_by_id into task_creator from public.tasks where id = target_task_id and archived_at is null;
  if actor_role is null or task_creator is null then raise exception 'Task not found' using errcode = 'P0002'; end if;
  if actor_role not in ('Admin', 'Manager') and task_creator <> auth.uid() then raise exception 'Only the creator or an administrator can archive this task' using errcode = '42501'; end if;
  with recursive task_tree as (
    select id from public.tasks where id = target_task_id and archived_at is null
    union all select child.id from public.tasks child join task_tree parent on child.parent_id = parent.id where child.archived_at is null
  ), updated as (update public.tasks set archived_at = now() where id in (select id from task_tree) returning id)
  select array_agg(id) into archived_ids from updated;
  return coalesce(archived_ids, array[]::text[]);
end;
$$;
revoke all on function public.archive_task_tree(text) from public;
grant execute on function public.archive_task_tree(text) to authenticated;

create or replace function public.restore_task_tree(target_task_id text)
returns text[] language plpgsql security definer set search_path = public
as $$
declare actor_role public.app_role; task_creator uuid; restored_ids text[];
begin
  select role into actor_role from public.profiles where id=auth.uid() and active;
  select created_by_id into task_creator from public.tasks where id=target_task_id and archived_at is not null;
  if actor_role is null or task_creator is null then raise exception 'Archived task not found' using errcode='P0002'; end if;
  if actor_role not in ('Admin','Manager') and task_creator<>auth.uid() then raise exception 'Only the creator or an administrator can restore this task' using errcode='42501'; end if;
  with recursive descendants as (
    select id from public.tasks where id=target_task_id and archived_at is not null
    union all select child.id from public.tasks child join descendants parent on child.parent_id=parent.id where child.archived_at is not null
  ), ancestors as (
    select parent.id,parent.parent_id from public.tasks child join public.tasks parent on parent.id=child.parent_id where child.id=target_task_id and parent.archived_at is not null
    union all select parent.id,parent.parent_id from public.tasks parent join ancestors child on parent.id=child.parent_id where parent.archived_at is not null
  ), updated as (
    update public.tasks set archived_at=null where id in (select id from descendants union select id from ancestors) returning id
  ) select array_agg(id) into restored_ids from updated;
  return coalesce(restored_ids,array[]::text[]);
end;
$$;
revoke all on function public.restore_task_tree(text) from public;
grant execute on function public.restore_task_tree(text) to authenticated;

alter policy tasks_read on public.tasks using (public.can_read_task(id));
alter policy tasks_insert on public.tasks with check (
  created_by_id = auth.uid() and (public.current_role() = 'Manager'
    or public.can_delegate_task(parent_id, project_id, assignee_id))
);
alter policy notes_read on public.notes using (public.can_read_task(task_id));
alter policy notes_insert on public.notes with check (
  author_id = auth.uid() and public.can_read_task(task_id) and (
    public.current_role() = 'Manager' or exists (
      select 1 from public.tasks t where t.id = task_id and (t.assignee_id = auth.uid()
        or (public.current_role() = 'Senior Employee' and t.created_by_id = auth.uid()))
    )
  )
);
alter policy progress_read on public.progress_logs using (public.can_read_task(task_id));
alter policy progress_insert on public.progress_logs with check (
  employee_id = auth.uid() and public.current_role() in ('Senior Employee', 'Employee')
  and exists (select 1 from public.tasks t where t.id = task_id and t.assignee_id = auth.uid())
);

-- Mark only the caller's own read receipt, and only on tasks they may read.
create or replace function public.mark_task_messages_read(target_task_id text)
returns void language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.can_read_task(target_task_id) then
    raise exception 'Task not found or access denied' using errcode = '42501';
  end if;
  update public.notes
  set read_by = array_append(coalesce(read_by, '{}'::uuid[]), auth.uid())
  where task_id = target_task_id and not (auth.uid() = any(coalesce(read_by, '{}'::uuid[])));
end;
$$;
revoke all on function public.mark_task_messages_read(text) from public;
grant execute on function public.mark_task_messages_read(text) to authenticated;

alter table public.tasks add column if not exists review_state text not null default 'none' check (review_state in ('none','pending','changes_requested','approved'));
alter table public.tasks add column if not exists review_note text not null default '';
alter table public.tasks add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.tasks add column if not exists reviewed_at timestamptz;

-- Direct API writes cannot bypass the review transition function.
create or replace function public.protect_review_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.review_state <> 'none' or new.status::text in ('Complete','Completed') then raise exception 'Use the review workflow'; end if;
    elsif new.review_state is distinct from old.review_state or new.review_note is distinct from old.review_note
      or new.reviewed_by is distinct from old.reviewed_by or new.reviewed_at is distinct from old.reviewed_at
      or (new.status is distinct from old.status and new.status::text in ('Complete','Completed')) then
      raise exception 'Use the review workflow';
    end if;
  end if;
  return new;
end; $$;
create trigger protect_review_before_write before insert or update on public.tasks for each row execute function public.protect_review_fields();

create or replace function public.review_task(target_task_id text, decision text, feedback text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  target public.tasks%rowtype;
  actor_role public.app_role;
  completion_value public.task_status;
begin
  actor_role := public.current_role();
  if auth.uid() is null or actor_role is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into target from public.tasks where id=target_task_id for update;
  if not found or target.archived_at is not null or not public.can_read_task(target_task_id) then raise exception 'Active task not found' using errcode='42501'; end if;
  if decision='submit' then
    if target.assignee_id <> auth.uid() or actor_role not in ('Employee','Senior Employee') then raise exception 'Only the assignee can submit work' using errcode='42501'; end if;
    if target.review_state='pending' or target.status::text in ('Complete','Completed') then raise exception 'Task already submitted or completed'; end if;
    update public.tasks set review_state='pending',review_note='',reviewed_by=null,reviewed_at=null,status='In progress' where id=target_task_id;
  elsif decision in ('approve','request_changes') then
    if target.review_state <> 'pending' then raise exception 'Task is not awaiting review'; end if;
    if not (actor_role in ('Admin','Manager') or (actor_role='Senior Employee' and target.created_by_id=auth.uid() and target.assignee_id<>auth.uid())) then raise exception 'You cannot review this task' using errcode='42501'; end if;
    if decision='request_changes' and length(trim(feedback))=0 then raise exception 'Explain the changes required'; end if;
    if length(feedback)>5000 then raise exception 'Feedback is too long'; end if;
    if decision='approve' then
      if exists (
        with recursive descendants as (
          select id,status from public.tasks where parent_id=target_task_id
          union all select t.id,t.status from public.tasks t join descendants d on t.parent_id=d.id
        ) select 1 from descendants where status::text not in ('Complete','Completed')
      ) then raise exception 'Complete all subtasks before approving the parent task'; end if;
      select enumlabel::public.task_status into completion_value from pg_enum where enumtypid='public.task_status'::regtype and enumlabel in ('Completed','Complete') order by (enumlabel='Completed') desc limit 1;
      update public.tasks set review_state='approved', review_note=trim(feedback),reviewed_by=auth.uid(),reviewed_at=now(),status=completion_value,progress=100,completed_at=now() where id=target_task_id;
    else
      update public.tasks set review_state='changes_requested',review_note=trim(feedback),reviewed_by=auth.uid(),reviewed_at=now(),status='In progress',completed_at=null where id=target_task_id;
    end if;
  else raise exception 'Invalid review decision'; end if;
end; $$;
revoke all on function public.review_task(text,text,text) from public;
grant execute on function public.review_task(text,text,text) to authenticated;
begin;
create table if not exists public.activity_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('task','profile')),
  entity_id text not null,
  entity_label text not null,
  actor_id uuid,
  actor_name text not null,
  action text not null,
  changes jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists activity_events_entity on public.activity_events(entity_type, entity_id, id desc);
alter table public.activity_events enable row level security;
revoke all on public.activity_events from anon, authenticated;
grant select on public.activity_events to authenticated;
drop policy if exists activity_read on public.activity_events;
create policy activity_read on public.activity_events for select to authenticated using (
  public.current_role() is not null and (
    (entity_type = 'profile' and public.current_role() = 'Admin') or
    (entity_type = 'task' and public.can_read_task(entity_id))
  )
);
create or replace function public.record_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  before_row jsonb := case when TG_OP = 'UPDATE' then to_jsonb(OLD) else '{}'::jsonb end;
  after_row jsonb := to_jsonb(NEW);
  fields text[];
  field text;
  delta jsonb := '{}'::jsonb;
  actor uuid := auth.uid();
  actor_label text;
begin
  fields := case when TG_TABLE_NAME = 'tasks' then array['title','description','assignee_id','project_id','parent_id','priority','start_date','due_date','status','progress','archived_at','review_state','review_note'] else array['name','role','active'] end;
  foreach field in array fields loop
    if before_row->field is distinct from after_row->field then
      if field in ('description','review_note') then
        delta := delta || jsonb_build_object(field, jsonb_build_object('before',null,'after','Updated'));
      elsif field = 'assignee_id' then
        delta := delta || jsonb_build_object(field, jsonb_build_object('before',(select name from public.profiles where id::text = before_row->>field),'after',(select name from public.profiles where id::text = after_row->>field)));
      else
        delta := delta || jsonb_build_object(field, jsonb_build_object('before',before_row->field,'after',after_row->field));
      end if;
    end if;
  end loop;
  if delta = '{}'::jsonb then return NEW; end if;
  select name into actor_label from public.profiles where id = actor;
  insert into public.activity_events(entity_type,entity_id,entity_label,actor_id,actor_name,action,changes)
  values(case when TG_TABLE_NAME = 'tasks' then 'task' else 'profile' end,after_row->>'id',coalesce(after_row->>'title',after_row->>'name'),actor,coalesce(actor_label,'System / service'),lower(TG_OP),delta);
  return NEW;
end $$;
revoke all on function public.record_activity() from public, anon, authenticated;
drop trigger if exists record_task_activity on public.tasks;
create trigger record_task_activity after insert or update on public.tasks for each row execute function public.record_activity();
drop trigger if exists record_profile_activity on public.profiles;
create trigger record_profile_activity after insert or update on public.profiles for each row execute function public.record_activity();
commit;
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('task-attachments','task-attachments',false,10485760,array['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;
create or replace function public.can_attach_task(target text)
returns boolean language sql stable security definer set search_path=public as $$
 select public.current_role() is not null and exists(select 1 from public.tasks t where t.id=target and t.archived_at is null and (public.current_role() in ('Admin','Manager') or t.assignee_id=auth.uid() or (public.current_role()='Senior Employee' and t.created_by_id=auth.uid())));
$$;
revoke all on function public.can_attach_task(text) from public;
grant execute on function public.can_attach_task(text) to authenticated;
drop policy if exists task_attachments_read on storage.objects;
create policy task_attachments_read on storage.objects for select to authenticated using(bucket_id='task-attachments' and public.can_read_task((storage.foldername(name))[1]));
drop policy if exists task_attachments_insert on storage.objects;
create policy task_attachments_insert on storage.objects for insert to authenticated with check(bucket_id='task-attachments' and public.can_attach_task((storage.foldername(name))[1]) and array_length(storage.foldername(name),1)=1);
commit;

-- Multiple assignees per task and subtask.
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
      select 1 from unnest(new.assignee_ids) assignee(id)
      left join public.profiles profile on profile.id = assignee.id
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
      select 1 from unnest(target_assignee_ids) assignee(id) left join public.profiles profile on profile.id=assignee.id
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

-- Admin lifecycle actions use authenticated RLS instead of a service key.
begin;

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks for delete to authenticated
  using (public.current_role() = 'Admin' and archived_at is not null);

drop policy if exists task_attachments_delete on storage.objects;
create policy task_attachments_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-attachments'
    and public.current_role() = 'Admin'
    and public.can_read_task((storage.foldername(name))[1])
  );

commit;

