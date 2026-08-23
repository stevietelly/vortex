import { useState } from "react";
import { IconDownload } from "../icons";

export default function Thumbnail({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  if (broken || !src) {
    return (
      <div
        className={`flex items-center justify-center ${className ?? ""}`}
        style={{ backgroundColor: "var(--muted)" }}
      >
        <IconDownload size={16} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  );
}
