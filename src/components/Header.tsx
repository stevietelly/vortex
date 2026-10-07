import { IconArrowLeft, IconDownload, IconLink, IconMoon, IconSettings, IconSun, IconTray } from "@/icons"

import { useRouter } from "@/router/provider"

import React from "react"

import NavBtn from "./ui/NavButton"
import { useDownloads } from "@/downloads/provider";

function Header() {
  const { navigate, current, windowTitle, theme } = useRouter();
  const  { activeCount } = useDownloads()

  return (
    <header
      className="flex items-center px-5 py-2.5 border-b gap-3 shrink"
      style={{ borderColor: "var(--border)", backgroundColor: "var(--card)" }}
    >
      <button
        type="button"
        onClick={() => navigate("home", undefined)}
        className="flex items-center gap-1.5 cursor-pointer shrink"
      >
        <div
          className="w-5 h-5 rounded flex items-center justify-center"
          style={{
            backgroundColor: "var(--primary)",

            color: "var(--primary-foreground)",
          }}
        >
          <IconDownload size={11} />
        </div>
        <span
          className="text-sm font-semibold"
          style={{ color: "var(--foreground)" }}
        >
          Downlink
        </span>
      </button>

      {current.route === "info" && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span style={{ color: "var(--muted-foreground)" }}>/</span>
          <button
            type="button"
            onClick={() => navigate("home", undefined)}
            className="flex items-center gap-1 text-xs cursor-pointer flex-shrink-0"
            style={{ color: "var(--muted-foreground)" }}
          >
            <IconArrowLeft size={12} /> Home
          </button>
          <span style={{ color: "var(--muted-foreground)" }}>/</span>
          <span
            className="mono text-xs truncate max-w-xs"
            style={{ color: "var(--muted-foreground)" }}
          >
            {windowTitle}
          </span>
        </div>
      )}

      <div className="flex-1" />

      <nav className="flex items-center gap-1">
        <NavBtn target="home" label="Home" icon={<IconLink size={13} />} />
        <NavBtn
          target="downloads"
          label="Downloads"
          icon={<IconTray size={13} />}
          badge={activeCount}
        />
        <NavBtn
          target="settings"
          label="Settings"
          icon={<IconSettings size={13} />}
        />
      </nav>

      <div
        className="w-px h-4 shrink"
        style={{ backgroundColor: "var(--border)" }}
      />

      <button
        type="button"
        onClick={theme.toggle}
        className="w-7 h-7 rounded flex items-center justify-center transition-colors cursor-pointer"
        style={{
          backgroundColor: "var(--muted)",

          color: "var(--muted-foreground)",
        }}
        title={theme.mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme.mode === "dark" ? <IconSun size={13} /> : <IconMoon size={13} />}
      </button>
    </header>
  )
}

export default Header
