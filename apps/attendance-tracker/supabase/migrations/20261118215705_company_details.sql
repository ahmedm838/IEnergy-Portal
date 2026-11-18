-- =====================================================================
-- Company details, for the forms that print them.
--
-- One row: the company's Arabic name, the social insurance office it
-- belongs to, its establishment (insurance) number and its address.
-- Form 1 Social Insurance (طلب اشتراك مؤمن عليه) in HR Documents prints
-- them: the office at the top, the establishment number in its boxes,
-- the name and, on the back, the name, number and address again.
--
-- Everyone signed in reads it, as with the other reference tables; only
-- a super admin edits it, on the Settings page.
-- =====================================================================

create table if not exists public.company_details (
  id               smallint primary key default 1 check (id = 1),
  name_ar          text not null default 'شركة اي انيرجي لصناعة العدادات',
  si_office        text,
  establishment_no text check (establishment_no is null or establishment_no ~ '^[0-9]{1,8}$'),
  address_ar       text,
  updated_at       timestamptz not null default now()
);

comment on table public.company_details is
  'The company''s details as the forms print them (one row). Super admins edit it in Settings.';
comment on column public.company_details.si_office is
  'The social insurance office (مكتب) the company belongs to.';
comment on column public.company_details.establishment_no is
  'The establishment''s insurance number (رقم المنشأة), up to 8 digits.';

insert into public.company_details (id) values (1) on conflict (id) do nothing;

alter table public.company_details enable row level security;

drop policy if exists company_details_read on public.company_details;
create policy company_details_read on public.company_details
  for select to authenticated
  using (my_role() <> 'no_access'::app_role);

drop policy if exists company_details_write on public.company_details;
create policy company_details_write on public.company_details
  for update to authenticated
  using (is_super_admin())
  with check (is_super_admin());

grant select, update on public.company_details to authenticated;
