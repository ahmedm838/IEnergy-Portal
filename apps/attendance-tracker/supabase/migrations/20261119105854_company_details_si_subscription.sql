-- =====================================================================
-- Company details: the subscription's sector, code and period type.
--
-- Form 1 Social Insurance (طلب اشتراك مؤمن عليه) asks, under the
-- subscription start date, for the sector (القطاع), the subscription code
-- (كود الاشتراك) and the period type (نوع المدة). They are the same for
-- every employee the company registers, so they are kept with the
-- company's other details and edited by a super admin on the Settings
-- page, written as the form should print them.
-- =====================================================================

alter table public.company_details
  add column if not exists si_sector            text,
  add column if not exists si_subscription_code text,
  add column if not exists si_period_type       text;

comment on column public.company_details.si_sector is
  'The sector (القطاع) printed on Form 1 Social Insurance.';
comment on column public.company_details.si_subscription_code is
  'The subscription code (كود الاشتراك) printed on Form 1 Social Insurance.';
comment on column public.company_details.si_period_type is
  'The period type (نوع المدة) printed on Form 1 Social Insurance.';
