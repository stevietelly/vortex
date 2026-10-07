import React, { useEffect } from "react"
import Header from "./components/Header"
import { PAGES } from "./router/routes"
import { useRouter } from "./router/provider"

function Window() {
  const { current, theme } = useRouter()

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme.mode === "dark")
    console.log(theme.mode)
  }, [theme.mode])
  return (
    <div className="Window">
      <Header />
      {PAGES[current.route]}
    </div>
  )
}

export default Window
