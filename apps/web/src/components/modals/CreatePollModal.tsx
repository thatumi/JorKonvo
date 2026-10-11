import { createPoll } from "@jorkonvo/matrix-core";
import { type FormEvent, useState } from "react";
import { useTranslation } from "../../i18n";
import { useMatrixStore } from "../../state/matrixStore";
import { useModalStore } from "../../state/modalStore";
import { Modal, ModalField, modalInputClass, ModalPrimaryButton } from "../Modal";

/**
 * Modal for starting a poll in a room: question, 2-10 answer options, and
 * toggles for multi-select and live (disclosed) results.
 *
 * @param roomId - Matrix room ID of the room to create the poll in.
 */
export function CreatePollModal({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const client = useMatrixStore((s) => s.client)!;
  const close = useModalStore((s) => s.close);
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState(["", ""]);
  const [multiSelect, setMultiSelect] = useState(false);
  const [disclosed, setDisclosed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validAnswers = answers.map((a) => a.trim()).filter(Boolean);

  function updateAnswer(index: number, value: string) {
    setAnswers((prev) => prev.map((a, i) => (i === index ? value : a)));
  }

  function addAnswer() {
    if (answers.length < 10) setAnswers((prev) => [...prev, ""]);
  }

  function removeAnswer(index: number) {
    setAnswers((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || validAnswers.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await createPoll(client, roomId, question.trim(), validAnswers, {
        maxSelections: multiSelect ? validAnswers.length : 1,
        disclosed,
      });
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("createPoll.title")} onClose={close}>
      <form onSubmit={handleSubmit}>
        <ModalField label={t("createPoll.questionLabel")}>
          <input
            className={modalInputClass()}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t("createPoll.questionPlaceholder")}
            autoFocus
          />
        </ModalField>

        <span className="mb-1 block text-xs font-bold uppercase text-muted">{t("createPoll.optionsLabel")}</span>
        <div className="mb-3 flex flex-col gap-1.5">
          {answers.map((answer, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                className={modalInputClass()}
                value={answer}
                onChange={(e) => updateAnswer(i, e.target.value)}
                placeholder={t("createPoll.optionPlaceholder", { n: i + 1 })}
              />
              {answers.length > 2 && (
                <button
                  type="button"
                  onClick={() => removeAnswer(i)}
                  className="shrink-0 rounded p-1.5 text-muted hover:text-dnd"
                  title={t("createPoll.removeOption")}
                  aria-label={t("createPoll.removeOption")}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          {answers.length < 10 && (
            <button
              type="button"
              onClick={addAnswer}
              className="self-start text-xs font-medium text-link hover:underline"
            >
              {t("createPoll.addOption")}
            </button>
          )}
        </div>

        <label className="mb-2 flex items-center gap-2 text-sm text-normal">
          <input type="checkbox" checked={multiSelect} onChange={(e) => setMultiSelect(e.target.checked)} className="h-4 w-4" />
          {t("createPoll.multiSelect")}
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm text-normal">
          <input type="checkbox" checked={disclosed} onChange={(e) => setDisclosed(e.target.checked)} className="h-4 w-4" />
          {t("createPoll.liveResults")}
        </label>

        {error && <p className="mb-3 rounded bg-dnd/10 px-3 py-2 text-sm text-dnd">{error}</p>}
        <ModalPrimaryButton type="submit" disabled={!question.trim() || validAnswers.length < 2 || busy}>
          {busy ? t("createPoll.creating") : t("createPoll.start")}
        </ModalPrimaryButton>
      </form>
    </Modal>
  );
}
