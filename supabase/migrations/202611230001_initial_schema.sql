begin;

create schema oniro_private;
revoke all on schema oniro_private from public, anon, authenticated;
grant usage on schema oniro_private to authenticated, service_role;

create type public.organization_role as enum ('owner', 'admin', 'agent');
create type public.conversation_status as enum ('new', 'open', 'pending', 'resolved');
create type public.lead_status as enum ('new_lead', 'interested', 'quotation_sent', 'booked', 'closed_won', 'closed_lost');
create type public.channel_status as enum ('disconnected', 'connected', 'attention');
create type public.message_direction as enum ('inbound', 'outbound');
create type public.message_status as enum ('received', 'queued', 'sent', 'failed');
create type public.subscription_status as enum ('unpaid', 'trialing', 'active', 'past_due', 'canceled');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  role public.organization_role not null default 'agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id, organization_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  email text not null check (email = lower(btrim(email))),
  role public.organization_role not null check (role <> 'owner'),
  invited_by uuid references public.profiles on delete set null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id, email);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  provider text not null default 'messenger' check (provider = 'messenger'),
  external_page_id text not null,
  name text not null,
  status public.channel_status not null default 'disconnected',
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
-- A Page can route incoming events to one tenant at a time.
create unique index channels_active_page_idx on public.channels (provider, external_page_id) where status <> 'disconnected';
create unique index channels_org_page_idx on public.channels (organization_id, provider, external_page_id);

create table oniro_private.channel_credentials (
  organization_id uuid not null,
  channel_id uuid primary key,
  token_ciphertext text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, channel_id) references public.channels (organization_id, id) on delete cascade
);
alter table oniro_private.channel_credentials enable row level security;
grant select, insert, update, delete on oniro_private.channel_credentials to service_role;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  external_contact_id text not null,
  display_name text not null,
  email text,
  phone text,
  lead_status public.lead_status not null default 'new_lead',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, channel_id) references public.channels (organization_id, id) on delete cascade,
  unique (channel_id, external_contact_id),
  unique (organization_id, id),
  unique (organization_id, channel_id, id)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  contact_id uuid not null,
  external_thread_id text,
  status public.conversation_status not null default 'new',
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz,
  last_customer_message_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, channel_id, contact_id) references public.contacts (organization_id, channel_id, id) on delete cascade,
  unique (organization_id, id),
  unique (organization_id, channel_id, id),
  unique (channel_id, contact_id),
  unique (channel_id, external_thread_id)
);
create index conversations_inbox_idx on public.conversations (organization_id, last_message_at desc);
create index conversations_status_idx on public.conversations (organization_id, status);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  conversation_id uuid not null,
  external_message_id text,
  client_request_id uuid,
  direction public.message_direction not null,
  status public.message_status not null,
  body text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, channel_id, conversation_id) references public.conversations (organization_id, channel_id, id) on delete cascade,
  unique (channel_id, external_message_id),
  unique (organization_id, client_request_id),
  check ((direction = 'inbound' and status = 'received' and external_message_id is not null) or
         (direction = 'outbound' and status in ('queued', 'sent', 'failed') and client_request_id is not null))
);
create index messages_thread_idx on public.messages (organization_id, conversation_id, created_at, id);

create table public.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  assignee_id uuid not null,
  assigned_by uuid references public.profiles on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade,
  foreign key (organization_id, assignee_id) references public.organization_members (organization_id, user_id),
  check (ended_at is null or ended_at >= started_at)
);
create unique index assignments_current_idx on public.conversation_assignments (organization_id, conversation_id) where ended_at is null;
create index assignments_member_idx on public.conversation_assignments (organization_id, assignee_id);

create table public.conversation_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  author_id uuid references public.profiles on delete set null,
  body text not null check (length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, conversation_id) references public.conversations (organization_id, id) on delete cascade
);
create index notes_thread_idx on public.conversation_notes (organization_id, conversation_id, created_at);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create unique index tags_name_idx on public.tags (organization_id, lower(name));

create table public.contact_tags (
  organization_id uuid not null,
  contact_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, contact_id, tag_id),
  foreign key (organization_id, contact_id) references public.contacts (organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.tags (organization_id, id) on delete cascade
);
create index contact_tags_tag_idx on public.contact_tags (organization_id, tag_id);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations on delete cascade,
  actor_id uuid references public.profiles on delete set null,
  action text not null,
  subject_id uuid,
  created_at timestamptz not null default now()
);
create index audit_org_time_idx on public.audit_logs (organization_id, created_at desc);

create table public.subscription_plans (
  id text primary key,
  name text not null,
  price_centavos integer not null check (price_centavos >= 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  page_limit integer not null check (page_limit > 0),
  member_limit integer not null check (member_limit > 0),
  features text[] not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.subscription_plans (id, name, price_centavos, page_limit, member_limit, features) values
  ('starter', 'Starter', 49900, 1, 3, array['inbox', 'tags']),
  ('growth', 'Growth', 129900, 3, 6, array['inbox', 'tags', 'crm', 'analytics']),
  ('pro', 'Pro', 249900, 6, 10, array['inbox', 'tags', 'crm', 'analytics']);

create table public.organization_subscriptions (
  organization_id uuid primary key references public.organizations on delete cascade,
  plan_id text not null references public.subscription_plans,
  status public.subscription_status not null default 'unpaid',
  verified_payment_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'active' or verified_payment_at is not null)
);

create function oniro_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function oniro_private.touch_updated_at() from public, anon, authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'profiles', 'organizations', 'organization_members', 'invitations', 'channels', 'contacts',
    'conversations', 'messages', 'conversation_assignments', 'conversation_notes', 'tags', 'contact_tags',
    'audit_logs', 'subscription_plans', 'organization_subscriptions'
  ] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', tbl);
    execute format('grant select, insert, update, delete on public.%I to service_role', tbl);
    if tbl not in ('contact_tags', 'audit_logs') then
      execute format('create trigger touch_updated_at before update on public.%I for each row execute function oniro_private.touch_updated_at()', tbl);
    end if;
  end loop;
end;
$$;
create trigger touch_updated_at before update on oniro_private.channel_credentials
for each row execute function oniro_private.touch_updated_at();

create function oniro_private.member_orgs(require_manager boolean default false)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.organization_id
  from public.organization_members m
  where m.user_id = (select auth.uid())
    and (not require_manager or m.role in ('owner', 'admin'));
$$;
revoke all on function oniro_private.member_orgs(boolean) from public, anon, authenticated;
grant execute on function oniro_private.member_orgs(boolean) to authenticated;

create policy profiles_read_self on public.profiles for select to authenticated using (id = (select auth.uid()));
grant select on public.profiles to authenticated;
create policy organizations_read_member on public.organizations for select to authenticated
  using (id in (select oniro_private.member_orgs()));
grant select on public.organizations to authenticated;
create policy plans_read on public.subscription_plans for select to authenticated using (true);
grant select on public.subscription_plans to authenticated;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'organization_members', 'channels', 'contacts', 'conversations', 'messages',
    'conversation_assignments', 'conversation_notes', 'tags', 'contact_tags', 'organization_subscriptions'
  ] loop
    execute format('grant select on public.%I to authenticated', tbl);
    execute format(
      'create policy member_read on public.%I for select to authenticated using (organization_id in (select oniro_private.member_orgs()))',
      tbl
    );
  end loop;
end;
$$;

grant select (id, organization_id, email, role, invited_by, expires_at, accepted_at,
              revoked_at, created_at, updated_at) on public.invitations to authenticated;
create policy invitations_manager_read on public.invitations for select to authenticated
  using (organization_id in (select oniro_private.member_orgs(true)));
grant select on public.audit_logs to authenticated;
create policy audit_manager_read on public.audit_logs for select to authenticated
  using (organization_id in (select oniro_private.member_orgs(true)));

commit;
