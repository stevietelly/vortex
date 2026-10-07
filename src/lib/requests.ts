import { useSyncExternalStore } from "react"
import type { RequestRecord } from "@/types/domain"
import {
  listRequests,
  clearRequests as dbClear,
  saveRequest as dbSave,
  failRequest as dbFail,
  getRequest as dbGetRequest,
} from "@/lib/db"

type Listener = () => void

let requests: RequestRecord[] = []
// Records touched this session. Read first so lookups work before the DB has
// caught up — and so the web preview (no SQLite) still has a source of truth.
const session = new Map<string, RequestRecord>()
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l())
}

export function subscribe(l: Listener): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function getRequests(): RequestRecord[] {
  return requests
}

export function useRequests(): RequestRecord[] {
  return useSyncExternalStore(subscribe, getRequests)
}

function newUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export async function loadRequests(): Promise<void> {
  try {
    const rows = await listRequests()
    // Session records win: they may hold updates the DB write didn't reach.
    const byId = new Map(rows.map((r) => [r.id, r]))
    for (const [id, rec] of session) byId.set(id, rec)
    requests = [...byId.values()].sort((a, b) => b.requestedAt - a.requestedAt)
  } catch {
    requests = [...session.values()].sort((a, b) => b.requestedAt - a.requestedAt)
  }
  emit()
}

export async function clearRequests(): Promise<void> {
  try {
    await dbClear()
  } catch {
    /* not in a Tauri context */
  }
  session.clear()
  requests = []
  emit()
}

/**
 * Persist a new request for a URL. Returns the generated uid — the stable id
 * used for the request row, its download items, and the info route.
 */
export async function saveRequest(
  rec: Omit<RequestRecord, "id">,
): Promise<string> {
  const id = newUid()
  const full: RequestRecord = { ...rec, id }
  session.set(id, full)
  try {
    await dbSave(full)
  } catch {
    /* not in a Tauri context */
  }
  await loadRequests()
  return id
}

/** Upsert an existing request (e.g. once its metadata has been fetched). */
export async function updateRequest(rec: RequestRecord): Promise<void> {
  session.set(rec.id, rec)
  try {
    await dbSave(rec)
  } catch {
    /* not in a Tauri context */
  }
  await loadRequests()
}

/** Look up a request by uid — session cache first, then the DB. */
export async function getRequest(uid: string): Promise<RequestRecord | null> {
  const cached = session.get(uid)
  if (cached) return cached
  try {
    return await dbGetRequest(uid)
  } catch {
    return null
  }
}

/** Mark a request as failed (metadata fetch error). */
export async function failRequest(uid: string, error: string): Promise<void> {
  const cached = session.get(uid)
  if (cached) {
    session.set(uid, { ...cached, status: "error", error, requestedAt: Date.now() })
  }
  try {
    await dbFail(uid, error)
  } catch {
    /* not in a Tauri context */
  }
  await loadRequests()
}
