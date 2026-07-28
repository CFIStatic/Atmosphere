-- Supabase's default privileges grant EXECUTE on new public functions to anon,
-- which survives a plain "revoke ... from public". These two are only ever
-- called with a user JWT (both already reject a null auth.uid()), so drop the
-- anon grant explicitly rather than relying on the in-function check alone.
revoke execute on function public.enroll_device(text, text, text, text, text) from anon;
revoke execute on function public.revoke_my_devices() from anon;