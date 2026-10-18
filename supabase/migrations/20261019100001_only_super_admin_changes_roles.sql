-- =====================================================================
-- Every role change is a super admin's to make.
--
-- The previous guard protected only the elevated roles: an admin could
-- still move somebody between user and no_access. That was a deliberate
-- middle ground, and it is now too loose -- access is granted in one
-- place, by one kind of account, and the Settings page that offers it is
-- already super admin only. Leaving the database more permissive than
-- the page would mean the real rule lived in the UI, which is exactly
-- the arrangement every other guard here exists to avoid.
--
-- A new employee therefore arrives with no access and stays that way
-- until a super admin says otherwise, whichever route created the row --
-- the portal's Database page, the REST API, or anything else.
-- =====================================================================

create or replace function guard_super_admin_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- No JWT means direct database access (SQL editor, service role, and
  -- the install migrations that create the first administrator). Already
  -- beyond anything this guard could enforce, and the only way back in if
  -- the last super admin is ever lost.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Creating a personnel record is not granting anybody anything.
    if new.role is distinct from 'no_access'::app_role and not is_super_admin() then
      raise exception
        'Only a super admin can give an account the % role. New employees start with no access.',
        new.role
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- An admin editing somebody's title or department must not be blocked
  -- just because that person happens to hold a role.
  if new.role is not distinct from old.role then
    return new;
  end if;

  if not is_super_admin() then
    raise exception 'Only a super admin can change what access an account has'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $fn$;

comment on function guard_super_admin_grants() is
  'Restricts every role change, and any role other than no_access on a new row, to super admins.';
