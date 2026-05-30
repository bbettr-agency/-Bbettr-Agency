-- ============================================================================
-- Supabase Storage — client file bucket with tenant-scoped access.
--
-- Files are stored under a path prefixed with the tenant's client_id:
--   client-files/<client_id>/<timestamp>-<filename>
--
-- The first path segment (client_id) is matched against the user's tenant so
-- clients can only read/write within their own folder. Admins see all.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('client-files', 'client-files', false)
on conflict (id) do nothing;

-- Read: admins anywhere; clients only inside their own tenant folder.
create policy "Read client files"
  on storage.objects for select
  using (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_client_id()::text
    )
  );

-- Insert: admins anywhere; clients only inside their own tenant folder.
create policy "Upload client files"
  on storage.objects for insert
  with check (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_client_id()::text
    )
  );

-- Delete: admins anywhere; clients only inside their own tenant folder.
create policy "Delete client files"
  on storage.objects for delete
  using (
    bucket_id = 'client-files'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_client_id()::text
    )
  );
