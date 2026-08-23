import { useState, useEffect, useSyncExternalStore } from "react";
import { IconDownload, IconLink, IconTray, IconSettings, IconSun, IconMoon, IconArrowLeft } from "./icons";
import { DEFAULT_SETTINGS } from "./types";
import { loadSettings, saveSettings } from "@/lib/settings";
import { invoke } from "@/lib/tauri";
import { buildFallbackChain } from "@/lib/format";
import type { VideoMetadata, RequestRecord, DownloadItem } from "@/types/domain";
import type { Page, AppSettings } from "./types";
import { addJob, applyProgress, getJobs, subscribe, setupProgressListener, removeJob } from "@/lib/jobs";
import { upsertDownloadItem } from "@/lib/db";
import {
  registerJobMeta,
  refreshPending,
  usePendingItems,
  setupItemProgressListener,
  clearPending,
} from "@/lib/downloadItems";
import HomePage from "./pages/HomePage";
import InfoPage from "./pages/InfoPage";
import DownloadsPage from "./pages/DownloadsPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const [dark, setDark] = useState(true);
  const [page, setPage] = useState<Page>("home");
  const [currentMeta, setCurrentMeta] = useState<VideoMetadata | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const downloads = useSyncExternalStore(subscribe, getJobs);
  const pending = usePendingItems();

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  useEffect(() => {
    setupProgressListener();
    setupItemProgressListener();
    void refreshPending();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const handleFetch = (metadata: VideoMetadata) => {
    setCurrentMeta(metadata);
    setPage("info");
  };

  const openRequest = (r: RequestRecord) => {
    setCurrentMeta(r.metadata);
    setPage("info");
  };

  const resolveDir = (profileId?: string): string => {
    const profile = profileId
      ? settings.folderProfiles.find((p) => p.id === profileId)
      : undefined;
    return profile?.path?.trim() ? profile.path : settings.download_dir;
  };

  const handleDownload = async (
    formatId: string,
    downloadAll?: boolean,
    profileId?: string,
  ) => {
    if (!currentMeta) return;
    const fallbackFormatIds = buildFallbackChain(currentMeta.formats, formatId);
    const reqId = currentMeta.id || currentMeta.url;
    const entries = currentMeta.entries ?? [];
    const dir = resolveDir(profileId);

    const startOne = async (opts: {
      url: string;
      formatId: string;
      title: string;
      index?: number;
      jobId?: string;
    }): Promise<void> => {
      const { url, formatId, title, index, jobId } = opts;
      try {
        const id = await invoke<string>("start_download", {
          url,
          formatId,
          fallbackFormatIds,
          playlistItems: index,
          resume: null,
          jobId: jobId ?? null,
          downloadDir: dir,
        });
        addJob(currentMeta!, formatId, id);
        registerJobMeta(id, {
          requestId: reqId,
          url,
          title,
          index,
          formatId,
          addedAt: Date.now(),
        });
        await upsertDownloadItem({
          id,
          requestId: reqId,
          url,
          title,
          index,
          formatId,
          status: "queued",
          progress: 0,
          outputDir: dir,
          addedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (e) {
        const id = `err-${Date.now()}`;
        addJob(currentMeta!, formatId, id);
        const message = e instanceof Error ? e.message : String(e);
        applyProgress({
          id,
          status: "error",
          progress: 0,
          speed: undefined,
          eta: undefined,
          outputPath: undefined,
          formatId: undefined,
          error: message,
        });
      }
    };

    if (currentMeta.isPlaylist && downloadAll && entries.length) {
      for (const entry of entries) {
        await startOne({ url: currentMeta.url, formatId, title: entry.title, index: entry.index });
      }
    } else {
      await startOne({ url: currentMeta.url, formatId, title: currentMeta.title });
    }
  };

  const startResume = async (it: DownloadItem): Promise<void> => {
    const meta: VideoMetadata = {
      id: it.id,
      url: it.url,
      title: it.title,
      uploader: "",
      thumbnail: "",
      duration: 0,
      formats: [],
      isPlaylist: it.index !== undefined,
    };
    const dir = it.outputDir?.trim() ? it.outputDir : settings.download_dir;
    try {
      const id = await invoke<string>("start_download", {
        url: it.url,
        formatId: it.formatId,
        fallbackFormatIds: [],
        playlistItems: it.index ?? null,
        resume: true,
        jobId: it.id,
        downloadDir: dir,
      });
      registerJobMeta(id, {
        requestId: it.requestId,
        url: it.url,
        title: it.title,
        index: it.index,
        formatId: it.formatId,
        addedAt: it.addedAt,
      });
      addJob(meta, it.formatId, id);
    } catch {
      /* ignore individual resume failures */
    }
  };

  const resumePending = async () => {
    for (const it of pending) {
      await startResume(it);
    }
    clearPending();
  };

  const activeCount = downloads.filter((d) =>
    d.status === "queued" || d.status === "fetching-metadata" || d.status === "downloading" || d.status === "merging",
  ).length;

  const NavBtn = ({ target, label, icon, badge }: { target: Page; label: string; icon: React.ReactNode; badge?: number }) => (
    <button
      onClick={() => setPage(target)}
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer"
      style={{
        backgroundColor: page === target ? "var(--muted)" : "transparent",
        color: page === target ? "var(--foreground)" : "var(--muted-foreground)",
      }}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full mono text-[9px] flex items-center justify-center font-bold"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
        >
          {badge}
        </span>
      )}
    </button>
  );

  return (
    <div className="min-h-full flex flex-col" style={{ backgroundColor: "var(--background)", color: "var(--foreground)" }}>
      <header
        className="flex items-center px-5 py-2.5 border-b gap-3 flex-shrink-0"
        style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
      >
        <button onClick={() => setPage("home")} className="flex items-center gap-1.5 cursor-pointer flex-shrink-0">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            <IconDownload size={11} />
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Downlink</span>
        </button>

        {page === "info" && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span style={{ color: "var(--muted-foreground)" }}>/</span>
            <button
              onClick={() => setPage("home")}
              className="flex items-center gap-1 text-xs cursor-pointer flex-shrink-0"
              style={{ color: "var(--muted-foreground)" }}
            >
              <IconArrowLeft size={12} /> Home
            </button>
            <span style={{ color: "var(--muted-foreground)" }}>/</span>
            <span className="mono text-xs truncate max-w-xs" style={{ color: "var(--muted-foreground)" }}>
              {currentMeta?.title ?? ""}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <nav className="flex items-center gap-1">
          <NavBtn target="home" label="Home" icon={<IconLink size={13} />} />
          <NavBtn target="downloads" label="Downloads" icon={<IconTray size={13} />} badge={activeCount} />
          <NavBtn target="settings" label="Settings" icon={<IconSettings size={13} />} />
        </nav>

        <div className="w-px h-4 flex-shrink-0" style={{ backgroundColor: "var(--border)" }} />

        <button
          onClick={() => setDark(!dark)}
          className="w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer"
          style={{ backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
          title={dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {dark ? <IconSun size={13} /> : <IconMoon size={13} />}
        </button>
      </header>

      <main className="flex-1 overflow-auto">
        {pending.length > 0 && (
          <div
            className="flex items-center gap-3 px-5 py-2 border-b text-xs"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--muted)", color: "var(--foreground)" }}
          >
            <span className="flex-1">
              {pending.length} download{pending.length === 1 ? "" : "s"} interrupted — resume from where they left off?
            </span>
            <button
              onClick={() => void resumePending()}
              className="px-3 py-1 rounded font-medium cursor-pointer"
              style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              Resume all
            </button>
          </div>
        )}
        {page === "home" && <HomePage onFetch={handleFetch} />}
        {page === "info" && currentMeta && (
          <div className="max-w-5xl mx-auto px-6 py-6">
            <InfoPage metadata={currentMeta} onDownload={handleDownload} />
          </div>
        )}
        {page === "downloads" && (
          <DownloadsPage
            jobs={downloads}
            onClear={removeJob}
            onOpenRequest={openRequest}
            onClearAll={() =>
              downloads
                .filter((j) => j.status === "done" || j.status === "error" || j.status === "cancelled")
                .forEach((j) => removeJob(j.id))
            }
          />
        )}
        {page === "settings" && (
          <SettingsPage
            settings={settings}
            onChange={(patch) =>
              setSettings((prev) => {
                const next = { ...prev, ...patch };
                saveSettings(next);
                return next;
              })
            }
            onReset={() => setSettings(DEFAULT_SETTINGS)}
          />
        )}
      </main>
    </div>
  );
}
