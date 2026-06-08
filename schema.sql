create table if not exists public.branch_printers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,

  name text not null,
  role text not null default 'receipt'
    check (role in ('receipt', 'kitchen', 'bar', 'label', 'cash_drawer')),

  is_active boolean not null default true,

  -- Example: {"type":"network","ip":"192.168.1.50","port":9100,"mac":"AA:BB:CC:DD:EE:FF"}
  connection jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists branch_printers_branch_role_idx
  on public.branch_printers (branch_id, role, is_active);

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  printer_id uuid references public.branch_printers(id) on delete set null,

  job_type text not null
    check (job_type in (
      'sales_ticket',
      'invoice',
      'kitchen_ticket',
      'bar_ticket',
      'food_ticket',
      'kds_ticket',
      'label_ticket',
      'test_ticket'
    )),

  status text not null default 'to_print'
    check (status in ('to_print', 'printing', 'printed', 'failed', 'cancelled')),

  order_id uuid references public.branch_orders(id) on delete set null,
  payment_id uuid references public.branch_payments(id) on delete set null,
  order_item_ids uuid[] not null default '{}',

  payload jsonb not null,

  dedupe_key text not null,

  priority int not null default 100,
  attempts int not null default 0,
  max_attempts int not null default 3,

  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  locked_by text,
  locked_at timestamptz,
  locked_until timestamptz,

  printed_at timestamptz,
  failed_at timestamptz,
  last_error text,

  meta jsonb not null default '{}'::jsonb
);

create unique index if not exists print_jobs_dedupe_key_idx
  on public.print_jobs (dedupe_key);

create index if not exists print_jobs_poll_idx
  on public.print_jobs (branch_id, status, available_at, priority, created_at);

create index if not exists print_jobs_payment_idx
  on public.print_jobs (payment_id);

create index if not exists print_jobs_order_idx
  on public.print_jobs (order_id);

create or replace function public.claim_print_jobs(
  p_branch_id uuid,
  p_agent_id text,
  p_limit int default 5
)
returns setof public.print_jobs
language sql
security definer
as $$
  update public.print_jobs j
  set
    status = 'printing',
    locked_by = p_agent_id,
    locked_at = now(),
    locked_until = now() + interval '2 minutes',
    attempts = attempts + 1
  where j.id in (
    select id
    from public.print_jobs
    where branch_id = p_branch_id
      and status = 'to_print'
      and available_at <= now()
    order by priority asc, created_at asc
    limit p_limit
    for update skip locked
  )
  returning j.*;
$$;
