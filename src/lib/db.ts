import Database from "@tauri-apps/plugin-sql"
import type {
  DownloadItem,
  DownloadStatus,
  IssueLevel,
  PostprocessIssue,
  RequestRecord,
  VideoMetadata,
} from "@/types/domain"

// All persistence goes through @tauri-apps/plugin-sql. The schema + migration
// are registered on the Rust side (tauri-plugin-sql Builder::add_migrations),
// and the DB is preloaded in tauri.conf.json so the tables exist at startup.
const DB_NAME = "sqlite:vortex.db"

let dbPromise: Promise<Database> | null = null

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_NAME)
  }
  return dbPromise
}

function now(): number {
  return Date.now()
}

interface RequestRow {
  id: string
  url: string
  title: string
  uploader: string
  requested_at: number
  status: string
  error: string | null
  metadata: string
}

interface ItemRow {
  id: string
  request_id: string
  url: string
  title: string
  idx: number | null
  format_id: string
  status: string
  progress: number
  speed: string | null
  eta: string | null
  output_path: string | null
  error: string | null
  output_dir: string | null
  added_at: number
  started_at: number | null
  completed_at: number | null
  updated_at: number
}

function mapRequest(r: RequestRow): RequestRecord {
  let metadata: VideoMetadata
  try {
    metadata = (JSON.parse(r.metadata) as VideoMetadata)
  } catch {
    metadata = ({} as VideoMetadata)
  }
  return {
    id: r.id,
    url: r.url,
    title: r.title,
    uploader: r.uploader,
    requestedAt: r.requested_at,
    status: r.status,
    error: r.error ?? undefined,
    metadata,
  }
}

function mapItem(r: ItemRow): DownloadItem {
  return {
    id: r.id,
    requestId: r.request_id,
    url: r.url,
    title: r.title,
    index: r.idx ?? undefined,
    formatId: r.format_id,
    status: r.status as DownloadStatus,
    progress: r.progress,
    speed: r.speed ?? undefined,
    eta: r.eta ?? undefined,
    outputPath: r.output_path ?? undefined,
    error: r.error ?? undefined,
    outputDir: r.output_dir ?? undefined,
    addedAt: r.added_at,
    startedAt: r.started_at ?? undefined,
    completedAt: r.completed_at ?? undefined,
    updatedAt: r.updated_at,
  }
}

export async function saveRequest(rec: RequestRecord): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO requests (id, url, title, uploader, requested_at, status, error, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url=excluded.url, title=excluded.title, uploader=excluded.uploader,
       requested_at=excluded.requested_at, status=excluded.status,
       error=excluded.error, metadata=excluded.metadata`,
    [
      rec.id,
      rec.url,
      rec.title,
      rec.uploader,
      rec.requestedAt,
      rec.status,
      rec.error ?? null,
      JSON.stringify(rec.metadata),
    ],
  )
}

export async function getRequest(id: string): Promise<RequestRecord | null> {
  const db = await getDb();
  const rows = await db.select<RequestRow[]>(
    "SELECT id, url, title, uploader, requested_at, status, error, metadata FROM requests WHERE id = ?",
    [id],
  );
  const row = rows[0];
  return row ? mapRequest(row) : null;
}

export async function failRequest(id: string, error: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE requests SET status = 'error', error = ?, requested_at = ? WHERE id = ?",
    [error, Date.now(), id],
  );
}

export async function listRequests(): Promise<RequestRecord[]> {
  const db = await getDb()
  const rows = await db.select<RequestRow[]>(
    "SELECT id, url, title, uploader, requested_at, status, error, metadata FROM requests ORDER BY requested_at DESC",
  )
  return rows.map(mapRequest)
}

export async function clearRequests(): Promise<void> {
  const db = await getDb()
  await db.execute("DELETE FROM requests", [])
  await db.execute("DELETE FROM download_items", [])
}

export interface DownloadItemSeed {
  index: number
  title: string
}

/** Persist each playlist entry as its own (queued) download item. */
export async function savePlaylistItems(
  requestId: string,
  url: string,
  items: DownloadItemSeed[],
): Promise<void> {
  const db = await getDb()
  const t = now()
  for (const it of items) {
    const id = `${requestId}#${it.index}`
    await db.execute(
      `INSERT INTO download_items (id, request_id, url, title, idx, format_id, status, progress, output_dir, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'queued', 0, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET status='queued', updated_at=excluded.updated_at`,
      [id, requestId, url, it.title, it.index, t, t],
    )
  }
}

/** Insert or update a single download item row. */
export async function upsertDownloadItem(item: DownloadItem): Promise<void> {
  const db = await getDb()
  await db.execute(
    `INSERT INTO download_items (id, request_id, url, title, idx, format_id, status, progress, speed, eta, output_path, error, output_dir, added_at, started_at, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       request_id=excluded.request_id, url=excluded.url, title=excluded.title,
       idx=excluded.idx, format_id=excluded.format_id, status=excluded.status,
       progress=excluded.progress, speed=excluded.speed, eta=excluded.eta,
       output_path=excluded.output_path, error=excluded.error, output_dir=excluded.output_dir,
       started_at=excluded.started_at, completed_at=excluded.completed_at,
       updated_at=excluded.updated_at`,
    [
      item.id,
      item.requestId,
      item.url,
      item.title,
      item.index ?? null,
      item.formatId,
      item.status,
      item.progress,
      item.speed ?? null,
      item.eta ?? null,
      item.outputPath ?? null,
      item.error ?? null,
      item.outputDir ?? null,
      item.addedAt,
      item.startedAt ?? null,
      item.completedAt ?? null,
      item.updatedAt,
    ],
  )
}

export async function listDownloadItems(
  requestId: string,
): Promise<DownloadItem[]> {
  const db = await getDb()
  const rows = await db.select<ItemRow[]>(
    "SELECT * FROM download_items WHERE request_id = ? ORDER BY idx",
    [requestId],
  )
  return rows.map(mapItem)
}

/** Items that were not finished (interrupted by a crash/close) and can resume. */
export async function listPendingItems(): Promise<DownloadItem[]> {
  const db = await getDb()
  const rows = await db.select<ItemRow[]>(
    "SELECT * FROM download_items WHERE status IN ('queued','downloading','merging') ORDER BY added_at",
    [],
  )
  return rows.map(mapItem)
}

interface IssueRow {
  item_id: string
  level: string
  stage: string
  code: string
  message: string
}

/**
 * Store the classified WARNING/ERROR lines reported for a job. Replaces any
 * previous report for that item (a retry supersedes the old one).
 */
export async function replacePostprocessIssues(
  itemId: string,
  requestId: string,
  issues: PostprocessIssue[],
): Promise<void> {
  const db = await getDb()
  await db.execute("DELETE FROM postprocess_issues WHERE item_id = ?", [itemId])
  const t = Date.now()
  for (const i of issues) {
    await db.execute(
      `INSERT INTO postprocess_issues (item_id, request_id, level, stage, code, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, requestId, i.level, i.stage, i.code, i.message, t],
    )
  }
}

/** All stored issues for a request, grouped by download item id. */
export async function listPostprocessIssues(
  requestId: string,
): Promise<Record<string, PostprocessIssue[]>> {
  const db = await getDb()
  const rows = await db.select<IssueRow[]>(
    "SELECT item_id, level, stage, code, message FROM postprocess_issues WHERE request_id = ? ORDER BY created_at",
    [requestId],
  )
  const out: Record<string, PostprocessIssue[]> = {}
  for (const r of rows) {
    const issue: PostprocessIssue = {
      level: r.level as IssueLevel,
      stage: r.stage,
      code: r.code,
      message: r.message,
    }
    ;(out[r.item_id] ??= []).push(issue)
  }
  return out
}
