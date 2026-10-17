import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'tactical_' });

export const roomsGauge = new Gauge({
  name: 'tactical_rooms_active', help: 'Số phòng đang hoạt động', registers: [registry],
});
export const playersGauge = new Gauge({
  name: 'tactical_players_connected', help: 'Số người chơi đang kết nối', registers: [registry],
});
export const ticksCounter = new Counter({
  name: 'tactical_sim_ticks_total', help: 'Tổng số tick mô phỏng đã chạy', registers: [registry],
});
export const snapshotsCounter = new Counter({
  name: 'tactical_snapshots_sent_total', help: 'Tổng số snapshot đã gửi', registers: [registry],
});
export const tickLagHistogram = new Histogram({
  name: 'tactical_tick_lag_ms', help: 'Độ trễ vòng lặp tick (ms)', buckets: [0.5, 1, 2, 4, 8, 16, 33, 66], registers: [registry],
});
export const rejectedCounter = new Counter({
  name: 'tactical_messages_rejected_total', help: 'Tin nhắn bị từ chối', labelNames: ['reason'], registers: [registry],
});
