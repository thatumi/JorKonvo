import { isUserVerified, type MatrixClient, watchUserTrustChanges } from "@jorkonvo/matrix-core";
import { useEffect, useState } from "react";

/** Live cross-signing verification status for one user - null while unknown/loading, so callers can render nothing rather than a wrong flash of "unverified". */
export function useIsUserVerified(client: MatrixClient, userId: string): boolean | null {
  const [verified, setVerified] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    setVerified(null);
    void isUserVerified(client, userId).then((v) => {
      if (!cancelled) setVerified(v);
    });
    const unsubscribe = watchUserTrustChanges(client, (changedUserId) => {
      if (changedUserId !== userId) return;
      void isUserVerified(client, userId).then((v) => {
        if (!cancelled) setVerified(v);
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [client, userId]);

  return verified;
}
