const MICROS_PER_USD = 1_000_000;

export function usdDecimalToMicros(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole ?? "0") * BigInt(MICROS_PER_USD) +
    BigInt(fraction.padEnd(6, "0"));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("usd_amount_too_large");
  }
  return Number(micros);
}

export function microsToUsd(micros: number): number {
  return Math.round(micros) / MICROS_PER_USD;
}

export function microsToUsdDecimal(micros: number): string {
  return (Math.round(micros) / MICROS_PER_USD)
    .toFixed(6)
    .replace(/\.?0+$/, "");
}

export interface FilledSlotShare {
  projectId: string;
  filledSlots: number;
}

export interface PayoutAllocation extends FilledSlotShare {
  allocatedMicros: number;
}

/** Largest-remainder allocation with project ID as the stable tie-breaker. */
export function allocatePayoutMicros(
  totalMicros: number,
  shares: readonly FilledSlotShare[],
): PayoutAllocation[] {
  const eligible = shares.filter((share) => share.filledSlots > 0);
  const totalSlots = eligible.reduce((sum, share) => sum + share.filledSlots, 0);
  if (totalSlots === 0) return [];

  const denominator = BigInt(totalSlots);
  const rows = eligible.map((share) => {
    const numerator = BigInt(totalMicros) * BigInt(share.filledSlots);
    return {
      ...share,
      allocatedMicros: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  let unallocated = totalMicros - rows.reduce((sum, row) => sum + row.allocatedMicros, 0);
  rows.sort((left, right) => {
    if (left.remainder !== right.remainder) return left.remainder > right.remainder ? -1 : 1;
    return left.projectId.localeCompare(right.projectId);
  });
  for (let index = 0; index < unallocated; index += 1) {
    const row = rows[index];
    if (row) row.allocatedMicros += 1;
  }
  return rows
    .map(({ remainder: _remainder, ...row }) => row)
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
}
