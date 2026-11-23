-- Apply the schema migrations first. Run with psql as a development database owner.
begin;

insert into auth.users (id, email) values
  ('11000000-0000-0000-0000-000000000001', 'phase2-owner-a@example.test'),
  ('11000000-0000-0000-0000-000000000002', 'phase2-owner-b@example.test'),
  ('11000000-0000-0000-0000-000000000003', 'phase2-agent-a@example.test');

set local role service_role;
do $$
declare
  v_owner_a constant uuid := '11000000-0000-0000-0000-000000000001';
  v_owner_b constant uuid := '11000000-0000-0000-0000-000000000002';
  v_agent constant uuid := '11000000-0000-0000-0000-000000000003';
  v_request constant uuid := '12000000-0000-0000-0000-000000000001';
  v_second_request constant uuid := '12000000-0000-0000-0000-000000000002';
  v_denied_request constant uuid := '12000000-0000-0000-0000-000000000003';
  v_org_a uuid;
  v_org_b uuid;
  v_channel uuid;
  v_operation uuid;
  v_conversation uuid;
  v_message uuid;
  v_second_message uuid;
  v_customer_at timestamptz;
  v_timestamp bigint := floor(extract(epoch from clock_timestamp() - interval '2 minutes') * 1000);
  v_old_timestamp bigint := v_timestamp - 25 * 60 * 60 * 1000;
  v_event jsonb;
  v_result jsonb;
begin
  v_org_a := (public.oniro_create_organization(v_owner_a, 'Phase 2 A', 'Phase 2 Owner A') ->> 'organization_id')::uuid;
  v_org_b := (public.oniro_create_organization(v_owner_b, 'Phase 2 B', 'Phase 2 Owner B') ->> 'organization_id')::uuid;
  if not exists (
    select 1 from public.organization_members m join public.organization_subscriptions s using (organization_id)
    where m.organization_id = v_org_a and m.user_id = v_owner_a and m.role = 'owner'
      and s.plan_id = 'starter' and s.status = 'unpaid'
  ) then raise exception 'Organization bootstrap is incomplete'; end if;

  insert into public.profiles (id, display_name) values (v_agent, 'Phase 2 Agent A');
  insert into public.organization_members (organization_id, user_id) values (v_org_a, v_agent);

  begin
    perform public.oniro_reserve_channel(v_agent, v_org_a, 'phase2-page', 'Phase 2 Page', 'encrypted-token-example');
    raise exception 'Agent could connect a Page';
  exception when insufficient_privilege then null;
  end;

  v_result := public.oniro_reserve_channel(v_owner_a, v_org_a, 'phase2-page', 'Phase 2 Page', 'encrypted-token-example');
  v_channel := (v_result ->> 'channel_id')::uuid;
  v_operation := (v_result ->> 'operation_id')::uuid;
  if (select status from public.channels where id = v_channel) <> 'attention' then
    raise exception 'Channel is active before provider confirmation';
  end if;

  v_event := jsonb_build_object('kind', 'message', 'pageId', 'phase2-page', 'senderId', 'phase2-recipient',
    'messageId', 'old-message', 'timestamp', v_old_timestamp, 'text', 'Old message');
  v_result := public.oniro_ingest_messenger_event(v_event);
  v_conversation := (v_result ->> 'conversation_id')::uuid;
  if v_result ->> 'result' is distinct from 'stored' or v_conversation is null then
    raise exception 'An event received during channel connection was lost';
  end if;

  begin
    perform public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_denied_request, 'Pending Page reply');
    raise exception 'An unconfirmed Page could send a reply';
  exception when object_not_in_prerequisite_state then null;
  end;

  begin
    perform public.oniro_finish_channel(v_owner_a, v_org_a, v_channel, gen_random_uuid(), true);
    raise exception 'A stale channel operation could connect a Page';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_result := public.oniro_finish_channel(v_owner_a, v_org_a, v_channel, v_operation, true);
  if v_result ->> 'status' is distinct from 'connected' then raise exception 'Page never activated'; end if;

  begin
    perform public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_denied_request, 'Outside the window');
    raise exception 'An expired reply window was accepted';
  exception when object_not_in_prerequisite_state then null;
  end;
  begin
    perform public.oniro_reserve_outgoing(v_owner_b, v_org_a, v_conversation, v_denied_request, 'Wrong tenant');
    raise exception 'An outsider could send from another organization';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.oniro_reserve_outgoing(v_owner_b, v_org_b, v_conversation, v_denied_request, 'Wrong conversation');
    raise exception 'A conversation ID crossed tenant scope';
  exception when no_data_found then null;
  end;

  v_event := v_event || jsonb_build_object('messageId', 'recent-message', 'timestamp', v_timestamp, 'text', 'Recent message');
  if public.oniro_ingest_messenger_batch(jsonb_build_array(v_event, v_event)) is distinct from array[v_conversation] then
    raise exception 'Inbound batch did not store the message exactly once';
  end if;
  if cardinality(public.oniro_ingest_messenger_batch(jsonb_build_array(v_event))) <> 0 then
    raise exception 'An inbound batch replay was not deduplicated';
  end if;
  if public.oniro_messenger_profile_context(v_conversation) ->> 'recipient_id' is distinct from 'phase2-recipient' then
    raise exception 'Profile lookup did not identify the scoped Messenger contact';
  end if;

  v_event := v_event || jsonb_build_object('messageId', 'late-message', 'timestamp', v_old_timestamp, 'text', 'Late message');
  perform public.oniro_ingest_messenger_event(v_event);
  v_customer_at := to_timestamp(v_timestamp::double precision / 1000.0);
  if not exists (
    select 1 from public.conversations where id = v_conversation and unread_count = 3
      and last_customer_message_at = v_customer_at and last_message_at = v_customer_at
  ) then raise exception 'Duplicate or late messages corrupted unread count or timestamps'; end if;

  v_result := public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_request, 'Agent reply');
  v_message := (v_result ->> 'message_id')::uuid;
  if (v_result ->> 'should_send')::boolean is distinct from true
    or v_result ->> 'page_id' is distinct from 'phase2-page' or v_result ->> 'recipient_id' is distinct from 'phase2-recipient'
    or v_result ->> 'token_ciphertext' is distinct from 'encrypted-token-example' then
    raise exception 'The first reservation did not return authorized send details';
  end if;
  perform public.oniro_finish_outgoing(v_agent, v_org_a, v_message, 'unknown');
  v_result := public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_request, 'Agent reply');
  if (v_result ->> 'should_send')::boolean is distinct from false or v_result ? 'token_ciphertext'
    or (v_result ->> 'message_id')::uuid is distinct from v_message or v_result ->> 'status' is distinct from 'queued' then
    raise exception 'Replaying an ambiguous send could send again or disclose credentials';
  end if;
  begin
    perform public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_request, 'Different reply');
    raise exception 'An idempotency key was reused with different text';
  exception when object_not_in_prerequisite_state then null;
  end;

  v_event := jsonb_build_object('kind', 'delivery', 'pageId', 'phase2-page', 'senderId', 'phase2-recipient',
    'messageIds', jsonb_build_array('reply-1', 'reply-1'), 'timestamp', v_timestamp + 3000, 'watermark', v_timestamp + 2000);
  perform public.oniro_ingest_messenger_event(v_event);
  v_result := public.oniro_ingest_messenger_event(v_event);
  if v_result ->> 'result' is distinct from 'duplicate' then raise exception 'Delivery receipt was not deduplicated'; end if;
  perform public.oniro_ingest_messenger_event(v_event || jsonb_build_object('kind', 'read', 'watermark', v_timestamp + 4000));
  perform public.oniro_ingest_messenger_event(v_event || jsonb_build_object('kind', 'read', 'watermark', v_timestamp + 1000));

  v_event := jsonb_build_object('kind', 'echo', 'pageId', 'phase2-page', 'senderId', 'phase2-recipient',
    'messageId', 'reply-1', 'timestamp', v_timestamp + 500, 'text', 'Agent reply', 'clientRequestId', v_request);
  v_result := public.oniro_ingest_messenger_event(v_event);
  if (v_result ->> 'message_id')::uuid is distinct from v_message then
    raise exception 'Messenger metadata did not reconcile the send reservation';
  end if;

  if not exists (
    select 1 from public.messages where id = v_message and status = 'sent' and external_message_id = 'reply-1'
      and delivered_at = to_timestamp((v_timestamp + 3000)::double precision / 1000.0)
      and read_at = to_timestamp((v_timestamp + 4000)::double precision / 1000.0)
  ) then raise exception 'Out-of-order delivery/read effects did not apply after echo'; end if;
  v_result := public.oniro_finish_outgoing(v_agent, v_org_a, v_message, 'sent', 'reply-1');
  if v_result ->> 'status' is distinct from 'sent' then raise exception 'Send completion rewound the echo'; end if;

  v_result := public.oniro_reserve_outgoing(v_agent, v_org_a, v_conversation, v_second_request, 'Second reply');
  v_second_message := (v_result ->> 'message_id')::uuid;
  perform public.oniro_ingest_messenger_event((v_event - 'clientRequestId') ||
    jsonb_build_object('messageId', 'reply-2', 'timestamp', v_timestamp + 10000, 'text', 'Second reply'));
  v_result := public.oniro_finish_outgoing(v_agent, v_org_a, v_second_message, 'sent', 'reply-2');
  if v_result ->> 'status' is distinct from 'sent' or
      (select count(*) from public.messages where conversation_id = v_conversation and direction = 'outbound') <> 2 then
    raise exception 'The response did not merge the uncorrelated echo into the send row';
  end if;
  if (select unread_count from public.conversations where id = v_conversation) <> 3 then
    raise exception 'An outbound message increased unread count';
  end if;

  begin
    perform public.oniro_mutate_conversation(v_owner_b, v_org_a, v_conversation, 'note', '{"body":"Wrong tenant"}');
    raise exception 'An outsider could add a note';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'assign', jsonb_build_object('assigneeId', v_owner_b));
    raise exception 'An assignment crossed tenant scope';
  exception when insufficient_privilege then null;
  end;

  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'note', '{"body":"Agent note"}');
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'assign', jsonb_build_object('assigneeId', v_agent));
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'assign', jsonb_build_object('assigneeId', v_owner_a));
  if (select count(*) from public.conversation_assignments where conversation_id = v_conversation and ended_at is null) <> 1
    or not exists (select 1 from public.conversation_assignments
      where conversation_id = v_conversation and ended_at is null and assignee_id = v_owner_a) then
    raise exception 'Assignment change failed to end the previous assignment';
  end if;
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'status', '{"status":"resolved"}');
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'lead', '{"leadStatus":"interested"}');
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'add_tag', '{"name":" Priority "}');
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'add_tag', '{"name":"priority"}');
  if (select count(*) from public.contact_tags where organization_id = v_org_a) <> 1 then
    raise exception 'Tag link was not idempotent or case-insensitive';
  end if;
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'remove_tag', '{"name":" PRIORITY "}');
  perform public.oniro_mutate_conversation(v_agent, v_org_a, v_conversation, 'mark_read');
  if exists (select 1 from public.contact_tags where organization_id = v_org_a)
    or not exists (select 1 from public.conversations where id = v_conversation and status = 'resolved' and resolved_at is not null and unread_count = 0)
    or not exists (select 1 from public.contacts where channel_id = v_channel and lead_status = 'interested')
    or not exists (select 1 from public.conversation_notes where conversation_id = v_conversation and body = 'Agent note') then
    raise exception 'Conversation mutations did not persist';
  end if;

  v_result := public.oniro_reserve_disconnect(v_owner_a, v_org_a, v_channel);
  v_operation := (v_result ->> 'operation_id')::uuid;
  if v_result ->> 'token_ciphertext' is distinct from 'encrypted-token-example' then
    raise exception 'Disconnect reservation did not return the encrypted Page token';
  end if;
  perform public.oniro_finish_disconnect(v_owner_a, v_org_a, v_channel, v_operation, true);
  if exists (select 1 from oniro_private.channel_credentials where channel_id = v_channel) then
    raise exception 'Disconnect did not erase the Page token';
  end if;
  begin
    perform public.oniro_reserve_channel(v_owner_b, v_org_b, 'phase2-page', 'Wrong owner', 'some-encrypted-value');
    raise exception 'Another organization could claim a disconnected Page';
  exception when object_not_in_prerequisite_state then null;
  end;
  v_result := public.oniro_ingest_messenger_event(v_event);
  if v_result ->> 'result' is distinct from 'ignored' then raise exception 'Disconnected Page still ingests events'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
do $$
begin
  if (select array_agg(display_name order by display_name) from public.profiles)
    is distinct from array['Phase 2 Agent A', 'Phase 2 Owner A'] then
    raise exception 'Team profile visibility crossed tenant scope or omitted a teammate';
  end if;
  if not exists (select 1 from public.conversation_notes where body = 'Agent note') then
    raise exception 'Agent could not see inbox mutations';
  end if;
  begin
    perform public.oniro_ingest_messenger_event('{}');
    raise exception 'Browser role could call webhook ingestion';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.oniro_reserve_outgoing(null, null, null, null, null);
    raise exception 'Browser role could call outgoing reservation';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
