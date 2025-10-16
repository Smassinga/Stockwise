# Supabase Authentication Redirects Configuration

This document explains how to properly configure authentication redirects in Supabase to ensure users are redirected to the correct URLs after authentication.

## Problem

Users were landing on the Supabase domain (`*.supabase.co/...`) because the redirect target wasn't being supplied or Supabase Auth wasn't configured with the app URL. This resulted in the error: `{"error":"requested path is invalid"}`.

## Solution

### 1. Set the Canonical Redirect at Supabase (One-time Dashboard Change)

In the Supabase Dashboard:
1. Go to **Authentication → URL Configuration**
2. Set the following values:

* **Site URL**: `https://stockwiseapp.com`
* **Additional Redirect URLs**: Add each URL you'll use explicitly:
  * `https://stockwiseapp.com/auth/callback`
  * `http://localhost:3000/auth/callback` (or your dev port)
  * (any other preview URLs)

This ensures that even if the client forgets to pass a redirect, Auth knows where to send users after verifying the token.

### 2. Always Pass `redirectTo` / `emailRedirectTo` in Your Client

Where you request magic links, password resets, or OAuth, always pass a redirect pointing at your callback route. Use the current origin so it works in dev and prod.

Example in `src/hooks/useAuth.tsx`:

```ts
// src/lib/auth.ts (or inside your sign-in component)
import { supabase } from '../lib/db';

const APP_ORIGIN =
  import.meta.env.VITE_APP_ORIGIN ?? window.location.origin; 
const AUTH_CALLBACK = `${APP_ORIGIN}/auth/callback`;

// Magic link:
await supabase.auth.signInWithOtp({
  email,
  options: { emailRedirectTo: AUTH_CALLBACK },
});

// Password reset:
await supabase.auth.resetPasswordForEmail(email, {
  redirectTo: AUTH_CALLBACK,
});

// OAuth:
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: AUTH_CALLBACK },
});
```

> Supabase v2: `signInWithOtp(..., { options: { emailRedirectTo }})` and `signInWithOAuth(..., { options: { redirectTo }})`.

### 3. Ensure You Have a Callback Route That Exchanges the Code for a Session

The app already has this implemented in `src/pages/AuthCallback.tsx`.

### 4. If You Invite Users from an Edge Function, Pass `redirectTo` There Too

In `supabase/functions/admin-users/index.ts`, the invite path includes the redirect:

```ts
// inside your admin function when inviting:
await supaAdmin.auth.admin.inviteUserByEmail(email, {
  redirectTo: 'https://stockwiseapp.com/auth/callback',
});
```

> For any programmatic password reset you trigger from a function, use the same `redirectTo`.

### 5. Environment Variables

Make sure to set the following environment variables:

In `.env` for local development:
```
VITE_SITE_URL=https://stockwiseapp.com
```

In production (e.g., Vercel), define these in the dashboard as environment variables.

## Quick Test Matrix (Takes 2 Minutes)

* **Magic link** sign-in: Email link opens Supabase verify, then immediately 302 → `https://stockwiseapp.com/auth/callback` → session established → redirected to `/`.
* **Password reset**: same dance, same callback.
* **OAuth** (if used): provider → `/auth/callback`.
* **Invite** (from your admin function): link → `/auth/callback`.

## Why This Fixes the Issue

The current links don't include a valid `redirect_to`, so the token verification page can't forward anywhere allowed and stalls on the Supabase domain, yielding "requested path is invalid." Setting the site URL **and** explicitly passing `redirectTo` makes the flow deterministic and immune to that failure.

If you want to belt-and-suspenders it, keep both the Dashboard URL config **and** explicit redirects in code. That way even a misconfigured preview build still works.