import React, { useEffect, useRef, useState } from 'react';
import { ImageOff } from 'lucide-react';
import {
  fetchMediaImageDataUrl,
  getCachedMediaImageDataUrl,
} from '../../services/mediaStorage';
import type { MediaCacheKeyOptions } from '../../utils/mediaCache';

interface FirestoreImageProps {
  imageId?: string | null;
  fallbackUrl?: string | null;
  directSrc?: string | null;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  eager?: boolean;
  cacheScope?: MediaCacheKeyOptions;
  fallbackNode?: React.ReactNode;
  onClick?: () => void;
}

interface AsyncFetchState {
  forImageId: string;
  src: string | null;
  failed: boolean;
}

export const FirestoreImage: React.FC<FirestoreImageProps> = ({
  imageId,
  fallbackUrl,
  directSrc,
  alt,
  className = 'h-full w-full object-cover',
  placeholderClassName = 'bg-[#0B1A2E]',
  eager = false,
  cacheScope,
  fallbackNode,
  onClick,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [inViewId, setInViewId] = useState<string | null>(null);
  const [asyncState, setAsyncState] = useState<AsyncFetchState | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);

  const scopeKind = cacheScope?.scope ?? 'public';
  const scopeUid = cacheScope?.viewerUid ?? null;

  const cachedSrc = imageId
    ? getCachedMediaImageDataUrl(imageId, {
        scope: scopeKind,
        viewerUid: scopeUid,
      })
    : null;
  const matchedAsync =
    imageId && asyncState?.forImageId === imageId ? asyncState : null;

  const candidateSrc =
    directSrc ||
    cachedSrc ||
    matchedAsync?.src ||
    fallbackUrl ||
    null;

  const isImgBroken = Boolean(candidateSrc && brokenSrc === candidateSrc);
  const activeSrc = isImgBroken ? null : candidateSrc;
  const isWaitingInView = Boolean(
    !activeSrc && imageId && !matchedAsync?.failed
  );
  const isInstantHit = Boolean(directSrc || cachedSrc);
  const isDecoded = Boolean(
    activeSrc && (isInstantHit || loadedSrc === activeSrc)
  );

  const shouldFetch = Boolean(
    imageId &&
      !directSrc &&
      !cachedSrc &&
      (eager || inViewId === imageId)
  );

  useEffect(() => {
    if (!imageId || directSrc || cachedSrc || eager || inViewId === imageId) {
      return;
    }
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => setInViewId(imageId), 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInViewId(imageId);
          observer.disconnect();
        }
      },
      { rootMargin: '320px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageId, directSrc, cachedSrc, eager, inViewId]);

  useEffect(() => {
    if (!shouldFetch || !imageId) return;

    let active = true;
    fetchMediaImageDataUrl(imageId, {
      scope: scopeKind,
      viewerUid: scopeUid,
    })
      .then((dataUrl) => {
        if (!active) return;
        setAsyncState({
          forImageId: imageId,
          src: dataUrl,
          failed: !dataUrl && !fallbackUrl,
        });
      })
      .catch(() => {
        if (!active) return;
        setAsyncState({
          forImageId: imageId,
          src: null,
          failed: !fallbackUrl,
        });
      });

    return () => {
      active = false;
    };
  }, [shouldFetch, imageId, fallbackUrl, scopeKind, scopeUid]);

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden ${placeholderClassName}`}
    >
      {activeSrc ? (
        <>
          {!isDecoded && (
            <div
              aria-hidden="true"
              className="absolute inset-0 animate-pulse bg-[#132946]"
            />
          )}
          <img
            src={activeSrc}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            referrerPolicy="no-referrer"
            onClick={onClick}
            onLoad={() => setLoadedSrc(activeSrc)}
            onError={() => {
              setLoadedSrc(null);
              setBrokenSrc(activeSrc);
            }}
            className={`${className} transition-opacity duration-200 ${
              isDecoded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </>
      ) : isWaitingInView && !isImgBroken ? (
        <div
          aria-label="Loading photograph"
          className="h-full w-full animate-pulse bg-[#132946]"
        />
      ) : fallbackNode ? (
        fallbackNode
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-[#0B1A2E] text-slate-300">
          <ImageOff className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <span className="text-[11px] font-medium text-slate-400">
            Photo unavailable
          </span>
        </div>
      )}
    </div>
  );
};

interface AvatarMediaProps {
  fullName: string;
  photoImageId?: string | null;
  photoUrl?: string | null;
  sizeClass?: string;
  roundedClass?: string;
  textClass?: string;
  eager?: boolean;
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'LI';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export const AvatarMedia: React.FC<AvatarMediaProps> = ({
  fullName,
  photoImageId,
  photoUrl,
  sizeClass = 'h-10 w-10',
  roundedClass = 'rounded-full',
  textClass = 'text-xs',
  eager = false,
}) => {
  const hasPhoto = Boolean(photoImageId || photoUrl);
  const initials = computeInitials(fullName);

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden bg-[#0B1A2E] font-bold text-white ${sizeClass} ${roundedClass}`}
    >
      {hasPhoto ? (
        <FirestoreImage
          imageId={photoImageId}
          fallbackUrl={photoUrl}
          alt={fullName}
          eager={eager}
          className="h-full w-full object-cover"
          placeholderClassName="bg-[#0B1A2E]"
          fallbackNode={
            <div className="flex h-full w-full items-center justify-center bg-[#0B1A2E] font-bold text-white">
              <span className={textClass}>{initials}</span>
            </div>
          }
        />
      ) : (
        <span className={textClass}>{initials}</span>
      )}
    </div>
  );
};
