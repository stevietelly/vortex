import { invoke } from "@/lib/tauri"
import { mockFetchMetadata } from "@/lib/mock"
import { updateRequest, failRequest } from "@/lib/requests"
import { savePlaylistItems } from "@/lib/db"
import type { VideoMetadata } from "@/types/domain"

/**
 * Fetch full metadata for a request (by uid) and record the outcome on its
 * row. The caller is expected to have created the request already via
 * saveRequest() — this only updates it.
 *
 * Throws on failure after marking the request as errored.
 */
export async function fetchAndRecord(
  uid: string,
  url: string,
  mockMode: boolean,
): Promise<VideoMetadata> {
  try {
    const metadata = mockMode
      ? await mockFetchMetadata(url)
      : await invoke<VideoMetadata>("fetch_metadata", { url })

    await updateRequest({
      id: uid,
      url: metadata.url || url,
      title: metadata.title,
      uploader: metadata.uploader,
      requestedAt: Date.now(),
      status: "requested",
      metadata,
    })
    if (metadata.isPlaylist && metadata.entries?.length) {
      await savePlaylistItems(
        uid,
        metadata.url || url,
        metadata.entries.map((e) => ({ index: e.index, title: e.title })),
      )
    }
    return metadata
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!msg.includes("not in tauri context")) {
      await failRequest(uid, msg)
    }
    throw e instanceof Error ? e : new Error(msg)
  }
}
