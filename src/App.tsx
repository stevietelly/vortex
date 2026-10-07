import { RouterProvider } from "./router/provider"
import { DownloadsProvider } from "./downloads/provider"
import Window from "./Window"

function App() {
  return (
    <RouterProvider defaultTitle="Vortex Downloader">
      <DownloadsProvider>
        <Window />
      </DownloadsProvider>
    </RouterProvider>
  )
}

export default App
