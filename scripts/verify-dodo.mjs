#!/usr/bin/env node
/**
 * Verify the Dodo Payments configuration that `lib/billing` will use.
 *
 *   node --env-file=.env scripts/verify-dodo.mjs
 *   node --env-file=deploy/app.env scripts/verify-dodo.mjs
 *
 * Read-only. It prints product names/prices and webhook URLs, never a key.
 * Exit 0 means the five products, the webhook endpoint, and the mode flags are
 * consistent. Run it on the workstation before rendering, then against the
 * host's `deploy/app.env` after a release.
 */

const API = {
  test_mode: "https://test.dodopayments.com",
  live_mode: "https://live.dodopayments.com",
};

const key = process.env.DODO_PAYMENTS_API_KEY?.trim();
const webhookKey = process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim();
const requestedMode =
  process.env.DODO_PAYMENTS_ENVIRONMENT === "live_mode" &&
  process.env.DODO_LIVE_MODE_ENABLED === "true"
    ? "live_mode"
    : "test_mode";

const products = {
  DODO_PRODUCT_MONTHLY: { recurring: true, cents: 2500, interval: "Month" },
  DODO_PRODUCT_YEARLY: { recurring: true, cents: 24000, interval: "Year" },
  DODO_PRODUCT_CREDITS_STARTER: { recurring: false, cents: 1000 },
  DODO_PRODUCT_CREDITS_PLUS: { recurring: false, cents: 2000 },
  DODO_PRODUCT_CREDITS_PRO: { recurring: false, cents: 5000 },
};

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

async function api(path) {
  const response = await fetch(`${API[requestedMode]}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep the status; a non-JSON body is not useful here.
  }
  return { status: response.status, body };
}

async function main() {
  if (!key) fail("DODO_PAYMENTS_API_KEY is not set");
  if (!webhookKey) fail("DODO_PAYMENTS_WEBHOOK_KEY is not set");

  if (requestedMode === "test_mode") {
    warn(
      "Dodo is in TEST MODE. This configuration cannot take real money. " +
        "Set DODO_PAYMENTS_ENVIRONMENT=live_mode and DODO_LIVE_MODE_ENABLED=true " +
        "with live credentials.",
    );
  }
  if (
    requestedMode === "live_mode" &&
    process.env.ALLOW_TEST_CHECKOUT_IN_PRODUCTION === "true"
  ) {
    fail("ALLOW_TEST_CHECKOUT_IN_PRODUCTION=true on a live deployment");
  }

  if (!key) {
    report();
    return;
  }

  console.log(`Dodo environment: ${requestedMode}`);
  console.log(`API:              ${API[requestedMode]}`);

  for (const [envName, expected] of Object.entries(products)) {
    const id = process.env[envName]?.trim();
    if (!id) {
      fail(`${envName} is not set`);
      continue;
    }
    const { status, body } = await api(`/products/${encodeURIComponent(id)}`);
    if (status !== 200 || !body) {
      fail(`${envName}=${id}: HTTP ${status}`);
      continue;
    }

    const price = body.price ?? {};
    const recurring = body.is_recurring === true;
    const interval = price.payment_frequency_interval ?? null;
    const amount = price.price ?? null;

    const problems = [];
    if (recurring !== expected.recurring) {
      problems.push(`recurring=${recurring}, expected ${expected.recurring}`);
    }
    if (amount !== expected.cents) {
      problems.push(`price=${amount}, expected ${expected.cents} (cents)`);
    }
    if (expected.recurring && interval !== expected.interval) {
      problems.push(`interval=${interval}, expected ${expected.interval}`);
    }
    if (price.currency && price.currency !== "USD") {
      problems.push(`currency=${price.currency}, expected USD`);
    }

    if (problems.length) {
      fail(`${envName} (${body.name ?? id}): ${problems.join("; ")}`);
    } else {
      console.log(
        `  ok  ${envName.padEnd(32)} ${body.name ?? id} (${id})`,
      );
    }
  }

  const hooks = await api("/webhooks?limit=100");
  if (hooks.status !== 200 || !hooks.body) {
    fail(`webhooks list: HTTP ${hooks.status}`);
  } else {
    const items = hooks.body.items ?? hooks.body.data ?? [];
    const match = items.find((hook) =>
      String(hook.url ?? "").endsWith("/api/webhooks/dodo"),
    );
    if (!match) {
      fail("no webhook endpoint ending in /api/webhooks/dodo");
    } else if (match.disabled) {
      fail(`webhook ${match.id} is disabled`);
    } else {
      console.log(`  ok  webhook ${match.url} (${match.id})`);
    }
    const expectedEvents = [
      "subscription.active",
      "subscription.renewed",
      "subscription.cancelled",
      "payment.succeeded",
      "payment.failed",
    ];
    const filters = Array.isArray(match?.filter_types) ? match.filter_types : [];
    if (filters.length) {
      const missing = expectedEvents.filter((event) => !filters.includes(event));
      if (missing.length) {
        warn(`webhook filter is missing: ${missing.join(", ")}`);
      }
    }
  }

  report();
}

function report() {
  for (const message of warnings) console.warn(`WARN  ${message}`);
  for (const message of failures) console.error(`FAIL  ${message}`);
  if (failures.length) {
    console.error(`\n${failures.length} failure(s). Billing is not ready.`);
    process.exitCode = 1;
  } else {
    console.log("\nDodo billing configuration is valid for this mode.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
