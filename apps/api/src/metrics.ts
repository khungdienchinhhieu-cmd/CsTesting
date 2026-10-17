import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

export function createApiMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'tactical_api_' });
  return {
    registry,
    registrations: new Counter({ name: 'tactical_api_registrations_total', help: 'Số tài khoản tạo mới', registers: [registry] }),
    loginFailures: new Counter({ name: 'tactical_api_login_failures_total', help: 'Số lần đăng nhập thất bại', registers: [registry] }),
    storePurchases: new Counter({ name: 'tactical_api_store_purchases_total', help: 'Số giao dịch cửa hàng', registers: [registry] }),
    marketTrades: new Counter({ name: 'tactical_api_market_trades_total', help: 'Số giao dịch chợ', registers: [registry] }),
  };
}
