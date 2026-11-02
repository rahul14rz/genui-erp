begin;
set local role genui_role_sales_rep;
select set_config('app.tenant_id', ':tenant', true), set_config('app.user_id', ':user', true);
select o.number, o.status, o.ordered_at, c.name
  from sales_orders o join customers c on c.id = o.customer_id
  where o.ordered_at > now() - interval '30 days'
  order by o.ordered_at desc limit 50;
commit;
