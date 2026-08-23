import Database from "@tauri-apps/plugin-sql";
import type {
  DownloadItem,
  DownloadStatus,
  RequestRecord,
  VideoMetadata,
} from "@/types/domain";

// All persistence goes through @tauri-apps/plugin-sql. The schema + migration
// are registered on the Rust side (tauri-plugin-sql Builder::add_migrations),
// and the DB is preloaded in tauri.conf.json so the tables exist at startup.
const DB_NAME = "sqlite:vortex.db";

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_NAME);
  }
  return dbPromise;
}

function now(): number {
  return Date.now();
}

interface RequestRow {
  id: string;
  url: string;
  title: string;
  uploader: string;
  requested_at: number;
  status: string;
  error: string | null;
  metadata: string;
}

interface ItemRow {
  id: string;
  request_id: string;
  url: string;
  title: string;
  idx: number | null;
  format_id: string;
  status: string;
  progress: number;
  speed: string | null;
  eta: string | null;
  output_path: string | null;
  error: string | null;
  output_dir: string | null;
  added_at: number;
  updated_at: number;
}

function mapRequest(r: RequestRow): RequestRecord {
  let metadata: VideoMetadata;
  try {
    metadata = JSON.parse(r.metadata) as VideoMetadata;
  } catch {
    metadata = {} as VideoMetadata;
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
  };
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
    updatedAt: r.updated_at,
  };
}

export async function saveRequest(rec: RequestRecord): Promise<void> {
  const db = await getDb();
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
  );
}

export async function saveFailedRequest(
  url: string,
  error: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO requests (id, url, title, uploader, requested_at, status, error, metadata)
     VALUES (?, ?, '', '', ?, 'error', ?, 'null')
     ON CONFLICT(id) DO UPDATE SET
       status='error', error=excluded.error, requested_at=excluded.requested_at`,
    [url, url, Date.now(), error],
  );
}

export async function listRequests(): Promise<RequestRecord[]> {
  const db = await getDb();
  const rows = await db.select<RequestRow[]>(
    "SELECT id, url, title, uploader, requested_at, status, error, metadata FROM requests ORDER BY requested_at DESC",
  );
  return rows.map(mapRequest);
}

export async function clearRequests(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM requests", []);
  await db.execute("DELETE FROM download_items", []);
}

export interface DownloadItemSeed {
  index: number;
  title: string;
}

/** Persist each playlist entry as its own (queued) download item. */
export async function savePlaylistItems(
  requestId: string,
  url: string,
  items: DownloadItemSeed[],
): Promise<void> {
  const db = await getDb();
  const t = now();
  for (const it of items) {
    const id = `${requestId}#${it.index}`;
    await db.execute(
      `INSERT INTO download_items (id, request_id, url, title, idx, format_id, status, progress, output_dir, added_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'queued', 0, '', ?, ?)
       ON CONFLICT(id) DO UPDATE SET status='queued', updated_at=excluded.updated_at`,
      [id, requestId, url, it.title, it.index, t, t],
    );
  }
}

/** Insert or update a single download item row. */
export async function upsertDownloadItem(item: DownloadItem): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO download_items (id, request_id, url, title, idx, format_id, status, progress, speed, eta, output_path, error, output_dir, added_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       request_id=excluded.request_id, url=excluded.url, title=excluded.title,
       idx=excluded.idx, format_id=excluded.format_id, status=excluded.status,
       progress=excluded.progress, speed=excluded.speed, eta=excluded.eta,
       output_path=excluded.output_path, error=excluded.error, output_dir=excluded.output_dir,
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
      item.updatedAt,
    ],
  );
}

export async function listDownloadItems(
  requestId: string,
): Promise<DownloadItem[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>(
    "SELECT * FROM download_items WHERE request_id = ? ORDER BY idx",
    [requestId],
  );
  return rows.map(mapItem);
}

/** Items that were not finished (interrupted by a crash/close) and can resume. */
export async function listPendingItems(): Promise<DownloadItem[]> {
  const db = await getDb();
  const rows = await db.select<ItemRow[]>(
    "SELECT * FROM download_items WHERE status IN ('queued','downloading','merging') ORDER BY added_at",
    [],
  );
  return rows.map(mapItem);
}
