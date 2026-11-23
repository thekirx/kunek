-- Run with psql as a development database owner after applying the migration.
begin;

insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'agent-a@example.test'),
  ('10000000-0000-0000-0000-000000000002', 'owner-b@example.test');
insert into public.profiles (id, display_name) values
  ('10000000-0000-0000-0000-000000000001', 'Agent A'),
  ('10000000-0000-0000-0000-000000000002', 'Owner B');
insert into public.organizations (id, name) values
  ('20000000-0000-0000-0000-000000000001', 'Tenant A'),
  ('20000000-0000-0000-0000-000000000002', 'Tenant B');
insert into public.organization_members (organization_id, user_id, role) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'agent'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'owner');
insert into public.channels (id, organization_id, name, external_page_id, status) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Page A', 'page-a', 'connected'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'Page B', 'page-b', 'connected');
insert into public.contacts (id, organization_id, channel_id, external_contact_id, display_name) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'contact-1', 'Contact A'),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'contact-1', 'Contact B');
insert into public.conversations (id, organization_id, channel_id, contact_id) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002');
insert into public.messages (organization_id, channel_id, conversation_id, external_message_id, direction, status, body) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'm1', 'inbound', 'received', 'Tenant A message'),
  ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'm1', 'inbound', 'received', 'Tenant B message');
insert into public.invitations (organization_id, email, role, token_hash, expires_at) values
  ('20000000-0000-0000-0000-000000000001', 'invite-a@example.test', 'agent', 'test-hash-a', now()),
  ('20000000-0000-0000-0000-000000000002', 'invite-b@example.test', 'agent', 'test-hash-b', now());
insert into oniro_private.channel_credentials (organization_id, channel_id, token_ciphertext) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'example-encrypted-value');

do $$ begin
  begin
    insert into public.contacts (organization_id, channel_id, external_contact_id, display_name)
    values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'cross-tenant-id', 'Cross-tenant');
    raise exception 'A cross-tenant foreign key was accepted';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.messages (organization_id, channel_id, conversation_id, external_message_id, direction, status)
    values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'm1', 'inbound', 'received');
    raise exception 'A duplicate message ID was accepted on one Page';
  exception when unique_violation then null;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
do $$ begin
  if (select array_agg(body) from public.messages) is distinct from array['Tenant A message'] then
    raise exception 'Tenant A sees incorrect message rows';
  end if;
  if exists (select id from public.invitations) then raise exception 'An agent could read invitations'; end if;
  begin
    update public.organizations set name = 'Unauthorized';
    raise exception 'An authenticated browser role could update organizations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform token_ciphertext from oniro_private.channel_credentials;
    raise exception 'An agent could read Page tokens';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
do $$ begin
  if (select array_agg(body) from public.messages) is distinct from array['Tenant B message'] then
    raise exception 'Tenant B sees incorrect message rows';
  end if;
  if (select array_agg(email) from public.invitations) is distinct from array['invite-b@example.test'] then
    raise exception 'An owner sees incorrect invitation rows';
  end if;
  begin
    perform token_hash from public.invitations;
    raise exception 'An owner could read invite token hashes';
  exception when insufficient_privilege then null;
  end;
end $$;

set local role anon;
do $$ begin
  begin
    perform id from public.messages;
    raise exception 'Anonymous access to messages was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
