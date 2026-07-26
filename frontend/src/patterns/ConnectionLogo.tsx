import { useState } from 'react';
import { cn } from '../design';
import type { Connection } from '../domain/types';
import { monogramFor, readableOn } from './logoMark';

/**
 * A connected system's visual identity.
 *
 * Renders the vendor's real logo when one has been supplied, and otherwise a
 * monogram tile in that vendor's brand colour. The fallback is the default on
 * purpose: shipping forty vendor logos means forty trademark permissions and
 * forty assets to keep current, while a coloured monogram is recognisable at a
 * glance, never goes stale, and needs no network — which matters for a tool
 * used on job sites with poor signal.
 *
 * Dropping real marks into /public/logos and setting `logoUrl` upgrades this
 * with no code change, and a failed image load falls back rather than showing a
 * broken tile.
 */
export function ConnectionLogo({
  connection,
  size = 'md',
  className,
}: {
  connection: Connection;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);

  const dimensions = {
    sm: 'h-7 w-7 text-[10px] rounded-md',
    md: 'h-9 w-9 text-xs rounded-lg',
    lg: 'h-12 w-12 text-sm rounded-xl',
  }[size];

  const showImage = connection.logoUrl && !imageFailed;

  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden font-bold tracking-tight',
        dimensions,
        showImage ? 'bg-raised' : undefined,
        className,
      )}
      style={
        showImage
          ? undefined
          : {
              backgroundColor: connection.brandColor,
              color: readableOn(connection.brandColor),
            }
      }
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={connection.logoUrl}
          alt=""
          className="h-full w-full object-contain p-1"
          onError={() => setImageFailed(true)}
          loading="lazy"
        />
      ) : (
        monogramFor(connection)
      )}
    </span>
  );
}
