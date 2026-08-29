import { useEffect, useState } from 'react';
import { initials } from '../lib/display';

type AvatarSize = 'sm' | 'md' | 'lg';

const SIZE: Record<AvatarSize, string> = {
  sm: 'h-9 w-9 text-sm',
  md: 'h-8 w-8 text-xs',
  lg: 'h-14 w-14 text-lg',
};

export function PersonAvatar({
  fullName,
  email,
  avatarUrl,
  size = 'md',
  className = '',
}: {
  fullName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);
  const showPhoto = Boolean(avatarUrl) && !failed;

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-brand-500 font-semibold text-white ${SIZE[size]} ${className}`}
    >
      {showPhoto ? (
        <img
          key={avatarUrl}
          src={avatarUrl!}
          alt=""
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(fullName, email)
      )}
    </span>
  );
}
