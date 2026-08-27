import 'dotenv/config';
import { createMerossMsh300SensorSource } from '../server/sensors/meross-msh300';

async function main() {
  const source = createMerossMsh300SensorSource();
  if (!source) {
    throw new Error('Set MEROSS_MSH300_HOST in the untracked local .env first; MEROSS_MSH300_KEY is optional.');
  }
  const readings = await source.read();
  if (!readings.length) throw new Error('The MSH300 replied, but it returned no MS100 readings.');
  console.log(JSON.stringify({
    hub: source.config.endpoint.host,
    readings: readings.map(reading => ({
      id: reading.id,
      deviceId: reading.deviceId,
      location: reading.location,
      kind: reading.kind,
      value: reading.value,
      unit: reading.unit,
      observedAt: reading.observedAt ? new Date(reading.observedAt).toISOString() : undefined
    }))
  }, null, 2));
}

main().catch((error: any) => {
  console.error(`Meross probe failed: ${error?.message || String(error)}`);
  process.exitCode = 1;
});
