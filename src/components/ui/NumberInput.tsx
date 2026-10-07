import { AppSettings } from "@/types"

export default function NumberInput({
  label,
  field,
  min,
  max,
  hint,
  settings,
  onChange,
}: {
  label: string
  field: keyof AppSettings
  min: number
  max: number
  hint?: string
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  return (
    <div>
      <label
        className="mono text-[10px] uppercase tracking-widest block mb-1.5"
        style={{ color: "var(--muted-foreground)" }}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          value={settings[field] as number}
          onChange={(e) => onChange({ [field]: Number(e.target.value) })}
          className="w-20 px-3 py-2 text-xs rounded border outline-none mono"
          style={{
            backgroundColor: "var(--background)",
            borderColor: "var(--border)",
            color: "var(--foreground)",
          }}
        />
        {hint && (
          <span
            className="mono text-[10px]"
            style={{ color: "var(--muted-foreground)" }}
          >
            {hint}
          </span>
        )}
      </div>
    </div>
  )
}
