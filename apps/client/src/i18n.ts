/**
 * i18n tối giản: dịch theo câu gốc tiếng Việt, không cần build step.
 * Bản tiếng Anh phủ các màn menu, cài đặt, HUD và thông báo chính; chuỗi động
 * được dịch qua t(), chuỗi tĩnh qua localizeDom().
 */
export type Lang = 'vi' | 'en';

let lang: Lang = 'vi';

const EN: Record<string, string> = {
  // Menu chính
  'Chơi với bot': 'Play with bots',
  'Chơi online': 'Play online',
  'Xem lại trận': 'Watch replays',
  'Kho vũ khí': 'Armory',
  'Cài đặt': 'Settings',
  'Giới thiệu': 'About',
  '// NHIỆM VỤ': '// MISSION',
  '// TRẠNG THÁI': '// STATUS',
  '// 5V5 BOMB DEFUSAL · TRÌNH DUYỆT': '// 5V5 BOMB DEFUSAL · BROWSER',
  '5v5 luật MR12. Đặt hoặc gỡ bom. Kinh tế quyết định vòng đấu. Mọi nội dung là thiết kế gốc, không sử dụng tài sản hay tên gọi của bất kỳ tựa game nào khác.':
    '5v5 MR12 rules. Plant or defuse the bomb. Economy decides the round. All content is original — no assets or names from any other game.',
  'Đang kiểm tra renderer…': 'Checking renderer…',
  'RENDERER: ĐANG KHỞI TẠO': 'RENDERER: INITIALIZING',
  'ORIGINAL TACTICAL FPS · BUILD 0.1': 'ORIGINAL TACTICAL FPS · BUILD 0.1',
  'TACTICAL STRIKE © 2026 · ORIGINAL IP · VER 0.1.0': 'TACTICAL STRIKE © 2026 · ORIGINAL IP · VER 0.1.0',
  'Bản tĩnh GitHub Pages: chơi offline với bot (không cần server).': 'Static GitHub Pages build: play offline with bots (no server needed).',
  'Asset procedural đã sẵn sàng.': 'Procedural assets ready.',
  'Một số asset dùng fallback — xem asset manifest.': 'Some assets use fallbacks — see the asset manifest.',

  // Setup
  'Chuẩn bị trận đấu': 'Match setup',
  'Chọn chế độ, bản đồ và độ khó. Bot luôn được gắn nhãn BOT.': 'Pick mode, map and difficulty. Bots are always labelled BOT.',
  'Chế độ': 'Mode',
  'MR12 · đổi phe giữa hiệp': 'MR12 · sides swap at halftime',
  'Bản đồ': 'Map',
  '3 bản đồ gốc': '3 original maps',
  'Phe của bạn': 'Your side',
  'T · tấn công': 'T · attackers',
  'T · Attacker': 'T · Attacker',
  'CT · Defender': 'CT · Defender',
  'Ngẫu nhiên': 'Random',
  'Quy mô đội': 'Team size',
  'Độ khó bot': 'Bot difficulty',
  'Tên hiển thị': 'Display name',
  'Bắt đầu trận →': 'Start match →',
  'Bản thử nghiệm offline — listen-server chạy trong Web Worker, dùng chung mô phỏng với chế độ online.':
    'Offline build — listen-server runs in a Web Worker and shares the online simulation.',
  'BẠN': 'YOU',
  'Trận đấu': 'Match',
  'GIÂY': 'SECONDS',
  'Vòng': 'Round',
  'bắt đầu': 'started',
  'Đã đổi phím.': 'Keybinding updated.',
  'Không đọc được tệp replay': 'Could not read the replay file',
  'Đã xuất tệp replay.': 'Replay file exported.',
  'Hãy nhập tên hiển thị': 'Please enter a display name',
  'Địa chỉ máy chủ phải bắt đầu bằng ws:// hoặc wss://': 'The server address must start with ws:// or wss://',
  'Đã tháo skin': 'Skin removed',
  'Chẩn đoán renderer': 'Renderer diagnostics',
  'Bomb được đặt tại site': 'Bomb planted at site',
  'Đã nhặt': 'Picked up',
  'Đã mua': 'Bought',
  'Chơi lại': 'Play again',
  'Về menu': 'Back to menu',
  'Tiếp tục': 'Resume',
  'Rời trận': 'Leave match',
  'Tạm dừng': 'Paused',
  'Trận đấu đang tạm dừng cục bộ.': 'The match is paused locally.',
  'TRẬN ĐẤU KẾT THÚC': 'MATCH OVER',
  'Chiến thắng': 'Victory',
  'Thất bại': 'Defeat',
  'Hòa': 'Draw',

  // Online
  'Kết nối máy chủ có thẩm quyền · bot do máy chủ điều khiển · luôn gắn nhãn BOT':
    'Connect to an authoritative server · server-driven bots · always labelled BOT',
  'Địa chỉ máy chủ': 'Server address',
  'MR12 · server quản lý vòng đấu': 'MR12 · server-managed rounds',
  'server chọn': 'server picks',
  'TEAM': 'TEAM',
  'Bot bù vào đội': 'Bots per team',
  '2 mỗi bên': '2 per side',
  'chỉ người thật': 'humans only',
  'Mã phòng (tùy chọn)': 'Room code (optional)',
  'để trống = phòng mới': 'leave empty = new room',
  'Kết nối & vào trận →': 'Connect & join →',
  'Kết nối máy chủ…': 'Connecting to server…',
  'Đang kết nối máy chủ…': 'Connecting to server…',
  'Bản GitHub Pages là tĩnh: chỉ chơi offline. Muốn online, nhập': 'This GitHub Pages build is static: offline only. For online, enter',
  'của một máy chủ Node đang chạy.': 'from a running Node server.',

  // Replay
  'Replay lưu seed + input, phát lại bằng cùng mô phỏng 64 Hz — tất định với bot.':
    'Replays store the seed + inputs and replay them on the same 64 Hz simulation — deterministic with bots.',
  'Chưa có replay. Chơi một trận offline; khi trận kết thúc, bản ghi được lưu tự động (tối đa 3 trận gần nhất, mỗi bản ≤ 2 MB).':
    'No replays yet. Play an offline match; when it ends the recording is saved automatically (last 3 matches, ≤ 2 MB each).',
  'Xem': 'Watch',
  'Xóa': 'Delete',
  'Xuất': 'Export',
  'Nhập tệp': 'Import file',
  'Tốc độ': 'Speed',
  'Đang phát lại': 'Replay',

  // Settings
  'Thay đổi được lưu cục bộ. Preset đồ hoạ không thay đổi độ che khuất của khói hay độ chói flash.':
    'Changes are saved locally. Graphics presets never change smoke opacity or flash intensity.',
  '// ĐỒ HOẠ': '// GRAPHICS',
  '// ÂM THANH': '// AUDIO',
  '// GIAO DIỆN': '// INTERFACE',
  '// TRỢ NĂNG': '// ACCESSIBILITY',
  '// DỮ LIỆU': '// DATA',
  'Độ nhạy chuột': 'Mouse sensitivity',
  'Độ nhạy khi scope': 'Scoped sensitivity',
  'Đảo trục Y': 'Invert Y axis',
  'Fairness: độ dày/độ mờ khói, thời gian flash và hitbox giống nhau ở mọi preset.':
    'Fairness: smoke thickness/opacity, flash duration and hitboxes are identical across all presets.',
  'Master': 'Master',
  'Hiệu ứng': 'Effects',
  'Môi trường': 'Ambience',
  'Âm thanh được tổng hợp bằng WebAudio — không dùng file ngoài.': 'Audio is synthesised with WebAudio — no external files.',
  'Màu tâm ngắm': 'Crosshair color',
  'Khoảng hở tâm': 'Crosshair gap',
  'Hiện FPS': 'Show FPS',
  'Giảm chuyển động': 'Reduce motion',
  'Bảng màu mù màu': 'Colorblind palette',
  'Mặc định (vàng/lam)': 'Default (amber/blue)',
  'Phụ đề âm thanh': 'Sound subtitles',
  'Tương phản cao': 'High contrast',
  'Cỡ HUD': 'HUD scale',
  'Phụ đề mô tả tiếng súng/bước chân theo hướng tương đối. Preset đồ hoạ không ảnh hưởng các trợ năng này.':
    'Subtitles describe gunshots/footsteps by relative direction. Graphics presets do not affect these accessibility options.',
  'Ngôn ngữ': 'Language',
  'Đổi ngôn ngữ sẽ tải lại trang.': 'Changing language reloads the page.',
  'Đặt lại cài đặt': 'Reset settings',
  'Xoá hồ sơ': 'Delete profile',
  'Hồ sơ cục bộ:': 'Local profile:',
  'Credits:': 'Credits:',
  'Skin sở hữu:': 'Owned skins:',
  '// PHÍM TẮT': '// KEYBINDS',
  'Nhấn phím mới… (Esc để hủy)': 'Press a new key… (Esc to cancel)',
  'Trùng phím — đã gỡ phím cũ.': 'Duplicate key — the old binding was cleared.',
  'Đã đặt lại phím mặc định.': 'Keybinds reset to defaults.',
  'Đặt lại phím': 'Reset keybinds',
  'Bật': 'On',
  'Tắt': 'Off',

  // About
  '// NGUYÊN TẮC NỘI DUNG': '// CONTENT PRINCIPLES',
  '// CHECKLIST TRƯỚC KHI BẬT FLAG': '// CHECKLIST BEFORE ENABLING FLAGS',
  'TACTICAL STRIKE là IP gốc. Toàn bộ tên gọi, bản đồ, vũ khí, skin, âm thanh và mô hình đều do dự án tạo ra. Không sử dụng tài sản, logo, bản đồ, âm thanh hay tên nhân vật từ bất kỳ trò chơi nào khác.':
    'TACTICAL STRIKE is original IP. All names, maps, weapons, skins, audio and models are created by this project. No assets, logos, maps, audio or character names from any other game are used.',
  'Art hiện tại là procedural placeholder có watermark trong asset manifest; thay thế bằng asset cuối trước khi phát hành thương mại. Xem':
    'Current art is procedural placeholders watermarked in the asset manifest; replace it with final art before a commercial release. See',
  'Tiền tệ trong game là': 'The in-game currency is',
  'không quy đổi tiền thật. Các tính năng nạp tiền thật, loot box, giao dịch trực tiếp, voice chat và skin do người dùng tạo đang':
    'and is not convertible to real money. Real-money top-up, loot boxes, direct trading, voice chat and user-generated skins are',
  'Xác minh yêu cầu pháp lý tại quốc gia phát hành': 'Verify legal requirements in the release country',
  'Điều khoản dịch vụ + chính sách riêng tư đã duyệt': 'Terms of service + privacy policy approved',
  'Hệ thống thanh toán, hoàn tiền, thuế và KYC (nếu áp dụng)': 'Payments, refunds, tax and KYC (if applicable)',
  'Giới hạn độ tuổi, hiển thị tỷ lệ và bảo vệ người chơi': 'Age limits, odds disclosure and player protection',
  'Nhật ký giao dịch, chống gian lận, xử lý tranh chấp': 'Transaction logs, anti-fraud and dispute handling',
  'Kiểm thử tải và giám sát trước khi mở': 'Load testing and monitoring before launch',
  'Đây là danh sách cần kiểm tra, không phải tư vấn pháp lý.': 'This is a checklist to verify, not legal advice.',
  'FLAGS BẬT': 'FLAGS ON',
  'GIAO DỊCH THẬT': 'REAL TRANSACTIONS',
  'TACTICAL STRIKE · bản dựng 0.1.0': 'TACTICAL STRIKE · build 0.1.0',
  '← Quay lại': '← Back',

  // HUD / in-game
  'ĐÃ MUA': 'PURCHASED',
  'KHÔNG ĐỦ TIỀN': 'NOT ENOUGH CREDITS',
  'NGOÀI THỜI GIAN MUA': 'BUY TIME OVER',
  'KHÔNG THỂ MUA': 'CANNOT BUY',
  'BOMB ĐÃ ĐẶT': 'BOMB PLANTED',
  'BOMB ĐÃ GỠ': 'BOMB DEFUSED',
  'CT GIÀNH CHIẾN THẮNG VÒNG': 'CT WINS THE ROUND',
  'VÒNG THẮNG': 'ROUND WON',
  'VÒNG THUA': 'ROUND LOST',
  'TRIỂN KHAI': 'DEPLOY',
  'CHUẨN BỊ VÀO TRẬN': 'GET READY',
  'REPLAY': 'REPLAY',
  'PHÁT LẠI TRẬN ĐẤU · KHÔNG NHẬN INPUT': 'MATCH PLAYBACK · NO INPUT',
  'Bot được gắn nhãn BOT. Nhấn TAB để xem bảng điểm, B để mua.': 'Bots are labelled BOT. Press TAB for the scoreboard, B to buy.',
  'Chế độ xem lại: mô phỏng chạy lại từ seed và input đã ghi.': 'Replay mode: the simulation runs again from the recorded seed and inputs.',
  'Đã lưu replay trận vừa rồi.': 'Replay of the last match saved.',
  'Không lưu được replay (bộ nhớ đầy hoặc dữ liệu lỗi).': 'Could not save the replay (storage full or invalid data).',
  'Mất kết nối — đang thử lại.': 'Connection lost — retrying.',
  'Đã kết nối lại máy chủ.': 'Reconnected to the server.',
  'Đã kết nối lại máy chủ. ': 'Reconnected to the server. ',
  'BOMB ĐÃ ĐẶT ': 'BOMB PLANTED ',
};

export function setLang(next: Lang): void {
  lang = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function getLang(): Lang { return lang; }

/** Dịch một câu tiếng Việt sang ngôn ngữ hiện tại (fallback: giữ nguyên). */
export function t(vi: string): string {
  return lang === 'en' ? (EN[vi] ?? vi) : vi;
}

const ATTRS = ['placeholder', 'title', 'aria-label'] as const;

/**
 * Duyệt DOM đã render và dịch các text node/attribute khớp từ điển.
 * Chỉ chạy khi đang ở tiếng Anh; gọi lại sau mỗi lần render động.
 */
export function localizeDom(root: Element): void {
  if (lang !== 'en') return;
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const value = node.nodeValue ?? '';
    const trimmed = value.trim();
    if (trimmed) {
      const hit = EN[trimmed];
      if (hit !== undefined) node.nodeValue = value.replace(trimmed, hit);
    }
    node = walker.nextNode();
  }
  const elements = root.matches('*') ? [root, ...Array.from(root.querySelectorAll('*'))] : Array.from(root.querySelectorAll('*'));
  for (const el of elements) {
    for (const attr of ATTRS) {
      const v = el.getAttribute(attr);
      if (!v) continue;
      const hit = EN[v.trim()];
      if (hit !== undefined) el.setAttribute(attr, hit);
    }
  }
}
