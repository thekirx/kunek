-- Apply the schema migrations first. Run with psql as a development database owner.
begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('13000000-0000-0000-0000-000000000001', 'oauth-owner@example.test', now()),
  ('13000000-0000-0000-0000-000000000002', 'oauth-admin@example.test', now()),
  ('13000000-0000-0000-0000-000000000003', 'oauth-agent@example.test', now()),
  ('13000000-0000-0000-0000-000000000004', 'oauth-invitee@example.test', now()),
  ('13000000-0000-0000-0000-000000000005', 'oauth-unconfirmed@example.test', null);

set local role service_role;
do $$
declare
  v_owner constant uuid := '13000000-0000-0000-0000-000000000001';
  v_admin constant uuid := '13000000-0000-0000-0000-000000000002';
  v_agent constant uuid := '13000000-0000-0000-0000-000000000003';
  v_invitee constant uuid := '13000000-0000-0000-0000-000000000004';
  v_unconfirmed constant uuid := '13000000-0000-0000-0000-000000000005';
  v_nonce constant text := repeat('a', 64);
  v_expired_nonce constant text := repeat('b', 64);
  v_unconfirmed_token constant text := repeat('c', 64);
  v_invite_token constant text := repeat('d', 64);
  v_expired_token constant text := repeat('e', 64);
  v_existing_token constant text := repeat('f', 64);
  v_org uuid;
  v_other_org uuid;
  v_attempt uuid;
  v_invitation uuid;
  v_accepted_org uuid;
  v_pages constant jsonb := '[{"id":"1","name":"Page","tokenCiphertext":"sample-ciphertext"}]';
begin
  v_org := (public.oniro_create_organization(v_owner, 'OAuth test org', 'Owner') ->> 'organization_id')::uuid;
  v_other_org := (public.oniro_create_organization(v_owner, 'Other test org', 'Owner') ->> 'organization_id')::uuid;
  insert into public.profiles (id, display_name) values (v_admin, 'Admin'), (v_agent, 'Agent');
  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, v_admin, 'admin'), (v_org, v_agent, 'agent');

  begin
    perform public.oniro_oauth_start(v_agent, v_org, v_nonce);
    raise exception 'Agent could start an OAuth attempt';
  exception when insufficient_privilege then null;
  end;

  perform public.oniro_oauth_start(v_owner, v_org, v_nonce);
  if public.oniro_oauth_claim(v_admin, v_org, v_nonce) is not null
    or public.oniro_oauth_claim(v_owner, v_other_org, v_nonce) is not null then
    raise exception 'An OAuth nonce crossed actor or organization boundaries';
  end if;
  v_attempt := public.oniro_oauth_claim(v_owner, v_org, v_nonce);
  if v_attempt is null or public.oniro_oauth_claim(v_owner, v_org, v_nonce) is not null then
    raise exception 'An OAuth nonce was not single-use';
  end if;
  if public.oniro_oauth_save_pages(v_admin, v_org, v_attempt, v_pages)
    or public.oniro_oauth_save_pages(v_owner, v_other_org, v_attempt, v_pages) then
    raise exception 'A manager saved Page credentials outside their own attempt';
  end if;
  if not public.oniro_oauth_save_pages(v_owner, v_org, v_attempt, v_pages)
    or public.oniro_oauth_save_pages(v_owner, v_org, v_attempt, '[]') then
    raise exception 'Page candidates were not saved exactly once';
  end if;
  if public.oniro_oauth_pages(v_owner, v_org, v_attempt) is distinct from v_pages
    or public.oniro_oauth_pages(v_admin, v_org, v_attempt) is not null
    or public.oniro_oauth_pages(v_owner, v_other_org, v_attempt) is not null then
    raise exception 'OAuth Page candidate read was unavailable or crossed attempt scope';
  end if;
  update oniro_private.meta_oauth_attempts set expires_at = now() - interval '1 minute' where id = v_attempt;
  if public.oniro_oauth_pages(v_owner, v_org, v_attempt) is not null then
    raise exception 'Expired OAuth session returned Page credentials';
  end if;

  perform public.oniro_oauth_start(v_admin, v_org, v_expired_nonce);
  update oniro_private.meta_oauth_attempts set expires_at = now() - interval '1 minute' where nonce_hash = v_expired_nonce;
  if public.oniro_oauth_claim(v_admin, v_org, v_expired_nonce) is not null then
    raise exception 'An expired OAuth nonce could be claimed';
  end if;

  begin
    perform public.oniro_create_invitation(v_agent, v_org, 'oauth-invitee@example.test', 'agent', v_invite_token);
    raise exception 'An agent could invite a member';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.oniro_create_invitation(v_admin, v_org, 'oauth-invitee@example.test', 'admin', v_invite_token);
    raise exception 'An admin could invite another admin';
  exception when insufficient_privilege then null;
  end;

  v_invitation := public.oniro_create_invitation(v_admin, v_org, 'oauth-invitee@example.test', 'agent', v_invite_token);
  if v_invitation is null then raise exception 'An admin could not invite an agent'; end if;

  begin
    perform public.oniro_accept_invitation(v_agent, 'oauth-agent@example.test', 'Agent', v_invite_token);
    raise exception 'A different verified email could accept the invitation';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.oniro_accept_invitation(v_agent, 'oauth-invitee@example.test', 'Agent', v_invite_token);
    raise exception 'An actor could impersonate the invited email in a service RPC';
  exception when insufficient_privilege then null;
  end;

  perform public.oniro_create_invitation(v_owner, v_org, 'oauth-unconfirmed@example.test', 'agent', v_unconfirmed_token);
  begin
    perform public.oniro_accept_invitation(v_unconfirmed, 'oauth-unconfirmed@example.test', 'Unconfirmed', v_unconfirmed_token);
    raise exception 'An unconfirmed email could accept the invitation';
  exception when insufficient_privilege then null;
  end;

  v_accepted_org := public.oniro_accept_invitation(v_invitee, 'oauth-invitee@example.test', 'Invitee', v_invite_token);
  if v_accepted_org is distinct from v_org or not exists (select 1 from public.organization_members where organization_id = v_org and user_id = v_invitee and role = 'agent') then
    raise exception 'A verified invitee did not receive the expected scoped role';
  end if;
  if (select count(*) from public.audit_logs where subject_id = v_invitation and action in ('member.invited', 'member.joined')) <> 2 then
    raise exception 'Invitation creation or acceptance did not write an audit entry';
  end if;
  begin
    perform public.oniro_accept_invitation(v_invitee, 'oauth-invitee@example.test', 'Invitee', v_invite_token);
    raise exception 'An invitation could be accepted twice';
  exception when insufficient_privilege then null;
  end;

  v_invitation := public.oniro_create_invitation(v_owner, v_other_org, 'oauth-invitee@example.test', 'agent', v_expired_token);
  update public.invitations set expires_at = now() - interval '1 minute' where id = v_invitation;
  begin
    perform public.oniro_accept_invitation(v_invitee, 'oauth-invitee@example.test', 'Invitee', v_expired_token);
    raise exception 'An expired invitation could be accepted';
  exception when insufficient_privilege then null;
  end;

  perform public.oniro_create_invitation(v_owner, v_org, 'oauth-agent@example.test', 'admin', v_existing_token);
  perform public.oniro_accept_invitation(v_agent, 'oauth-agent@example.test', 'Agent', v_existing_token);
  if (select role from public.organization_members where organization_id = v_org and user_id = v_agent) <> 'agent' then
    raise exception 'Accepting an invite escalated an active member role';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
do $$
begin
  begin
    perform public.oniro_oauth_start('13000000-0000-0000-0000-000000000001', null, repeat('0', 64));
    raise exception 'An authenticated browser role could call the OAuth RPC';
  exception when insufficient_privilege then null;
  end;
  begin
    perform oniro_private.matches_verified_email('13000000-0000-0000-0000-000000000001', 'oauth-owner@example.test');
    raise exception 'An authenticated browser role could check another Auth record';
  exception when insufficient_privilege then null;
  end;
  begin
    perform candidates from oniro_private.meta_oauth_attempts;
    raise exception 'An authenticated browser role could read encrypted Page candidates';
  exception when insufficient_privilege then null;
  end;
end $$;

rollback;
