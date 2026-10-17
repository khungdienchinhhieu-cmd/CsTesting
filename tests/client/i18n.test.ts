import { describe, expect, it } from 'vitest';
import { getLang, setLang, t } from '../../apps/client/src/i18n';

describe('i18n', () => {
  it('mặc định tiếng Việt, dịch sang tiếng Anh theo câu gốc', () => {
    setLang('vi');
    expect(getLang()).toBe('vi');
    expect(t('Chơi với bot')).toBe('Chơi với bot');
    setLang('en');
    expect(getLang()).toBe('en');
    expect(t('Chơi với bot')).toBe('Play with bots');
    expect(t('Cài đặt')).toBe('Settings');
    expect(t('BOMB ĐÃ ĐẶT')).toBe('BOMB PLANTED');
    expect(t('TRIỂN KHAI')).toBe('DEPLOY');
    setLang('vi');
  });

  it('chuỗi chưa có bản dịch được giữ nguyên', () => {
    setLang('en');
    expect(t('Một câu chưa dịch')).toBe('Một câu chưa dịch');
    setLang('vi');
  });

  it('các màn chính đều có bản dịch', () => {
    setLang('en');
    for (const key of [
      'Chơi với bot', 'Chơi online', 'Xem lại trận', 'Kho vũ khí', 'Cài đặt', 'Giới thiệu',
      'Chuẩn bị trận đấu', 'Bắt đầu trận →', 'Tạm dừng', 'Chiến thắng',
      'Địa chỉ máy chủ', 'Kết nối & vào trận →', 'Phụ đề âm thanh', 'Ngôn ngữ',
    ]) {
      expect(t(key), key).not.toBe(key);
    }
    setLang('vi');
  });
});
