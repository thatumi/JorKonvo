import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../i18n";

/** "Test Video" button + a live self-view preview, so a camera choice can be confirmed from Settings without joining a call. */
export function CameraPreview({ deviceId }: { deviceId: string | undefined }) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);

  useEffect(() => () => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
  }, []);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setActive(true);
    } catch {
      // Permission denied, device unavailable, etc. - the button just stays in its untested state.
    }
  }

  function stop() {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setActive(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => (active ? stop() : void start())}
        className="self-start rounded border border-border px-2 py-1 text-xs font-medium text-normal hover:bg-bg-modifier-hover"
      >
        {active ? t("settings.cameraTestStop") : t("settings.cameraTest")}
      </button>
      {active && (
        // Mirrored (scale-x -1) - a self-view preview reads more naturally as a mirror, same as every other video call app.
        <video ref={videoRef} autoPlay muted playsInline aria-label={t("settings.camera")} className="w-full max-w-xs -scale-x-100 rounded bg-bg-darkest" />
      )}
    </div>
  );
}
