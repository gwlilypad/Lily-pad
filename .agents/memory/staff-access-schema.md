---
name: Staff access schema
description: Live Supabase staff authorization schema differs from the legacy setup SQL and assumptions in server code.
---

Live Supabase has populated admin and staff whitelist tables, but no admin_users table. Treat membership in the existing whitelists (plus verified Supabase sign-in) as a valid authorization source; do not assume the older admin_users setup SQL was applied.

**Why:** The Admin Pad Queue returned 403 for signed-in administrators because its token validator queried a table that does not exist, even though authorized emails were present in the whitelist.

**How to apply:** When changing admin/staff authentication, check the actual live schema before relying on table names in embedded setup SQL. Preserve explicit suspension checks and fail closed for unrecognized users.