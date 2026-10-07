import * as React from "react";

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
 * The frame is its own document, so it does not inherit the app's dark theme.
 * Left alone, the browser paints the frame's default white canvas behind every
 * message — which is why HTML mail looked like a white card while plain-text
 * mail sat on the dark surface. The document below sets `color-scheme: dark`
 * and an explicit background matching the reader so the two agree; a sender's
 * own background (a white newsletter body, say) still wins, exactly as in
 * Gmail.
 *
 * Remote images load by default. Gmail's "display images" prompt is a
 * tracking-pixel guard, but this client chooses to render the message as sent;
 * `referrerPolicy="no-referrer"` keeps the Referer header off the requests.
 */
export function MailHtmlBody({ html }: { html: string }) {
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(320);

  const document_ = React.useMemo(() => {
    // Without 'unsafe-inline' for styles nearly every marketing email loses its
    // layout — inline style attributes are how email design works. Scripts stay
    // denied outright, and the sandbox already blocks them regardless.
    const csp = [
      "default-src 'none'",
      "img-src https: http: data: cid:",
      "style-src 'unsafe-inline'",
      "font-src data:",
      "form-action 'none'",
    ].join("; ");

    return `<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<base target="_blank">
<style>
  html, body { background-color: #222222; }
  html, body { margin:0; padding:0; }
  body {
    font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #e8e8e8;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  img { max-width: 100%; height: auto; }
  table { max-width: 100% !important; }
  a { color: #8ab4f8; }
</style>
</head><body>${html}</body></html>`;
  }, [html]);

  // Re-measure whenever the document changes: images landing reflow it.
  const measure = React.useCallback(() => {
    const body = frameRef.current?.contentDocument?.body;
    if (body) setHeight(Math.min(body.scrollHeight + 16, 20000));
  }, []);

  React.useEffect(() => {
    // Images and webfonts land after load, each changing the height.
    const timers = [80, 400, 1200].map((delay) =>
      window.setTimeout(measure, delay),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [document_, measure]);

  return (
    <iframe
      ref={frameRef}
      title="Message content"
      srcDoc={document_}
      onLoad={measure}
      // No allow-scripts: nothing in here executes. allow-popups so a link
      // can still open, in a tab this frame has no handle on.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      referrerPolicy="no-referrer"
      className="w-full border-0 bg-mail-surface"
      style={{ height }}
    />
  );
}
