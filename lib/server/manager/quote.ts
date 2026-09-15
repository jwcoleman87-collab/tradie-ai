import { z } from 'zod';
import { AppError } from '../errors';
import type { loadTradeIntelligence } from '../trade-intelligence';

export const QuoteInput = z
  .object({
    title: z.string().trim().min(1).max(160),
    scope: z.string().trim().min(1).max(3000),
    hours: z.number().positive().max(200),
    distanceKm: z.number().nonnegative().max(2000),
    includedLocality: z.enum([
      'none',
      'Kingston',
      'Fyshwick',
      'Queanbeyan',
      'Canberra inner',
    ]),
    afterHours: z.boolean(),
    assumptions: z.array(z.string().min(1).max(400)).max(8),
  })
  .strict();

// Read numerical rules from the versioned managed pack, rather than installing
// a second rate card in the model adapter. A changed/unrecognised rule fails
// closed and requires an operator to update the calculator and its tests.
export function calculateManagedQuote(
  pack: Awaited<ReturnType<typeof loadTradeIntelligence>>,
  input: z.infer<typeof QuoteInput>,
) {
  if (!pack.applied) throw new AppError('MANAGED_RATES_UNAVAILABLE', 409);
  const number = (pattern: RegExp) => {
    const raw = pack.instructions.match(pattern)?.[1];
    const value = Number(raw?.replaceAll(',', ''));
    if (!raw || !Number.isFinite(value) || value <= 0)
      throw new AppError('MANAGED_RATE_FORMAT_CHANGED', 503);
    return value;
  };
  const hourly = number(/# 4 Hourly\s+AUD ([\d,.]+) inc GST on site/);
  const minimum = number(/# 3 Minimum charge\s+AUD ([\d,.]+) inc GST/);
  const multiplier = number(/# 5 After-hours\s+([\d.]+)× hourly/);
  const middleTravel = number(/20–50 km: AUD ([\d,.]+)/);
  const farTravel = number(/50–100 km: AUD ([\d,.]+)/);
  const extraKm = number(
    /100\+ km: AUD [\d,.]+ \+ AUD ([\d,.]+) per km after 100/,
  );
  const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const labour = round(
    input.hours * hourly * (input.afterHours ? multiplier : 1),
  );
  const travel =
    input.includedLocality !== 'none' || input.distanceKm <= 20
      ? 0
      : input.distanceKm <= 50
        ? middleTravel
        : input.distanceKm <= 100
          ? farTravel
          : round(farTravel + (input.distanceKm - 100) * extraKm);
  // The pack states a minimum total charge. Surface the formula in the draft.
  const total = round(Math.max(minimum, labour + travel));
  return {
    currency: 'AUD',
    gst: 'included',
    hourly,
    labour,
    travel,
    minimum,
    total,
    formula: 'max(minimum charge, on-site labour + travel)',
    packVersion: pack.version,
    packHash: pack.sha256,
    assumptions: input.assumptions,
    ownerApprovalRequired: true,
    sent: false,
  };
}
