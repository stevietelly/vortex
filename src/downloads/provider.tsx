import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "@/types";
import type { DownloadItem, DownloadJob, VideoMetadata } from "@/types/domain";
import { loadSettings, saveSettings } from "@/lib/settings";
import {
  primeNotificationPermission,
  setNotificationsEnabled,
} from "@/lib/notify";
import { invoke, isTauri } from "@/lib/tauri";
import { buildFallbackChain } from "@/lib/format";
import { mockStartDownload } from "@/lib/mock";
import {
  addJob,
  applyProgress,
  getJobs,
  removeJob,
  setupProgressListener,
  subscribe,
} from "@/lib/jobs";
import { upsertDownloadItem } from "@/lib/db";
import {
  clearPending,
  refreshPending,
  registerJobMeta,
  setupItemProgressListener,
  setupIssuesListener,
  usePendingItems,
} from "@/lib/downloadItems";

const ACTIVE_STATUSES = new Set([
  "queued",
  "fetching-metadata",
  "downloading",
  "merging",
]);

const FINISHED_STATUSES = new Set(["done", "error", "cancelled"]);

interface DownloadsContextValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  resetSettings: () => void;

  jobs: DownloadJob[];
  pending: DownloadItem[];
  activeCount: number;

  startDownload: (
    metadata: VideoMetadata,
    formatId: string,
    opts?: {
      downloadAll?: boolean;
      profileId?: string;
      requestId?: string;
    },
  ) => Promise<void>;
  resumeItem: (item: DownloadItem) => Promise<void>;
  resumeAll: () => Promise<void>;

  removeJob: (id: string) => void;
  clearFinished: () => void;
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null);

export function DownloadsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const jobs = useSyncExternalStore(subscribe, getJobs);
  const pending = usePendingItems();

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  // Keep the notify helper in sync with the settings toggle (jobs.ts fires
  // toasts from outside React, so it reads this module-level flag).
  useEffect(() => {
    setNotificationsEnabled(settings.notifyOnComplete);
  }, [settings.notifyOnComplete]);

  useEffect(() => {
    if (isTauri()) {
      setupProgressListener();
      setupItemProgressListener();
      setupIssuesListener();
    }
    void refreshPending();
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    void saveSettings(DEFAULT_SETTINGS);
  }, []);

  const resolveDir = useCallback(
    (profileId?: string): string => {
      const profile = profileId
        ? settings.folderProfiles.find((p) => p.id === profileId)
        : undefined;
      return profile?.path?.trim() ? profile.path : settings.downloadDir;
    },
    [settings],
  );

  const startDownload = useCallback(
    async (
      metadata: VideoMetadata,
      formatId: string,
      opts?: {
        downloadAll?: boolean;
        profileId?: string;
        requestId?: string;
      },
    ) => {
      void primeNotificationPermission();
      const fallbackFormatIds = buildFallbackChain(metadata.formats, formatId);
      const reqId = opts?.requestId || metadata.id || metadata.url;
      const entries = metadata.entries ?? [];
      const dir = resolveDir(opts?.profileId);

      const startOne = async (o: {
        url: string;
        formatId: string;
        title: string;
        index?: number;
        jobId?: string;
      }): Promise<void> => {
        // Register the job BEFORE start_download: the backend thread can emit
        // progress events the moment it spawns, and applyProgress drops
        // events for ids it doesn't know about yet.
        const startedAt = Date.now();
        const id =
          o.jobId ??
          `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        addJob(metadata, o.formatId, id, reqId);
        registerJobMeta(id, {
          requestId: reqId,
          url: o.url,
          title: o.title,
          index: o.index,
          formatId: o.formatId,
          outputDir: dir,
          addedAt: startedAt,
          startedAt,
        });
        try {
          if (settings.mockMode) {
            mockStartDownload({
              url: o.url,
              formatId: o.formatId,
              title: o.title,
              index: o.index,
              downloadDir: dir,
              jobId: id,
            });
          } else {
            await invoke<string>("start_download", {
              url: o.url,
              formatId: o.formatId,
              fallbackFormatIds,
              playlistItems: o.index ?? null,
              resume: null,
              jobId: id,
              downloadDir: dir,
            });
          }
          await upsertDownloadItem({
            id,
            requestId: reqId,
            url: o.url,
            title: o.title,
            index: o.index,
            formatId: o.formatId,
            status: "queued",
            progress: 0,
            outputDir: dir,
            addedAt: startedAt,
            startedAt,
            updatedAt: startedAt,
          });
        } catch (e) {
          // The job is already registered under `id` — mark that one failed
          // instead of adding a second, separate error job.
          applyProgress({
            id,
            status: "error",
            progress: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };

      if (metadata.isPlaylist && opts?.downloadAll) {
        // Schedule the reported playlist total, not just the capped preview
        // entries: the backend extracts entry N straight from the playlist
        // URL, so entries beyond the preview still download fine.
        const total = metadata.playlistCount ?? entries.length;
        for (let idx = 1; idx <= total; idx++) {
          const entry = entries.find((e) => e.index === idx);
          await startOne({
            url: metadata.url,
            formatId,
            title: entry?.title ?? `${metadata.title} #${idx}`,
            index: idx,
          });
        }
      } else {
        await startOne({
          url: metadata.url,
          formatId,
          title: metadata.title,
        });
      }
    },
    [resolveDir, settings.mockMode],
  );

  const resumeItem = useCallback(
    async (item: DownloadItem): Promise<void> => {
      void primeNotificationPermission();
      const meta: VideoMetadata = {
        id: item.id,
        url: item.url,
        title: item.title,
        uploader: "",
        thumbnail: "",
        duration: 0,
        formats: [],
        isPlaylist: item.index !== undefined,
      };
      const dir = item.outputDir?.trim() ? item.outputDir : settings.downloadDir;
      // Register before start_download for the same reason as startOne — and
      // on resume the id is already known: it's the existing item's id.
      addJob(meta, item.formatId, item.id, item.requestId);
      registerJobMeta(item.id, {
        requestId: item.requestId,
        url: item.url,
        title: item.title,
        index: item.index,
        formatId: item.formatId,
        outputDir: dir,
        addedAt: item.addedAt,
        startedAt: Date.now(),
      });
      try {
        if (settings.mockMode) {
          mockStartDownload({
            url: item.url,
            formatId: item.formatId,
            title: item.title,
            index: item.index,
            downloadDir: dir,
            jobId: item.id,
          });
        } else {
          await invoke<string>("start_download", {
            url: item.url,
            formatId: item.formatId,
            fallbackFormatIds: [],
            playlistItems: item.index ?? null,
            resume: true,
            jobId: item.id,
            downloadDir: dir,
          });
        }
      } catch (e) {
        // Registered above — update it instead of leaving a queued zombie.
        applyProgress({
          id: item.id,
          status: "error",
          progress: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [settings.downloadDir, settings.mockMode],
  );

  const resumeAll = useCallback(async () => {
    for (const item of pending) {
      await resumeItem(item);
    }
    clearPending();
  }, [pending, resumeItem]);

  const clearFinished = useCallback(() => {
    jobs
      .filter((j) => FINISHED_STATUSES.has(j.status))
      .forEach((j) => removeJob(j.id));
  }, [jobs]);

  const activeCount = useMemo(
    () => jobs.filter((j) => ACTIVE_STATUSES.has(j.status)).length,
    [jobs],
  );

  const value = useMemo<DownloadsContextValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      jobs,
      pending,
      activeCount,
      startDownload,
      resumeItem,
      resumeAll,
      removeJob,
      clearFinished,
    }),
    [
      settings,
      updateSettings,
      resetSettings,
      jobs,
      pending,
      activeCount,
      startDownload,
      resumeItem,
      resumeAll,
      clearFinished,
    ],
  );

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
}

export function useDownloads(): DownloadsContextValue {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloads must be inside DownloadsProvider");
  return ctx;
}
