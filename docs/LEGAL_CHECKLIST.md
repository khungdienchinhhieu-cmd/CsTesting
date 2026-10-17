# LEGAL CHECKLIST — đọc trước khi bật bất kỳ feature flag nào

> Đây **không phải tư vấn pháp lý**. Đây là danh sách hạng mục cần luật sư/chuyên gia tuân thủ xác nhận cho thị trường bạn phát hành. Không mục nào được tự động “đã đạt”.

## Trạng thái mặc định

| Flag | Mặc định | Ghi chú |
|---|---|---|
| `FF_REAL_MONEY_TOPUP` | false | Không có mã nạp tiền thật |
| `FF_LOOT_BOXES` | false | Store từ chối sản phẩm `loot_box` |
| `FF_DIRECT_TRADING` | false | Không có endpoint giao dịch trực tiếp |
| `FF_VOICE_CHAT` | false | Không thu âm, không truyền giọng nói |
| `FF_USER_GENERATED_SKINS` | false | Không upload skin |
| `realMoneyCashout` | **BỊ CẤM** | Không tồn tại trong hệ thống, không được thêm |

API từ chối khởi động nếu flag nhạy cảm bật mà `LEGAL_ACK` chưa bằng `1`; đây chỉ là chốt kỹ thuật, không thay thế phê duyệt pháp lý.

## 1. Tiền ảo & Credits

- [ ] Credits chỉ dùng trong game, **không quy đổi ra tiền/pháp định/tài sản ngoài**, không chuyển nhượng ngoài hệ thống.
- [ ] Điều khoản dịch vụ nêu rõ Credits là giấy phép sử dụng có điều kiện, không phải tài sản; cơ chế hoàn tiền khi đóng cửa dịch vụ.
- [ ] Nếu có bất kỳ kênh mua Credits bằng tiền thật: xác nhận luật người tiêu dùng, hiển thị giá, thuế, refund, chargeback, ví điện tử, xác minh danh tính (nếu bắt buộc).
- [ ] Kiểm tra luật trò chơi/xổ số theo từng quốc gia nếu Credits gắn với cơ chế ngẫu nhiên.

## 2. Chợ vật phẩm

- [ ] Chỉ bán vật phẩm thẩm mỹ; không bán lợi thế gameplay.
- [ ] Chính sách phí, thời gian khóa giao dịch, giới hạn tin đăng hiển thị công khai trước khi người dùng bán.
- [ ] Quy trình xử lý gian lận, tài khoản bị chiếm, hoàn tác giao dịch và khiếu nại.
- [ ] Nghĩa vụ thuế/ghi sổ nếu người chơi nhận giá trị tiền tệ; xác nhận với kế toán.
- [ ] Không tạo thị trường thứ cấp cho tiền tệ hay vật phẩm ngoài hệ thống.

## 3. Người chơi nhỏ tuổi & dữ liệu

- [ ] Xác định độ tuổi tối thiểu, cơ chế đồng ý của phụ huynh nếu cần; không yêu cầu dữ liệu không cần thiết.
- [ ] COPPA/GDPR/CCPA/PDPA: cơ sở pháp lý, quyền xóa/sửa/xuất dữ liệu, thời gian lưu, chuyển dữ liệu qua biên giới.
- [ ] Chính sách quyền riêng tư liệt kê log máy chủ, IP, telemetry; thời hạn lưu; quy trình xử lý sự cố.
- [ ] Kiểm tra telemetry bot: không gắn với dữ liệu cá nhân ngoài mục đích cân bằng.

## 4. Nội dung & IP

- [ ] 100% tên, bản đồ, vũ khí, âm thanh, logo là **gốc**; lưu hồ sơ tác giả/giấy phép cho từng asset (manifest).
- [ ] Không dùng tài sản, nhạc, font, icon hoặc tên thương hiệu của bên thứ ba khi chưa có giấy phép.
- [ ] Asset AI-assisted: xác nhận điều khoản công cụ, quyền thương mại, khai báo trong manifest.
- [ ] Kiểm tra nhãn kiểm duyệt độ tuổi, mô tả bạo lực (không máu me), mua sắm trong game.

## 5. Cộng đồng & an toàn

- [ ] Chat text: bộ lọc, kênh báo cáo, chặn người dùng, lưu log có thời hạn.
- [ ] Nếu bật voice chat: đồng ý ghi âm, kiểm duyệt, chặn theo độ tuổi, xử lý dữ liệu giọng nói.
- [ ] Nếu bật UGC: kiểm duyệt trước khi hiển thị, bản quyền, báo cáo, giới hạn kích thước.
- [ ] Chống quấy rối: block/mute, giới hạn chat, xử lý tên hiển thị.

## 6. Vận hành

- [ ] Điều khoản dịch vụ, chính sách bảo mật, cookie, EULA, chính sách hoàn tiền được công bố trước khi phát hành.
- [ ] Bản quyền phần mềm, giấy phép thư viện mã nguồn mở (three.js MIT, Fastify MIT, v.v.) được liệt kê.
- [ ] Quy trình ứng cứu sự cố, sao lưu, xóa tài khoản, ngừng dịch vụ.
- [ ] Nhãn “BOT” trong mọi chế độ online đã bật; không giả danh người thật.

## 7. Trước khi bật flag

1. Điền checklist này, lưu bằng chứng xác nhận.
2. Đặt `LEGAL_ACK=1` trong môi trường **sau khi** được duyệt.
3. Bật đúng một flag, theo dõi 14 ngày, có kênh báo cáo.
4. Không bật cashout trong bất kỳ trường hợp nào.
