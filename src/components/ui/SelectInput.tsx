import { AppSettings } from "@/types";


export default function SelectInput({
  label,
  field,
  options,
  hint,
  settings,
  onChange,
}: {
  label: string;
  field: keyof AppSettings;
  options: { value: string; label: string }[];
  hint?: string;
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}) {
  return (
    <div>
      <label
        className="mono text-[10px] uppercase tracking-widest block mb-1.5"
        style={{ color: "var(--muted-foreground)" }}
      >
        {label}
      </label>
      <select
        value={settings[field] as string}
        onChange={(e) => onChange({ [field]: e.target.value })}
        className="w-full px-3 py-2 text-xs rounded border outline-none mono cursor-pointer appearance-none"
        style={{
          backgroundColor: "var(--background)",
          borderColor: "var(--border)",
          color: "var(--foreground)",
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && (
        <p
          className="mono text-[10px] mt-1"
          style={{ color: "var(--muted-foreground)" }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
