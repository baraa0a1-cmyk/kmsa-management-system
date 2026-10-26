-- KMSA v5.9: cohorts exist independently of organizational cycles.
-- Requires 0017; run once via migration or SQL editor, not both.
create table if not exists public.kmsa_batches (
 batch_number integer primary key check(batch_number between 1 and 999),
 display_name text not null unique,
 academic_level smallint check(academic_level between 1 and 6),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
insert into public.kmsa_batches(batch_number,display_name)
select distinct batch_number,'الدفعة '||batch_number from (
 select batch_number from public.cycle_batches
 union
 select batch_number from public.profiles where batch_number is not null
) source where batch_number between 1 and 999
on conflict(batch_number) do nothing;
alter table public.kmsa_batches enable row level security;
drop policy if exists kmsa_batches_admin_read on public.kmsa_batches;
create policy kmsa_batches_admin_read on public.kmsa_batches for select to authenticated
 using(exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active and p.role='ADMIN'));
grant select on public.kmsa_batches to authenticated;
revoke insert,update,delete on public.kmsa_batches from anon,authenticated;

create table if not exists public.kmsa_batch_transfers (
 id uuid primary key default gen_random_uuid(),
 profile_id uuid not null references public.profiles(id),
 from_batch integer references public.kmsa_batches(batch_number),
 to_batch integer not null references public.kmsa_batches(batch_number),
 changed_by uuid not null references public.profiles(id),
 changed_at timestamptz not null default now()
);
create index if not exists kmsa_batch_transfers_profile_idx on public.kmsa_batch_transfers(profile_id,changed_at desc);
alter table public.kmsa_batch_transfers enable row level security;
drop policy if exists kmsa_batch_transfers_admin_read on public.kmsa_batch_transfers;
create policy kmsa_batch_transfers_admin_read on public.kmsa_batch_transfers for select to authenticated
 using(exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active and p.role='ADMIN'));
grant select on public.kmsa_batch_transfers to authenticated;
revoke insert,update,delete on public.kmsa_batch_transfers from anon,authenticated;

-- Make transfer + history insertion atomic. The caller must be a verified system administrator.
create or replace function public.admin_move_kmsa_member(p_profile_id uuid,p_to_batch integer)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; previous_batch integer;
begin
 select p.id into actor from public.profiles p where p.auth_user_id=auth.uid() and p.active and p.role='ADMIN';
 if actor is null then raise exception 'ADMIN_REQUIRED'; end if;
 if not exists(select 1 from public.kmsa_batches where batch_number=p_to_batch and active) then raise exception 'BATCH_NOT_AVAILABLE'; end if;
 select p.batch_number into previous_batch from public.profiles p where p.id=p_profile_id and p.active and p.role<>'ADMIN' for update;
 if not found then raise exception 'MEMBER_NOT_FOUND'; end if;
 if previous_batch is not distinct from p_to_batch then return; end if;
 update public.profiles set batch_number=p_to_batch,updated_at=now() where id=p_profile_id;
 insert into public.kmsa_batch_transfers(profile_id,from_batch,to_batch,changed_by)
 values(p_profile_id,previous_batch,p_to_batch,actor);
end $$;
revoke all on function public.admin_move_kmsa_member(uuid,integer) from public,anon;
grant execute on function public.admin_move_kmsa_member(uuid,integer) to authenticated;

-- An archived cycle remains immutable. Keep a single active cycle, based on cycles.is_current.
create unique index if not exists kmsa_one_current_cycle_guard on public.cycles ((is_current)) where is_current;

-- Ninth constitutional executive seat: Assistant General Secretary.
-- Explicitly NOT mapped to GS to avoid unintentionally granting general-secretary powers.
create table if not exists public.kmsa_cycle_gs_assistants (
 cycle_id uuid primary key references public.cycles(id) on delete cascade,
 profile_id uuid not null references public.profiles(id),
 assigned_at timestamptz not null default now()
);
alter table public.kmsa_cycle_gs_assistants enable row level security;
drop policy if exists kmsa_cycle_assistants_admin_read on public.kmsa_cycle_gs_assistants;
create policy kmsa_cycle_assistants_admin_read on public.kmsa_cycle_gs_assistants for select to authenticated
 using(exists(select 1 from public.profiles p where p.auth_user_id=auth.uid() and p.active and p.role='ADMIN'));
grant select on public.kmsa_cycle_gs_assistants to authenticated;
revoke insert,update,delete on public.kmsa_cycle_gs_assistants from anon,authenticated;

-- Cycle metadata and the legacy current_cycle setting must change together.
create or replace function public.admin_update_kmsa_cycle(p_cycle_id uuid,p_code text,p_name text,p_start_date date)
returns void language plpgsql security definer set search_path=public as $$
declare actor uuid; was_current boolean;
begin
 select p.id into actor from public.profiles p where p.auth_user_id=auth.uid() and p.active and p.role='ADMIN';
 if actor is null then raise exception 'ADMIN_REQUIRED'; end if;
 if p_code !~ '^KMSA[0-9]{1,5}$' or length(trim(p_name))<3 or length(p_name)>120 then raise exception 'CYCLE_METADATA_INVALID'; end if;
 select c.is_current into was_current from public.cycles c where c.id=p_cycle_id and c.status<>'CLOSED' for update;
 if not found then raise exception 'CYCLE_NOT_EDITABLE'; end if;
 update public.cycles set code=p_code,name=trim(p_name),cycle_start_date=p_start_date where id=p_cycle_id;
 if was_current then
  insert into public.system_settings(key,value,updated_by,updated_at)
  values('current_cycle',to_jsonb(p_code),actor,now())
  on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 end if;
end $$;
revoke all on function public.admin_update_kmsa_cycle(uuid,text,text,date) from public,anon;
grant execute on function public.admin_update_kmsa_cycle(uuid,text,text,date) to authenticated;
