import { useSyncExternalStore } from "react";
import type { RequestRecord } from "@/types/domain";
import {
  listRequests,
  clearRequests as dbClear,
  saveRequest as dbSave,
  saveFailedRequest as dbSaveFailed,
} from "@/lib/db";

type Listener = () => void;

let requests: RequestRecord[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function getRequests(): RequestRecord[] {
  return requests;
}

export function useRequests(): RequestRecord[] {
  return useSyncExternalStore(subscribe, getRequests);
}

export async function loadRequests(): Promise<void> {
  try {
    requests = await listRequests();
  } catch {
    requests = [];
  }
  emit();
}

export async function clearRequests(): Promise<void> {
  try {
    await dbClear();
  } catch {
    /* not in a Tauri context */
  }
  requests = [];
  emit();
}

export async function saveRequest(rec: RequestRecord): Promise<void> {
  try {
    await dbSave(rec);
  } catch {
    /* not in a Tauri context */
  }
  await loadRequests();
}

export async function saveFailedRequest(
  url: string,
  error: string,
): Promise<void> {
  try {
    await dbSaveFailed(url, error);
  } catch {
    /* not in a Tauri context */
  }
  await loadRequests();
}
