create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.clinics (
  id uuid primary key default gen_random_uuid(), name text not null,
  timezone text not null default 'Asia/Karachi', created_at timestamptz not null default now()
);
create table public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  title text not null, content text not null, embedding extensions.vector(1536) not null,
  unique (clinic_id, title)
);
create table public.slots (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  starts_at timestamptz not null, is_booked boolean not null default false,
  unique (clinic_id, starts_at), unique (id, clinic_id)
);
create table public.appointments (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  slot_id uuid not null unique, patient_name text not null, patient_email text not null,
  patient_phone text not null, reason text not null,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','completed')),
  reminder_sent_at timestamptz, created_at timestamptz not null default now(),
  foreign key (slot_id, clinic_id) references public.slots(id, clinic_id), unique (id, clinic_id)
);
create table public.leads (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  name text not null, contact text not null, message text not null,
  status text not null default 'new' check (status in ('new','contacted','closed')),
  created_at timestamptz not null default now()
);
create table public.conversations (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  status text not null default 'active' check (status in ('active','follow_up')),
  handoff_reason text, pending_booking jsonb, lease_id uuid, locked_until timestamptz,
  created_at timestamptz not null default now(), unique (id, clinic_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')), content text not null,
  created_at timestamptz not null default now()
);
create table public.llm_usage (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  model text not null, prompt_tokens integer not null check (prompt_tokens >= 0),
  completion_tokens integer not null check (completion_tokens >= 0), latency_ms integer not null,
  estimated_cost_usd numeric(14,8) not null default 0, created_at timestamptz not null default now()
);
-- A transactional outbox keeps booked appointments even if the email provider is down.
create table public.email_outbox (
  id uuid primary key default gen_random_uuid(), clinic_id uuid not null references public.clinics(id),
  appointment_id uuid not null, kind text not null check (kind in ('confirmation','reminder')),
  claimed_at timestamptz, claim_token uuid, sent_at timestamptz,
  attempts integer not null default 0, created_at timestamptz not null default now(),
  unique (appointment_id, kind), foreign key (appointment_id, clinic_id) references public.appointments(id, clinic_id)
);

create index documents_embedding_idx on public.documents using hnsw (embedding extensions.vector_cosine_ops);
create index slots_available_idx on public.slots (clinic_id, starts_at) where not is_booked;
create index appointments_clinic_idx on public.appointments (clinic_id, created_at);
create index leads_clinic_idx on public.leads (clinic_id, created_at);
create index conversations_clinic_idx on public.conversations (clinic_id, created_at);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index usage_conversation_idx on public.llm_usage (conversation_id, created_at);
create index staff_clinic_idx on public.staff_profiles (clinic_id);
create index outbox_pending_idx on public.email_outbox (created_at) where sent_at is null;

create function public.staff_clinic_id() returns uuid language sql stable security definer
set search_path = '' as $$ select clinic_id from public.staff_profiles where user_id = (select auth.uid()) $$;
revoke all on function public.staff_clinic_id() from public;
grant execute on function public.staff_clinic_id() to authenticated, service_role;

alter table public.clinics enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.documents enable row level security;
alter table public.slots enable row level security;
alter table public.appointments enable row level security;
alter table public.leads enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.llm_usage enable row level security;
alter table public.email_outbox enable row level security;

create policy clinic_access on public.clinics for all to authenticated using (id = (select public.staff_clinic_id())) with check (id = (select public.staff_clinic_id()));
-- Membership is provisioned by service-role seed/admin only: staff cannot reassign themselves.
create policy own_profile on public.staff_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy documents_access on public.documents for all to authenticated using (clinic_id = (select public.staff_clinic_id())) with check (clinic_id = (select public.staff_clinic_id()));
create policy slots_access on public.slots for all to authenticated using (clinic_id = (select public.staff_clinic_id())) with check (clinic_id = (select public.staff_clinic_id()));
create policy appointments_access on public.appointments for all to authenticated using (clinic_id = (select public.staff_clinic_id())) with check (clinic_id = (select public.staff_clinic_id()));
create policy leads_access on public.leads for all to authenticated using (clinic_id = (select public.staff_clinic_id())) with check (clinic_id = (select public.staff_clinic_id()));
create policy conversations_access on public.conversations for all to authenticated using (clinic_id = (select public.staff_clinic_id())) with check (clinic_id = (select public.staff_clinic_id()));
create policy messages_access on public.messages for all to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and c.clinic_id = (select public.staff_clinic_id()))) with check (exists (select 1 from public.conversations c where c.id = conversation_id and c.clinic_id = (select public.staff_clinic_id())));
create policy usage_access on public.llm_usage for select to authenticated using (exists (select 1 from public.conversations c where c.id = conversation_id and c.clinic_id = (select public.staff_clinic_id())));
create policy outbox_access on public.email_outbox for select to authenticated using (clinic_id = (select public.staff_clinic_id()));

revoke all on all tables in schema public from anon;
grant usage on schema public, extensions to authenticated, service_role;
grant select, insert, update, delete on public.clinics, public.documents, public.slots, public.appointments, public.leads, public.conversations, public.messages to authenticated;
grant select on public.staff_profiles, public.llm_usage, public.email_outbox to authenticated;
grant all on all tables in schema public to service_role;

create function public.match_documents(query_embedding extensions.vector(1536), clinic_id uuid, match_count integer default 4)
returns table(id uuid, title text, content text, similarity double precision)
language sql stable security invoker set search_path = public, extensions as $$
  select d.id, d.title, d.content, 1 - (d.embedding <=> $1) as similarity
  from public.documents d where d.clinic_id = $2
  order by d.embedding <=> $1 limit least(greatest($3, 1), 4)
$$;
revoke all on function public.match_documents(extensions.vector, uuid, integer) from public;
grant execute on function public.match_documents(extensions.vector, uuid, integer) to authenticated, service_role;

create function public.book_appointment(p_clinic_id uuid, p_slot_id uuid, p_patient_name text, p_patient_email text, p_patient_phone text, p_reason text)
returns public.appointments language plpgsql security invoker set search_path = '' as $$
declare booked public.appointments;
begin
  update public.slots set is_booked = true where id = p_slot_id and clinic_id = p_clinic_id and not is_booked and starts_at > now();
  if not found then raise exception 'Slot unavailable' using errcode = 'P0001'; end if;
  insert into public.appointments (clinic_id, slot_id, patient_name, patient_email, patient_phone, reason)
  values (p_clinic_id, p_slot_id, p_patient_name, p_patient_email, p_patient_phone, p_reason) returning * into booked;
  insert into public.email_outbox (clinic_id, appointment_id, kind) values (p_clinic_id, booked.id, 'confirmation');
  return booked;
end $$;

create function public.acquire_conversation(p_id uuid, p_clinic_id uuid, p_lease uuid)
returns setof public.conversations language sql security invoker set search_path = '' as $$
  update public.conversations set lease_id = p_lease, locked_until = now() + interval '5 minutes'
  where id = p_id and clinic_id = p_clinic_id and (locked_until is null or locked_until < now()) returning *
$$;
create function public.enqueue_reminders()
returns void language sql security invoker set search_path = '' as $$
  insert into public.email_outbox (clinic_id, appointment_id, kind)
  select a.clinic_id, a.id, 'reminder' from public.appointments a
  join public.slots s on s.id = a.slot_id and s.clinic_id = a.clinic_id
  where a.status = 'confirmed' and a.reminder_sent_at is null
    and s.starts_at between now() + interval '23 hours' and now() + interval '25 hours'
  on conflict (appointment_id, kind) do nothing
$$;
create function public.claim_emails(p_token uuid, p_appointment_id uuid default null)
returns setof public.email_outbox language sql security invoker set search_path = '' as $$
  update public.email_outbox set claimed_at = now(), claim_token = p_token, attempts = attempts + 1
  where id in (
    select o.id from public.email_outbox o
    where o.sent_at is null and (o.claimed_at is null or o.claimed_at < now() - interval '5 minutes')
      and (p_appointment_id is null or o.appointment_id = p_appointment_id)
    order by o.created_at limit 50 for update skip locked
  ) returning *
$$;
create function public.complete_email(p_id uuid, p_token uuid, p_success boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare finished public.email_outbox;
begin
  update public.email_outbox set sent_at = case when p_success then now() else null end,
    claimed_at = null, claim_token = null where id = p_id and claim_token = p_token and sent_at is null returning * into finished;
  if p_success and finished.kind = 'reminder' then
    update public.appointments set reminder_sent_at = now() where id = finished.appointment_id and clinic_id = finished.clinic_id;
  end if;
end $$;

revoke all on function public.book_appointment(uuid,uuid,text,text,text,text), public.acquire_conversation(uuid,uuid,uuid), public.enqueue_reminders(), public.claim_emails(uuid,uuid), public.complete_email(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.book_appointment(uuid,uuid,text,text,text,text), public.acquire_conversation(uuid,uuid,uuid), public.enqueue_reminders(), public.claim_emails(uuid,uuid), public.complete_email(uuid,uuid,boolean) to service_role;
