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

