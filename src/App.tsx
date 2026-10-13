import { RouterProvider } from "./router/provider"
import { DownloadsProvider } from "./downloads/provider"
import IncomingHandler from "./components/IncomingHandler"
import Window from "./Window"

function App() {
  return (
    <RouterProvider defaultTitle="Vortex Downloader">
      <DownloadsProvider>
        <IncomingHandler />
        <Window />
      </DownloadsProvider>
    </RouterProvider>
  )
}

export default App
