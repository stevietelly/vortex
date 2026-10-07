import { useRouter } from "@/router/provider"

import { PAGES, RouteName } from "@/router/routes"

const NavBtn = ({
  target,

  label,

  icon,

  badge,
}: {
  target: RouteName

  label: string

  icon: React.ReactNode

  badge?: number
}) => {
  const { navigate, current } = useRouter()

  return (
    <button
      type="button"
      onClick={() => navigate(target, undefined)}
      className="relative flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer"
      style={{
        backgroundColor:
          current.route === target ? "var(--muted)" : "transparent",

        color:
          current.route === target
            ? "var(--foreground)"
            : "var(--muted-foreground)",
      }}
    >
      {icon}
      {label}
      {badge != null && badge > 0 && (
        <span
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full mono text-[9px] flex items-center justify-center font-bold"
          style={{
            backgroundColor: "var(--primary)",

            color: "var(--primary-foreground)",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  )
}

export default NavBtn
