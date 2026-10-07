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
        try {
          const id = settings.mockMode
            ? mockStartDownload({
                url: o.url,
                formatId: o.formatId,
                title: o.title,
                index: o.index,
                downloadDir: dir,
              })
            : await invoke<string>("start_download", {
                url: o.url,
                formatId: o.formatId,
                fallbackFormatIds,
                playlistItems: o.index ?? null,
                resume: null,
                jobId: o.jobId ?? null,
                downloadDir: dir,
              });
          const startedAt = Date.now();
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
          const id = `err-${Date.now()}`;
          addJob(metadata, o.formatId, id, reqId);
          applyProgress({
            id,
            status: "error",
            progress: 0,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };

      if (metadata.isPlaylist && opts?.downloadAll && entries.length) {
        for (const entry of entries) {
          await startOne({
            url: metadata.url,
            formatId,
            title: entry.title,
            index: entry.index,
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
      try {
        const id = settings.mockMode
          ? mockStartDownload({
              url: item.url,
              formatId: item.formatId,
              title: item.title,
              index: item.index,
              downloadDir: dir,
            })
          : await invoke<string>("start_download", {
              url: item.url,
              formatId: item.formatId,
              fallbackFormatIds: [],
              playlistItems: item.index ?? null,
              resume: true,
              jobId: item.id,
              downloadDir: dir,
            });
        registerJobMeta(id, {
          requestId: item.requestId,
          url: item.url,
          title: item.title,
          index: item.index,
          formatId: item.formatId,
          outputDir: dir,
          addedAt: item.addedAt,
          startedAt: Date.now(),
        });
        addJob(meta, item.formatId, id, item.requestId);
      } catch {
        /* ignore individual resume failures */
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
