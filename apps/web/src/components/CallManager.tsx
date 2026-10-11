import { CallEventHandlerEvent, type MatrixCall } from "@jorkonvo/matrix-core";
import { useEffect } from "react";
import { registerCall, useCallStore } from "../state/callStore";
import { useMatrixStore } from "../state/matrixStore";

/** Invisible component: wires up handling for incoming 1:1 calls. */
export function CallManager() {
  const client = useMatrixStore((s) => s.client);

  useEffect(() => {
    if (!client) return;

    function onIncoming(call: MatrixCall) {
      // Only track one call at a time - reject anything beyond that.
      if (useCallStore.getState().call) {
        call.reject();
        return;
      }
      registerCall(call, "incoming");
    }

    client.on(CallEventHandlerEvent.Incoming, onIncoming);
    return () => {
      client.removeListener(CallEventHandlerEvent.Incoming, onIncoming);
    };
  }, [client]);

  return null;
}
