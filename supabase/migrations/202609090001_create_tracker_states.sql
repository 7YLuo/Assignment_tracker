create table public.tracker_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint tracker_states_data_is_object check (jsonb_typeof(data) = 'object')
);

alter table public.tracker_states enable row level security;

revoke all on table public.tracker_states from anon;
grant select, insert, update, delete on table public.tracker_states to authenticated;

create policy "Users can read their own tracker state"
on public.tracker_states
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own tracker state"
on public.tracker_states
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own tracker state"
on public.tracker_states
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own tracker state"
on public.tracker_states
for delete
to authenticated
using ((select auth.uid()) = user_id);
