
# Migration 1 — Pre-Execution Fix: set_org_id_from_user() NULL auth.uid() Guard

## The Problem

`set_org_id_from_user()` currently calls `public.get_user_org_id()`, which runs:
```sql
SELECT org_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
```

When called from a **service_role** context or an **edge function**, `auth.uid()` returns `NULL`. The `WHERE user_id = NULL` predicate matches no rows, so `get_user_org_id()` returns `NULL`. The trigger then sets `NEW.org_id = NULL`, which immediately violates the `NOT NULL` constraint on every entity table — crashing any edge function insert that doesn't explicitly pass `org_id`.

## The Fix

Update `set_org_id_from_user()` to only attempt resolution when `auth.uid() IS NOT NULL`. If `auth.uid()` is NULL (service_role / edge function context), the trigger becomes a no-op — and the `NOT NULL` constraint on `org_id` enforces that the caller must have passed `org_id` explicitly:

```sql
CREATE OR REPLACE FUNCTION public.set_org_id_from_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Only resolve org_id from session when a real user session is present.
  -- In service_role / edge function context auth.uid() is NULL — the trigger
  -- is a no-op, and the NOT NULL constraint on org_id enforces that the
  -- caller (edge function / service role insert) must supply org_id explicitly.
  IF NEW.org_id IS NULL AND auth.uid() IS NOT NULL THEN
    NEW.org_id = public.get_user_org_id();
  END IF;
  RETURN NEW;
END;
$$;
```

The condition `NEW.org_id IS NULL AND auth.uid() IS NOT NULL` means:
- **User session insert, no org_id passed** → auto-resolved from profiles (existing behavior)
- **User session insert, org_id explicitly passed** → preserved as-is (existing guard)
- **Edge function / service_role insert, org_id explicitly passed** → preserved, trigger is no-op
- **Edge function / service_role insert, no org_id passed** → `NEW.org_id` stays NULL → NOT NULL constraint fires → crash with a clear constraint violation error (correct: edge functions must pass org_id)

## Edge Function Contract (documented)

Every edge function that inserts into any of the 18 entity tables **must** supply `org_id` explicitly in the insert payload. The standard pattern is:

```typescript
// In every edge function that inserts into DD entity tables:
const { data: { claims } } = await supabase.auth.getClaims(token);
// org_id must be resolved server-side, e.g. via:
const { data: orgRow } = await adminClient
  .from('profiles')
  .select('org_id')
  .eq('user_id', claims.sub)
  .single();

await adminClient.from('deals').insert({
  org_id: orgRow.org_id,   // ← required; trigger is no-op for service_role
  name: '...',
  ...
});
```

This is implemented starting in Step 8 (dd-ingest). The schema enforces it via NOT NULL.

## assign_user_org() — Same Pattern Applied

`assign_user_org()` (for `profiles`) already has `IF NEW.org_id IS NULL` but does not guard against `auth.uid() IS NULL`. Since `profiles` is only inserted by the `handle_new_user` trigger (which runs in a trigger context without a user session), it uses `SELECT id FROM public.orgs LIMIT 1` — not `auth.uid()` — so it is safe as written. No change needed there.

## What Gets Created

Two files:

| File | Action |
|---|---|
| `supabase/migrations/20260220000000_dd_vault_migration_1.sql` | CREATE — complete Migration 1 SQL with fix applied to set_org_id_from_user() |
| `src/test/ddValidation.test.ts` | CREATE — 54-test acceptance gate (53 active + 1 skipped sentinel) |

## Technical Details — Migration Block Order (unchanged from approved plan, fix inline in Block C)

```text
Block A  Enum types (app_role 'external', all dd_ enums)
Block B  orgs table → seed (ON CONFLICT DO NOTHING) → profiles.org_id →
         backfill → NOT NULL → assign_user_org trigger
Block C  get_user_org_id()
         set_org_id_from_user()  ← fix applied here
Block D  validate_deal_member_org() + validate_property_member_org() (bodies only)
Block E  18 entity tables in FK order, each with set_org_id_from_user trigger;
         deal_members + property_members also get cross-org validation triggers;
         upload_file_status + unit_ledger_rows also get updated_at triggers;
         documents gets canonical partial unique index
         (WHERE deleted_at IS NULL AND duplicate_of_document_id IS NULL)
Block F  is_deal_member(), is_property_member(), get_tenants_for_property()
         (all reference Block E tables — safe)
Block G  ENABLE ROW LEVEL SECURITY on all 19 tables — zero CREATE POLICY
```

## Acceptance Conditions (unchanged + one addition)

- All 19 tables exist with RLS enabled and zero policies
- `profiles.org_id` NOT NULL, existing rows backfilled
- New signup chain works: `handle_new_user` → profiles INSERT → `trg_assign_user_org` → `org_id` set
- Seed idempotent: `ON CONFLICT (name) DO NOTHING`
- All 8 helper functions callable
- **New:** `set_org_id_from_user()` is a no-op when `auth.uid() IS NULL` — service_role inserts without `org_id` hit NOT NULL constraint cleanly
- `src/test/ddValidation.test.ts` exists; Vitest reports module-not-found for `@/lib/ddValidation` (intentional gate — unblocked in Step 4)
