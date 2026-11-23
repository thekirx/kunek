begin;

create or replace function public.oniro_ingest_messenger_event(p_event jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_kind text := p_event ->> 'kind';
  v_page text := p_event ->> 'pageId';
  v_recipient text := p_event ->> 'senderId';
  v_mid text := p_event ->> 'messageId';
  v_client_request text := p_event ->> 'clientRequestId';
  v_timestamp timestamptz;
  v_watermark timestamptz;
  v_channel public.channels;
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_receipts_written integer := 0;
  v_count integer;
begin
  if v_kind is null or v_kind not in ('message', 'echo', 'delivery', 'read')
    or coalesce(length(v_page), 0) not between 1 and 200
    or coalesce(length(v_recipient), 0) not between 1 and 200
    or coalesce(p_event ->> 'timestamp', '') !~ '^[0-9]{1,14}$'
    or (v_kind in ('message', 'echo') and coalesce(length(v_mid), 0) not between 1 and 500)
    or (v_kind = 'delivery' and p_event ? 'messageIds' and jsonb_typeof(p_event -> 'messageIds') <> 'array')
    or (p_event ->> 'watermark' is not null and (p_event ->> 'watermark') !~ '^[0-9]{1,14}$')
    or (v_kind = 'read' and p_event ->> 'watermark' is null) then
    raise exception 'Invalid Messenger event' using errcode = '22023';
  end if;

  v_timestamp := to_timestamp((p_event ->> 'timestamp')::double precision / 1000.0);
  v_watermark := to_timestamp((p_event ->> 'watermark')::double precision / 1000.0);
  -- This lock orders receipt, webhook, and send writes for one Page.
  select * into v_channel from public.channels
  where provider = 'messenger' and external_page_id = v_page and status <> 'disconnected'
  for update;
  if not found then
    return jsonb_build_object('result', 'ignored');
  end if;

  if v_kind in ('delivery', 'read') then
    if v_watermark is not null then
      insert into oniro_private.messenger_receipts (
        channel_id, recipient_id, external_message_id, delivery_watermark, read_watermark
      ) values (
        v_channel.id, v_recipient, '',
        case when v_kind = 'delivery' then v_watermark end,
        case when v_kind = 'read' then v_watermark end
      ) on conflict (channel_id, recipient_id, external_message_id) do update set
        delivery_watermark = greatest(messenger_receipts.delivery_watermark, excluded.delivery_watermark),
        read_watermark = greatest(messenger_receipts.read_watermark, excluded.read_watermark)
      where messenger_receipts.delivery_watermark < excluded.delivery_watermark
        or messenger_receipts.read_watermark < excluded.read_watermark
        or (messenger_receipts.delivery_watermark is null and excluded.delivery_watermark is not null)
        or (messenger_receipts.read_watermark is null and excluded.read_watermark is not null);
      get diagnostics v_receipts_written = row_count;
    end if;
    if v_kind = 'delivery' and p_event ? 'messageIds' then
      insert into oniro_private.messenger_receipts (channel_id, recipient_id, external_message_id, delivered_at)
      select distinct v_channel.id, v_recipient, mid, v_timestamp
      from jsonb_array_elements_text(p_event -> 'messageIds') as ids(mid)
      where length(mid) between 1 and 500
      on conflict (channel_id, recipient_id, external_message_id) do update set delivered_at = excluded.delivered_at
      where messenger_receipts.delivered_at < excluded.delivered_at;
      get diagnostics v_count = row_count;
      v_receipts_written := v_receipts_written + v_count;
    end if;

    select c.id into v_conversation_id
    from public.conversations c join public.contacts t on t.id = c.contact_id
    where c.channel_id = v_channel.id and t.external_contact_id = v_recipient;
    if found then
      perform oniro_private.apply_messenger_receipts(v_channel.id, v_conversation_id, v_recipient);
    end if;
    return jsonb_build_object('result', case when v_receipts_written > 0 then 'stored' else 'duplicate' end,
      'conversation_id', v_conversation_id);
  end if;

  select m.id, m.conversation_id into v_message_id, v_conversation_id
  from public.messages m where m.channel_id = v_channel.id and m.external_message_id = v_mid;
  if found then
    -- The API response can precede the echo. Record the provider clock once for receipt comparisons.
    if v_kind = 'echo' then
      update public.messages m set provider_sent_at = v_timestamp
      from public.conversations c join public.contacts t on t.id = c.contact_id
      where m.id = v_message_id and m.conversation_id = c.id and t.external_contact_id = v_recipient
        and m.direction = 'outbound' and m.provider_sent_at is null;
      if found then
        perform oniro_private.apply_messenger_receipts(v_channel.id, v_conversation_id, v_recipient);
      end if;
    end if;
    return jsonb_build_object('result', 'duplicate', 'conversation_id', v_conversation_id, 'message_id', v_message_id);
  end if;

  insert into public.contacts (organization_id, channel_id, external_contact_id, display_name)
  values (v_channel.organization_id, v_channel.id, v_recipient, 'Messenger contact')
  on conflict (channel_id, external_contact_id) do nothing
  returning id into v_contact_id;
  if v_contact_id is null then
    select id into v_contact_id from public.contacts where channel_id = v_channel.id and external_contact_id = v_recipient;
  end if;

  insert into public.conversations (organization_id, channel_id, contact_id, external_thread_id)
  values (v_channel.organization_id, v_channel.id, v_contact_id, v_recipient)
  on conflict (channel_id, contact_id) do nothing
  returning id into v_conversation_id;
  if v_conversation_id is null then
    select id into v_conversation_id from public.conversations where channel_id = v_channel.id and contact_id = v_contact_id;
  end if;

  if v_kind = 'message' then
    insert into public.messages (organization_id, channel_id, conversation_id, external_message_id, direction, status, body, sent_at)
    values (v_channel.organization_id, v_channel.id, v_conversation_id, v_mid, 'inbound', 'received', p_event ->> 'text', v_timestamp)
    on conflict (channel_id, external_message_id) do nothing
    returning id into v_message_id;
    if v_message_id is null then
      return jsonb_build_object('result', 'duplicate', 'conversation_id', v_conversation_id);
    end if;

    update public.conversations
    set unread_count = unread_count + 1,
        last_message_at = greatest(last_message_at, v_timestamp),
        last_customer_message_at = greatest(last_customer_message_at, v_timestamp),
        -- Meta's event clock can trail the database clock that set resolved_at.
        -- Reopening on a borderline message is safer than hiding a new customer message.
        status = case
          when status = 'resolved' and (resolved_at is null or v_timestamp >= resolved_at - interval '1 minute') then 'open'::public.conversation_status
          else status
        end,
        resolved_at = case
          when status = 'resolved' and (resolved_at is null or v_timestamp >= resolved_at - interval '1 minute') then null
          else resolved_at
        end
    where id = v_conversation_id;
  else
    if v_client_request ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
      update public.messages
      set external_message_id = v_mid, status = 'sent', sent_at = v_timestamp, provider_sent_at = v_timestamp
      where organization_id = v_channel.organization_id and channel_id = v_channel.id
        and conversation_id = v_conversation_id and direction = 'outbound' and outgoing_reserved_at is not null
        and client_request_id = v_client_request::uuid and external_message_id is null
      returning id into v_message_id;
    end if;
    if v_message_id is null then
      insert into public.messages (
        organization_id, channel_id, conversation_id, external_message_id, client_request_id, direction, status, body, sent_at, provider_sent_at
      ) values (
        v_channel.organization_id, v_channel.id, v_conversation_id, v_mid, gen_random_uuid(), 'outbound', 'sent',
        p_event ->> 'text', v_timestamp, v_timestamp
      ) returning id into v_message_id;
    end if;

    perform oniro_private.record_response(v_conversation_id, v_timestamp);
    perform oniro_private.apply_messenger_receipts(v_channel.id, v_conversation_id, v_recipient);
  end if;
  return jsonb_build_object('result', 'stored', 'conversation_id', v_conversation_id, 'message_id', v_message_id);
end;
$$;

commit;
