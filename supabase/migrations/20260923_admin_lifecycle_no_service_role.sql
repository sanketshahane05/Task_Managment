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

