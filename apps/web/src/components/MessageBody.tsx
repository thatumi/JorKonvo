import { type MatrixClient, parseInviteLink } from "@jorkonvo/matrix-core";
import hljs from "highlight.js/lib/common";
import { type MouseEvent, type ReactNode, useState } from "react";
import { useTranslation } from "../i18n";
import { useAuthedMedia } from "../lib/authedMedia";
import { getSpoilerMode } from "../lib/spoilerPrefs";
import { useModalStore } from "../state/modalStore";

/**
 * Renders a message's `formatted_body` (org.matrix.custom.html) as React
 * elements, walking the parsed DOM ourselves through an allowlist instead
 * of `dangerouslySetInnerHTML` - untrusted HTML from other homeservers'
 * clients never reaches innerHTML, and any tag not on the allowlist is
 * unwrapped (its children still render, just without the tag/attributes).
 *
 * The one deliberate innerHTML exception is fenced code blocks: highlight.js
 * escapes all content it emits, and the input it receives is our own escaped
 * text read back out of the DOM, so no untrusted markup can get through.
 */

const ALLOWED_TAGS = new Set([
  "b", "strong", "i", "em", "code", "pre", "del", "s", "strike", "u",
  "sup", "sub", "br", "a", "p", "ul", "ol", "li", "blockquote", "span", "hr",
]);

function isMentionHref(href: string): boolean {
  return href.startsWith("https://matrix.to/#/") || href.startsWith("http://matrix.to/#/");
}

/**
 * A link inside a message that's actually a room/space invite (as opposed
 * to, say, a matrix.to USER mention pill, which also starts with
 * matrix.to but must never trigger a join attempt) - clicking it opens the
 * in-app join flow (same modal + auto-join the native deep-link handler
 * uses) instead of navigating away. Real gap reported live 2026-09-16:
 * tapping an invite link in a message opened Safari - a dead end, since
 * Universal Links/App Links aren't verified yet (separate, already-known
 * infra gap) - instead of joining in-app the way the link was clearly
 * meant to work. `InviteLinkCard` (rendered below the message body) covers
 * the common case with a proper preview + button; this catches someone
 * tapping the raw link text itself instead.
 */
function handleInviteLinkClick(e: MouseEvent, href: string): void {
  const parsed = parseInviteLink(href);
  // A matrix.to link can just as easily be a @user mention pill - only a
  // room/space target (never starting with "@") is actually joinable.
  if (!parsed || parsed.target.startsWith("@")) return;
  e.preventDefault();
  useModalStore.getState().open({ type: "joinRoom", initialTarget: href });
}

// Bare URLs in a plain-text body (or in a text run of a formatted body that a
// sender's client didn't wrap in <a>) - every other chat client turns these
// into links, so this does too. Trailing sentence punctuation is left out of
// the href; a balanced ")" is kept so wiki-style links survive.
const URL_IN_TEXT = /https?:\/\/[^\s<]+/g;

function trimTrailingPunctuation(url: string): string {
  let end = url.length;
  while (end > 0 && ".,;:!?'\"".includes(url[end - 1]!)) end -= 1;
  // A closing paren only counts as part of the URL if it balances an opening
  // one inside it (e.g. a Wikipedia "..._(disambiguation)" link).
  while (end > 0 && url[end - 1] === ")") {
    const slice = url.slice(0, end);
    if ((slice.match(/\(/g)?.length ?? 0) >= (slice.match(/\)/g)?.length ?? 0)) break;
    end -= 1;
  }
  return url.slice(0, end);
}

function linkifyText(text: string, keyBase: number): ReactNode {
  // Cheap negative check first - this runs for every text node of every
  // rendered message, and the overwhelming majority have no URL.
  if (text.indexOf("http") === -1) return text;
  URL_IN_TEXT.lastIndex = 0;
  if (!URL_IN_TEXT.test(text)) return text;
  URL_IN_TEXT.lastIndex = 0;
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_IN_TEXT.exec(text))) {
    const raw = match[0];
    const href = trimTrailingPunctuation(raw);
    if (match.index > last) out.push(text.slice(last, match.index));
    out.push(
      <a
        key={`${keyBase}-${match.index}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        onClick={(e) => handleInviteLinkClick(e, href)}
        className="text-link hover:underline"
      >
        {href}
      </a>,
    );
    out.push(raw.slice(href.length));
    last = match.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Spec's spoiler markup: <span data-mx-spoiler[="reason"]>text</span> - hidden until clicked (unless the Appearance "spoiler display" setting overrides). */
function SpoilerSpan({ reason, children }: { reason: string | null; children: ReactNode }) {
  const mode = getSpoilerMode();
  const [clicked, setClicked] = useState(false);
  const revealed = mode === "show" || (mode === "click" && clicked);
  return (
    <span
      onClick={() => setClicked(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setClicked(true);
        }
      }}
      role={revealed ? undefined : "button"}
      tabIndex={revealed ? undefined : 0}
      title={!revealed && reason ? reason : undefined}
      className={`rounded bg-bg-darkest px-1 ${revealed ? "text-normal" : "cursor-pointer text-bg-darkest"}`}
    >
      {children}
    </span>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const { t } = useTranslation();
  const resolvedLang = lang && hljs.getLanguage(lang) ? lang : null;
  const highlighted = resolvedLang ? hljs.highlight(code, { language: resolvedLang }).value : null;
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="jk-codeblock my-1 overflow-hidden rounded bg-bg-darkest">
      <div className="flex items-center justify-between border-b border-white/5 px-2 py-1 text-[11px] text-muted">
        <span className="font-mono uppercase tracking-wide">{resolvedLang ?? "code"}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={t("common.copy")}
          className="rounded px-1.5 py-0.5 font-medium hover:bg-white/10 hover:text-normal"
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[13px]">
        {highlighted !== null ? (
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
    </div>
  );
}

/**
 * `<img>` is deliberately NOT in ALLOWED_TAGS - an arbitrary image tag in a
 * message could leak the reader's IP/client info to a third-party URL just
 * by rendering. The one narrow exception: the spec's own custom-emoji
 * markup (`data-mx-emoticon`, see roomEmoji.ts) with an `mxc://` src, which
 * is safe because it only ever resolves through OUR OWN homeserver's media
 * endpoint, the same as any avatar/attachment image already does - never an
 * arbitrary external host.
 */
/**
 * Custom-emoji <img>. Resolved through useAuthedMedia (blob: URL with a
 * Bearer token) rather than a plain mxcUrlToHttp src: on an
 * authenticated-media homeserver (MSC3916, this project's server included)
 * the legacy thumbnail endpoint 404s and a bare <img> can't send the token,
 * so the emoji would just render broken.
 */
function EmoticonImg({ mxc, alt }: { mxc: string; alt: string }) {
  const src = useAuthedMedia(mxc, { width: 32, height: 32, method: "scale", animated: true });
  if (!src) {
    return (
      <span className="text-muted" title={alt}>
        {alt ? `:${alt}:` : "🖼️"}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      title={alt}
      loading="lazy"
      className="mx-0.5 inline-block h-5 w-5 align-text-bottom"
    />
  );
}

function renderEmoticonImg(el: Element, key: number): ReactNode {
  const src = el.getAttribute("src") ?? "";
  if (!el.hasAttribute("data-mx-emoticon") || !src.startsWith("mxc://")) return null;
  const alt = el.getAttribute("alt") || el.getAttribute("title") || "";
  return <EmoticonImg key={key} mxc={src} alt={alt.replace(/^:|:$/g, "")} />;
}

/**
 * Nesting past this is never legitimate formatting - a `formatted_body` from
 * a hostile client can be tens of thousands of levels deep (`<s>` repeated to
 * the 64KB event limit), which would blow the stack / hang the tab just
 * rendering that one message. Past the cap we stop recursing and drop to the
 * subtree's plain text.
 */
const MAX_DEPTH = 48;

function renderNode(node: ChildNode, key: number, client: MatrixClient, depth = 0, linkify = true): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return linkify ? linkifyText(node.textContent ?? "", key) : node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  if (tag === "img") return renderEmoticonImg(el, key);

  if (depth >= MAX_DEPTH) return <span key={key}>{el.textContent}</span>;

  // Don't turn URL-looking text into a second nested link inside an existing
  // <a>, and leave inline code spans verbatim.
  const childLinkify = linkify && tag !== "a" && tag !== "code";
  const children = Array.from(el.childNodes).map((c, i) => renderNode(c, i, client, depth + 1, childLinkify));

  if (!ALLOWED_TAGS.has(tag)) {
    return <span key={key}>{children}</span>;
  }

  switch (tag) {
    case "br":
      return <br key={key} />;
    case "hr":
      return <hr key={key} className="my-1 border-border" />;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      if (isMentionHref(href)) {
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => handleInviteLinkClick(e, href)}
            className="rounded bg-brand/20 px-1 text-brand hover:underline"
          >
            {children}
          </a>
        );
      }
      if (/^https?:\/\//.test(href)) {
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => handleInviteLinkClick(e, href)}
            className="text-link hover:underline"
          >
            {children}
          </a>
        );
      }
      return <span key={key}>{children}</span>;
    }
    case "code":
      return (
        <code key={key} className="rounded bg-bg-darkest px-1 py-0.5 font-mono text-[13px]">
          {children}
        </code>
      );
    case "pre": {
      // Fenced code block: pull the raw text back out and re-render it with
      // syntax highlighting (formatting.ts marks the language with a
      // language-* class on the inner <code>).
      const codeEl = el.querySelector("code");
      const langClass = [...(codeEl?.classList ?? [])].find((c) => c.startsWith("language-"));
      return (
        <CodeBlock key={key} code={codeEl?.textContent ?? el.textContent ?? ""} lang={langClass?.slice(9) ?? null} />
      );
    }
    case "blockquote":
      return (
        <blockquote key={key} className="my-1 border-l-2 border-border pl-2 text-muted">
          {children}
        </blockquote>
      );
    case "ul":
      return (
        <ul key={key} className="my-1 list-disc pl-5">
          {children}
        </ul>
      );
    case "ol":
      return (
        <ol key={key} className="my-1 list-decimal pl-5">
          {children}
        </ol>
      );
    case "li":
      return <li key={key}>{children}</li>;
    case "p":
      return (
        <p key={key} className="my-0.5">
          {children}
        </p>
      );
    case "del":
    case "s":
    case "strike":
      return <del key={key}>{children}</del>;
    case "b":
    case "strong":
      return <strong key={key}>{children}</strong>;
    case "i":
    case "em":
      return <em key={key}>{children}</em>;
    case "u":
      return <u key={key}>{children}</u>;
    case "sup":
      return <sup key={key}>{children}</sup>;
    case "sub":
      return <sub key={key}>{children}</sub>;
    case "span":
      if (el.hasAttribute("data-mx-spoiler")) {
        return (
          <SpoilerSpan key={key} reason={el.getAttribute("data-mx-spoiler") || null}>
            {children}
          </SpoilerSpan>
        );
      }
      if (el.getAttribute("data-mx-pill") === "room") {
        return (
          <span key={key} className="rounded bg-dnd/20 px-1 font-medium text-dnd">
            {children}
          </span>
        );
      }
      if (el.getAttribute("data-mx-pill") === "here") {
        return (
          <span
            key={key}
            className="rounded bg-[var(--color-online)]/20 px-1 font-medium"
            style={{ color: "var(--color-online)" }}
          >
            {children}
          </span>
        );
      }
      if (el.getAttribute("data-mx-pill") === "role") {
        // data-mx-color, not a trusted raw `style` attribute passed
        // through - this HTML can come from anyone's message, not just our
        // own composer, so the color is read back and applied ourselves
        // rather than trusting arbitrary inline CSS from the parsed body.
        const color = el.getAttribute("data-mx-color") || "var(--color-brand)";
        return (
          <span key={key} className="rounded px-1 font-medium" style={{ backgroundColor: `${color}33`, color }}>
            {children}
          </span>
        );
      }
      return <span key={key}>{children}</span>;
    default:
      return <span key={key}>{children}</span>;
  }
}

/**
 * Renders a message body as React elements: a plain-text body is just
 * linkified, while an `org.matrix.custom.html` formatted body goes through
 * the allowlisted DOM walk above. Never mutates the parse logic - see the
 * module doc on ALLOWED_TAGS for the security model.
 *
 * @param body - the plain-text body.
 * @param formattedBody - the `formatted_body` HTML, if the event used it.
 * @param client - the Matrix client (used for authenticated media).
 */
export function MessageBody({
  body,
  formattedBody,
  client,
}: {
  body: string;
  formattedBody?: string | null;
  client: MatrixClient;
}) {
  if (!formattedBody) return <>{linkifyText(body, 0)}</>;

  // Our own mx-reply fallback block (and other clients') is redundant here:
  // RepliedToPreview already renders the quoted-message UI.
  const withoutReplyFallback = formattedBody.replace(/<mx-reply>[\s\S]*?<\/mx-reply>/gi, "");
  const doc = new DOMParser().parseFromString(`<body>${withoutReplyFallback}</body>`, "text/html");
  return <>{Array.from(doc.body.childNodes).map((n, i) => renderNode(n, i, client, 0))}</>;
}
