const INVITE_TOKEN_KEY = "sw:inviteToken";

function sessionStore(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function localStore(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function stashInviteToken(token: string) {
  const session = sessionStore();
  const local = localStore();

  session?.setItem(INVITE_TOKEN_KEY, token);
  local?.removeItem(INVITE_TOKEN_KEY);
}

export function readInviteToken(): string | null {
  const session = sessionStore();
  const local = localStore();
  return session?.getItem(INVITE_TOKEN_KEY) ?? local?.getItem(INVITE_TOKEN_KEY) ?? null;
}

export function clearInviteToken() {
  sessionStore()?.removeItem(INVITE_TOKEN_KEY);
  localStore()?.removeItem(INVITE_TOKEN_KEY);
}
