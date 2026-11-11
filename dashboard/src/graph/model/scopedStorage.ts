export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ProfilePreferenceScope {
  /** Stable, host-authorized profile namespace. Null means session-only. */
  profileKey: string | null;
  /** Optional owner scoping inside a host-mount session store. */
  sessionKey?: string | null;
}

export interface GraphViewPreferenceScope extends ProfilePreferenceScope {
  /** Stable authorized owner namespace. Null means session-only. */
  ownerKey: string | null;
}

/** Allocate once per host mount and pass to every preference model call. */
export function createPreferenceSessionStore(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const STORAGE_PREFIX = "reliquary.graph.preferences.v1";

function namespacePart(value: string | null): string | null {
  if (typeof value !== "string" || value.trim() === "" || value.length > 256) return null;
  return encodeURIComponent(value);
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function resolveStorage(scope: ProfilePreferenceScope, session?: StorageLike): {
  storage: StorageLike | null;
  key: (name: string) => string;
  fallback: StorageLike | null;
} {
  const profile = namespacePart(scope?.profileKey ?? null);
  if (profile) {
    return {
      storage: browserStorage(),
      key: (name) => `${STORAGE_PREFIX}:profile:${profile}:${name}`,
      fallback: session ?? null,
    };
  }
  return {
    storage: session ?? null,
    key: (name) => `${STORAGE_PREFIX}:session:${namespacePart(scope?.sessionKey ?? null) ?? "default"}:${name}`,
    fallback: null,
  };
}

export function readPreference(scope: ProfilePreferenceScope, name: string, session?: StorageLike): string | null {
  const resolved = resolveStorage(scope, session);
  const key = resolved.key(name);
  // A successful session fallback write is newer than an older browser value.
  try {
    const memoryValue = resolved.fallback?.getItem(key);
    if (memoryValue !== null && memoryValue !== undefined) return memoryValue;
  } catch { /* Continue to primary storage. */ }
  try { return resolved.storage?.getItem(key) ?? null; } catch { return null; }
}

export function writePreference(scope: ProfilePreferenceScope, name: string, value: string, session?: StorageLike): void {
  const resolved = resolveStorage(scope, session);
  const key = resolved.key(name);
  try {
    if (!resolved.storage) throw new Error("Preference storage unavailable");
    resolved.storage.setItem(key, value);
    return;
  } catch { /* Fall back to this host mount's explicit session store. */ }
  try { resolved.fallback?.setItem(key, value); } catch { /* Nonfatal. */ }
}

export function removePreference(scope: ProfilePreferenceScope, name: string, session?: StorageLike): void {
  const resolved = resolveStorage(scope, session);
  const key = resolved.key(name);
  try { resolved.storage?.removeItem(key); } catch { /* Nonfatal. */ }
  try { resolved.fallback?.removeItem(key); } catch { /* Nonfatal. */ }
}

export function graphViewPreferenceScopeKey(scope: GraphViewPreferenceScope): string | null {
  const profile = namespacePart(scope?.profileKey ?? null);
  const owner = namespacePart(scope?.ownerKey ?? null);
  return profile && owner ? `${profile}:${owner}` : null;
}



