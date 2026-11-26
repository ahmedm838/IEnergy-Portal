-- The order of the tiles on the portal's main page, set in Settings >
-- Page access with the up and down arrows. One row per page; the lowest
-- position comes first. A tile with no row keeps its place after the
-- ones that have one, in the order the page itself lists them.
create table if not exists page_order (
  page        text      primary key,
  position    smallint  not null,
  updated_at  timestamptz not null default now(),
  constraint page_order_page_name check (page ~ '^[a-z0-9-]{1,60}$')
);

comment on table page_order is
  'Order of the tiles on the portal main page (Settings > Page access). Lowest position first.';

alter table page_order enable row level security;

drop policy if exists page_order_read on page_order;
create policy page_order_read on page_order
  for select to authenticated
  using (true);

drop policy if exists page_order_write on page_order;
create policy page_order_write on page_order
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());

grant select, insert, update, delete on page_order to authenticated;

drop trigger if exists page_order_touch on page_order;
create trigger page_order_touch
  before update on page_order
  for each row execute function page_access_touch();

-- The order the main page has today.
insert into page_order (page, position) values
  ('attendance-tracker', 1),
  ('employee-database',  2),
  ('hr-documents',       3),
  ('employee-documents', 4),
  ('company-structure',  5),
  ('contacts-list',      6),
  ('salary-calculator',  7),
  ('company-policy',     8),
  ('settings',           9)
on conflict (page) do nothing;
