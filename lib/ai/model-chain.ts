/**
 * Model routing primitives (A1).
 *
 * Pure and dependency-free so the fallback/chain logic can be unit-tested
 * without a provider or a database. `lib/ai/model-provider.ts` turns the parsed
 * chain into concrete (provider, model) candidates; `lib/ai/generate.ts` runs
 * them with usage capture and the deterministic fallback at the call site.
 *
 * A role is deliberately coarse (`fast` / `standard` / `reasoning`); the call
 * site never names a model, and swapping a gateway stays config-only.
 */

export type ModelCandidate = {
  /** Gateway id, e.g. "opencode" or the configured fallback provider id. */
  providerId: string;
  /** Provider-specific model id, e.g. "space-bunny-free". */
  modelId: string;
};

export function candidateKey(candidate: ModelCandidate): string {
  return `${candidate.providerId}:${candidate.modelId}`;
}

/**
 * Parse a `provider:model,provider:model` chain from an env var. Entries
 * without a model are dropped; an unset/empty value yields `[fallback]`.
 * Provider ids are lowercased; model ids keep their case.
 */
export function parseModelChain(
  raw: string | undefined | null,
  fallback: ModelCandidate,
): ModelCandidate[] {
  const fallbackList = [fallback];
  if (!raw || !raw.trim()) return fallbackList;

  const parsed: ModelCandidate[] = [];
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf(":");
    // A bare provider name is not enough: we will not guess a model.
    if (separator <= 0) continue;

    const providerId = trimmed.slice(0, separator).trim().toLowerCase();
    const modelId = trimmed.slice(separator + 1).trim();
    if (!providerId || !modelId) continue;
    if (parsed.some((candidate) => candidateKey(candidate) === `${providerId}:${modelId}`)) {
      continue;
    }
    parsed.push({ providerId, modelId });
  }

  return parsed.length > 0 ? parsed : fallbackList;
}

/**
 * Resolve a role's ordered chain, dropping candidates whose provider has no
 * credentials so we never waste an attempt on an unconfigured gateway. Falls
 * back to the raw list when nothing is configured (the caller then reports the
 * heuristic path).
 */
export function modelChainForRole({
  raw,
  fallback,
  isProviderConfigured,
}: {
  raw: string | undefined;
  fallback: ModelCandidate;
  isProviderConfigured: (providerId: string) => boolean;
}): ModelCandidate[] {
  const parsed = parseModelChain(raw, fallback);
  const configured = parsed.filter((candidate) =>
    isProviderConfigured(candidate.providerId),
  );
  return configured.length > 0 ? configured : parsed;
}

export type FallbackAttempt<T> = (
  candidate: ModelCandidate,
  index: number,
) => Promise<T>;

export type FallbackResult<T> = {
  value: T;
  candidate: ModelCandidate;
  /** How many earlier candidates failed before this one succeeded. */
  fallbackDepth: number;
};

export type FallbackFailure = {
  candidate: ModelCandidate;
  error: unknown;
};

/**
 * Try each candidate in order until one resolves. Returns `null` when every
 * candidate fails, which is the signal for the caller to serve its
 * deterministic fallback.
 *
 * `isRetryable` decides whether a failure advances to the next candidate
 * (429/5xx/timeout) or aborts the chain immediately (validation/authz — a
 * different model will not fix a malformed request).
 */
export async function runWithModelFallback<T>({
  candidates,
  attempt,
  isRetryable = () => true,
  onFailure,
}: {
  candidates: readonly ModelCandidate[];
  attempt: FallbackAttempt<T>;
  isRetryable?: (error: unknown) => boolean;
  onFailure?: (failure: FallbackFailure, hasNext: boolean) => void;
}): Promise<FallbackResult<T> | null> {
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    try {
      const value = await attempt(candidate, index);
      return { value, candidate, fallbackDepth: index };
    } catch (error) {
      const hasNext = index < candidates.length - 1;
      onFailure?.({ candidate, error }, hasNext);
      if (!hasNext || !isRetryable(error)) return null;
    }
  }
  return null;
}
