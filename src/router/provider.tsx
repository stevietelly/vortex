import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { useWindowManager } from "@/hooks/useWindowManager"
import { ROUTES, type RouteName, type RouteParams } from "./routes"

interface RouterProviderProps {
  children: ReactNode
  defaultTitle: string // app-level fallback if a route has no title
}

const RouterContext = createContext<RouterContextValue | null>(null)

export function RouterProvider({
  children,
  defaultTitle,
}: RouterProviderProps) {
  // 1. The history stack
  const [stack, setStack] = useState<HistoryEntry[]>([
    { route: "home", params: ROUTES.home.params },
  ])

  // 2. Window title (synced to current route, overridable mid-render)
  const [windowTitle, setWindowTitle] = useState<string>(
    ROUTES.home.title ?? defaultTitle,
  )

  // 3. Navigation API
  const navigate = useCallback(
    <R extends RouteName>(route: R, params: RouteParams[R]) => {
      setStack((prev) => [...prev, { route, params }])
    },
    [],
  )

  // 4, theme API
  const [darkMode, setDarkMode] = useState(true)

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev)
  }, [])

  const theme: {
    mode: "dark" | "light"
    toggle: () => void
  } = useMemo(
    () => ({ mode: darkMode ? "dark" : "light", toggle: toggleDarkMode }),
    [darkMode, toggleDarkMode],
  )

  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))
  }, [])

  // 4. Title reset on every navigation (per-page dynamic titles discarded)
  useEffect(() => {
    const current = stack[stack.length - 1]
    if (!current) return
    setWindowTitle(ROUTES[current.route]?.title ?? defaultTitle)
  }, [stack, defaultTitle])

  const changeWindowTitle = useCallback(
    (title?: string, return_to_default?: boolean) => {
      const current = stack[stack.length - 1]
      if (return_to_default) {
        setWindowTitle(ROUTES[current.route]?.title ?? defaultTitle)
      } else if (title) {
        setWindowTitle(title)
      }
    },
    [stack, defaultTitle],
  )

  // 5. Composed concerns

  const window = useWindowManager(true)

  return (
    <RouterContext.Provider
      value={{
        current: stack[stack.length - 1],
        stack,
        navigate,
        back,
        canGoBack: stack.length > 1,
        changeWindowTitle,
        windowTitle,
        ...window,
        isMaximized: window.isMaximized,
        isFullscreen: window.isFullscreen,
        theme,
      }}
    >
      {children}
    </RouterContext.Provider>
  )
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error("useRouter must be inside RouterProvider")
  return ctx
}

/**
 * Returns the current route's params typed for a specific route.
 * Pages call it with their own route name, e.g. useRouteParams<"loading">().
 */
export function useRouteParams<R extends RouteName = RouteName,>(): RouteParams[R] {
  const { current } = useRouter()
  return current.params as RouteParams[R]
}

// ─── 3. History entry (enables back/forward) ──────────
export type HistoryEntry<R extends RouteName = RouteName,> = {
  route: R
  params: RouteParams[R]
}

// ─── 4. Context shape ─────────────────────────────────
export type RouterContextValue = {
  current: HistoryEntry
  stack: HistoryEntry[]
  navigate: <R extends RouteName>(route: R, params: RouteParams[R]) => void
  back: () => void
  canGoBack: boolean
  changeWindowTitle: (title?: string, return_to_default?: boolean) => void
  windowTitle: string

  isMaximized: boolean
  isFullscreen: boolean
  isTitleBarHidden: boolean
  minimize: () => Promise<void>
  maximize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  close: () => Promise<void>
  setFullscreen: (val: boolean) => Promise<void>
  toggleFullscreen: () => Promise<void>

  theme: {
    mode: "dark" | "light"
    toggle: () => void
  }
}
