"use client";

import * as React from "react";

import { applyStyleNonce, hasLightBackground } from "@/lib/mail/render-email";

/**
 * Renders an email's own HTML.
 *
 * Email HTML is arbitrary markup written by whoever sent the message, so it is
 * never injected into this document — `dangerouslySetInnerHTML` on a stranger's
 * markup is the classic mail-client XSS. It goes into a sandboxed iframe with
 * no `allow-scripts`, so scripts simply do not execute, and a CSP inside the
 * frame as a second layer.
 *
 * `allow-same-origin` is present *without* `allow-scripts`, which is what lets
 * the parent measure the content height. That pairing is deliberate: together
 * the two would defeat the sandbox, but with scripting off there is nothing
 * running inside the frame to take advantage of it.
 *
 * The frame is its own document on the app's dark canvas. Left alone, the
 * browser would paint its default white behind every message, which is why the
 * document below sets `color-scheme: dark` and an explicit background matching
 * the reader.
 *
 * Senders write HTML for a *light* client, though, and often pin near-black
 * text without ever setting a background. `hasLightBackground` detects that
 * case: when the message brings no light surface of its own, the frame forces a
 * readable light-on-dark default. When it does bring one, its own colors are
 * left exactly as authored.
 *
 * The frame's `<style>` carries the page's CSP `nonce`: a `srcdoc` document
 * inherits the parent's policy, and in production that policy only allows
 * `style` elements that present the nonce. Without it the canvas and the
 * contrast fallback would silently not apply.
 *
 * Remote images load by default. Gmail's "display images" prompt is a
 * tracking-pixel guard, but this client chooses to render the message as sent;
 * `referrerPolicy="no-referrer"` keeps the Referer header off the requests.
 */
export const MailHtmlBody = React.memo(function MailHtmlBody({
  html,
  nonce,
  variant = "dark",
}: {
  html: string;
  /** The host document's CSP nonce, so the frame's own `<style>` is allowed. */
  nonce?: string;
  /**
   * `light` paints the message on a white canvas — the surface a newsletter was
   * designed for, so its dark text and colours land as authored. `dark` keeps
   * the app's own canvas with a readable fallback.
   */
  variant?: "dark" | "light";
}) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const rafRef = React.useRef(0);
  const [height, setHeight] = React.useState(160);

  // A `srcdoc` frame inherits the page's CSP, which (in production) binds
  // `<style>` elements to the page nonce. The sender's own `<style>` blocks are
  // what carry a designed email's background and layout, so hand them the
  // nonce: inside this sandboxed, scriptless frame a style element can only
  // affect the message itself, never the app UI. Without it a white newsletter
  // loses its background while keeping its dark text — unreadable grey on the
  // dark canvas — which is the exact case this prevents.
  const rendered = React.useMemo(
    () => (nonce ? applyStyleNonce(html, nonce) : html),
    [html, nonce],
  );

  const document_ = React.useMemo(() => {
    const light = variant === "light";
    // On the dark canvas only: a sender that brought no light background of its
    // own gets a readable light default. On white there is nothing to rescue.
    const forceReadable = !light && !hasLightBackground(rendered);
    const readable = forceReadable
      ? `
  html, body { color: #e8e8e8; }
  body, body * { color: #e8e8e8 !important; }
  a { color: #8ab4f8 !important; }`
      : "";
    const canvas = light
      ? { bg: "#ffffff", fg: "#202124", link: "#1a73e8", scheme: "light" }
      : { bg: "#222222", fg: "#e8e8e8", link: "#8ab4f8", scheme: "dark" };

    // Without 'unsafe-inline' for styles nearly every marketing email loses its
    // layout — inline style attributes are how email design works. Scripts stay
    // denied outright, and the sandbox already blocks them regardless.
    const csp = [
      "default-src 'none'",
      "img-src 'self' https: http: data: cid:",
      "style-src 'unsafe-inline'",
      "font-src data: https:",
      "form-action 'none'",
    ].join("; ");
    const nonceAttr = nonce ? ` nonce="${nonce}"` : "";

    return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="color-scheme" content="${canvas.scheme}">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style${nonceAttr}>
  html, body { background-color: ${canvas.bg}; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: ${canvas.fg};
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  a { color: ${canvas.link}; }${readable}
</style>
</head><body>${rendered}</body></html>`;
  }, [rendered, nonce, variant]);

  // Coalesce every reflow (image landing, font swap, explicit resize) into a
  // single measurement on the next frame, rather than a fixed timer fan-out.
  const measure = React.useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const body = frameRef.current?.contentDocument?.body;
      if (body) setHeight(Math.min(body.scrollHeight + 16, 20000));
    });
  }, []);

  // The frame reloads whenever `srcDoc` changes; re-observe its new document.
  const handleLoad = React.useCallback(() => {
    const document = frameRef.current?.contentDocument;
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (document?.documentElement && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(document.documentElement);
      if (document.body) observer.observe(document.body);
      observerRef.current = observer;
    }
    measure();
  }, [measure]);

  React.useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      observerRef.current?.disconnect();
    },
    [],
  );

  const frame = (
    <iframe
      ref={frameRef}
      title="Message content"
      srcDoc={document_}
      onLoad={handleLoad}
      // No allow-scripts: nothing in here executes. allow-popups so a link
      // can still open, in a tab this frame has no handle on.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className={
        variant === "light"
          ? "block w-full border-0"
          : "block w-full border-0 bg-mail-surface"
      }
      style={{ height }}
    />
  );

  // The white canvas reads as a card, so clip it to the app's `xl` radius; the
  // dark canvas blends into the reader surface and needs no frame.
  return variant === "light" ? (
    <div className="w-full overflow-hidden rounded-xl bg-white">{frame}</div>
  ) : (
    frame
  );
});
