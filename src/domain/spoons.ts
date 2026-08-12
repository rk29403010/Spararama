interface SpoonProfile {
  gramsPerTeaspoon: number;
  minimumStepTeaspoons: number;
}

// Approximate bulk-density profiles for the current dry products. The gram dose
// remains authoritative; spoon measures are convenience approximations only.
const SPOON_PROFILES: Record<string, SpoonProfile> = {
  'cleverspa-ta-plus': { gramsPerTeaspoon: 5.0, minimumStepTeaspoons: 0.5 },
  'cleverspa-ph-plus': { gramsPerTeaspoon: 5.0, minimumStepTeaspoons: 0.5 },
  'cleverspa-ph-minus': { gramsPerTeaspoon: 6.65, minimumStepTeaspoons: 0.5 },
  'cleverspa-chlorine-granules': { gramsPerTeaspoon: 4.5, minimumStepTeaspoons: 0.5 }
};

export interface SpoonDose {
  text: string;
  approximateGrams: number;
  teaspoons: number;
}

function formatMeasure(teaspoons: number) {
  let remaining = teaspoons;
  const parts: string[] = [];

  const tablespoons = Math.floor(remaining / 3);
  if (tablespoons > 0) {
    parts.push(`${tablespoons} tbsp`);
    remaining -= tablespoons * 3;
  }
  if (remaining >= 1.5 - 1e-9) {
    parts.push('½ tbsp');
    remaining -= 1.5;
  }
  if (remaining >= 1 - 1e-9) {
    parts.push('1 tsp');
    remaining -= 1;
  }
  if (remaining >= 0.5 - 1e-9) {
    parts.push('½ tsp');
  }

  return parts.join(' + ') || '< ½ tsp';
}

export function spoonDoseForProduct(productId: string, grams: number): SpoonDose | null {
  const profile = SPOON_PROFILES[productId];
  if (!profile || !Number.isFinite(grams) || grams <= 0) return null;

  const rawTeaspoons = grams / profile.gramsPerTeaspoon;
  const step = profile.minimumStepTeaspoons;
  const roundedTeaspoons = Math.max(step, Math.round(rawTeaspoons / step) * step);

  return {
    text: formatMeasure(roundedTeaspoons),
    approximateGrams: Math.round(roundedTeaspoons * profile.gramsPerTeaspoon * 10) / 10,
    teaspoons: roundedTeaspoons
  };
}
