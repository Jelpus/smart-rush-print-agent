create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.print_agent_activations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,

  agent_name text,
  agent_code text,
  secret_hash text not null unique,

  expires_at timestamptz not null,
  used_at timestamptz,
  used_by_agent_id uuid references public.print_agents(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists print_agent_activations_branch_idx
  on public.print_agent_activations (branch_id, expires_at);

create index if not exists print_agent_activations_unused_idx
  on public.print_agent_activations (expires_at)
  where used_at is null;

create or replace function public.create_print_agent_activation(
  p_branch_id uuid,
  p_agent_name text default null,
  p_agent_code text default null,
  p_expires_minutes int default 30
)
returns table (
  activation_id uuid,
  activation_secret text,
  expires_at timestamptz,
  tenant_id uuid,
  branch_id uuid,
  branch_name text,
  agent_name text,
  agent_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branch record;
  v_activation_id uuid;
  v_expires_minutes int;
  v_expires_at timestamptz;
  v_secret text;
  v_agent_name text;
  v_agent_code text;
begin
  if p_branch_id is null then
    raise exception 'missing_branch_id';
  end if;

  select b.id, b.tenant_id, b.name
  into v_branch
  from public.branches b
  where b.id = p_branch_id;

  if not found then
    raise exception 'branch_not_found';
  end if;

  v_agent_code := nullif(btrim(p_agent_code), '');

  if v_agent_code is not null and (
    exists (
      select 1
      from public.print_agents a
      where a.agent_code = v_agent_code
    )
    or exists (
      select 1
      from public.print_agent_activations a
      where a.agent_code = v_agent_code
        and a.used_at is null
        and a.expires_at > now()
    )
  ) then
    raise exception 'agent_code_already_exists';
  end if;

  v_agent_name := coalesce(
    nullif(btrim(p_agent_name), ''),
    'SmartRush Android Agent ' || coalesce(v_branch.name, v_branch.id::text)
  );
  v_secret := 'srpaa_' || encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_minutes := greatest(5, least(coalesce(p_expires_minutes, 30), 1440));
  v_expires_at := now() + make_interval(mins => v_expires_minutes);

  insert into public.print_agent_activations (
    tenant_id,
    branch_id,
    agent_name,
    agent_code,
    secret_hash,
    expires_at
  )
  values (
    v_branch.tenant_id,
    v_branch.id,
    v_agent_name,
    v_agent_code,
    encode(extensions.digest(v_secret, 'sha256'), 'hex'),
    v_expires_at
  )
  returning id into v_activation_id;

  activation_id := v_activation_id;
  activation_secret := v_secret;
  expires_at := v_expires_at;
  tenant_id := v_branch.tenant_id;
  branch_id := v_branch.id;
  branch_name := v_branch.name;
  agent_name := v_agent_name;
  agent_code := v_agent_code;
  return next;
end;
$$;

revoke all on function public.create_print_agent_activation(uuid, text, text, int) from public;
revoke all on function public.create_print_agent_activation(uuid, text, text, int) from anon;
revoke all on function public.create_print_agent_activation(uuid, text, text, int) from authenticated;
grant execute on function public.create_print_agent_activation(uuid, text, text, int) to service_role;

create or replace function public.activate_print_agent(
  p_activation_id uuid,
  p_activation_secret text,
  p_agent_name text default null
)
returns table (
  agent_id uuid,
  agent_token text,
  tenant_id uuid,
  branch_id uuid,
  branch_name text,
  agent_name text,
  agent_code text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_activation public.print_agent_activations;
  v_branch_name text;
  v_agent_id uuid;
  v_agent_name text;
  v_token text;
begin
  if p_activation_id is null or coalesce(p_activation_secret, '') = '' then
    raise exception 'missing_activation_credentials' using errcode = '28000';
  end if;

  select *
  into v_activation
  from public.print_agent_activations a
  where a.id = p_activation_id
  for update;

  if not found then
    raise exception 'invalid_activation' using errcode = '28000';
  end if;

  if v_activation.used_at is not null then
    raise exception 'activation_already_used' using errcode = '28000';
  end if;

  if v_activation.expires_at <= now() then
    raise exception 'activation_expired' using errcode = '28000';
  end if;

  if v_activation.secret_hash <> encode(extensions.digest(p_activation_secret, 'sha256'), 'hex') then
    raise exception 'invalid_activation' using errcode = '28000';
  end if;

  select b.name
  into v_branch_name
  from public.branches b
  where b.id = v_activation.branch_id;

  v_agent_name := coalesce(
    nullif(btrim(p_agent_name), ''),
    v_activation.agent_name,
    'SmartRush Android Agent ' || coalesce(v_branch_name, v_activation.branch_id::text)
  );
  v_token := 'srpa_' || encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.print_agents (
    tenant_id,
    branch_id,
    name,
    agent_code,
    token_hash,
    last_agent_name
  )
  values (
    v_activation.tenant_id,
    v_activation.branch_id,
    v_agent_name,
    v_activation.agent_code,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_agent_name
  )
  returning id into v_agent_id;

  update public.print_agent_activations
  set used_at = now(),
      used_by_agent_id = v_agent_id,
      updated_at = now()
  where id = v_activation.id;

  agent_id := v_agent_id;
  agent_token := v_token;
  tenant_id := v_activation.tenant_id;
  branch_id := v_activation.branch_id;
  branch_name := v_branch_name;
  agent_name := v_agent_name;
  agent_code := v_activation.agent_code;
  return next;
exception
  when unique_violation then
    raise exception 'agent_code_already_exists';
end;
$$;

revoke all on function public.activate_print_agent(uuid, text, text) from public;
grant execute on function public.activate_print_agent(uuid, text, text) to anon, authenticated;
