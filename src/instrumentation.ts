export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startWatcher } = await import('@/lib/watcher');
  try {
    await startWatcher();
  } catch (err) {
    console.error('[instrumentation] failed to start watcher', err);
  }
}
