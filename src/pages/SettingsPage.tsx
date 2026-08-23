
import { useState, useEffect } from "react";
import { IconRefresh, IconSettings } from "../icons";
import type { AppSettings } from "../types";
import { validateBinary } from "@/lib/settings";
import { pickPath, type BinaryStatus } from "@/lib/tauri";

// Ensures the mount-time auto-verify runs at most once per app session, even
// if the page remounts (e.g. React StrictMode double-invoke or rapid nav).
let autoVerified = false;

// Popular browsers yt-dlp can pull cookies from via --cookies-from-browser.
// Value "" means "none" (falls back to the cookies file, if any).
const BROWSER_OPTIONS = [
  { value: "", label: "None" },
  { value: "chrome", label: "Chrome" },
  { value: "firefox", label: "Firefox" },
  { value: "edge", label: "Edge" },
  { value: "brave", label: "Brave" },
  { value: "opera", label: "Opera" },
  { value: "vivaldi", label: "Vivaldi" },
  { value: "chromium", label: "Chromium" },
  { value: "safari", label: "Safari" },
];

function Spinner() {
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border-2 border-transparent align-middle"
      style={{ borderTopColor: "var(--primary)", animation: "spin-slow 0.7s linear infinite" }}
    />
  );
}
import TextInput from "@/components/ui/TextInput";
import SelectInput from "@/components/ui/SelectInput";
import Toggle from "@/components/ui/Toggle";
import NumberInput from "@/components/ui/NumberInput";


import PathInput from "@/components/ui/PathInput";








function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mono text-[10px] uppercase tracking-widest mb-4 pb-2 border-b"
        style={{ color: "var(--muted-foreground)", borderColor: "var(--border)" }}
      >
        {title}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function BinaryLine({ label, status }: { label: string; status?: BinaryStatus }) {
  if (!status) return <span style={{ color: "var(--muted-foreground)" }}>{label}: …</span>;
  if (!status.exists) {
    const reason = status.error ? ` — ${status.error}` : "";
    return (
      <span style={{ color: "#EF4444" }} title={status.error ?? undefined}>
        {label}: not found{reason}
      </span>
    );
  }
  return <span style={{ color: "#22C55E" }}>{label}: {status.version ?? "ok"} ✓</span>;
}

export default function SettingsPage({
  settings,
  onChange,
  onReset,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onReset: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [status, setStatus] = useState<{ ytdlp?: BinaryStatus; ffmpeg?: BinaryStatus }>({});

  // Auto-verify on open must not mutate App state (that caused a re-render
  // feedback loop). It only updates local status. `persist` (manual Verify
  // click) is what writes the discovered versions back to settings.
  const verify = async (persist = false) => {
    if (verifying) return;
    setVerifying(true);
    try {
      const [y, f] = await Promise.all([
        validateBinary(settings.ytdlpPath),
        validateBinary(settings.ffmpegPath),
      ]);
      setStatus({ ytdlp: y, ffmpeg: f });
      if (persist) {
        onChange({
          ytdlpVersion: y.exists ? y.version ?? "" : "",
          ffmpegVersion: f.exists ? f.version ?? "" : "",
        });
      }
    } catch {
      /* not in a Tauri context (web preview) */
    } finally {
      setVerifying(false);
    }
  };

  // Gate the mount auto-verify so repeated mounts/StrictMode remounts can't
  // spam `validate_path` in a loop.
  useEffect(() => {
    if (!autoVerified) {
      autoVerified = true;
      verify(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const shared = { settings, onChange };

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-7">
        <div>
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--muted-foreground)" }}><IconSettings size={16} /></span>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Settings</h1>
          </div>
          <p className="mono text-[10px] mt-0.5" style={{ color: "var(--muted-foreground)" }}>
            Configuration is saved on this device
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onReset}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border transition-colors cursor-pointer"
            style={{ borderColor: "var(--border)", color: "var(--muted-foreground)", backgroundColor: "var(--card)" }}
          >
            <IconRefresh size={12} />
            Reset defaults
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 text-xs px-4 py-1.5 rounded font-medium transition-all cursor-pointer"
            style={{
              backgroundColor: saved ? "#22C55E" : "var(--primary)",
              color: saved ? "#fff" : "var(--primary-foreground)",
            }}
          >
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>

      <div className="space-y-8">
        <Section title="Binaries">
          <PathInput label="yt-dlp path" field="ytdlpPath" placeholder="C:\path\to\yt-dlp.exe" hint="Full path to the yt-dlp executable. Must be v2023.01.06 or newer." browse={{ extensions: ["exe"] }} {...shared} />
          <PathInput label="FFmpeg path" field="ffmpegPath" placeholder="C:\path\to\ffmpeg.exe" hint="Required for format conversion, audio extraction, and subtitle merging." browse={{ extensions: ["exe"] }} {...shared} />
          <div className="flex items-center gap-3">
            <div
              className="flex-1 mono text-[10px] px-3 py-2 rounded border"
              style={{ backgroundColor: "var(--muted)", borderColor: "var(--border)", color: "var(--muted-foreground)" }}
            >
              {verifying ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner /> Checking binaries…
                </span>
              ) : (
                <>
                  <BinaryLine label="yt-dlp" status={status.ytdlp} />
                  {"  ·  "}
                  <BinaryLine label="ffmpeg" status={status.ffmpeg} />
                </>
              )}
            </div>
            <button
              onClick={() => verify(true)}
              disabled={verifying}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded border cursor-pointer flex-shrink-0 disabled:opacity-50"
              style={{ borderColor: "var(--border)", color: "var(--muted-foreground)", backgroundColor: "var(--card)" }}
            >
              {verifying ? <Spinner /> : <IconRefresh size={12} />}
              {verifying ? "Checking…" : "Verify"}
            </button>
          </div>
        </Section>

        <Section title="Output">
          
          <PathInput label="Download directory" field="downloadDir" placeholder="C:\Users\You\Downloads" hint="Where completed downloads are saved." browse={{ directory: true }} {...shared} />
          <TextInput label="Filename template" field="filenameTemplate" placeholder="%(uploader)s - %(title)s.%(ext)s" hint="yt-dlp output template. Use %(title)s, %(uploader)s, %(id)s, %(ext)s, %(upload_date)s, etc." {...shared} />
          <div className="grid grid-cols-2 gap-4">
            <SelectInput
              label="Default format"
              field="defaultFormat"
              options={[
                { value: "mp4", label: "MP4" }, { value: "webm", label: "WebM" }, { value: "mkv", label: "MKV" },
                { value: "mp3", label: "MP3 (audio)" }, { value: "m4a", label: "M4A (audio)" },
                { value: "wav", label: "WAV (audio)" }, { value: "opus", label: "Opus (audio)" },
              ]}
              {...shared}
            />
            <SelectInput
              label="Default quality"
              field="defaultQuality"
              options={[
                { value: "2160p", label: "4K — 2160p" }, { value: "1440p", label: "2K — 1440p" },
                { value: "1080p", label: "Full HD — 1080p" }, { value: "720p", label: "HD — 720p" },
                { value: "480p", label: "SD — 480p" }, { value: "360p", label: "360p" },
                { value: "best", label: "Best available" },
              ]}
              {...shared}
            />
          </div>
          <SelectInput
            label="Audio quality (kbps)"
            field="audioQuality"
            options={[
              { value: "320", label: "320 kbps" }, { value: "256", label: "256 kbps" },
              { value: "192", label: "192 kbps" }, { value: "128", label: "128 kbps" },
              { value: "96", label: "96 kbps" }, { value: "0", label: "Best (VBR)" },
            ]}
            hint="Target bitrate when downloading audio or extracting audio from video."
            {...shared}
          />
        </Section>

        <Section title="Metadata & Post-processing">
          <div className="space-y-3.5">
            
            <Toggle label="Embed metadata" field="embedMetadata" hint="Write title, uploader, description, and date into the file." {...shared} />
            <Toggle label="Embed thumbnail" field="embedThumbnail" hint="Attach cover art to audio files (MP3, M4A) or video containers that support it." {...shared} />
            <Toggle label="Keep original audio track" field="keepOriginalAudio" hint="When remuxing video, preserve the source audio codec instead of re-encoding." {...shared} />
            <Toggle label="Prefer free formats" field="preferFreeFormats" hint="Prefer WebM and Opus over MP4 and M4A when quality is equivalent." {...shared} />
            <Toggle label="Split by chapters" field="splitChapters" hint="Split videos into separate files per chapter when chapter data is available." {...shared} />
          </div>
        </Section>

        <Section title="Subtitles">
          <Toggle label="Download subtitles" field="writeSubs" hint="Download and embed subtitles when available." {...shared} />
          {settings.writeSubs && (
            <TextInput label="Subtitle languages" field="subLangs" placeholder="en,fr,de" hint="Comma-separated BCP-47 language codes. Use 'all' to download every available language." {...shared} />
          )}
        </Section>

        <Section title="Network">
          
          <NumberInput label="Max concurrent downloads" field="maxConcurrent" min={1} max={8} hint="simultaneous downloads (1–8)" {...shared} />
          <TextInput label="Rate limit" field="rateLimit" placeholder="e.g. 2M or 500K" hint="Maximum download speed. Leave empty for unlimited. Accepts K (kilobytes) or M (megabytes) suffix." {...shared} />
          <TextInput label="Proxy URL" field="proxyUrl" placeholder="http://proxy.example.com:8080" hint="HTTP, HTTPS, or SOCKS5 proxy. Leave empty to use system default." {...shared} />

        </Section>

        <Section title="Authentication">
          <SelectInput
            label="Cookies source"
            field="cookiesBrowser"
            options={BROWSER_OPTIONS}
            hint="YouTube may ask you to confirm you're not a bot. Sign in to a browser and select it here to pass cookies automatically (recommended). A selected browser takes priority over the cookies file below."
            {...shared}
          />
          <PathInput
            label="Cookies file"
            field="cookiesFile"
            placeholder="C:\path\to\cookies.txt"
            hint="Netscape-format cookies file exported from your browser. Used only when no browser is selected above."
            browse={{ extensions: ["txt"] }}
            {...shared}
          />
        </Section>

        <Section title="Application">
          <Toggle label="Check for yt-dlp updates on launch" field="checkForUpdates" hint="Automatically notify when a new version of yt-dlp is available." {...shared} />
        </Section>
      </div>

      <div className="h-10" />
    </div>
  );
}
