import { ImageOff } from "lucide-react";
import type { ListingPhoto } from "@/lib/api/types";

function isRenderableImageUrl(url: string) {
  // fileUrl can be a bare storage path when backend storage is not configured.
  return url.startsWith("https://") || url.startsWith("http://");
}

export default function ListingPhotoGallery({
  photos,
  title,
}: {
  photos: ListingPhoto[];
  title: string;
}) {
  const renderable = photos.filter((photo) =>
    isRenderableImageUrl(photo.fileUrl)
  );

  if (renderable.length === 0) {
    return (
      <div
        aria-hidden="true"
        className="flex h-64 w-full items-center justify-center rounded-xl bg-slate-100 text-slate-400 sm:h-80"
      >
        <ImageOff className="size-10" />
      </div>
    );
  }

  const [cover, ...rest] = renderable;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <div className="overflow-hidden rounded-xl bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element -- backend photo hosts are env-dependent, so next/image remotePatterns cannot be pinned */}
        <img
          src={cover.fileUrl}
          alt={`Photo 1 of ${title}`}
          className="h-64 w-full object-cover sm:h-80"
        />
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {rest.slice(0, 4).map((photo, index) => (
            <div
              key={photo.id}
              className="overflow-hidden rounded-xl bg-slate-100"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- backend photo hosts are env-dependent, so next/image remotePatterns cannot be pinned */}
              <img
                src={photo.fileUrl}
                alt={`Photo ${index + 2} of ${title}`}
                className="h-31 w-full object-cover sm:h-39"
                loading="lazy"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
