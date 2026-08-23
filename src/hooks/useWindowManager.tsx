// src/hooks/useWindowManager.ts

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";

export type WindowState = {
  isMaximized: boolean;
  isFullscreen: boolean;
  isTitleBarHidden: boolean;
};

export type WindowActions = {
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  unmaximize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  setFullscreen: (val: boolean) => Promise<void>;
  toggleFullscreen: () => Promise<void>;
};

export function useWindowManager(titleBarHidden = false): WindowState & WindowActions {
  const win = getCurrentWindow();

  const [state, setState] = useState<WindowState>({
    isMaximized: false,
    isFullscreen: false,
    isTitleBarHidden: titleBarHidden,
  });

  useEffect(() => {
    // get initial state
    async function init(): Promise<void> {
      const [maximized, fullscreen] = await Promise.all([
        win.isMaximized(),
        win.isFullscreen(),
      ]);
      setState((s) => ({
        ...s,
        isMaximized: maximized,
        isFullscreen: fullscreen,
      }));
    }

    // listen for window state changes from OS
    // (user can maximize via OS, not just your buttons)
    const unlisteners = Promise.all([
      win.onResized(async () => {
        const [maximized, fullscreen] = await Promise.all([
          win.isMaximized(),
          win.isFullscreen(),
        ]);
        setState((s) => ({
          ...s,
          isMaximized: maximized,
          isFullscreen: fullscreen,
        }));
      }),
    ]);

    init();
    return () => {
      unlisteners.then((fns) => fns.map((fn) => fn()));
    };
  }, [win.isFullscreen, win.isMaximized, win.onResized]);

  const actions: WindowActions = {
    minimize: () => win.minimize(),
    maximize: () => win.maximize(),
    unmaximize: () => win.unmaximize(),
    toggleMaximize: () =>
      state.isMaximized ? win.unmaximize() : win.maximize(),
    close: () => win.close(),
    setFullscreen: (val) => {
      setState((s) => ({ ...s, isFullscreen: val }));
      return win.setFullscreen(val);
    },
    toggleFullscreen: () => {
      const next = !state.isFullscreen;
      setState((s) => ({ ...s, isFullscreen: next }));
      return win.setFullscreen(next);
    },
  };

  return { ...state, ...actions };
}
