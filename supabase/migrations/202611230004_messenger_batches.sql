begin;

create function public.oniro_ingest_messenger_batch(p_events jsonb)
returns uuid[] language plpgsql set search_path = '' as $$
declare
  item jsonb;
  result jsonb;
  conversations uuid[] := '{}';
begin
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events) > 2000 then
    raise exception 'Invalid Messenger batch' using errcode = '22023';
  end if;
  -- Adjacent deliveries can overlap Pages. Lock them in a consistent order.
  for item in select value from jsonb_array_elements(p_events) with ordinality
    order by value ->> 'pageId', ordinality
  loop
    result := public.oniro_ingest_messenger_event(item);
    if item ->> 'kind' = 'message' and result ->> 'result' = 'stored' then
      conversations := array_append(conversations, (result ->> 'conversation_id')::uuid);
    end if;
  end loop;
  return conversations;
end;
$$;

create function public.oniro_messenger_profile_context(p_conversation_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'organization_id', c.organization_id, 'channel_id', c.channel_id, 'contact_id', c.contact_id,
    'page_id', t.external_page_id, 'recipient_id', p.external_contact_id,
    'token_ciphertext', k.token_ciphertext
  )
  from public.conversations c
  join public.contacts p on (p.organization_id, p.channel_id, p.id) = (c.organization_id, c.channel_id, c.contact_id)
  join public.channels t on (t.organization_id, t.id) = (c.organization_id, c.channel_id)
  join oniro_private.channel_credentials k on (k.organization_id, k.channel_id) = (c.organization_id, c.channel_id)
  where c.id = p_conversation_id and t.status = 'connected' and p.display_name = 'Messenger contact';
$$;

revoke all on function public.oniro_ingest_messenger_batch(jsonb), public.oniro_messenger_profile_context(uuid)
  from public, anon, authenticated;
grant execute on function public.oniro_ingest_messenger_batch(jsonb), public.oniro_messenger_profile_context(uuid) to service_role;

commit;
