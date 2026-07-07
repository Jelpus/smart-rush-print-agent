create table if not exists public.print_agent_releases (
  id uuid primary key default gen_random_uuid(),

  platform text not null default 'android'
    check (platform in ('android')),
  channel text not null default 'stable',

  version_code int not null check (version_code > 0),
  version_name text not null,
  apk_url text not null,
  release_notes text,

  is_active boolean not null default true,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (platform, channel, version_code)
);

create index if not exists print_agent_releases_latest_idx
  on public.print_agent_releases (platform, channel, is_active, version_code desc, published_at desc);

revoke all on public.print_agent_releases from public;
revoke all on public.print_agent_releases from anon;
revoke all on public.print_agent_releases from authenticated;
grant all on public.print_agent_releases to service_role;

-- Example release:
-- insert into public.print_agent_releases (
--   platform,
--   channel,
--   version_code,
--   version_name,
--   apk_url,
--   release_notes
-- )
-- values (
--   'android',
--   'stable',
--   4,
--   '0.4.0',
--   'https://print.smartrush.io/android/SmartRush-Print-Agent-Android.apk',
--   'Detector de actualizaciones integrado.'
-- );
