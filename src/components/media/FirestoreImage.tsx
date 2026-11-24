import React, { useEffect, useRef, useState } from 'react';
import { ImageOff, RefreshCw } from 'lucide-react';
import {
  fetchMediaImageDataUrl,
  getCachedMediaImageDataUrl,
  isImageSrcPredecoded,
  readCachedMediaL2Url,
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
  onImageLoaded?: () => void;
}

interface AsyncFetchState {
  forKey: string;
  src: string | null;
  failed: boolean;
  notFound: boolean;
}

interface L2HitState {
  forKey: string;
  src: string;
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
  onImageLoaded,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [inViewKey, setInViewKey] = useState<string | null>(null);
  const [l2State, setL2State] = useState<L2HitState | null>(null);
  const [asyncState, setAsyncState] = useState<AsyncFetchState | null>(null);
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<{
    forKey: string;
    count: number;
  }>({ forKey: '', count: 0 });
  const autoRetriedKeyRef = useRef<string | null>(null);
  const onImageLoadedRef = useRef(onImageLoaded);
  useEffect(() => {
    onImageLoadedRef.current = onImageLoaded;
  }, [onImageLoaded]);

  const scopeKind = cacheScope?.scope ?? 'public';
  const scopeUid = cacheScope?.viewerUid ?? null;
  const activeKey = imageId ? `${scopeKind}:${scopeUid ?? 'pub'}:${imageId}` : '';

  const cachedSrc = imageId
    ? getCachedMediaImageDataUrl(imageId, {
        scope: scopeKind,
        viewerUid: scopeUid,
      })
    : null;
  const matchedL2 = activeKey && l2State?.forKey === activeKey ? l2State.src : null;
  const matchedAsync =
    activeKey && asyncState?.forKey === activeKey ? asyncState : null;

  const candidateSrc =
    directSrc ||
    cachedSrc ||
    matchedL2 ||
    matchedAsync?.src ||
    fallbackUrl ||
    null;

  const isImgBroken = Boolean(candidateSrc && brokenSrc === candidateSrc);
  const activeSrc = isImgBroken ? null : candidateSrc;
  const isWaitingInView = Boolean(
    !activeSrc &&
      imageId &&
      !matchedAsync?.failed &&
      !matchedAsync?.notFound
  );
  const isInstantHit = Boolean(directSrc || cachedSrc || matchedL2);
  const isDecoded = Boolean(
    activeSrc &&
      (isInstantHit ||
        loadedSrc === activeSrc ||
        isImageSrcPredecoded(activeSrc))
  );

  useEffect(() => {
    if (isDecoded) {
      onImageLoadedRef.current?.();
    }
  }, [isDecoded, activeSrc]);

  const retryNonce =
    activeKey && retryState.forKey === activeKey ? retryState.count : 0;

  // Immediately hydrate already-cached persistent media (Cache API / IndexedDB)
  // before intersection triggers, avoiding any redundant Firestore read or delay.
  useEffect(() => {
    if (!imageId || !activeKey || directSrc || cachedSrc) return;
    let active = true;
    void readCachedMediaL2Url(imageId, {
      scope: scopeKind,
      viewerUid: scopeUid,
    })
      .then((src) => {
        if (!active || !src) return;
        setL2State({ forKey: activeKey, src });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [imageId, activeKey, directSrc, cachedSrc, scopeKind, scopeUid]);

  const shouldFetch = Boolean(
    imageId &&
      activeKey &&
      !directSrc &&
      !cachedSrc &&
      !matchedL2 &&
      (eager || inViewKey === activeKey)
  );

  // Lazy load far off-screen images; prioritize near-viewport images (~550px ahead)
  useEffect(() => {
    if (
      !imageId ||
      !activeKey ||
      directSrc ||
      cachedSrc ||
      matchedL2 ||
      eager ||
      inViewKey === activeKey
    ) {
      return;
    }
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => setInViewKey(activeKey), 0);
      return () => window.clearTimeout(timer);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInViewKey(activeKey);
          observer.disconnect();
        }
      },
      { rootMargin: '550px 0px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [imageId, activeKey, directSrc, cachedSrc, matchedL2, eager, inViewKey]);

  useEffect(() => {
    if (!shouldFetch || !imageId || !activeKey) return;

    let active = true;
    fetchMediaImageDataUrl(imageId, {
      scope: scopeKind,
      viewerUid: scopeUid,
      forceRefresh: retryNonce > 0,
    })
      .then((dataUrl) => {
        if (!active) return;
        const offline =
          typeof navigator !== 'undefined' && navigator.onLine === false;
        setAsyncState({
          forKey: activeKey,
          src: dataUrl,
          failed: !dataUrl && offline && !fallbackUrl,
          notFound: !dataUrl && !offline && !fallbackUrl,
        });
      })
      .catch(() => {
        if (!active) return;
        setAsyncState({
          forKey: activeKey,
          src: null,
          failed: !fallbackUrl,
          notFound: false,
        });
      });

    return () => {
      active = false;
    };
  }, [
    shouldFetch,
    imageId,
    activeKey,
    fallbackUrl,
    scopeKind,
    scopeUid,
    retryNonce,
  ]);

  // Safe automatic single retry on transient failure & retry when browser reconnects
  useEffect(() => {
    if (!activeKey || !matchedAsync?.failed) return;
    let timer: number | null = null;
    if (
      autoRetriedKeyRef.current !== activeKey &&
      (typeof navigator === 'undefined' || navigator.onLine !== false)
    ) {
      autoRetriedKeyRef.current = activeKey;
      timer = window.setTimeout(() => {
        setRetryState((prev) => ({
          forKey: activeKey,
          count: prev.forKey === activeKey ? prev.count + 1 : 1,
        }));
      }, 1200);
    }
    const handleOnline = () => {
      setRetryState((prev) => ({
        forKey: activeKey,
        count: prev.forKey === activeKey ? prev.count + 1 : 1,
      }));
    };
    window.addEventListener('online', handleOnline);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('online', handleOnline);
    };
  }, [activeKey, matchedAsync?.failed]);

  const handleManualRetry = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (!activeKey) return;
    setBrokenSrc(null);
    setAsyncState(null);
    setRetryState((prev) => ({
      forKey: activeKey,
      count: prev.forKey === activeKey ? prev.count + 1 : 1,
    }));
  };

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
            fetchPriority={eager ? 'high' : 'auto'}
            referrerPolicy="no-referrer"
            onClick={onClick}
            onLoad={() => {
              setLoadedSrc(activeSrc);
              onImageLoadedRef.current?.();
            }}
            onError={() => {
              setLoadedSrc(null);
              setBrokenSrc(activeSrc);
            }}
            className={`${className} transition-opacity duration-150 ${
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
      ) : matchedAsync?.failed && !matchedAsync?.notFound ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[#0B1A2E] px-2 text-center text-slate-300">
          <ImageOff className="h-5 w-5 text-slate-400" aria-hidden="true" />
          <span className="text-[11px] font-medium text-slate-300">
            Could not load photo
          </span>
          <button
            type="button"
            onClick={handleManualRetry}
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-white/20"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            Tap to retry
          </button>
        </div>
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

