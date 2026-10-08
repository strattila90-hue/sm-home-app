-- SM home dekor Planner – Supabase adatbázis
-- Futtatás: Supabase → SQL Editor → New query → másold be az egészet → Run.
-- Többször is lefuttatható, nem töröl adatot.

-- 1) Adatok táblája: rendelések, kiadások, beállítások, vállalkozás adatai, dokumentumok listája
create table if not exists public.records (
  id         text        not null,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text        not null check (kind in ('order','expense','settings','business','doc')),
  data       jsonb       not null default '{}'::jsonb,
  deleted    boolean     not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists records_user_updated_idx on public.records (user_id, updated_at);

-- A szerver állítja be a módosítás idejét (így a telefon órája nem számít)
create or replace function public.smhd_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

drop trigger if exists records_touch on public.records;
create trigger records_touch
  before insert or update on public.records
  for each row execute function public.smhd_touch_updated_at();

-- 2) Sorszintű védelem: mindenki csak a saját adatait látja és írja
alter table public.records enable row level security;

drop policy if exists "records_select_own" on public.records;
drop policy if exists "records_insert_own" on public.records;
drop policy if exists "records_update_own" on public.records;
drop policy if exists "records_delete_own" on public.records;

create policy "records_select_own" on public.records
  for select to authenticated using (auth.uid() = user_id);
create policy "records_insert_own" on public.records
  for insert to authenticated with check (auth.uid() = user_id);
create policy "records_update_own" on public.records
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records_delete_own" on public.records
  for delete to authenticated using (auth.uid() = user_id);

-- 3) Dokumentumtár (szkennelt nyomtatványok), privát
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 20971520)
on conflict (id) do nothing;

drop policy if exists "docs_select_own" on storage.objects;
drop policy if exists "docs_insert_own" on storage.objects;
drop policy if exists "docs_update_own" on storage.objects;
drop policy if exists "docs_delete_own" on storage.objects;

create policy "docs_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "docs_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
