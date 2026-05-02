import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Original image as data URL or base64 (with or without data: prefix). */
  imageDataUrl: string;
  /** PNG mask, base64 only (no data: prefix), same dimensions as image. */
  maskBase64: string;
  /** Coverage fraction the sidecar reported, 0..1 — shown as a chip. */
  coverage?: number;
  /** Tint applied to the mask. Bio-emerald by default — matches the design system. */
  tint?: { r: number; g: number; b: number };
  /** 0..1 mask opacity. Default 0.55. */
  opacity?: number;
  /** Optional caption text under the canvas. */
  caption?: string;
}

const DEFAULT_TINT = { r: 56, g: 189, b: 248 };

/**
 * Paints `maskBase64` over `imageDataUrl` on a single canvas using a
 * coloured tint and `lighter` blending — so high-intensity regions glow
 * instead of being flatly painted over. Renders at the original image
 * resolution but scales down to fit its container.
 */
export function ImagingMaskOverlay({
  imageDataUrl,
  maskBase64,
  coverage,
  tint = DEFAULT_TINT,
  opacity = 0.55,
  caption,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;

    const baseSrc = imageDataUrl.startsWith('data:')
      ? imageDataUrl
      : `data:image/jpeg;base64,${imageDataUrl}`;
    const maskSrc = maskBase64.startsWith('data:')
      ? maskBase64
      : `data:image/png;base64,${maskBase64}`;

    const base = new Image();
    const mask = new Image();
    let baseReady = false;
    let maskReady = false;

    const draw = () => {
      if (cancelled || !baseReady || !maskReady) return;
      const w = base.naturalWidth || 640;
      const h = base.naturalHeight || 480;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('canvas 2d context unavailable');
        return;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);

      // Tint the mask: paint the mask onto a scratch canvas with `source-in`
      // so only the lit pixels of the mask receive the tint colour.
      const scratch = document.createElement('canvas');
      scratch.width = w;
      scratch.height = h;
      const sctx = scratch.getContext('2d');
      if (!sctx) return;
      sctx.drawImage(mask, 0, 0, w, h);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = `rgb(${tint.r}, ${tint.g}, ${tint.b})`;
      sctx.fillRect(0, 0, w, h);

      ctx.globalAlpha = opacity;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(scratch, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    };

    base.onload = () => {
      baseReady = true;
      draw();
    };
    base.onerror = () => setError('cannot decode base image');
    mask.onload = () => {
      maskReady = true;
      draw();
    };
    mask.onerror = () => setError('cannot decode mask');

    base.src = baseSrc;
    mask.src = maskSrc;

    return () => {
      cancelled = true;
    };
  }, [imageDataUrl, maskBase64, tint.r, tint.g, tint.b, opacity]);

  return (
    <figure className="space-y-1">
      <div className="relative overflow-hidden rounded-lg border border-quantum-400/40 bg-black/60">
        <canvas ref={canvasRef} className="block h-auto w-full" />
        {coverage !== undefined && (
          <span className="absolute right-2 top-2 rounded-md border border-quantum-400/40 bg-ink-950/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-quantum-300">
            mask {(coverage * 100).toFixed(1)}%
          </span>
        )}
      </div>
      {error ? (
        <figcaption className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
          overlay error · {error}
        </figcaption>
      ) : caption ? (
        <figcaption className="font-mono text-[10px] uppercase tracking-[0.18em] text-app-faint">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
