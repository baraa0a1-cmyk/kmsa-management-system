create table public.background_jobs (
  id uuid primary key default gen_random_uuid(), job_type text not null, entity_type text not null, entity_id uuid,
  payload jsonb not null default '{}'::jsonb, status text not null default 'PENDING', attempts integer not null default 0,
  run_after timestamptz not null default now(), locked_at timestamptz, last_error text,
  created_at timestamptz not null default now(), completed_at timestamptz
);
create index background_jobs_pending_idx on public.background_jobs(status,run_after);
alter table public.background_jobs enable row level security;
revoke all on public.background_jobs from anon,authenticated;

create table public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text unique not null, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('staging','staging',false,15728640,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','audio/ogg','audio/mpeg'])
on conflict(id) do nothing;

create policy staging_select_own on storage.objects for select to authenticated
using (bucket_id='staging' and (storage.foldername(name))[1]=auth.uid()::text);
create policy staging_insert_own on storage.objects for insert to authenticated
with check (bucket_id='staging' and (storage.foldername(name))[1]=auth.uid()::text);
create policy staging_delete_own on storage.objects for delete to authenticated
using (bucket_id='staging' and (storage.foldername(name))[1]=auth.uid()::text);
