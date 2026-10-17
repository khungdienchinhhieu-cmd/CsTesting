import { createApi } from './app';
import { runMigrations } from './migrate';

const runtime = createApi();
void runtime.app;
void (async () => {
  if (runtime.cfg.DATABASE_URL) {
    const applied = await runMigrations(runtime.cfg.DATABASE_URL);
    if (applied.length > 0) console.info('[api] migration đã chạy:', applied.join(', '));
  }
  await runtime.db.init();
  await runtime.listen();
})().catch((err) => {
  console.error('[api] không khởi động được', err);
  process.exit(1);
});
const shutdown = (sig: string) => {
  console.info('[api] tắt', sig);
  void runtime.close().then(() => process.exit(0)).catch(() => process.exit(1));
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
