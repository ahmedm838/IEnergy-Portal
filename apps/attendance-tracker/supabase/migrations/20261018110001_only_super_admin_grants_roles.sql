-- =====================================================================
-- Only a super admin may hand out an elevated role.
--
-- The previous guard protected super_admin alone, which left the obvious
-- way round it open: an admin could make a second account an admin, or
-- demote an existing one. Both are now restricted, so an admin can only
-- move people between the two unprivileged roles.
--
--   super_admin : may set any role
--   admin       : may set user or no_access, and only on accounts that
--                 are not already admin or super_admin
--
-- New employees default to 'user', so nothing has to be granted for
-- someone to start work.
-- =====================================================================

create or replace function guard_super_admin_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  elevated constant app_role[] := array['admin', 'super_admin']::app_role[];
begin
  -- No JWT means direct database access (SQL editor, service role), which
  -- is already beyond anything this guard could protect. Leaving that path
  -- open is also the only way back in if the last super admin is lost.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role = any(elevated) and not is_super_admin() then
      raise exception 'Only a super admin can create an account with the % role', new.role
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Unchanged role: an admin editing someone's title or department must
  -- not be blocked just because that person happens to be an admin.
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- Granting an elevated role, or taking one away, both need super admin.
  -- Without the second half, an admin could demote the super admin and
  -- then promote themselves.
  if (new.role = any(elevated) or old.role = any(elevated)) and not is_super_admin() then
    raise exception
      'Only a super admin can change a role to or from admin or super admin'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

comment on function guard_super_admin_grants() is
  'Restricts granting and removing the admin and super_admin roles to super admins.';
