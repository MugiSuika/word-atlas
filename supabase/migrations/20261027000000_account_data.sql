-- Expand phase: repair missing profiles, preserve existing data and legacy nickname writes.
-- New writes use revision-checked RPCs. Apply the separate lockdown migration only
-- after the new account-data frontend has been verified in production.
begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'display_name' and data_type = 'text'
  ) then
    raise exception 'incompatible_profile_schema: expected uuid id and text display_name';
  end if;
end $$;

alter table public.profiles
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists avatar_path text,
  add column if not exists profile_revision bigint not null default 0,
  add column if not exists data_revision bigint not null default 0,
  add column if not exists data_initialized boolean not null default false,
  add column if not exists data_updated_at timestamptz not null default now(),
  add column if not exists learning_data jsonb not null default '{"settings":{"accent":"uk","autoplay":true,"dailyNew":10,"retention":0.9,"theme":"dark","sfx":true,"spell":true,"startLevel":0,"onboarded":false,"dataset":"open","ambience":"stars","ambienceVolume":0.45,"splash":true,"atlasView":"grid"},"datasets":{}}'::jsonb;

-- Fail rather than silently truncate or discard incompatible existing records.
do $$
declare id_column smallint; expected record;
begin
  for expected in select * from (values
    ('updated_at','timestamptz'),('avatar_path','text'),('profile_revision','int8'),
    ('data_revision','int8'),('data_initialized','bool'),('data_updated_at','timestamptz'),('learning_data','jsonb')
  ) as types(column_name,udt_name) loop
    if not exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='profiles'
        and c.column_name=expected.column_name and c.udt_name=expected.udt_name) then
      raise exception 'incompatible_profile_schema: column % has an unexpected type',expected.column_name;
    end if;
  end loop;
  if exists (select 1 from public.profiles where id is null or display_name is null
    or char_length(display_name) > 60 or profile_revision < 0 or data_revision < 0
    or learning_data is null or data_initialized is null or profile_revision is null
    or data_revision is null or updated_at is null or data_updated_at is null) then
    raise exception 'incompatible_profile_data: inspect existing records before migrating';
  end if;
  select attnum into id_column from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'id';
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and contype in ('p','u') and conkey = array[id_column]) then
    alter table public.profiles add constraint word_atlas_profiles_id_unique unique (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and contype = 'f' and confrelid = 'auth.users'::regclass and conkey = array[id_column]) then
    alter table public.profiles add constraint word_atlas_profiles_user_fk
      foreign key (id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass
    and conname = 'word_atlas_profile_bounds') then
    alter table public.profiles add constraint word_atlas_profile_bounds
      check (char_length(display_name) <= 60 and profile_revision >= 0 and data_revision >= 0);
  end if;
end $$;

alter table public.profiles
  alter column display_name set default '', alter column updated_at set default now(),
  alter column avatar_path set default null, alter column profile_revision set default 0,
  alter column data_revision set default 0, alter column data_initialized set default false,
  alter column data_updated_at set default now(), alter column learning_data set default '{"settings":{"accent":"uk","autoplay":true,"dailyNew":10,"retention":0.9,"theme":"dark","sfx":true,"spell":true,"startLevel":0,"onboarded":false,"dataset":"open","ambience":"stars","ambienceVolume":0.45,"splash":true,"atlasView":"grid"},"datasets":{}}'::jsonb,
  alter column id set not null, alter column display_name set not null,
  alter column updated_at set not null, alter column profile_revision set not null,
  alter column data_revision set not null, alter column data_initialized set not null,
  alter column data_updated_at set not null, alter column learning_data set not null;

create or replace function public._wa_number(v jsonb, lo numeric, hi numeric, whole boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then return false; end if;
  n := (v::text)::numeric;
  return n >= lo and n <= hi and (not whole or trunc(n) = n);
end $$;

create or replace function public._wa_id(v text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(v ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$', false)
$$;

create or replace function public._wa_keys(v jsonb, allowed text[])
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if v is null or jsonb_typeof(v) <> 'object' then return false; end if;
  for k in select jsonb_object_keys(v) loop
    if not k = any(allowed) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._wa_ids(v jsonb, max_items integer)
returns boolean language plpgsql immutable set search_path = '' as $$
declare x jsonb;
begin
  if v is null or jsonb_typeof(v) <> 'array' then return false; end if;
  if jsonb_array_length(v) > max_items then return false; end if;
  for x in select value from jsonb_array_elements(v) loop
    if jsonb_typeof(x) <> 'string' or not public._wa_id(x #>> '{}') then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._wa_settings(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if not public._wa_keys(v, array['accent','autoplay','dailyNew','retention','theme','sfx',
    'spell','startLevel','onboarded','dataset','ambience','ambienceVolume','splash','atlasView']) then return false; end if;
  if not v ?& array['accent','autoplay','dailyNew','retention','theme','sfx','spell',
    'startLevel','onboarded','dataset','ambience','ambienceVolume','splash','atlasView'] then return false; end if;
  foreach k in array array['autoplay','sfx','spell','onboarded','splash'] loop
    if jsonb_typeof(v -> k) <> 'boolean' then return false; end if;
  end loop;
  return coalesce((v ->> 'accent') in ('uk','us')
    and (v ->> 'theme') in ('system','light','dark')
    and (v ->> 'dataset') in ('open','private')
    and (v ->> 'ambience') in ('off','stars','rain','sea','forest','fire','voyage','cafe')
    and public._wa_number(v -> 'dailyNew', 0, 100, true)
    and public._wa_number(v -> 'retention', 0.7, 0.97)
    and public._wa_number(v -> 'startLevel', 0, 5, true)
    and public._wa_number(v -> 'ambienceVolume', 0, 1)
    and (not v ? 'atlasView' or (v ->> 'atlasView') in ('grid','list','galaxy')), false);
end $$;

create or replace function public._wa_card(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if not public._wa_keys(v, array['due','s','d','el','sd','ls','reps','lapses','st','last','seen'])
    or not v ?& array['due','s','d','el','sd','ls','reps','lapses','st','seen'] then return false; end if;
  foreach k in array array['due','s','el','sd','seen'] loop
    if not public._wa_number(v -> k, 0, 9007199254740991) then return false; end if;
  end loop;
  foreach k in array array['ls','reps','lapses'] loop
    if not public._wa_number(v -> k, 0, 9007199254740991, true) then return false; end if;
  end loop;
  return public._wa_number(v -> 'd', 0, 11)
    and public._wa_number(v -> 'st', 0, 3, true)
    and (not v ? 'last' or public._wa_number(v -> 'last', 0, 9007199254740991));
end $$;

create or replace function public._wa_day(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  if not public._wa_keys(v, array['n','r','c','t']) or not v ?& array['n','r','c','t'] then return false; end if;
  foreach k in array array['n','r','c','t'] loop
    if not public._wa_number(v -> k, 0, 9007199254740991, true) then return false; end if;
  end loop;
  return (v ->> 'c')::numeric <= (v ->> 'r')::numeric
    and (v ->> 'n')::numeric <= (v ->> 'r')::numeric;
end $$;

create or replace function public._wa_typing(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare x jsonb;
begin
  if v is null or jsonb_typeof(v) <> 'array' then return false; end if;
  if jsonb_array_length(v) > 500 then return false; end if;
  for x in select value from jsonb_array_elements(v) loop
    if not public._wa_keys(x, array['at','mode','items','wpm','accuracy'])
      or not x ?& array['at','mode','items','wpm','accuracy'] then return false; end if;
    if jsonb_typeof(x -> 'mode') <> 'string' or (x ->> 'mode') not in ('word','sentence','dictation')
      or not public._wa_number(x -> 'at', 0, 9007199254740991)
      or not public._wa_number(x -> 'items', 0, 9007199254740991, true)
      or not public._wa_number(x -> 'wpm', 0, 400)
      or not public._wa_number(x -> 'accuracy', 0, 100) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._wa_session(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare x jsonb; k text; grade jsonb; step_ids jsonb := '{}'::jsonb;
begin
  if v = 'null'::jsonb then return true; end if;
  if not public._wa_keys(v, array['id','started','steps','index','graded','newIds','reviewIds','pending','finished'])
    or not v ?& array['id','started','steps','index','graded','newIds','reviewIds'] then return false; end if;
  if jsonb_typeof(v -> 'id') <> 'string' or not public._wa_id(v ->> 'id')
    or not public._wa_number(v -> 'started', 0, 9007199254740991)
    or jsonb_typeof(v -> 'steps') <> 'array' or jsonb_typeof(v -> 'graded') <> 'object'
    or not public._wa_ids(v -> 'newIds', 20000) or not public._wa_ids(v -> 'reviewIds', 20000) then return false; end if;
  if not public._wa_number(v -> 'index', 0, jsonb_array_length(v -> 'steps'), true) then return false; end if;
  for x in select value from jsonb_array_elements(v -> 'steps') loop
    if not public._wa_keys(x, array['id','kind','retry','options']) or not x ?& array['id','kind'] then return false; end if;
    if jsonb_typeof(x -> 'id') <> 'string' or not public._wa_id(x ->> 'id')
      or jsonb_typeof(x -> 'kind') <> 'string' or (x ->> 'kind') not in ('intro','meaning','picture','listen','spell') then return false; end if;
    if x ? 'retry' and (jsonb_typeof(x -> 'retry') <> 'boolean' or x ->> 'kind' = 'intro') then return false; end if;
    if x ? 'options' and not public._wa_ids(x -> 'options', 20000) then return false; end if;
    step_ids := step_ids || jsonb_build_object(x ->> 'id', true);
  end loop;
  for k, grade in select key, value from jsonb_each(v -> 'graded') loop
    if not public._wa_id(k) or not step_ids ? k or not public._wa_number(grade, 1, 4, true) then return false; end if;
  end loop;
  if v ? 'pending' and (not public._wa_keys(v -> 'pending', array['correct','value'])
    or not (v -> 'pending') ?& array['correct','value']
    or jsonb_typeof(v #> '{pending,correct}') <> 'boolean'
    or jsonb_typeof(v #> '{pending,value}') <> 'string'
    or (v ->> 'index')::numeric >= jsonb_array_length(v -> 'steps')) then return false; end if;
  if v ? 'pending' and (v #>> array['steps', v ->> 'index', 'kind'] = 'intro'
    or not (v -> 'graded') ? (v #>> array['steps', v ->> 'index', 'id'])) then return false; end if;
  if v ? 'finished' and (not public._wa_number(v -> 'finished', 0, 9007199254740991)
    or (v ->> 'index')::numeric <> jsonb_array_length(v -> 'steps') or v ? 'pending') then return false; end if;
  return true;
end $$;

create or replace function public._wa_date(v text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform make_date(substring(v,1,4)::int, substring(v,6,2)::int, substring(v,9,2)::int);
  return true;
exception when datetime_field_overflow then return false;
end $$;

create or replace function public._wa_progress(v jsonb, dataset_id text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; x jsonb;
begin
  if not public._wa_id(dataset_id)
    or not public._wa_keys(v, array['version','datasetId','cards','bookmarks','days','typing','session','mistakes'])
    or not v ?& array['version','datasetId','cards','bookmarks','days','typing','session','mistakes'] then return false; end if;
  if v -> 'version' <> '2'::jsonb or jsonb_typeof(v -> 'datasetId') <> 'string' or v ->> 'datasetId' <> dataset_id
    or jsonb_typeof(v -> 'cards') <> 'object' or jsonb_typeof(v -> 'days') <> 'object'
    or not public._wa_ids(v -> 'bookmarks', 20000) or not public._wa_ids(v -> 'mistakes', 300)
    or not public._wa_typing(v -> 'typing') or not public._wa_session(v -> 'session') then return false; end if;
  for k, x in select key, value from jsonb_each(v -> 'cards') loop
    if not public._wa_id(k) or not public._wa_card(x) then return false; end if;
  end loop;
  for k, x in select key, value from jsonb_each(v -> 'days') loop
    if not public._wa_date(k) or not public._wa_day(x) then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public._wa_learning(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare k text; x jsonb;
begin
  if octet_length(v::text) > 31457280 or not public._wa_keys(v, array['settings','datasets']) or not v ?& array['settings','datasets']
    or not public._wa_settings(v -> 'settings') or jsonb_typeof(v -> 'datasets') <> 'object' then return false; end if;
  for k, x in select key, value from jsonb_each(v -> 'datasets') loop
    if not public._wa_progress(x, k) then return false; end if;
  end loop;
  return true;
end $$;

-- Existing learning data must not be silently reset during an upgrade.
do $$
begin
  if exists (select 1 from public.profiles where not public._wa_learning(learning_data)) then
    raise exception 'incompatible_learning_data: migration aborted without replacing data';
  end if;
end $$;

-- Server-owned revisions also cover legacy nickname updates during the rollout.
create or replace function public._wa_bump_revisions()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.profile_revision := old.profile_revision;
  new.data_revision := old.data_revision;
  new.updated_at := old.updated_at;
  new.data_updated_at := old.data_updated_at;
  if (new.display_name, new.avatar_path) is distinct from (old.display_name, old.avatar_path) then
    new.profile_revision := old.profile_revision + 1;
    new.updated_at := clock_timestamp();
  end if;
  if (new.learning_data, new.data_initialized) is distinct from (old.learning_data, old.data_initialized) then
    new.data_revision := old.data_revision + 1;
    new.data_updated_at := clock_timestamp();
  end if;
  return new;
end $$;
drop trigger if exists word_atlas_revisions on public.profiles;
create trigger word_atlas_revisions before update on public.profiles
  for each row execute function public._wa_bump_revisions();

create or replace function public._wa_uid()
returns uuid language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise sqlstate 'PT401' using message = 'authentication_required'; end if;
  if not exists (select 1 from auth.users where id = uid) then
    raise sqlstate 'PT401' using message = 'account_not_found';
  end if;
  return uid;
end $$;

create or replace function public._wa_profile(p public.profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'display_name', p.display_name,
    'avatar_path', p.avatar_path, 'profile_revision', p.profile_revision, 'updated_at', p.updated_at)
$$;

-- No auth.users trigger: creating a profile must never prevent Google login.
create or replace function public.ensure_my_account()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._wa_uid(); p public.profiles;
begin
  insert into public.profiles (id, display_name)
    select id, left(coalesce(nullif(raw_user_meta_data ->> 'full_name',''),
      nullif(raw_user_meta_data ->> 'name',''), split_part(coalesce(email,''),'@',1)),60)
    from auth.users where id = uid on conflict (id) do nothing;
  select * into strict p from public.profiles where id = uid;
  return public._wa_profile(p) || jsonb_build_object('learning_data', p.learning_data,
    'data_initialized', p.data_initialized, 'data_revision', p.data_revision,
    'data_updated_at', p.data_updated_at);
end $$;

create or replace function public.save_my_profile(
  p_expected_revision bigint, p_display_name text, p_avatar_path text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._wa_uid(); p public.profiles;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_display_name is null
    or char_length(p_display_name) > 60 then
    raise sqlstate 'PT422' using message = 'invalid_profile';
  end if;
  if p_avatar_path is not null then
    if p_avatar_path !~ ('^' || uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
      or not exists (select 1 from storage.objects where bucket_id = 'word-atlas-avatars' and name = p_avatar_path) then
      raise sqlstate 'PT422' using message = 'invalid_avatar_path';
    end if;
  end if;
  select * into p from public.profiles where id = uid for update;
  if not found then raise sqlstate 'PT409' using message = 'account_not_initialized'; end if;
  if p.profile_revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'profile_revision_conflict';
  end if;
  update public.profiles set display_name = btrim(p_display_name), avatar_path = p_avatar_path
    where id = uid returning * into p;
  return public._wa_profile(p);
end $$;

-- Paths explicitly whitelist learning fields: no profile or authentication fields.
create or replace function public._wa_apply_changes(current_data jsonb, changes jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare op jsonb; path text[]; verb text; value jsonb; result jsonb := current_data;
  size integer; leaf text; valid boolean;
begin
  if changes is null or jsonb_typeof(changes) <> 'array' then
    raise sqlstate 'PT422' using message = 'invalid_changes';
  end if;
  if jsonb_array_length(changes) = 0 or jsonb_array_length(changes) > 50000
    or octet_length(changes::text) > 31457280 then
    raise sqlstate 'PT422' using message = 'invalid_changes_size';
  end if;
  for op in select v from jsonb_array_elements(changes) as a(v) loop
    if not public._wa_keys(op,array['op','path','value']) or not op ?& array['op','path']
      or jsonb_typeof(op -> 'op') <> 'string' or op ->> 'op' not in ('set','remove')
      or jsonb_typeof(op -> 'path') <> 'array' then
      raise sqlstate 'PT422' using message = 'invalid_change';
    end if;
    if exists (select 1 from jsonb_array_elements(op -> 'path') x where jsonb_typeof(x) <> 'string') then
      raise sqlstate 'PT422' using message = 'invalid_path';
    end if;
    path := array(select jsonb_array_elements_text(op -> 'path'));
    size := coalesce(array_length(path,1),0);
    verb := op ->> 'op'; value := op -> 'value'; valid := false;
    if (verb = 'set' and not op ? 'value') or (verb = 'remove' and op ? 'value') then
      raise sqlstate 'PT422' using message = 'invalid_change_value';
    end if;
    if path[1] = 'settings' and verb = 'set' then
      if size = 1 then valid := public._wa_settings(value);
      elsif size = 2 then
        valid := public._wa_settings(jsonb_set(result -> 'settings', array[path[2]], value, true));
        -- jsonb_set of an unknown field must fail instead of silently ignoring it.
      end if;
    elsif path[1] = 'datasets' and size >= 2 and public._wa_id(path[2]) then
      if size = 2 then
        valid := verb = 'remove' or public._wa_progress(value, path[2]);
      elsif result #> path[1:2] is not null then
        leaf := path[3];
        if size = 4 and leaf = 'cards' and public._wa_id(path[4]) then
          valid := verb = 'remove' or public._wa_card(value);
        elsif size = 4 and leaf = 'days' and public._wa_date(path[4]) then
          valid := verb = 'remove' or public._wa_day(value);
        elsif size = 3 and verb = 'set' then
          valid := case leaf
            when 'bookmarks' then public._wa_ids(value,20000)
            when 'mistakes' then public._wa_ids(value,300)
            when 'typing' then public._wa_typing(value)
            when 'session' then public._wa_session(value)
            else false end;
        end if;
      end if;
    end if;
    if not coalesce(valid,false) then raise sqlstate 'PT422' using message = 'invalid_change_path_or_value'; end if;
    if verb = 'remove' then result := result #- path;
    else result := jsonb_set(result,path,value,true); end if;
  end loop;
  if octet_length(result::text) > 31457280 then raise sqlstate 'PT422' using message = 'learning_data_too_large'; end if;
  return result;
end $$;

create or replace function public.apply_my_learning_changes(p_expected_revision bigint, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._wa_uid(); p public.profiles; changed jsonb;
begin
  select * into p from public.profiles where id = uid for update;
  if not found then raise sqlstate 'PT409' using message = 'account_not_initialized'; end if;
  if p_expected_revision is null or p.data_revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'data_revision_conflict';
  end if;
  -- First-device migration is a whole-snapshot decision, never an implicit patch.
  if not p.data_initialized then raise sqlstate 'PT409' using message = 'learning_data_not_initialized'; end if;
  changed := public._wa_apply_changes(p.learning_data,p_changes);
  update public.profiles set learning_data = changed where id = uid returning * into p;
  return jsonb_build_object('data_revision',p.data_revision,'data_updated_at',p.data_updated_at);
end $$;

create or replace function public.replace_my_learning_data(p_expected_revision bigint, p_learning_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := public._wa_uid(); p public.profiles;
begin
  if p_learning_data is null or octet_length(p_learning_data::text) > 31457280
    or not public._wa_learning(p_learning_data) then
    raise sqlstate 'PT422' using message = 'invalid_learning_data';
  end if;
  select * into p from public.profiles where id = uid for update;
  if not found then raise sqlstate 'PT409' using message = 'account_not_initialized'; end if;
  if p_expected_revision is null or p.data_revision <> p_expected_revision then
    raise sqlstate 'PT409' using message = 'data_revision_conflict';
  end if;
  update public.profiles set learning_data = p_learning_data, data_initialized = true
    where id = uid returning * into p;
  return jsonb_build_object('data_revision',p.data_revision,'data_updated_at',p.data_updated_at);
end $$;

-- Dedicated private bucket; never mutate an unrelated bucket's configuration.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
  values ('word-atlas-avatars','word-atlas-avatars',false,5242880,array['image/webp'])
  on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'word-atlas-avatars'
    and public = false and file_size_limit = 5242880 and allowed_mime_types = array['image/webp']) then
    raise exception 'incompatible_avatar_bucket: review the dedicated bucket configuration';
  end if;
end $$;

alter table public.profiles enable row level security;
-- Remove inherited table AND column grants, including grants made outside this repo.
revoke all on table public.profiles from public, anon, authenticated;
do $$
declare c record;
begin
  for c in select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' loop
    execute format('revoke all (%I) on public.profiles from public, anon, authenticated',c.column_name);
  end loop;
end $$;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;
-- Expand only: keep today's production editor working; never reopen a locked rollout.
do $$
begin
  if not exists (select 1 from pg_policy where polrelid='public.profiles'::regclass
    and polname='word_atlas_rpc_only_insert') then
    grant insert (id,display_name,updated_at), update (id,display_name,updated_at) on public.profiles to authenticated;
  end if;
end $$;
drop policy if exists word_atlas_owner_guard on public.profiles;
create policy word_atlas_owner_guard on public.profiles as restrictive for all to public
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists word_atlas_own_select on public.profiles;
create policy word_atlas_own_select on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
drop policy if exists word_atlas_legacy_insert on public.profiles;
create policy word_atlas_legacy_insert on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);
drop policy if exists word_atlas_legacy_update on public.profiles;
create policy word_atlas_legacy_update on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- storage.objects is a Supabase-managed table. Its RLS is already enabled;
-- postgres may manage policies but must not ALTER the platform-owned table.
do $$
begin
  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'storage_rls_disabled: enable RLS through the Storage administrator before rollout';
  end if;
end $$;

-- Restrictive guard also defeats unrelated permissive policies for this bucket.
-- Leave access to all other storage buckets unchanged.
drop policy if exists word_atlas_avatar_guard on storage.objects;
create policy word_atlas_avatar_guard on storage.objects as restrictive for all to public
  using (bucket_id <> 'word-atlas-avatars' or
    ((select auth.uid()) is not null and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')))
  with check (bucket_id <> 'word-atlas-avatars' or
    ((select auth.uid()) is not null and name ~ ('^' || (select auth.uid())::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')));
drop policy if exists word_atlas_avatar_own_select on storage.objects;
create policy word_atlas_avatar_own_select on storage.objects for select to authenticated
  using (bucket_id = 'word-atlas-avatars' and (select auth.uid())::text = split_part(name,'/',1));
drop policy if exists word_atlas_avatar_own_insert on storage.objects;
create policy word_atlas_avatar_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'word-atlas-avatars' and (select auth.uid())::text = split_part(name,'/',1));
drop policy if exists word_atlas_avatar_own_update on storage.objects;
create policy word_atlas_avatar_own_update on storage.objects for update to authenticated
  using (bucket_id = 'word-atlas-avatars' and (select auth.uid())::text = split_part(name,'/',1))
  with check (bucket_id = 'word-atlas-avatars' and (select auth.uid())::text = split_part(name,'/',1));
drop policy if exists word_atlas_avatar_own_delete on storage.objects;
create policy word_atlas_avatar_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'word-atlas-avatars' and (select auth.uid())::text = split_part(name,'/',1));

-- Backfill actual existing identities, without creating authentication users.
insert into public.profiles (id,display_name)
  select id,left(coalesce(nullif(raw_user_meta_data ->> 'full_name',''),
    nullif(raw_user_meta_data ->> 'name',''),split_part(coalesce(email,''),'@',1)),60)
  from auth.users on conflict (id) do nothing;

-- Helpers are implementation details. Definer RPCs can call them, clients cannot.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and left(p.proname,4) = '_wa_' loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  end loop;
end $$;
revoke all on function public.ensure_my_account(), public.save_my_profile(bigint,text,text),
  public.apply_my_learning_changes(bigint,jsonb), public.replace_my_learning_data(bigint,jsonb) from public, anon;
grant execute on function public.ensure_my_account(), public.save_my_profile(bigint,text,text),
  public.apply_my_learning_changes(bigint,jsonb), public.replace_my_learning_data(bigint,jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
