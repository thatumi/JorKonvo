import {
  getOnboardingConfig,
  getSpaceRoles,
  hasSeenOnboarding,
  markOnboardingSeen,
  setMemberRoleAssigned,
} from "@jorkonvo/matrix-core";
import { useId, useState } from "react";
import { useTranslation } from "../i18n";
import { useMatrixStore } from "../state/matrixStore";
import { useUiStore } from "../state/uiStore";

/**
 * A one-time (per account, per space) gate shown the first time a member
 * opens a space with onboarding enabled: rules the member must acknowledge,
 * optional self-assignable roles, and an optional welcome message. Mounted
 * once in MainLayout keyed by the selected space id, so switching spaces
 * remounts it fresh instead of carrying stale step/selection state over.
 */
export function OnboardingGate() {
  const { t } = useTranslation();
  const titleId = useId();
  const client = useMatrixStore((s) => s.client);
  const selectedSpaceId = useUiStore((s) => s.selectedSpaceId);
  const [dismissed, setDismissed] = useState(false);
  const [step, setStep] = useState<"rules" | "welcome">("rules");
  const [agreed, setAgreed] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const space = client && selectedSpaceId ? client.getRoom(selectedSpaceId) : null;
  if (!client || !space || dismissed) return null;

  const config = getOnboardingConfig(space);
  if (!config.enabled || hasSeenOnboarding(client, space.roomId)) return null;

  const roles = getSpaceRoles(space).filter((r) => config.selfAssignableRoleIds.includes(r.id));
  const needsAgreement = config.rules.trim().length > 0;

  async function finish() {
    setBusy(true);
    try {
      const ownUserId = client!.getUserId();
      if (ownUserId) {
        for (const roleId of selectedRoleIds) {
          await setMemberRoleAssigned(client!, space!.roomId, ownUserId, roleId, true).catch(() => undefined);
        }
      }
      if (config.welcomeMessage.trim() && step === "rules") {
        setStep("welcome");
        return;
      }
      await markOnboardingSeen(client!, space!.roomId);
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  async function closeWelcome() {
    setBusy(true);
    try {
      await markOnboardingSeen(client!, space!.roomId);
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-scale-in flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg bg-bg-primary shadow-xl ring-1 ring-white/5"
      >
        {step === "rules" ? (
          <>
            <div className="shrink-0 px-6 pt-6">
              <h2 id={titleId} className="text-lg font-semibold text-header">{t("onboarding.welcomeTitle", { name: space.name })}</h2>
              <p className="mt-1 text-sm text-muted">{t("onboarding.rulesHint")}</p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              {config.rules.trim() && (
                <p className="whitespace-pre-wrap rounded bg-bg-secondary px-3 py-2.5 text-sm text-normal">
                  {config.rules}
                </p>
              )}
              {roles.length > 0 && (
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-bold uppercase text-muted">{t("onboarding.pickRoles")}</p>
                  <div className="flex flex-wrap gap-2">
                    {roles.map((role) => {
                      const active = selectedRoleIds.has(role.id);
                      return (
                        <button
                          key={role.id}
                          type="button"
                          onClick={() =>
                            setSelectedRoleIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(role.id)) next.delete(role.id);
                              else next.add(role.id);
                              return next;
                            })
                          }
                          className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                            active ? "" : "border-border text-muted hover:text-normal"
                          }`}
                          style={active ? { borderColor: role.color, backgroundColor: `${role.color}26`, color: role.color } : undefined}
                        >
                          {role.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {needsAgreement && (
                <label className="mt-4 flex items-start gap-2 text-sm text-normal">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  {t("onboarding.agree")}
                </label>
              )}
            </div>
            <div className="shrink-0 px-6 pb-6">
              <button
                type="button"
                onClick={() => void finish()}
                disabled={(needsAgreement && !agreed) || busy}
                className="w-full rounded bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50"
              >
                {t("onboarding.continue")}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="shrink-0 px-6 pt-6">
              <h2 id={titleId} className="text-lg font-semibold text-header">{t("onboarding.welcomeStepTitle")}</h2>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
              <p className="whitespace-pre-wrap text-sm text-normal">{config.welcomeMessage}</p>
            </div>
            <div className="shrink-0 px-6 pb-6">
              <button
                type="button"
                onClick={() => void closeWelcome()}
                disabled={busy}
                className="w-full rounded bg-brand py-2 text-sm font-semibold text-white transition hover:bg-brand-hover disabled:opacity-50"
              >
                {t("onboarding.enter")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
