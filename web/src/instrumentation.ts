export async function register() {
  if (
    process.env.NEXT_RUNTIME === 'nodejs' &&
    process.env.FAMILYCARD_PROCESSING_ENABLED === 'true'
  ) {
    const { startProcessor } = await import('./lib/processing/scheduler');
    startProcessor();
  }
}
