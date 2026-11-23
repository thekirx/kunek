-- Apply all migrations to a disposable development database before running.
begin;

insert into auth.users (id, email)
values ('13000000-0000-0000-0000-000000000001', 'messenger-reliability@example.test');

set local role service_role;
do $$
declare
  actor constant uuid := '13000000-0000-0000-0000-000000000001';
  org uuid;
  connection jsonb;
  thread_id uuid;
  skewed_thread_id uuid;
  response jsonb;
  now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000);
  event jsonb;
  failures text[] := '{}';
begin
  org := (public.oniro_create_organization(actor, 'Messenger reliability', 'Test owner') ->> 'organization_id')::uuid;
  connection := public.oniro_reserve_channel(actor, org, 'reliability-page', 'Test Page', 'synthetic-encrypted-token');
  perform public.oniro_finish_channel(actor, org, (connection ->> 'channel_id')::uuid, (connection ->> 'operation_id')::uuid, true);

  event := jsonb_build_object('kind', 'message', 'pageId', 'reliability-page',
    'senderId', 'reopen-customer', 'messageId', 'original', 'timestamp', now_ms - 60000);
  thread_id := (public.oniro_ingest_messenger_event(event) ->> 'conversation_id')::uuid;
  perform public.oniro_mutate_conversation(actor, org, thread_id, 'status', '{"status":"resolved"}');

  perform public.oniro_ingest_messenger_event(event || '{"messageId":"late"}');
  if (select status from public.conversations where id = thread_id) <> 'resolved' then
    failures := array_append(failures, 'A delayed pre-resolution message reopened the conversation');
  end if;

  event := event || jsonb_build_object('messageId', 'new-customer-message', 'timestamp', now_ms + 5000);
  perform public.oniro_ingest_messenger_event(event);
  if not exists (
    select 1 from public.conversations where id = thread_id and status = 'open' and resolved_at is null
  ) then
    failures := array_append(failures, 'A new inbound message did not reopen the resolved conversation');
  end if;

  perform public.oniro_mutate_conversation(actor, org, thread_id, 'status', '{"status":"resolved"}');
  perform public.oniro_ingest_messenger_event(event);
  if (select status from public.conversations where id = thread_id) <> 'resolved' then
    failures := array_append(failures, 'A duplicate delivery reopened the conversation again');
  end if;

  event := event || jsonb_build_object('senderId', 'skewed-customer', 'messageId', 'skewed-message');
  skewed_thread_id := (public.oniro_ingest_messenger_event(event) ->> 'conversation_id')::uuid;
  begin
    response := public.oniro_reserve_outgoing(actor, org, skewed_thread_id, gen_random_uuid(), 'Reply after slight clock drift');
    if (response ->> 'should_send')::boolean is distinct from true then
      failures := array_append(failures, 'Reply reservation was not created');
    end if;
  exception when object_not_in_prerequisite_state then
    failures := array_append(failures, 'A small positive clock difference blocked a reply');
  end;

  perform public.oniro_ingest_messenger_event(event || jsonb_build_object(
    'messageId', 'far-future', 'timestamp', now_ms + 300000
  ));
  begin
    perform public.oniro_reserve_outgoing(actor, org, skewed_thread_id, gen_random_uuid(), 'Reply after an invalid future timestamp');
    failures := array_append(failures, 'A far-future timestamp opened the reply window');
  exception when object_not_in_prerequisite_state then null;
  end;

  if cardinality(failures) > 0 then
    raise exception '%', array_to_string(failures, '; ');
  end if;
end;
$$;

rollback;
