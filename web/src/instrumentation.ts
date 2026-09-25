export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.FAMILYCARD_PROCESSING_ENABLED === 'true'
  ) {
    const { startProcessor } = await import('./lib/processing/scheduler');
    startProcessor();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.FAMILYCARD_ALERTS_ENABLED === 'true') {
    const { startAlerts } = await import('./lib/alerts/scheduler');
    startAlerts();
  }
}
