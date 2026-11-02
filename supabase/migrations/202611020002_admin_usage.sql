create function public.usage_summary(p_clinic_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with scoped as (
    select u.* from public.llm_usage u join public.conversations c on c.id = u.conversation_id where c.clinic_id = p_clinic_id
  ), daily as (
    select (created_at at time zone 'Asia/Karachi')::date as day, count(*) as requests
    from scoped where created_at >= now() - interval '30 days'
    group by 1 order by 1
  )
  select jsonb_build_object(
    'total_tokens', coalesce(sum(prompt_tokens + completion_tokens), 0),
    'total_cost_usd', coalesce(sum(estimated_cost_usd), 0),
    'average_latency_ms', coalesce(round(avg(latency_ms)), 0),
    'total_calls', count(*),
    'daily', coalesce((select jsonb_agg(daily) from daily), '[]'::jsonb)
  ) from scoped
$$;
revoke all on function public.usage_summary(uuid) from public, anon;
grant execute on function public.usage_summary(uuid) to authenticated, service_role;
