begin;

alter table oniro_private.channel_credentials
  add column operation_id uuid,
  add column operation_kind text check (operation_kind in ('connect', 'disconnect')),
  add column operation_expires_at timestamptz,
  add constraint channel_credentials_operation_complete check (
    (operation_id is null and operation_kind is null and operation_expires_at is null) or
    (operation_id is not null and operation_kind is not null and operation_expires_at is not null)
  );

alter table public.messages
  add column outgoing_reserved_at timestamptz,
  add column provider_sent_at timestamptz,
  add column delivered_at timestamptz,
  add column read_at timestamptz;

create index messages_outgoing_receipts_idx on public.messages (conversation_id, sent_at)
  where direction = 'outbound' and status = 'sent';

create table oniro_private.messenger_receipts (
  channel_id uuid not null references public.channels on delete cascade,
  recipient_id text not null,
  -- The empty ID stores provider watermarks. Nonempty IDs store explicit delivery acknowledgements.
  external_message_id text not null,
  delivered_at timestamptz,
  delivery_watermark timestamptz,
  read_watermark timestamptz,
  primary key (channel_id, recipient_id, external_message_id)
);
alter table oniro_private.messenger_receipts enable row level security;
revoke all on oniro_private.messenger_receipts from public, anon, authenticated;
grant select, insert, update, delete on oniro_private.messenger_receipts to service_role;

create policy profiles_read_teammates on public.profiles for select to authenticated
  using (exists (
    select 1 from public.organization_members m
    where m.user_id = profiles.id
      and m.organization_id in (select oniro_private.member_orgs())
  ));

create function oniro_private.require_member(p_actor uuid, p_org uuid, p_manager boolean default false)
returns void language plpgsql set search_path = '' as $$
begin
  perform 1 from public.organization_members m
  where m.user_id = p_actor and m.organization_id = p_org
    and (not p_manager or m.role in ('owner', 'admin'))
  for share;
  if not found then
    raise exception 'Organization membership required' using errcode = '42501';
  end if;
end;
$$;

create function public.oniro_create_organization(p_actor uuid, p_name text, p_display_name text)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_org uuid;
begin
  if p_actor is null or p_name is null or p_display_name is null
    or length(btrim(p_name)) not between 1 and 100 or length(btrim(p_display_name)) not between 1 and 100 then
    raise exception 'Invalid organization details' using errcode = '22023';
  end if;

  insert into public.profiles (id, display_name) values (p_actor, btrim(p_display_name))
  on conflict (id) do nothing;
  insert into public.organizations (name) values (btrim(p_name)) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role) values (v_org, p_actor, 'owner');
  insert into public.organization_subscriptions (organization_id, plan_id, status) values (v_org, 'starter', 'unpaid');
  return jsonb_build_object('organization_id', v_org);
end;
$$;

create function public.oniro_reserve_channel(
  p_actor uuid, p_org uuid, p_page_id text, p_name text, p_token_ciphertext text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_channel public.channels;
  v_credentials oniro_private.channel_credentials;
  v_operation uuid := gen_random_uuid();
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  if p_page_id is null or length(p_page_id) not between 1 and 200 or p_page_id <> btrim(p_page_id)
    or p_name is null or length(btrim(p_name)) not between 1 and 500
    or p_token_ciphertext is null or p_token_ciphertext = '' then
    raise exception 'Invalid channel details' using errcode = '22023';
  end if;

  -- Serialize attempts for the same Page even when there is no channel row yet.
  perform pg_advisory_xact_lock(hashtextextended('oniro:messenger:' || p_page_id, 0));
  if exists (
    select 1 from public.channels
    where provider = 'messenger' and external_page_id = p_page_id and organization_id <> p_org
  ) then
    raise exception 'Page is already linked to another organization' using errcode = '55000';
  end if;

  select * into v_channel from public.channels
  where organization_id = p_org and provider = 'messenger' and external_page_id = p_page_id
  for update;
  if found then
    select * into v_credentials from oniro_private.channel_credentials where channel_id = v_channel.id;
    if v_credentials.operation_expires_at > clock_timestamp() then
      raise exception 'A Page operation is already in progress' using errcode = '55000';
    end if;
    update public.channels set name = btrim(p_name), status = 'attention' where id = v_channel.id;
  else
    insert into public.channels (organization_id, external_page_id, name, status)
    values (p_org, p_page_id, btrim(p_name), 'attention') returning * into v_channel;
  end if;

  insert into oniro_private.channel_credentials (
    organization_id, channel_id, token_ciphertext, operation_id, operation_kind, operation_expires_at
  ) values (
    p_org, v_channel.id, p_token_ciphertext, v_operation, 'connect', clock_timestamp() + interval '5 minutes'
  ) on conflict (channel_id) do update set
    token_ciphertext = excluded.token_ciphertext, operation_id = excluded.operation_id,
    operation_kind = excluded.operation_kind, operation_expires_at = excluded.operation_expires_at;
  return jsonb_build_object('channel_id', v_channel.id, 'operation_id', v_operation);
end;
$$;

create function public.oniro_reserve_disconnect(p_actor uuid, p_org uuid, p_channel_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_channel public.channels;
  v_credentials oniro_private.channel_credentials;
  v_operation uuid := gen_random_uuid();
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  select * into v_channel from public.channels where organization_id = p_org and id = p_channel_id for update;
  if not found then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  if v_channel.status = 'disconnected' then
    return jsonb_build_object('channel_id', v_channel.id, 'status', v_channel.status);
  end if;

  select * into v_credentials from oniro_private.channel_credentials where channel_id = v_channel.id;
  if not found then
    raise exception 'Page credentials are unavailable' using errcode = '55000';
  end if;
  if v_credentials.operation_expires_at > clock_timestamp() then
    raise exception 'A Page operation is already in progress' using errcode = '55000';
  end if;

  update public.channels set status = 'attention' where id = v_channel.id;
  update oniro_private.channel_credentials
  set operation_id = v_operation, operation_kind = 'disconnect',
      operation_expires_at = clock_timestamp() + interval '5 minutes'
  where channel_id = v_channel.id;

  return jsonb_build_object('channel_id', v_channel.id, 'operation_id', v_operation,
    'page_id', v_channel.external_page_id, 'token_ciphertext', v_credentials.token_ciphertext, 'status', 'attention');
end;
$$;

create function oniro_private.finish_channel_operation(
  p_actor uuid, p_org uuid, p_channel_id uuid, p_operation_id uuid, p_success boolean, p_kind text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_status public.channel_status;
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  perform 1 from public.channels where organization_id = p_org and id = p_channel_id for update;
  if not found then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  if p_success is null or not exists (
    select 1 from oniro_private.channel_credentials
    where organization_id = p_org and channel_id = p_channel_id
      and operation_id = p_operation_id and operation_kind = p_kind
  ) then
    raise exception 'Page operation has changed' using errcode = '55000';
  end if;

  v_status := case when not p_success then 'attention'
    when p_kind = 'connect' then 'connected' else 'disconnected' end;
  update public.channels
    set status = v_status, connected_at = case v_status
      when 'connected' then clock_timestamp() when 'disconnected' then null else connected_at end
    where id = p_channel_id;
  if v_status = 'disconnected' then
    delete from oniro_private.channel_credentials where channel_id = p_channel_id;
  else
    update oniro_private.channel_credentials
      set operation_id = null, operation_kind = null, operation_expires_at = null
      where channel_id = p_channel_id;
  end if;
  return jsonb_build_object('channel_id', p_channel_id, 'status', v_status);
end;
$$;

create function public.oniro_finish_channel(
  p_actor uuid, p_org uuid, p_channel_id uuid, p_operation_id uuid, p_success boolean
)
returns jsonb language sql set search_path = '' as $$
  select oniro_private.finish_channel_operation(p_actor, p_org, p_channel_id, p_operation_id, p_success, 'connect');
$$;

create function public.oniro_finish_disconnect(
  p_actor uuid, p_org uuid, p_channel_id uuid, p_operation_id uuid, p_success boolean
)
returns jsonb language sql set search_path = '' as $$
  select oniro_private.finish_channel_operation(p_actor, p_org, p_channel_id, p_operation_id, p_success, 'disconnect');
$$;

create function oniro_private.apply_messenger_receipts(p_channel_id uuid, p_conversation_id uuid, p_recipient_id text)
returns void language sql set search_path = '' as $$
  with receipts as (
    select m.id,
      greatest(m.delivered_at, d.delivered_at,
        case when coalesce(m.provider_sent_at, m.sent_at) <= w.delivery_watermark then w.delivery_watermark end) as delivered_at,
      greatest(m.read_at, case when coalesce(m.provider_sent_at, m.sent_at) <= w.read_watermark then w.read_watermark end) as read_at
    from public.messages m
    left join oniro_private.messenger_receipts w
      on w.channel_id = p_channel_id and w.recipient_id = p_recipient_id and w.external_message_id = ''
    left join oniro_private.messenger_receipts d
      on d.channel_id = p_channel_id and d.recipient_id = p_recipient_id and d.external_message_id = m.external_message_id
    where m.channel_id = p_channel_id and m.conversation_id = p_conversation_id
      and m.direction = 'outbound' and m.status = 'sent' and m.external_message_id is not null
  )
  update public.messages m set delivered_at = r.delivered_at, read_at = r.read_at
  from receipts r where m.id = r.id
    and (m.delivered_at, m.read_at) is distinct from (r.delivered_at, r.read_at);
$$;

create function oniro_private.record_response(p_conversation_id uuid, p_sent_at timestamptz)
returns void language sql set search_path = '' as $$
  update public.conversations
  set last_message_at = greatest(last_message_at, p_sent_at),
      first_response_at = coalesce(first_response_at, p_sent_at)
  where id = p_conversation_id
    and (last_message_at is null or last_message_at < p_sent_at
      or first_response_at is null);
$$;

create function public.oniro_ingest_messenger_event(p_event jsonb)
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
        last_customer_message_at = greatest(last_customer_message_at, v_timestamp)
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

create function public.oniro_reserve_outgoing(
  p_actor uuid, p_org uuid, p_conversation_id uuid, p_client_request_id uuid, p_body text
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_channel public.channels;
  v_conversation public.conversations;
  v_message public.messages;
  v_token_ciphertext text;
  v_recipient text;
  v_now timestamptz;
begin
  perform oniro_private.require_member(p_actor, p_org);
  if p_client_request_id is null or p_body is null or length(btrim(p_body)) not between 1 and 2000 then
    raise exception 'Invalid outgoing message' using errcode = '22023';
  end if;
  select * into v_conversation from public.conversations where organization_id = p_org and id = p_conversation_id;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  select * into v_channel from public.channels where organization_id = p_org and id = v_conversation.channel_id for update;
  select * into v_conversation from public.conversations where organization_id = p_org and id = p_conversation_id for update;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;

  select * into v_message from public.messages where organization_id = p_org and client_request_id = p_client_request_id;
  if not found then
    v_now := clock_timestamp();
    if v_channel.status is distinct from 'connected'::public.channel_status then
      raise exception 'Messenger Page is disconnected' using errcode = '55000';
    end if;
    if v_conversation.last_customer_message_at is null
      or v_conversation.last_customer_message_at <= v_now - interval '24 hours'
      or v_conversation.last_customer_message_at > v_now then
      raise exception 'The 24-hour Messenger reply window is closed' using errcode = '55000';
    end if;

    select token_ciphertext into v_token_ciphertext from oniro_private.channel_credentials where channel_id = v_channel.id;
    if not found then
      raise exception 'Page credentials are unavailable' using errcode = '55000';
    end if;
    select external_contact_id into strict v_recipient from public.contacts
      where organization_id = p_org and channel_id = v_channel.id and id = v_conversation.contact_id;

    insert into public.messages (
      organization_id, channel_id, conversation_id, client_request_id, direction, status, body, outgoing_reserved_at
    ) values (
      p_org, v_channel.id, p_conversation_id, p_client_request_id, 'outbound', 'queued', p_body, v_now
    ) on conflict (organization_id, client_request_id) do nothing returning * into v_message;
    if found then
      return jsonb_build_object('message_id', v_message.id, 'status', v_message.status, 'should_send', true,
        'page_id', v_channel.external_page_id, 'recipient_id', v_recipient, 'token_ciphertext', v_token_ciphertext);
    end if;
    select * into strict v_message from public.messages where organization_id = p_org and client_request_id = p_client_request_id;
  end if;

  if v_message.conversation_id <> p_conversation_id or v_message.body is distinct from p_body
    or v_message.outgoing_reserved_at is null then
    raise exception 'Request ID already used for a different message' using errcode = '55000';
  end if;
  return jsonb_build_object('message_id', v_message.id, 'status', v_message.status, 'should_send', false,
    'external_message_id', v_message.external_message_id);
end;
$$;

create function public.oniro_finish_outgoing(
  p_actor uuid, p_org uuid, p_message_id uuid, p_outcome text, p_external_message_id text default null
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_message public.messages;
  v_echo public.messages;
  v_recipient text;
begin
  perform oniro_private.require_member(p_actor, p_org);
  if p_outcome is null or p_outcome not in ('sent', 'failed', 'unknown')
    or (p_outcome = 'sent' and coalesce(length(p_external_message_id), 0) not between 1 and 500) then
    raise exception 'Invalid send outcome' using errcode = '22023';
  end if;

  select * into v_message from public.messages
  where organization_id = p_org and id = p_message_id and outgoing_reserved_at is not null;
  if not found then
    raise exception 'Outgoing message not found' using errcode = 'P0002';
  end if;
  perform 1 from public.channels where id = v_message.channel_id for update;
  perform 1 from public.conversations where id = v_message.conversation_id for update;
  select * into v_message from public.messages
  where organization_id = p_org and id = p_message_id and outgoing_reserved_at is not null for update;
  if not found then
    raise exception 'Outgoing message not found' using errcode = 'P0002';
  end if;

  if p_outcome = 'sent' and v_message.status <> 'sent' then
    -- Echoes can arrive before the send response, including echoes without client metadata.
    select * into v_echo from public.messages
    where channel_id = v_message.channel_id and external_message_id = p_external_message_id;
    if found then
      if v_echo.conversation_id <> v_message.conversation_id or v_echo.direction <> 'outbound'
        or v_echo.outgoing_reserved_at is not null then
        raise exception 'Messenger message ID is already in use' using errcode = '55000';
      end if;
      delete from public.messages where id = v_echo.id;
    end if;

    update public.messages
    set external_message_id = p_external_message_id, status = 'sent',
        sent_at = coalesce(v_echo.sent_at, clock_timestamp()), provider_sent_at = v_echo.provider_sent_at,
        delivered_at = v_echo.delivered_at, read_at = v_echo.read_at
    where id = v_message.id returning * into v_message;
    select t.external_contact_id into strict v_recipient
    from public.conversations c join public.contacts t on t.id = c.contact_id where c.id = v_message.conversation_id;
    perform oniro_private.record_response(v_message.conversation_id, v_message.sent_at);
    perform oniro_private.apply_messenger_receipts(v_message.channel_id, v_message.conversation_id, v_recipient);
  elsif p_outcome = 'failed' and v_message.status = 'queued' then
    update public.messages set status = 'failed' where id = v_message.id returning * into v_message;
  elsif p_outcome = 'sent' and v_message.external_message_id is distinct from p_external_message_id then
    raise exception 'Messenger message ID does not match the saved result' using errcode = '55000';
  end if;

  return jsonb_build_object('message_id', v_message.id, 'status', v_message.status,
    'external_message_id', v_message.external_message_id);
end;
$$;

create function public.oniro_mutate_conversation(
  p_actor uuid, p_org uuid, p_conversation_id uuid, p_action text, p_data jsonb default '{}'
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_conversation public.conversations;
  v_id uuid;
  v_assignee_id uuid;
  v_current_assignee uuid;
  v_name text;
  v_value text;
  v_now timestamptz;
begin
  perform oniro_private.require_member(p_actor, p_org);
  select * into v_conversation from public.conversations where organization_id = p_org and id = p_conversation_id for update;
  if not found then
    raise exception 'Conversation not found' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Invalid conversation action details' using errcode = '22023';
  end if;

  case p_action
    when 'note' then
      v_value := btrim(p_data ->> 'body');
      if coalesce(length(v_value), 0) not between 1 and 5000 then
        raise exception 'Invalid note' using errcode = '22023';
      end if;
      insert into public.conversation_notes (organization_id, conversation_id, author_id, body)
      values (p_org, p_conversation_id, p_actor, v_value) returning id into v_id;
    when 'status' then
      v_value := p_data ->> 'status';
      if v_value is null or v_value not in ('new', 'open', 'pending', 'resolved') then
        raise exception 'Invalid conversation status' using errcode = '22023';
      end if;
      update public.conversations
      set status = v_value::public.conversation_status,
          resolved_at = case when v_value = 'resolved' then coalesce(resolved_at, clock_timestamp()) end
      where id = p_conversation_id and status <> v_value::public.conversation_status;
    when 'lead' then
      v_value := p_data ->> 'leadStatus';
      if v_value is null or v_value not in ('new_lead', 'interested', 'quotation_sent', 'booked', 'closed_won', 'closed_lost') then
        raise exception 'Invalid lead status' using errcode = '22023';
      end if;
      update public.contacts set lead_status = v_value::public.lead_status
      where organization_id = p_org and id = v_conversation.contact_id and lead_status <> v_value::public.lead_status;
    when 'assign' then
      if not (p_data ? 'assigneeId') then
        raise exception 'Missing assignee' using errcode = '22023';
      end if;
      v_assignee_id := (p_data ->> 'assigneeId')::uuid;
      if v_assignee_id is not null then
        perform 1 from public.organization_members
          where organization_id = p_org and user_id = v_assignee_id for key share;
        if not found then
          raise exception 'Assignee is not an organization member' using errcode = '42501';
        end if;
      end if;

      select assignee_id into v_current_assignee from public.conversation_assignments
        where organization_id = p_org and conversation_id = p_conversation_id and ended_at is null;
      if v_current_assignee is distinct from v_assignee_id then
        v_now := clock_timestamp();
        update public.conversation_assignments set ended_at = greatest(started_at, v_now)
        where organization_id = p_org and conversation_id = p_conversation_id and ended_at is null;
        if v_assignee_id is not null then
          insert into public.conversation_assignments (organization_id, conversation_id, assignee_id, assigned_by, started_at)
          values (p_org, p_conversation_id, v_assignee_id, p_actor, v_now) returning id into v_id;
        end if;
      end if;
    when 'add_tag', 'remove_tag' then
      v_id := (p_data ->> 'tagId')::uuid;
      v_name := btrim(p_data ->> 'name');
      if v_id is not null then
        perform 1 from public.tags where organization_id = p_org and id = v_id for key share;
        if not found then
          raise exception 'Tag not found' using errcode = 'P0002';
        end if;
      else
        if coalesce(length(v_name), 0) not between 1 and 60 then
          raise exception 'Invalid tag name' using errcode = '22023';
        end if;
        if p_action = 'add_tag' then
          insert into public.tags (organization_id, name) values (p_org, v_name)
          on conflict (organization_id, lower(name)) do nothing;
        end if;
        select id into v_id from public.tags where organization_id = p_org and lower(name) = lower(v_name) for key share;
      end if;

      if p_action = 'add_tag' then
        insert into public.contact_tags (organization_id, contact_id, tag_id)
        values (p_org, v_conversation.contact_id, v_id) on conflict do nothing;
      elsif v_id is not null then
        delete from public.contact_tags
        where organization_id = p_org and contact_id = v_conversation.contact_id and tag_id = v_id;
      end if;
    when 'mark_read' then
      update public.conversations set unread_count = 0 where id = p_conversation_id and unread_count <> 0;
    else
      raise exception 'Unknown conversation action' using errcode = '22023';
  end case;
  return jsonb_build_object('conversation_id', p_conversation_id, 'id', v_id);
end;
$$;

revoke all on function oniro_private.require_member(uuid, uuid, boolean),
  oniro_private.finish_channel_operation(uuid, uuid, uuid, uuid, boolean, text),
  oniro_private.apply_messenger_receipts(uuid, uuid, text),
  oniro_private.record_response(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function oniro_private.require_member(uuid, uuid, boolean),
  oniro_private.finish_channel_operation(uuid, uuid, uuid, uuid, boolean, text),
  oniro_private.apply_messenger_receipts(uuid, uuid, text),
  oniro_private.record_response(uuid, timestamptz)
  to service_role;

revoke all on function public.oniro_create_organization(uuid, text, text),
  public.oniro_reserve_channel(uuid, uuid, text, text, text),
  public.oniro_finish_channel(uuid, uuid, uuid, uuid, boolean),
  public.oniro_reserve_disconnect(uuid, uuid, uuid),
  public.oniro_finish_disconnect(uuid, uuid, uuid, uuid, boolean),
  public.oniro_ingest_messenger_event(jsonb),
  public.oniro_reserve_outgoing(uuid, uuid, uuid, uuid, text),
  public.oniro_finish_outgoing(uuid, uuid, uuid, text, text),
  public.oniro_mutate_conversation(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.oniro_create_organization(uuid, text, text),
  public.oniro_reserve_channel(uuid, uuid, text, text, text),
  public.oniro_finish_channel(uuid, uuid, uuid, uuid, boolean),
  public.oniro_reserve_disconnect(uuid, uuid, uuid),
  public.oniro_finish_disconnect(uuid, uuid, uuid, uuid, boolean),
  public.oniro_ingest_messenger_event(jsonb),
  public.oniro_reserve_outgoing(uuid, uuid, uuid, uuid, text),
  public.oniro_finish_outgoing(uuid, uuid, uuid, text, text),
  public.oniro_mutate_conversation(uuid, uuid, uuid, text, jsonb)
  to service_role;

do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach v_table in array array[
      'conversations', 'messages', 'contacts', 'conversation_notes', 'conversation_assignments', 'tags', 'contact_tags', 'channels'
    ] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;

commit;
