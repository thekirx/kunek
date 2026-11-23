begin;

create table oniro_private.meta_oauth_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  actor_id uuid not null,
  nonce_hash text not null unique check (nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  claimed_at timestamptz,
  candidates jsonb,
  foreign key (organization_id, actor_id)
    references public.organization_members (organization_id, user_id) on delete cascade
);
create index meta_oauth_attempts_expiry_idx on oniro_private.meta_oauth_attempts (expires_at);
alter table oniro_private.meta_oauth_attempts enable row level security;
grant select, insert, update, delete on oniro_private.meta_oauth_attempts to service_role;

-- Keep Auth reads private. The service caller can only check a known user's current verified email.
create function oniro_private.matches_verified_email(p_actor uuid, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from auth.users u where u.id = p_actor
    and u.email_confirmed_at is not null and lower(btrim(u.email)) = lower(btrim(p_email))
  for share;
  return found;
end;
$$;

create function public.oniro_oauth_start(p_actor uuid, p_org uuid, p_nonce_hash text)
returns void language plpgsql set search_path = '' as $$
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid OAuth attempt' using errcode = '22023';
  end if;
  delete from oniro_private.meta_oauth_attempts
  where id in (select id from oniro_private.meta_oauth_attempts where expires_at <= now()
               order by expires_at limit 100);
  insert into oniro_private.meta_oauth_attempts (organization_id, actor_id, nonce_hash)
  values (p_org, p_actor, p_nonce_hash);
end;
$$;

create function public.oniro_oauth_claim(p_actor uuid, p_org uuid, p_nonce_hash text)
returns uuid language plpgsql set search_path = '' as $$
declare
  attempt_id uuid;
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  update oniro_private.meta_oauth_attempts
  set claimed_at = now()
  where organization_id = p_org and actor_id = p_actor and nonce_hash = p_nonce_hash
    and claimed_at is null and expires_at > now()
  returning id into attempt_id;
  return attempt_id;
end;
$$;

create function public.oniro_oauth_save_pages(p_actor uuid, p_org uuid, p_attempt uuid, p_candidates jsonb)
returns boolean language plpgsql set search_path = '' as $$
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  if jsonb_typeof(p_candidates) is distinct from 'array' then
    raise exception 'Invalid Page list' using errcode = '22023';
  end if;
  update oniro_private.meta_oauth_attempts
  set candidates = p_candidates, expires_at = now() + interval '10 minutes'
  where id = p_attempt and organization_id = p_org and actor_id = p_actor
    and claimed_at is not null and candidates is null and expires_at > now();
  return found;
end;
$$;

create function public.oniro_oauth_pages(p_actor uuid, p_org uuid, p_attempt uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result jsonb;
begin
  perform oniro_private.require_member(p_actor, p_org, true);
  select candidates into result from oniro_private.meta_oauth_attempts
    where id = p_attempt and organization_id = p_org and actor_id = p_actor
      and expires_at > now() and claimed_at is not null;
  return result;
end;
$$;

create function public.oniro_create_invitation(p_actor uuid, p_org uuid, p_email text, p_role public.organization_role, p_token_hash text)
returns uuid language plpgsql set search_path = '' as $$
declare
  manager_role public.organization_role;
  invite_id uuid;
begin
  select role into manager_role from public.organization_members
    where user_id = p_actor and organization_id = p_org for share;
  if manager_role is null or manager_role not in ('owner', 'admin')
      or p_role is null or p_role not in ('admin', 'agent') or (p_role = 'admin' and manager_role <> 'owner') then
    raise exception 'Cannot invite this role' using errcode = '42501';
  end if;
  if p_email is null or length(p_email) not between 1 and 254 or p_email <> lower(btrim(p_email))
      or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation details' using errcode = '22023';
  end if;
  insert into public.invitations (organization_id, email, role, invited_by, token_hash, expires_at)
    values (p_org, p_email, p_role, p_actor, p_token_hash, now() + interval '2 days') returning id into invite_id;
  insert into public.audit_logs (organization_id, actor_id, action, subject_id)
    values (p_org, p_actor, 'member.invited', invite_id);
  return invite_id;
end;
$$;

create function public.oniro_accept_invitation(p_actor uuid, p_email text, p_display_name text, p_token_hash text)
returns uuid language plpgsql set search_path = '' as $$
declare
  invitation public.invitations%rowtype;
begin
  if not oniro_private.matches_verified_email(p_actor, p_email) then
    raise exception 'Invitation is unavailable' using errcode = '42501';
  end if;
  select * into invitation from public.invitations where token_hash = p_token_hash for update;
  if not found or invitation.email is distinct from lower(btrim(p_email))
      or invitation.revoked_at is not null or invitation.accepted_at is not null or invitation.expires_at <= clock_timestamp() then
    raise exception 'Invitation is unavailable' using errcode = '42501';
  end if;
  insert into public.profiles (id, display_name) values (p_actor, p_display_name) on conflict (id) do nothing;
  insert into public.organization_members (organization_id, user_id, role)
    values (invitation.organization_id, p_actor, invitation.role)
    on conflict (organization_id, user_id) do nothing;
  update public.invitations set accepted_at = now() where id = invitation.id;
  insert into public.audit_logs (organization_id, actor_id, action, subject_id)
    values (invitation.organization_id, p_actor, 'member.joined', invitation.id);
  return invitation.organization_id;
end;
$$;

revoke all on function oniro_private.matches_verified_email(uuid, text) from public, anon, authenticated;
grant execute on function oniro_private.matches_verified_email(uuid, text) to service_role;

revoke all on function
  public.oniro_oauth_start(uuid, uuid, text),
  public.oniro_oauth_claim(uuid, uuid, text),
  public.oniro_oauth_save_pages(uuid, uuid, uuid, jsonb),
  public.oniro_oauth_pages(uuid, uuid, uuid),
  public.oniro_create_invitation(uuid, uuid, text, public.organization_role, text),
  public.oniro_accept_invitation(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.oniro_oauth_start(uuid, uuid, text),
  public.oniro_oauth_claim(uuid, uuid, text),
  public.oniro_oauth_save_pages(uuid, uuid, uuid, jsonb),
  public.oniro_oauth_pages(uuid, uuid, uuid),
  public.oniro_create_invitation(uuid, uuid, text, public.organization_role, text),
  public.oniro_accept_invitation(uuid, text, text, text)
to service_role;

commit;
