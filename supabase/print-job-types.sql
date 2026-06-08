alter table public.print_jobs
  drop constraint if exists print_jobs_job_type_check;

alter table public.print_jobs
  add constraint print_jobs_job_type_check
  check (job_type in (
    'sales_ticket',
    'invoice',
    'kitchen_ticket',
    'bar_ticket',
    'food_ticket',
    'kds_ticket',
    'label_ticket',
    'test_ticket'
  ));
