import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";

/**
 * Opens the device camera and repeatedly decodes frames with jsQR, calling
 * `onScan` with the raw QR payload bytes the first time a code is found.
 * Used for MSC1544 QR-code device verification (scanning the OTHER
 * device's `m.qr_code.show.v1` code) - the payload is arbitrary binary,
 * not text, so this hands back bytes rather than a decoded string.
 */
export function QrScanner({ onScan, onError }: { onScan: (data: Uint8ClampedArray) => void; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const foundRef = useRef(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;

    async function start() {
      try {
        // navigator.mediaDevices doesn't exist outside a secure context
        // (https, or plain http on localhost) - calling .getUserMedia on it
        // then throws a raw, unhelpful "undefined is not an object" TypeError.
        if (!navigator.mediaDevices?.getUserMedia) {
          onError(t("qrScanner.httpsRequired"));
          return;
        }
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setReady(true);
        tick();
      } catch (err) {
        onError((err as Error).message || t("qrScanner.denied"));
      }
    }

    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || foundRef.current || cancelled) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frame.data, frame.width, frame.height);
          if (code) {
            foundRef.current = true;
            onScan(new Uint8ClampedArray(code.binaryData));
            return;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <video ref={videoRef} muted playsInline aria-hidden="true" className="aspect-square w-full object-cover" />
      <canvas ref={canvasRef} className="hidden" />
      {!ready && (
        <p role="status" aria-live="polite" className="p-3 text-center text-xs text-muted">
          {t("qrScanner.starting")}
        </p>
      )}
    </div>
  );
}
