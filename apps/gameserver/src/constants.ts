// Các hằng số chỉ dùng phía server; giữ tách khỏi mô phỏng dùng chung.
export const ROOM_TOKEN_SECRET = process.env.ROOM_TOKEN_SECRET ?? '';
export const MAX_MESSAGE_BYTES = 4096;
export const RATE_LIMIT_PER_SEC = 180;
