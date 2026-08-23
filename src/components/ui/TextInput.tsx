import { AppSettings } from "@/types";

export default function TextInput({
  label,
  field,
  placeholder,
  hint,
  mono = true,
  settings,
  onChange,
}: {
  label: string;
  field: keyof AppSettings;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <div>
      <label className="mono text-[10px] uppercase tracking-widest block mb-1.5" style={{ color: "var(--muted-foreground)" }}>
        {label}
      </label>
      <input
        type="text"
        value={settings[field] as string}
        onChange={(e) => onChange({ [field]: e.target.value })}
        placeholder={placeholder}
        className={`w-full px-3 py-2 text-xs rounded border outline-none ${mono ? "mono" : ""}`}
        style={{ backgroundColor: "var(--background)", borderColor: "var(--border)", color: "var(--foreground)", caretColor: "var(--primary)" }}
        spellCheck={false}
      />
      {hint && <p className="mono text-[10px] mt-1" style={{ color: "var(--muted-foreground)" }}>{hint}</p>}
    </div>
  );
}