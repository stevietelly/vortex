import { useState, type CSSProperties } from "react"
import { IconDownload } from "../icons"

// Thumbnails are always rendered at the size of their container and cropped
// (object-cover) — a large source image can never change the layout.
const FIT: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "cover",
}

export default function Thumbnail({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  if (broken || !src) {
    return (
      <div
        className={`flex items-center justify-center ${className ?? ""}`}
        style={{ backgroundColor: "var(--muted)", ...FIT }}
      >
        <IconDownload size={16} />
      </div>
    )
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={FIT}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  )
}
