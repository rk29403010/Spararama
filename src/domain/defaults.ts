import type { SpaDomainState } from './models';

export const DEFAULT_DOMAIN_STATE: SpaDomainState = {
  activeWaterBodyId: 'cleverspa-800',
  activeTestMethodId: 'current-7-way',
  waterBodies: [
    {
      id: 'cleverspa-800',
      name: 'CleverSpa 800 L',
      kind: 'spa',
      volumeLiters: 800,
      sanitizer: 'chlorine',
      connectivity: 'wifi',
      manufacturerId: 'cleverspa',
      manufacturer: 'CleverSpa',
      modelId: 'cleverspa-current-800',
      model: 'Current 800 L Wi-Fi profile',
      modelCapacityLiters: 800,
      connectorId: 'cleverspa',
      doseRounding: 1,
      targets: [
        { measurement: 'free_chlorine', min: 3, max: 5, preferred: 4, unit: 'ppm' },
        { measurement: 'ph', min: 7.2, max: 7.6, preferred: 7.4, unit: 'ph' },
        { measurement: 'total_alkalinity', min: 80, max: 120, preferred: 80, unit: 'ppm' },
        { measurement: 'calcium_hardness', min: 150, max: 500, preferred: 250, unit: 'ppm' },
        { measurement: 'cyanuric_acid', min: 30, max: 50, preferred: 40, unit: 'ppm' }
      ]
    }
  ],
  testMethods: [
    {
      id: 'current-3-way',
      name: 'Current 3-way strips',
      description: 'Quick dip strip currently used with the spa.',
      instructions: [
        { id: 'dip', label: 'Dip the strip in and remove it immediately.', cueAtEnd: true, spokenText: 'Dip and remove.' },
        { id: 'hold', label: 'Hold the strip level and keep the pads facing up.', durationSeconds: 5, cueAtEnd: true },
        { id: 'read', label: 'Read the colours now. Finish before 60 seconds.', spokenText: 'Read the strip now.' }
      ],
      parameters: [
        { measurement: 'free_chlorine', label: 'Free chlorine' },
        { measurement: 'ph', label: 'pH' },
        { measurement: 'total_alkalinity', label: 'Total alkalinity' }
      ],
      readAfterSeconds: 5,
      readBeforeSeconds: 60,
      notes: 'Timing profile is editable because strip brands vary.'
    },
    {
      id: 'current-7-way',
      name: 'Current 7-way strips',
      description: 'Seven-parameter strip currently used with the spa.',
      instructions: [
        { id: 'dip', label: 'Dip the strip and move it through the water for 2 seconds.', durationSeconds: 2, cueAtEnd: true, spokenText: 'Dip and move for two seconds.' },
        { id: 'remove', label: 'Remove the strip and hold it level.', cueAtEnd: true },
        { id: 'wait', label: 'Wait before reading.', durationSeconds: 15, cueAtEnd: true },
        { id: 'read', label: 'Read the colours now. Finish before 60 seconds.', spokenText: 'Read the strip now.' }
      ],
      parameters: [
        { measurement: 'free_chlorine', label: 'Free chlorine' },
        { measurement: 'ph', label: 'pH' },
        { measurement: 'total_alkalinity', label: 'Total alkalinity' },
        { measurement: 'total_chlorine', label: 'Total chlorine' },
        { measurement: 'calcium_hardness', label: 'Total hardness' },
        { measurement: 'cyanuric_acid', label: 'Cyanuric acid' }
      ],
      readAfterSeconds: 15,
      readBeforeSeconds: 60,
      notes: 'Timing profile is editable because strip brands vary.'
    }
  ],
  products: [
    {
      id: 'cleverspa-ta-plus', name: 'Total Alkalinity Increaser', brand: 'CleverSpa', form: 'powder', activeIngredient: 'alkalinity increaser',
      doseModels: [{ kind: 'linear_raise', measurement: 'total_alkalinity', direction: 'raise', amount: 16, unit: 'g', referenceVolumeLiters: 1000, raisesBy: 10 }],
      mixMinutes: 20, circulationRequired: true, notes: 'Label: 16 g raises 1000 L by 10 ppm.'
    },
    {
      id: 'cleverspa-ph-plus', name: 'pH Plus', brand: 'CleverSpa', form: 'powder', activeIngredient: 'pH increaser',
      doseModels: [{ kind: 'fixed_label', measurement: 'ph', direction: 'raise', amount: 11, unit: 'g', referenceVolumeLiters: 1000, note: 'Use one label dose, circulate, then retest rather than assuming a linear pH change.' }],
      mixMinutes: 15, circulationRequired: true
    },
    {
      id: 'cleverspa-ph-minus', name: 'pH Minus', brand: 'CleverSpa', form: 'powder', activeIngredient: 'pH reducer',
      doseModels: [{ kind: 'fixed_label', measurement: 'ph', direction: 'lower', amount: 11, unit: 'g', referenceVolumeLiters: 1000, note: 'Use one label dose, circulate, then retest rather than assuming a linear pH change.' }],
      mixMinutes: 15, circulationRequired: true
    },
    {
      id: 'cleverspa-chlorine-granules', name: 'Stabilised Chlorine Granules', brand: 'CleverSpa', form: 'granules', activeIngredient: 'sodium dichloroisocyanurate dihydrate',
      doseModels: [{ kind: 'linear_raise', measurement: 'free_chlorine', direction: 'raise', amount: 2, unit: 'g', referenceVolumeLiters: 1000, raisesBy: 1 }],
      mixMinutes: 15, circulationRequired: true, notes: 'Label: 2 g raises 1000 L by 1 ppm free chlorine.'
    }
  ],
  equipment: [
    { id: 'cleverspa-filter', name: 'CleverSpa filter cartridge', kind: 'filter', runtimeSeconds: 0 },
    { id: 'cleverspa-heater', name: 'CleverSpa heater', kind: 'heater', runtimeSeconds: 0, metadata: { powerWatts: 1800 } },
    { id: 'cleverspa-controller', name: 'CleverSpa controller', kind: 'controller' }
  ],
  waterTests: [],
  chemicalDoses: [],
  dosingEpisodes: [],
  bathingEpisodes: [],
  maintenanceEvents: []
};

export function createDefaultDomainState(): SpaDomainState {
  return structuredClone(DEFAULT_DOMAIN_STATE);
}
