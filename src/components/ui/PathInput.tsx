import { IconFolder } from "@/icons";
import { pickPath } from "@/lib/tauri";
import type { AppSettings } from "@/types";

export default function PathInput({
  label,
  field,
  placeholder,
  hint,
  settings,
  onChange,
  browse,
}: {
  label: string;
  field: keyof AppSettings;
  placeholder: string;
  hint?: string;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  browse?: { directory?: boolean; extensions?: string[] };
}) {
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-widest block mb-1.5" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </label>
      <div className="flex gap-2">
        <div
          className="flex-1 flex items-center rounded border overflow-hidden"
          style={{ backgroundColor: "var(--background)", borderColor: "var(--border)" }}
        >
          <input
            type="text"
            value={settings[field] as string}
            onChange={(e) => onChange({ [field]: e.target.value })}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 text-xs outline-none bg-transparent mono"
            style={{ color: "var(--foreground)", caretColor: "var(--primary)" }}
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={async () => {
            const picked = await pickPath(browse);
            if (picked) onChange({ [field]: picked });
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded border text-xs transition-colors cursor-pointer flex-shrink-0"
          style={{ borderColor: "var(--border)", color: "var(--muted-foreground)", backgroundColor: "var(--card)" }}
        >
          <IconFolder size={13} />
          Browse
        </button>
      </div>
      {hint && <p className="mono text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>{hint}</p>}
    </div>
  );
}
