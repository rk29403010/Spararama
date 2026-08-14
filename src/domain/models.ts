export type WaterBodyKind = 'spa' | 'pool';
export type SanitizerSystem = 'chlorine' | 'bromine' | 'salt_chlorine' | 'other';

export type MeasurementKey =
  | 'free_chlorine'
  | 'total_chlorine'
  | 'bromine'
  | 'ph'
  | 'total_alkalinity'
  | 'calcium_hardness'
  | 'cyanuric_acid';

export type ReadingSource = 'manual' | 'camera' | 'photometer' | 'drop_test' | 'imported';

export interface MeasurementReading {
  measurement: MeasurementKey;
  value?: number;
  min?: number;
  max?: number;
  source: ReadingSource;
  confidence?: number;
  note?: string;
}

export interface TargetRange {
  measurement: MeasurementKey;
  min: number;
  max: number;
  preferred?: number;
  unit: 'ppm' | 'ph';
}

export interface WaterBodyProfile {
  id: string;
  name: string;
  kind: WaterBodyKind;
  volumeLiters: number;
  sanitizer: SanitizerSystem;
  connectivity?: 'none' | 'wifi';
  manufacturerId?: string;
  manufacturer?: string;
  modelId?: string;
  model?: string;
  modelCapacityLiters?: number;
  connectorId?: string;
  targets: TargetRange[];
  doseRounding?: number;
}

export interface TestInstructionStep {
  id: string;
  label: string;
  durationSeconds?: number;
  cueAtEnd?: boolean;
  spokenText?: string;
}

export interface TestParameterDefinition {
  measurement: MeasurementKey;
  label: string;
  scaleValues?: number[];
}

export interface TestMethodProfile {
  id: string;
  name: string;
  description?: string;
  instructions: TestInstructionStep[];
  parameters: TestParameterDefinition[];
  readAfterSeconds?: number;
  readBeforeSeconds?: number;
  notes?: string;
}

export type DoseUnit = 'g' | 'ml' | 'tablet' | 'unit';

export interface LinearRaiseDoseModel {
  kind: 'linear_raise';
  measurement: MeasurementKey;
  direction: 'raise';
  amount: number;
  unit: DoseUnit;
  referenceVolumeLiters: number;
  raisesBy: number;
}

export interface FixedLabelDoseModel {
  kind: 'fixed_label';
  measurement: MeasurementKey;
  direction: 'raise' | 'lower';
  amount: number;
  unit: DoseUnit;
  referenceVolumeLiters: number;
  note?: string;
}

export type DoseModel = LinearRaiseDoseModel | FixedLabelDoseModel;

export interface ChemicalProduct {
  id: string;
  name: string;
  brand?: string;
  form: 'granules' | 'liquid' | 'tablet' | 'powder' | 'other';
  activeIngredient?: string;
  doseModels: DoseModel[];
  mixMinutes: number;
  circulationRequired: boolean;
  maxSingleDose?: number;
  notes?: string;
}

export interface EquipmentProfile {
  id: string;
  name: string;
  kind: 'filter' | 'pump' | 'heater' | 'blower' | 'controller' | 'other';
  installedAt?: number;
  runtimeSeconds?: number;
  runtimeUpdatedAt?: number;
  lastCleanedAt?: number;
  lastReplacedAt?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface WaterTestRecord {
  id: string;
  timestamp: number;
  waterBodyId: string;
  testMethodId: string;
  readings: MeasurementReading[];
}

export interface ChemicalDoseEvent {
  id: string;
  timestamp: number;
  waterBodyId: string;
  productId: string;
  amount: number;
  unit: DoseUnit;
  reason?: string;
}

export interface MaintenanceEvent {
  id: string;
  timestamp: number;
  equipmentId?: string;
  type: 'cleaned' | 'replaced' | 'inspected' | 'water_change' | 'other';
  note?: string;
}

export interface SpaDomainState {
  activeWaterBodyId: string;
  activeTestMethodId: string;
  waterBodies: WaterBodyProfile[];
  testMethods: TestMethodProfile[];
  products: ChemicalProduct[];
  equipment: EquipmentProfile[];
  waterTests: WaterTestRecord[];
  chemicalDoses: ChemicalDoseEvent[];
  maintenanceEvents: MaintenanceEvent[];
}

export interface ChemistryFinding {
  measurement?: MeasurementKey;
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface DoseInstruction {
  kind: 'dose';
  productId: string;
  productName: string;
  amount: number;
  unit: DoseUnit;
  measurement: MeasurementKey;
  reason: string;
  mixMinutes: number;
  circulationRequired: boolean;
}

export interface RetestInstruction {
  kind: 'retest';
  measurements: MeasurementKey[];
  reason: string;
}

export interface NoActionInstruction {
  kind: 'none';
  reason: string;
}

export type ChemistryNextAction = DoseInstruction | RetestInstruction | NoActionInstruction;

export interface ChemistryAssessment {
  findings: ChemistryFinding[];
  nextAction: ChemistryNextAction;
}
