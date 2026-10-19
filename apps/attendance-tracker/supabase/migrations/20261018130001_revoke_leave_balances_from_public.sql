-- =====================================================================
-- Actually close the leave_balances hole.
--
-- The previous migration revoked EXECUTE from authenticated and anon and
-- changed nothing: PostgreSQL grants EXECUTE on a new function to PUBLIC,
-- and every role inherits that. Revoking from a role it was never granted
-- to directly is a no-op, which is a quiet way to believe something is
-- locked when it is not -- a signed-in user could still read any
-- employee's leave position.
--
-- The guard keeps working: it calls this from inside a SECURITY DEFINER
-- function, where privileges are the owner's rather than the caller's.
-- =====================================================================

revoke all on function leave_balances(uuid, integer) from public;
revoke all on function leave_balances(uuid, integer) from anon;
revoke all on function leave_balances(uuid, integer) from authenticated;

-- check_leave_balances is the guard's own entry point and takes an
-- arbitrary employee id too. It returns void, so it leaks nothing, but
-- nothing outside the triggers has any business calling it.
revoke all on function check_leave_balances(uuid, integer) from public;
revoke all on function check_leave_balances(uuid, integer) from anon;
revoke all on function check_leave_balances(uuid, integer) from authenticated;
