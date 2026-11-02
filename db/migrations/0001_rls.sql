-- Row-level security and per-role grants.
--
-- The server logs in as genui_app, which owns nothing and holds no table
-- privileges. Each request runs in a transaction that switches to one of the
-- four genui_role_* roles with SET LOCAL ROLE and sets app.tenant_id and
-- app.user_id. Tenant isolation is a RESTRICTIVE policy on every table, so no
-- permissive policy can widen it. Column hiding (cost, margin, prices) uses
-- column grants, because RLS only filters rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genui_app') THEN
    CREATE ROLE genui_app NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genui_role_owner') THEN
    CREATE ROLE genui_role_owner NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genui_role_sales_rep') THEN
    CREATE ROLE genui_role_sales_rep NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genui_role_warehouse') THEN
    CREATE ROLE genui_role_warehouse NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'genui_role_accounts') THEN
    CREATE ROLE genui_role_accounts NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint
GRANT genui_role_owner, genui_role_sales_rep, genui_role_warehouse, genui_role_accounts
  TO genui_app WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public
  TO genui_role_owner, genui_role_sales_rep, genui_role_warehouse, genui_role_accounts;
--> statement-breakpoint

-- An unset or empty setting yields NULL, and NULL matches no row.
CREATE FUNCTION app_tenant() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- Login runs before any tenant is known, so it needs one narrow way to read a
-- password hash. Nothing else can select users.password_hash.
CREATE FUNCTION auth_lookup(p_email text)
  RETURNS TABLE (id uuid, tenant_id uuid, role user_role, name text, password_hash text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT u.id, u.tenant_id, u.role, u.name, u.password_hash
    FROM users u
    WHERE u.email = lower(p_email)
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION auth_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth_lookup(text) TO genui_app;
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users', 'customers', 'products', 'warehouses', 'stock_levels',
    'stock_adjustments', 'sales_orders', 'sales_order_lines', 'quotes',
    'purchase_orders', 'purchase_order_lines', 'dispatches', 'dispatch_events',
    'invoices', 'payments', 'ledger_entries', 'approval_requests', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I AS RESTRICTIVE FOR ALL TO PUBLIC
         USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END
$$;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenants FOR SELECT TO PUBLIC USING (id = app_tenant());
--> statement-breakpoint

-- Shared reference data. Every role reads its own tenant, its colleagues'
-- names, and the warehouse list.
GRANT SELECT ON tenants, warehouses
  TO genui_role_owner, genui_role_sales_rep, genui_role_warehouse, genui_role_accounts;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, email, name, role) ON users
  TO genui_role_owner, genui_role_sales_rep, genui_role_warehouse, genui_role_accounts;
--> statement-breakpoint
CREATE POLICY visible ON users FOR SELECT TO PUBLIC USING (true);
--> statement-breakpoint
CREATE POLICY visible ON warehouses FOR SELECT TO PUBLIC USING (true);
--> statement-breakpoint

-- Audit log. Everyone writes their own rows and reads them back for
-- idempotency checks. Owners read the whole tenant's log.
GRANT SELECT, INSERT ON audit_log
  TO genui_role_owner, genui_role_sales_rep, genui_role_warehouse, genui_role_accounts;
--> statement-breakpoint
CREATE POLICY own_rows ON audit_log FOR SELECT TO PUBLIC USING (user_id = app_user());
--> statement-breakpoint
CREATE POLICY owner_reads_all ON audit_log FOR SELECT TO genui_role_owner USING (true);
--> statement-breakpoint
CREATE POLICY write_own ON audit_log FOR INSERT TO PUBLIC WITH CHECK (user_id = app_user());
--> statement-breakpoint

-- owner: everything in the tenant, including cost and margin.
GRANT SELECT ON
  customers, products, stock_levels, stock_adjustments, sales_orders,
  sales_order_lines, quotes, purchase_orders, purchase_order_lines, dispatches,
  dispatch_events, invoices, payments, ledger_entries, approval_requests
  TO genui_role_owner;
--> statement-breakpoint
GRANT UPDATE (price_cents) ON products TO genui_role_owner;
--> statement-breakpoint
GRANT UPDATE (discount_pct) ON sales_order_lines TO genui_role_owner;
--> statement-breakpoint
GRANT UPDATE (credit_limit_cents) ON customers TO genui_role_owner;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_reason) ON approval_requests
  TO genui_role_owner;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'products', 'stock_levels', 'stock_adjustments', 'sales_orders',
    'sales_order_lines', 'quotes', 'purchase_orders', 'purchase_order_lines',
    'dispatches', 'dispatch_events', 'invoices', 'payments', 'ledger_entries',
    'approval_requests'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY owner_all ON %I FOR ALL TO genui_role_owner USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- sales_rep: own customers and their orders, stock levels. No cost, margin,
-- credit limits, invoices or ledger.
GRANT SELECT (id, tenant_id, code, name, city, owner_user_id, notes, created_at) ON customers
  TO genui_role_sales_rep;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, sku, name, category, unit, price_cents) ON products
  TO genui_role_sales_rep;
--> statement-breakpoint
GRANT SELECT ON stock_levels, sales_orders, quotes, dispatches, dispatch_events
  TO genui_role_sales_rep;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, order_id, product_id, qty, unit_price_cents, discount_pct)
  ON sales_order_lines TO genui_role_sales_rep;
--> statement-breakpoint
GRANT SELECT, INSERT ON quotes TO genui_role_sales_rep;
--> statement-breakpoint
GRANT SELECT, INSERT ON approval_requests TO genui_role_sales_rep;
--> statement-breakpoint
CREATE POLICY rep_customers ON customers FOR SELECT TO genui_role_sales_rep
  USING (owner_user_id = app_user());
--> statement-breakpoint
CREATE POLICY rep_products ON products FOR SELECT TO genui_role_sales_rep USING (true);
--> statement-breakpoint
CREATE POLICY rep_stock ON stock_levels FOR SELECT TO genui_role_sales_rep USING (true);
--> statement-breakpoint
CREATE POLICY rep_orders ON sales_orders FOR SELECT TO genui_role_sales_rep
  USING (EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id));
--> statement-breakpoint
CREATE POLICY rep_order_lines ON sales_order_lines FOR SELECT TO genui_role_sales_rep
  USING (EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = order_id));
--> statement-breakpoint
CREATE POLICY rep_dispatches ON dispatches FOR SELECT TO genui_role_sales_rep
  USING (EXISTS (SELECT 1 FROM sales_orders o WHERE o.id = order_id));
--> statement-breakpoint
CREATE POLICY rep_dispatch_events ON dispatch_events FOR SELECT TO genui_role_sales_rep
  USING (EXISTS (SELECT 1 FROM dispatches d WHERE d.id = dispatch_id));
--> statement-breakpoint
CREATE POLICY rep_quotes ON quotes FOR ALL TO genui_role_sales_rep
  USING (created_by = app_user())
  WITH CHECK (created_by = app_user() AND EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id));
--> statement-breakpoint
CREATE POLICY rep_approvals ON approval_requests FOR ALL TO genui_role_sales_rep
  USING (requested_by = app_user())
  WITH CHECK (requested_by = app_user() AND kind = 'discount' AND status = 'pending');
--> statement-breakpoint

-- warehouse: stock, dispatch queue, purchase orders. No prices or costs.
GRANT SELECT (id, tenant_id, code, name, city) ON customers TO genui_role_warehouse;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, sku, name, category, unit) ON products TO genui_role_warehouse;
--> statement-breakpoint
GRANT SELECT ON stock_levels, stock_adjustments, purchase_orders, dispatches, dispatch_events
  TO genui_role_warehouse;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, number, customer_id, status, ordered_at, required_by, notes)
  ON sales_orders TO genui_role_warehouse;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, order_id, product_id, qty) ON sales_order_lines
  TO genui_role_warehouse;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, purchase_order_id, product_id, qty, received_qty)
  ON purchase_order_lines TO genui_role_warehouse;
--> statement-breakpoint
GRANT UPDATE (status, dispatched_at, carrier) ON dispatches TO genui_role_warehouse;
--> statement-breakpoint
GRANT UPDATE (status) ON sales_orders TO genui_role_warehouse;
--> statement-breakpoint
GRANT INSERT ON dispatch_events, stock_adjustments TO genui_role_warehouse;
--> statement-breakpoint
GRANT UPDATE (on_hand) ON stock_levels TO genui_role_warehouse;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'customers', 'products', 'stock_levels', 'stock_adjustments', 'sales_orders',
    'sales_order_lines', 'purchase_orders', 'purchase_order_lines', 'dispatches',
    'dispatch_events'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY warehouse_all ON %I FOR ALL TO genui_role_warehouse USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- accounts: invoices, payments, ledger, credit limits.
GRANT SELECT (id, tenant_id, code, name, city, owner_user_id, credit_limit_cents, notes, created_at)
  ON customers TO genui_role_accounts;
--> statement-breakpoint
GRANT SELECT (id, tenant_id, number, customer_id, status, ordered_at) ON sales_orders
  TO genui_role_accounts;
--> statement-breakpoint
GRANT SELECT ON invoices, payments, ledger_entries, approval_requests TO genui_role_accounts;
--> statement-breakpoint
GRANT UPDATE (credit_limit_cents) ON customers TO genui_role_accounts;
--> statement-breakpoint
GRANT UPDATE (paid_cents, status) ON invoices TO genui_role_accounts;
--> statement-breakpoint
GRANT INSERT ON payments, ledger_entries TO genui_role_accounts;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at, decision_reason) ON approval_requests
  TO genui_role_accounts;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'sales_orders', 'invoices', 'payments', 'ledger_entries'] LOOP
    EXECUTE format(
      'CREATE POLICY accounts_all ON %I FOR ALL TO genui_role_accounts USING (true) WITH CHECK (true)', t);
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE POLICY accounts_credit_requests ON approval_requests FOR ALL TO genui_role_accounts
  USING (kind = 'credit_override') WITH CHECK (kind = 'credit_override');
