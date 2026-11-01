-- Lets the server confirm, on every request, that the user in a token still
-- exists with the same tenant and role. Tokens are not trusted on their own.
CREATE FUNCTION auth_check(p_user uuid, p_tenant uuid, p_role user_role)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = p_user AND u.tenant_id = p_tenant AND u.role = p_role)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_check(uuid, uuid, user_role) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_check(uuid, uuid, user_role) TO genui_app;
