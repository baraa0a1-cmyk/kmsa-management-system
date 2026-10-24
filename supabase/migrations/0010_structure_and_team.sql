-- KMSA structure & team engine
-- Flexible operational structure without hard-coding current bylaws into the UI.

create table if not exists public.org_bodies (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  parent_body_id uuid references public.org_bodies(id),
  name text not null,
  body_type text not null default 'OFFICE' check (body_type in ('OFFICE','COMMITTEE','COUNCIL','CLUB','LIBRARY','TEAM','UNIT','OTHER')),
  purpose text,
  nature text not null default 'ONGOING' check (nature in ('ONGOING','TEMPORARY')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','FROZEN')),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  frozen_at timestamptz,
  frozen_reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_positions (
  id uuid primary key default gen_random_uuid(),
  secretariat_id uuid not null references public.secretariats(id),
  body_id uuid references public.org_bodies(id),
  title text not null,
  position_kind text not null default 'OTHER' check (position_kind in ('HEAD','DEPUT','COORDINATOR','SECRETARY','RAPPORTEUR','OTHER')),
  scope_label text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','FROZEN')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.org_bodies add column if not exists supervisor_position_id uuid references public.org_positions(id) on delete set null;

create table if not exists public.org_memberships (
  id uuid primary key default gen_random_uuid(),
  body_id uuid not null references public.org_bodies(id),
  profile_id uuid not null references public.profiles(id),
  membership_label text not null default 'عضو',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_appointments (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.org_positions(id),
  profile_id uuid not null references public.profiles(id),
  appointment_type text not null default 'PRIMARY' check (appointment_type in ('PRIMARY','ACTING','INTERIM')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','ENDED')),
  start_at timestamptz not null default now(),
  end_at timestamptz,
  note text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists org_memberships_active_unique
  on public.org_memberships(body_id,profile_id) where status='ACTIVE';
create unique index if not exists org_appointments_active_primary_unique
  on public.org_appointments(position_id) where status='ACTIVE' and appointment_type='PRIMARY';
create index if not exists org_bodies_secretariat_idx on public.org_bodies(secretariat_id,status,body_type);
create index if not exists org_positions_secretariat_idx on public.org_positions(secretariat_id,body_id,status);
create index if not exists org_memberships_body_idx on public.org_memberships(body_id,status);
create index if not exists org_appointments_position_idx on public.org_appointments(position_id,status);

-- Touch triggers.
drop trigger if exists org_bodies_touch on public.org_bodies;
create trigger org_bodies_touch before update on public.org_bodies for each row execute function public.touch_updated_at();
drop trigger if exists org_positions_touch on public.org_positions;
create trigger org_positions_touch before update on public.org_positions for each row execute function public.touch_updated_at();
drop trigger if exists org_memberships_touch on public.org_memberships;
create trigger org_memberships_touch before update on public.org_memberships for each row execute function public.touch_updated_at();
drop trigger if exists org_appointments_touch on public.org_appointments;
create trigger org_appointments_touch before update on public.org_appointments for each row execute function public.touch_updated_at();

alter table public.org_bodies enable row level security;
alter table public.org_positions enable row level security;
alter table public.org_memberships enable row level security;
alter table public.org_appointments enable row level security;

grant select on public.org_bodies,public.org_positions,public.org_memberships,public.org_appointments to authenticated;

create or replace function public.can_read_org_secretariat(p_secretariat uuid) returns boolean
language sql stable security definer set search_path=public as $$
 select public.current_role()::text in ('GS','PRESIDENT','ADMIN')
   or (public.current_role()::text='SECRETARY' and p_secretariat=public.current_secretariat_id());
$$;
grant execute on function public.can_read_org_secretariat(uuid) to authenticated;

drop policy if exists org_bodies_read on public.org_bodies;
create policy org_bodies_read on public.org_bodies for select to authenticated using (public.can_read_org_secretariat(secretariat_id));
drop policy if exists org_positions_read on public.org_positions;
create policy org_positions_read on public.org_positions for select to authenticated using (public.can_read_org_secretariat(secretariat_id));
drop policy if exists org_memberships_read on public.org_memberships;
create policy org_memberships_read on public.org_memberships for select to authenticated using (
  exists(select 1 from public.org_bodies b where b.id=body_id and public.can_read_org_secretariat(b.secretariat_id))
);
drop policy if exists org_appointments_read on public.org_appointments;
create policy org_appointments_read on public.org_appointments for select to authenticated using (
  exists(select 1 from public.org_positions p where p.id=position_id and public.can_read_org_secretariat(p.secretariat_id))
);

-- One compact snapshot for the secretary/GS structure screen. It intentionally exposes only
-- operational structure data and current/historical appointments, not auth secrets.
create or replace function public.org_structure_snapshot(p_secretariat_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare sid uuid; out jsonb;
begin
 sid:=coalesce(p_secretariat_id,public.current_secretariat_id());
 if sid is null then raise exception 'حدد السكرتارية'; end if;
 if not public.can_read_org_secretariat(sid) then raise exception 'غير مسموح'; end if;
 select jsonb_build_object(
  'secretariat',(select to_jsonb(s) from public.secretariats s where s.id=sid),
  'secretary',(select jsonb_build_object('id',p.id,'full_name',p.full_name,'university_id',p.university_id) from public.profiles p where p.secretariat_id=sid and p.role='SECRETARY' and p.active=true order by p.updated_at desc limit 1),
  'bodies',coalesce((select jsonb_agg(to_jsonb(b) order by case when b.status='ACTIVE' then 0 else 1 end,b.name) from public.org_bodies b where b.secretariat_id=sid),'[]'::jsonb),
  'positions',coalesce((select jsonb_agg(to_jsonb(p) order by p.body_id nulls first,p.title) from public.org_positions p where p.secretariat_id=sid),'[]'::jsonb),
  'appointments',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'position_id',a.position_id,'profile_id',a.profile_id,'appointment_type',a.appointment_type,'status',a.status,
      'start_at',a.start_at,'end_at',a.end_at,'note',a.note,
      'profile',jsonb_build_object('id',pr.id,'full_name',pr.full_name,'university_id',pr.university_id,'email',pr.email)
    ) order by a.start_at desc)
    from public.org_appointments a join public.org_positions pos on pos.id=a.position_id join public.profiles pr on pr.id=a.profile_id
    where pos.secretariat_id=sid),'[]'::jsonb),
  'memberships',coalesce((select jsonb_agg(jsonb_build_object(
      'id',m.id,'body_id',m.body_id,'profile_id',m.profile_id,'membership_label',m.membership_label,'status',m.status,
      'start_at',m.start_at,'end_at',m.end_at,'note',m.note,
      'profile',jsonb_build_object('id',pr.id,'full_name',pr.full_name,'university_id',pr.university_id,'email',pr.email)
    ) order by m.start_at desc)
    from public.org_memberships m join public.org_bodies b on b.id=m.body_id join public.profiles pr on pr.id=m.profile_id
    where b.secretariat_id=sid),'[]'::jsonb)
 ) into out;
 return out;
end $$;
grant execute on function public.org_structure_snapshot(uuid) to authenticated;
