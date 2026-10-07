import { AppSettings } from "@/types"

export default function Toggle({
  label,
  field,
  hint,
  settings,
  onChange,
}: {
  label: string
  field: keyof AppSettings
  hint?: string
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        onClick={() => onChange({ [field]: !settings[field] })}
        className="mt-0.5 flex-shrink-0 w-8 h-4.5 rounded-full relative transition-colors cursor-pointer"
        style={{
          backgroundColor: settings[field] ? "var(--primary)" : "var(--border)",
        }}
      >
        <div
          className="absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
          style={{
            transform: settings[field] ? "translateX(14px)" : "translateX(2px)",
          }}
        />
      </button>
      <div>
        <div
          className="text-xs font-medium"
          style={{ color: "var(--foreground)" }}
        >
          {label}
        </div>
        {hint && (
          <div
            className="mono text-[10px] mt-0.5"
            style={{ color: "var(--muted-foreground)" }}
          >
            {hint}
          </div>
        )}
      </div>
    </div>
  )
}
