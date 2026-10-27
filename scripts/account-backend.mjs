import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const projectPattern = /^[a-z0-9]{20}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const rpcNames = [
  "ensure_my_account",
  "save_my_profile",
  "apply_my_learning_changes",
  "replace_my_learning_data",
];
const migrationURL = new URL(
  "../supabase/migrations/20261027000000_account_data.sql",
  import.meta.url,
);

// Deliberately does not accept arbitrary SQL, a database password, or a service key
// in place of the Management API token. No HTTP response body is printed.
export async function runAccountBackend({
  args = process.argv.slice(2),
  env = process.env,
  request = fetch,
  read = readFile,
  log = console.log,
} = {}) {
  const [mode = "check", ...flags] = args;
  if (
    !["check", "apply", "verify"].includes(mode) ||
    flags.some((f) => !/^--(project-ref|verify-user-id)=/.test(f))
  ) {
    throw new Error(
      "Usage: backend:account -- check|apply|verify --project-ref=<ref> [--verify-user-id=<Google user UUID>]",
    );
  }
  const option = (name) =>
    flags.find((f) => f.startsWith(`--${name}=`))?.split("=")[1];
  const projectRef = option("project-ref");
  const explicitUser = option("verify-user-id");
  if (!projectPattern.test(projectRef ?? ""))
    throw new Error("An explicit valid --project-ref is required.");
  if (explicitUser && !uuidPattern.test(explicitUser))
    throw new Error("Invalid --verify-user-id.");
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    log(
      "BLOCKED: SUPABASE_ACCESS_TOKEN is missing. Add it through secure environment settings and apply the configuration. No migration was executed.",
    );
    return 2;
  }
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  async function sql(query) {
    let response;
    try {
      response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new Error(
        "Supabase Management API could not be reached. No credentials or database data have been logged. Check state before retrying an apply.",
      );
    }
    if (!response.ok)
      throw new Error(
        `Supabase Management API HTTP ${response.status}. Check authorization/project access; do not substitute a service_role key. Check state before retrying an apply.`,
      );
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("Unexpected Supabase Management API response.");
    }
    if (!Array.isArray(result))
      throw new Error("Unexpected Supabase Management API result shape.");
    return result;
  }
  async function inspect() {
    // Each check tolerates a missing profiles table, so PGRST205 can be repaired.
    const rows = await sql(`select
      exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname='profiles' and c.relrowsecurity) as rls,
      (select count(*)::int from information_schema.columns where table_schema='public'
        and table_name='profiles' and column_name in ('id','display_name','avatar_path','profile_revision',
          'data_revision','data_initialized','learning_data','updated_at','data_updated_at')) as columns,
      (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in ('${rpcNames.join("','")}') and p.prosecdef) as rpcs,
      exists (select 1 from storage.buckets where id='word-atlas-avatars' and public=false
        and file_size_limit=5242880 and allowed_mime_types=array['image/webp']) as private_bucket,
      (select relrowsecurity from pg_class where oid='storage.objects'::regclass) as storage_rls,
      (select count(*)::int from pg_policy where polrelid='storage.objects'::regclass
        and polname in ('word_atlas_avatar_guard','word_atlas_avatar_own_select',
          'word_atlas_avatar_own_insert','word_atlas_avatar_own_update','word_atlas_avatar_own_delete')) as storage_policies,
      exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
        join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='profiles'
        and p.polname='word_atlas_owner_guard' and not p.polpermissive) as owner_guard`);
    const state = rows[0];
    return (
      !!state &&
      state.rls === true &&
      state.columns === 9 &&
      state.rpcs === 4 &&
      state.private_bucket === true &&
      state.storage_policies === 5 &&
      state.storage_rls === true &&
      state.owner_guard === true
    );
  }
  if (mode === "check") {
    const ready = await inspect();
    log(
      ready
        ? "Backend structure is ready. Real Google-account rollback verification and authenticated browser read/write are still required before frontend rollout."
        : "NOT READY: profiles/RPC/RLS/Storage structure is incomplete. No migration was executed.",
    );
    return ready ? 0 : 3;
  }
  if (mode === "apply") {
    await sql(await read(migrationURL, "utf8"));
    if (!(await inspect()))
      throw new Error(
        "Migration request finished, but backend structure verification failed. Do not deploy the frontend.",
      );
    log(
      "Expand migration applied; backend structure verified. Existing frontend is unchanged. Run verify, then authenticated Google-account browser read/write before frontend rollout.",
    );
    return 0;
  }
  if (!(await inspect()))
    throw new Error(
      "Backend structure is incomplete. Apply and inspect the expand migration first.",
    );
  const users = await sql(`select id::text from auth.users where
    (raw_app_meta_data->>'provider'='google' or raw_app_meta_data->'providers' ? 'google')
    ${explicitUser ? `and id='${explicitUser}'::uuid` : ""} order by id limit 2`);
  if (users.length !== 1 || !uuidPattern.test(users[0].id)) {
    throw new Error(
      "Select exactly one existing Google identity with --verify-user-id. No test identity will be created.",
    );
  }
  const uid = users[0].id;
  const digestQuery = `select coalesce((select md5(to_jsonb(p)::text) from public.profiles p where id='${uid}'::uuid),'absent') as digest`;
  const before = await sql(digestQuery);
  await sql(`begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${uid}',true);
    do $$
    declare original jsonb; saved jsonb; after_save jsonb; replaced jsonb; patched jsonb; final_state jsonb; new_theme text;
    begin
      original:=public.ensure_my_account();
      saved:=public.save_my_profile((original->>'profile_revision')::bigint,
        case when original->>'display_name'='Word Atlas probe' then 'Word Atlas probe 2' else 'Word Atlas probe' end,
        original->>'avatar_path');
      after_save:=public.ensure_my_account();
      if after_save->'learning_data' is distinct from original->'learning_data'
        or after_save->'data_revision' is distinct from original->'data_revision' then
        raise exception 'profile_write_changed_learning_data';
      end if;
      replaced:=public.replace_my_learning_data((original->>'data_revision')::bigint,original->'learning_data');
      new_theme:=case when original#>>'{learning_data,settings,theme}'='light' then 'dark' else 'light' end;
      patched:=public.apply_my_learning_changes((replaced->>'data_revision')::bigint,
        jsonb_build_array(jsonb_build_object('op','set','path',jsonb_build_array('settings','theme'),'value',new_theme)));
      final_state:=public.ensure_my_account();
      if final_state#>>'{learning_data,settings,theme}' <> new_theme
        or final_state->'display_name' is distinct from saved->'display_name'
        or final_state->'avatar_path' is distinct from original->'avatar_path'
        or final_state->'profile_revision' is distinct from saved->'profile_revision' then
        raise exception 'account_probe_assertion_failed';
      end if;
    end $$;
    rollback;`);
  const after = await sql(digestQuery);
  if (before.length !== 1 || before[0].digest !== after[0]?.digest)
    throw new Error(
      "Rollback verification mismatch. Stop rollout and inspect the account; concurrent user activity may also change this digest.",
    );
  log(
    "Existing Google identity: four RPCs read/write successfully as authenticated, and all probe writes rolled back. This verifies the database role, not the browser OAuth session. Complete authenticated REST/browser read/write before frontend rollout.",
  );
  return 0;
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    process.exitCode = await runAccountBackend();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Backend operation failed.",
    );
    process.exitCode = 1;
  }
}
