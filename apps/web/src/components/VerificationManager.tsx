import { CryptoEvent, type VerificationRequest } from "@jorkonvo/matrix-core";
import { useEffect } from "react";
import { useMatrixStore } from "../state/matrixStore";
import { useVerificationStore } from "../state/verificationStore";

/** Invisible component: wires up handling for incoming device/user verification requests. */
export function VerificationManager() {
  const client = useMatrixStore((s) => s.client);

  useEffect(() => {
    if (!client) return;
    const c = client;

    const onRequest = (request: VerificationRequest) => {
      // A request the OTHER side started - surface it as a dismissible toast,
      // never a screen-blocking modal, so it can't be used to interrupt or
      // grief someone by spamming requests. Blocked users are dropped
      // silently. (A request WE started reaches the store via start(), not
      // this event.)
      useVerificationStore.getState().presentIncoming(request, c.isUserIgnored(request.otherUserId));
    };

    c.on(CryptoEvent.VerificationRequestReceived, onRequest);
    return () => {
      c.removeListener(CryptoEvent.VerificationRequestReceived, onRequest);
    };
  }, [client]);

  return null;
}
