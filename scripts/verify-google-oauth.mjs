#!/usr/bin/env node
/**
 * Read-only preflight for the public side of Google OAuth verification.
 *
 *   npm run verify:google-oauth
 *   VERIFY_ORIGIN=https://tartly.in npm run verify:google-oauth
 *   VERIFY_ORIGIN=http://localhost:3210 CANONICAL_ORIGIN=https://tartly.in \
 *     npm run verify:google-oauth   # inspect a local build before deploying
 *
 * It checks the homepage, `/privacy`, `/terms`, DNS ownership, robots/sitemap
 * and the exact disclosures Google's App Privacy Policy guide asks for. It
 * cannot check the OAuth consent screen, Search Console status, the demo video
 * or CASA — those are listed as warnings for the human submission checklist.
 *
 * Exit 0 means every repository-controllable criterion passed.
 */

const ORIGIN = (process.env.VERIFY_ORIGIN ?? "https://tartly.in").replace(/\/+$/, "");
const CANONICAL_ORIGIN = (process.env.CANONICAL_ORIGIN ?? ORIGIN).replace(/\/+$/, "");
const HOST = new URL(CANONICAL_ORIGIN).hostname.replace(/^www\./, "");
const GOOGLE_POLICY = "https://developers.google.com/terms/api-services-user-data-policy";

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function pass(message) {
  console.log(`✅ ${message}`);
}

async function get(url, options = {}) {
  const response = await fetch(url, {
    redirect: options.redirect ?? "follow",
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "Tartly-OAuth-Preflight/1.0" },
  });
  const body = await response.text();
  return { response, body };
}

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function includesAll(text, needles, label) {
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length === 0) {
    pass(label);
    return;
  }
  fail(`${label} — missing: ${missing.map((value) => JSON.stringify(value)).join(", ")}`);
}

async function checkDns() {
  try {
    const response = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(HOST)}&type=TXT`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const json = await response.json();
    const records = (json.Answer ?? []).map((answer) => String(answer.data ?? ""));
    const verification = records.find((record) =>
      record.includes("google-site-verification="),
    );

    if (verification) {
      pass(`DNS TXT ownership record present (${verification.replace(/^"|"$/g, "")})`);
    } else {
      fail(`DNS TXT ownership record missing for ${HOST}`);
    }
  } catch (error) {
    fail(`DNS ownership lookup failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function checkHomepage() {
  const { response, body } = await get(`${ORIGIN}/`);
  if (response.status !== 200) {
    fail(`Homepage returned ${response.status}, expected 200`);
    return;
  }
  pass("Homepage is publicly reachable (200)");

  const html = body;
  const text = visibleText(html);
  if (text.includes("Tartly")) {
    pass("Homepage names the app (Tartly)");
  } else {
    fail("Homepage does not name Tartly");
  }

  if (/<a[^>]+href=["']\/privacy["']/i.test(html)) {
    pass("Homepage links to /privacy");
  } else {
    fail("Homepage has no visible /privacy link");
  }

  if (/Gmail|Google Calendar/i.test(text)) {
    pass("Homepage describes the Google-powered functionality");
  } else {
    fail("Homepage does not describe Gmail / Google Calendar functionality");
  }
}

async function checkPrivacy() {
  const { response, body } = await get(`${ORIGIN}/privacy`);
  if (response.status !== 200) {
    fail(`/privacy returned ${response.status}, expected 200`);
    return;
  }
  pass("/privacy is publicly reachable (200)");

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    pass("/privacy is served as HTML");
  } else {
    fail(`/privacy content-type is ${JSON.stringify(contentType)}, expected text/html`);
  }

  if (/<iframe[\s>]/i.test(body)) {
    fail("/privacy contains an iframe; Google cannot process embedded documents");
  } else {
    pass("/privacy is not embedded in an iframe");
  }

  const robots = response.headers.get("x-robots-tag") ?? "";
  if (/noindex/i.test(robots)) {
    fail(`/privacy is noindexed (${robots})`);
  } else {
    pass("/privacy is indexable");
  }

  const html = body;

  const canonical = html.match(
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
  )?.[1];
  if (canonical === `${CANONICAL_ORIGIN}/privacy`) {
    pass("/privacy declares itself as its canonical URL");
  } else {
    fail(
      `/privacy canonical is ${JSON.stringify(canonical)}, expected ${JSON.stringify(`${CANONICAL_ORIGIN}/privacy`)}`,
    );
  }

  if (/<h1[^>]*>\s*Privacy Policy\s*<\/h1>/i.test(html)) {
    pass("/privacy has a dedicated Privacy Policy heading");
  } else {
    fail("/privacy does not look like a dedicated Privacy Policy page");
  }

  const text = visibleText(html);

  includesAll(
    text,
    ["Tartly", "support@tartly.in", `https://${HOST}`, "same domain"],
    "Privacy policy identifies Tartly and its homepage domain",
  );

  includesAll(
    text,
    [
      "gmail.modify",
      "https://mail.google.com/",
      "calendar.readonly",
      "calendar.events",
    ],
    "Privacy policy discloses every Google scope / data category",
  );

  includesAll(
    text,
    [
      "How we use Google user data",
      "How we share Google user data",
      "How we store, protect, and retain Google user data",
      "Your Google data choices and controls",
    ],
    "Privacy policy discloses use, sharing, protection, retention and deletion",
  );

  includesAll(
    text,
    ["do not sell", "data brokers", "creditworthiness", "lending"],
    "Privacy policy prohibits sale, broker, and credit uses",
  );

  includesAll(
    text,
    [
      "Google Workspace APIs are not used to develop, improve, or train non-personalized AI and/or ML models",
    ],
    "Privacy policy has Google's exact AI/ML affirmation",
  );

  includesAll(
    text,
    ["Google API Services User Data Policy", "Limited Use"],
    "Privacy policy has the Limited Use statement",
  );

  if (`${CANONICAL_ORIGIN}/privacy` === `${CANONICAL_ORIGIN}/`) {
    fail("Privacy policy URL is the homepage URL");
  } else {
    pass("Privacy policy URL differs from the homepage URL");
  }
}

async function checkTerms() {
  const { response } = await get(`${ORIGIN}/terms`);
  if (response.status === 200) {
    pass("/terms is publicly reachable (200)");
  } else {
    warn(`/terms returned ${response.status}; the consent screen lists a terms URL`);
  }
}

async function checkRobotsAndSitemap() {
  const robots = await get(`${ORIGIN}/robots.txt`);
  if (robots.response.status === 200 && robots.body.includes("/privacy")) {
    pass("robots.txt allows /privacy");
  } else {
    fail("robots.txt does not allow /privacy");
  }

  const sitemap = await get(`${ORIGIN}/sitemap.xml`);
  if (
    sitemap.response.status === 200 &&
    sitemap.body.includes(`${CANONICAL_ORIGIN}/privacy`)
  ) {
    pass("sitemap.xml includes the canonical /privacy URL");
  } else {
    fail("sitemap.xml does not include the canonical /privacy URL");
  }
}

async function checkConsentScreen() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) {
    warn("GOOGLE_CLIENT_ID is not set; skipped OAuth consent-screen check");
    return;
  }

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set(
    "redirect_uri",
    `${CANONICAL_ORIGIN}/api/auth/callback/google`,
  );
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", "oauth-preflight");
  url.searchParams.set("prompt", "consent");

  const { response, body } = await get(url.toString());
  if (response.status !== 200) {
    warn(`Consent screen returned ${response.status}; cannot inspect it`);
    return;
  }

  const text = visibleText(body);

  if (text.includes("Tartly")) {
    pass("Consent screen shows the app name Tartly");
  } else {
    fail("Consent screen does not show the app name Tartly");
  }

  if (body.includes(`${CANONICAL_ORIGIN}/privacy`)) {
    pass("Consent screen links to the privacy policy");
  } else {
    fail(`Consent screen does not link to ${CANONICAL_ORIGIN}/privacy`);
  }

  if (body.includes(`${CANONICAL_ORIGIN}/terms`)) {
    pass("Consent screen links to the terms of service");
  } else {
    warn("Consent screen does not link to the terms of service");
  }

  if (/https:\/\/lh3\.googleusercontent\.com\/[^"'\\]+/.test(body)) {
    pass("Consent screen has an app logo");
  } else {
    warn("Consent screen has no app logo");
  }

  const supportEmail = text.match(/Support email:\s*([^\s<]+)/i)?.[1];
  if (!supportEmail) {
    warn("Consent screen support email could not be parsed");
  } else if (supportEmail.toLowerCase() === "support@tartly.in") {
    pass("Consent screen support email is support@tartly.in");
  } else {
    warn(
      `Consent screen support email is ${supportEmail}. This is acceptable if the address is monitored. ` +
        "To display support@tartly.in, that address must first be a Google account or Google Group and a project Editor/Owner; see docs/google-oauth-verification.md §3.1.",
    );
  }
}

async function checkWwwCanonicalisation() {
  if (ORIGIN !== CANONICAL_ORIGIN) {
    warn("Skipped www canonicalisation for a local/non-production build");
    return;
  }
  try {
    const response = await fetch(`https://www.${HOST}/privacy`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if ([301, 308].includes(response.status)) {
      pass(`www.${HOST} redirects to the apex (${response.status})`);
    } else {
      warn(
        `www.${HOST} returned ${response.status} instead of a 301/308; deploy the canonical redirect or confirm the host is not attached`,
      );
    }
  } catch (error) {
    warn(`www canonicalisation check failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function checkMetaVerification() {
  const { body } = await get(`${ORIGIN}/`);
  if (/<meta[^>]+name=["']google-site-verification["'][^>]+content=["'][^"']+["']/i.test(body)) {
    pass("Homepage emits a google-site-verification meta tag");
  } else {
    warn(
      "Homepage has no google-site-verification meta tag (DNS TXT is sufficient, but the fallback is missing)",
    );
  }
}

function reportExternalSteps() {
  console.log("\nExternal steps this script cannot verify:");
  console.log("  • Search Console property tartly.in shows Verified");
  console.log("  • Consent-screen user support email is an address you monitor");
  console.log("  • Consent-screen logo, authorized domain and redirect URI are correct");
  console.log("  • Demo video recorded and linked");
  console.log("  • CASA restricted-scope assessment completed");
  console.log(`  • ${GOOGLE_POLICY} Limited Use compliance in the Google Cloud project`);
}

async function main() {
  console.log(`Google OAuth preflight for ${ORIGIN}`);
  if (CANONICAL_ORIGIN !== ORIGIN) {
    console.log(`Expected canonical origin: ${CANONICAL_ORIGIN}`);
  }
  console.log("");

  await checkDns();
  await checkHomepage();
  await checkMetaVerification();
  await checkPrivacy();
  await checkTerms();
  await checkRobotsAndSitemap();
  await checkConsentScreen();
  await checkWwwCanonicalisation();

  if (warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of warnings) console.log(`  ⚠️  ${warning}`);
  }

  if (failures.length > 0) {
    console.error("\nFailures:");
    for (const failure of failures) console.error(`  ✖ ${failure}`);
    reportExternalSteps();
    process.exit(1);
  }

  console.log("\nAll repository-controllable Google OAuth privacy criteria passed.");
  reportExternalSteps();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
