create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.print_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,

  name text not null,
  agent_code text,
  token_hash text not null unique,
  is_active boolean not null default true,

  last_seen_at timestamptz,
  last_agent_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.print_agents
  add column if not exists poll_interval_ms int not null default 5000,
  add column if not exists batch_size int not null default 5,
  add column if not exists retry_delay_seconds int not null default 30;

do $$
begin
  alter table public.print_agents
    add constraint print_agents_poll_interval_ms_check
    check (poll_interval_ms between 1000 and 60000);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.print_agents
    add constraint print_agents_batch_size_check
    check (batch_size between 1 and 25);
exception
  when duplicate_object then null;
end;
$$;

do $$
begin
  alter table public.print_agents
    add constraint print_agents_retry_delay_seconds_check
    check (retry_delay_seconds between 1 and 300);
exception
  when duplicate_object then null;
end;
$$;

create index if not exists print_agents_branch_active_idx
  on public.print_agents (branch_id, is_active);

create unique index if not exists print_agents_agent_code_idx
  on public.print_agents (agent_code)
  where agent_code is not null;

create or replace function public.create_print_agent(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_name text,
  p_agent_code text default null
)
returns table (
  agent_id uuid,
  agent_token text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text;
begin
  if not exists (
    select 1
    from public.branches b
    where b.id = p_branch_id
      and b.tenant_id = p_tenant_id
  ) then
    raise exception 'branch_does_not_belong_to_tenant';
  end if;

  v_token := 'srpa_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.print_agents (
    tenant_id,
    branch_id,
    name,
    agent_code,
    token_hash
  )
  values (
    p_tenant_id,
    p_branch_id,
    p_name,
    p_agent_code,
    encode(extensions.digest(v_token, 'sha256'), 'hex')
  )
  returning id into agent_id;

  agent_token := v_token;
  return next;
end;
$$;

revoke all on function public.create_print_agent(uuid, uuid, text, text) from public;
revoke all on function public.create_print_agent(uuid, uuid, text, text) from anon;
revoke all on function public.create_print_agent(uuid, uuid, text, text) from authenticated;

create or replace function public._print_agent_from_token(
  p_agent_token text
)
returns public.print_agents
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
begin
  if p_agent_token is null or p_agent_token = '' then
    raise exception 'missing_print_agent_token' using errcode = '28000';
  end if;

  select *
  into v_agent
  from public.print_agents
  where token_hash = encode(extensions.digest(p_agent_token, 'sha256'), 'hex')
    and is_active = true;

  if not found then
    raise exception 'invalid_print_agent_token' using errcode = '28000';
  end if;

  return v_agent;
end;
$$;

revoke all on function public._print_agent_from_token(text) from public;
revoke all on function public._print_agent_from_token(text) from anon;
revoke all on function public._print_agent_from_token(text) from authenticated;

create or replace function public.get_agent_printers(
  p_agent_token text
)
returns table (
  id uuid,
  name text,
  role text,
  connection jsonb,
  settings jsonb
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
begin
  v_agent := public._print_agent_from_token(p_agent_token);

  update public.print_agents
  set last_seen_at = now(),
      updated_at = now()
  where print_agents.id = v_agent.id;

  return query
  select
    p.id,
    p.name,
    p.role,
    p.connection,
    p.settings
  from public.branch_printers p
  where p.tenant_id = v_agent.tenant_id
    and p.branch_id = v_agent.branch_id
    and p.is_active = true
  order by p.role asc, p.created_at asc;
end;
$$;

grant execute on function public.get_agent_printers(text) to anon, authenticated;

create or replace function public.get_print_agent_config(
  p_agent_token text
)
returns table (
  poll_interval_ms int,
  batch_size int,
  retry_delay_seconds int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
begin
  v_agent := public._print_agent_from_token(p_agent_token);

  update public.print_agents
  set last_seen_at = now(),
      updated_at = now()
  where print_agents.id = v_agent.id;

  return query
  select
    greatest(1000, least(coalesce(a.poll_interval_ms, 5000), 60000))::int,
    greatest(1, least(coalesce(a.batch_size, 5), 25))::int,
    greatest(1, least(coalesce(a.retry_delay_seconds, 30), 300))::int
  from public.print_agents a
  where a.id = v_agent.id;
end;
$$;

grant execute on function public.get_print_agent_config(text) to anon, authenticated;

create or replace function public.claim_print_jobs_for_agent(
  p_agent_token text,
  p_agent_name text default null,
  p_limit int default 5
)
returns setof public.print_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
  v_limit int;
begin
  v_agent := public._print_agent_from_token(p_agent_token);
  v_limit := greatest(1, least(coalesce(p_limit, 5), 25));

  update public.print_agents
  set last_seen_at = now(),
      last_agent_name = coalesce(p_agent_name, last_agent_name),
      updated_at = now()
  where print_agents.id = v_agent.id;

  return query
  update public.print_jobs j
  set
    status = 'printing',
    locked_by = v_agent.id::text,
    locked_at = now(),
    locked_until = now() + interval '2 minutes',
    attempts = j.attempts + 1,
    last_error = null
  where j.id in (
    select id
    from public.print_jobs
    where tenant_id = v_agent.tenant_id
      and branch_id = v_agent.branch_id
      and attempts < max_attempts
      and (
        (status = 'to_print' and available_at <= now())
        or (status = 'printing' and locked_until <= now())
      )
    order by priority asc, created_at asc
    limit v_limit
    for update skip locked
  )
  returning j.*;
end;
$$;

grant execute on function public.claim_print_jobs_for_agent(text, text, int) to anon, authenticated;

create or replace function public.complete_print_job_for_agent(
  p_agent_token text,
  p_job_id uuid
)
returns public.print_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
  v_job public.print_jobs;
begin
  v_agent := public._print_agent_from_token(p_agent_token);

  update public.print_agents
  set last_seen_at = now(),
      updated_at = now()
  where print_agents.id = v_agent.id;

  update public.print_jobs j
  set
    status = 'printed',
    printed_at = now(),
    failed_at = null,
    locked_by = null,
    locked_at = null,
    locked_until = null,
    last_error = null
  where j.id = p_job_id
    and j.tenant_id = v_agent.tenant_id
    and j.branch_id = v_agent.branch_id
    and j.status = 'printing'
    and j.locked_by = v_agent.id::text
  returning j.* into v_job;

  if not found then
    raise exception 'print_job_not_locked_by_agent';
  end if;

  return v_job;
end;
$$;

grant execute on function public.complete_print_job_for_agent(text, uuid) to anon, authenticated;

create or replace function public.fail_print_job_for_agent(
  p_agent_token text,
  p_job_id uuid,
  p_error text,
  p_retry_delay_seconds int default 30
)
returns table (
  final_failure boolean,
  status text,
  attempts int,
  max_attempts int
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agent public.print_agents;
  v_job public.print_jobs;
  v_final_failure boolean;
  v_retry_delay interval;
begin
  v_agent := public._print_agent_from_token(p_agent_token);
  v_retry_delay := make_interval(secs => greatest(1, coalesce(p_retry_delay_seconds, 30)));

  update public.print_agents
  set last_seen_at = now(),
      updated_at = now()
  where print_agents.id = v_agent.id;

  select *
  into v_job
  from public.print_jobs j
  where j.id = p_job_id
    and j.tenant_id = v_agent.tenant_id
    and j.branch_id = v_agent.branch_id
    and j.status = 'printing'
    and j.locked_by = v_agent.id::text
  for update;

  if not found then
    raise exception 'print_job_not_locked_by_agent';
  end if;

  v_final_failure := v_job.attempts >= v_job.max_attempts;

  if v_final_failure then
    update public.print_jobs j
    set
      status = 'failed',
      failed_at = now(),
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'Unknown print error'), 1000)
    where j.id = v_job.id
    returning true, j.status, j.attempts, j.max_attempts
    into final_failure, status, attempts, max_attempts;
  else
    update public.print_jobs j
    set
      status = 'to_print',
      available_at = now() + v_retry_delay,
      failed_at = null,
      locked_by = null,
      locked_at = null,
      locked_until = null,
      last_error = left(coalesce(p_error, 'Unknown print error'), 1000)
    where j.id = v_job.id
    returning false, j.status, j.attempts, j.max_attempts
    into final_failure, status, attempts, max_attempts;
  end if;

  return next;
end;
$$;

grant execute on function public.fail_print_job_for_agent(text, uuid, text, int) to anon, authenticated;
