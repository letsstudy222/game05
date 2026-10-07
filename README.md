# Nha Trang City Drive · NT-CITY-02

Bản thử nghiệm lái xe trong một khu phố mô phỏng lấy cảm hứng từ Nha Trang. Chọn **Lái trong thành phố** để bắt đầu trên phố, hoặc **Đi dọc biển** để chạy tuyến Nha Trang → Cù Hin → Bãi Dài → Cam Ranh.

Đây là prototype web độc lập, chưa phải game có quy mô, đồ họa hoặc nội dung tương đương GTA V. Bản NT-CITY-02 ưu tiên mạng đường thành phố, cảm giác lái và xe giao thông; chưa có nhân vật đi bộ, lên/xuống xe, nhiệm vụ hoặc thành phố được khảo sát 1:1.

## Chạy tại máy

Không cần npm, backend hay khóa API. Cần trình duyệt hỗ trợ WebGL2 và kết nối jsDelivr để tải Three.js 0.169.0.

```sh
cd /workspace/game05
python3 -m http.server 8000 --bind 127.0.0.1
```

Phục vụ qua HTTP; mở trực tiếp `index.html` bằng `file://` không hỗ trợ đầy đủ các mô-đun và dữ liệu bản đồ.

## Điều khiển

| Thao tác | Phím |
| --- | --- |
| Ga | W / ↑ |
| Phanh; tiếp tục giữ để lùi | S / ↓ |
| Rẽ trái / phải | A / D, ← / → |
| Phanh tay | Space |
| Đổi góc nhìn theo xe / trong xe / điện ảnh | C |
| Ngày / đêm | N |
| Đưa xe về mặt đường, hướng Cam Ranh | R |
| Bản đồ | M hoặc bấm bản đồ nhỏ |
| Tạm dừng / tiếp tục | Esc |
| Ẩn / hiện hướng dẫn | H |

Điện thoại có các nút giữ ga, phanh và rẽ. Khi mất tiêu điểm hoặc ẩn tab, trò chơi tạm dừng và nhả các nút điều khiển.

Bản đồ lớn hỗ trợ kéo, cuộn, chụm hai ngón, nút +/−, định vị xe và toàn tuyến. Bấm tên chặng để xem vị trí; bấm **Lái từ…** để đưa xe đến chặng đó. Mở bản đồ sẽ tạm dừng xe và giữ lại trạng thái tạm dừng trước đó khi đóng.

## Khu phố và phiên bản

- Một khu phố khoảng 630 × 830 m với bốn đường song song, sáu đường cắt ngang nối đường ven biển, 60 khối nhà và các giao lộ có vạch qua đường/đèn tín hiệu.
- Xe người chơi dùng mô hình **Car Concept** có texture/PBR của Eric Chadwick, Darmstadt Graphics Group GmbH, ©2024, CC BY 4.0; nguồn và thay đổi ghi trong [assets/CREDITS.md](assets/CREDITS.md). Mesh tĩnh được gộp theo vật liệu, bánh xe có pivot quay/lái; kính dùng transparency thay transmission để giảm chi phí dựng hình. Asset local khoảng 11.8 MB, tải trước khi vào game. Xe giao thông dùng mô hình sedan dựng bằng mã; 12 xe giao thông đi theo làn, nhường xe người chơi và giảm tốc trước tín hiệu đỏ trong phố.
- Công trình lấy cảm hứng từ Trầm Hương trên quảng trường ven biển. Đường phố, kiến trúc, đèn tín hiệu và lịch giao thông đều là mô phỏng, không phải dữ liệu hiện trạng.
- Bản đồ nhỏ vẽ đường và khối nhà có thể lái trong game. Bản đồ lớn hiển thị thêm phố mô phỏng khi zoom vào Nha Trang, tách khỏi tuyến địa lý tham chiếu.
- Tài nguyên local và toàn bộ đồ thị import có cùng `?v=nt-city-02`; nhãn NT-CITY-02 xuất hiện trên giao diện. Tăng mã phiên bản của toàn bộ tài nguyên khi phát hành tiếp để tránh trộn module cũ/mới trong cache.

## Đồ họa và chuyển động

- Sáu chặng, các cụm cảnh 400 m được loại bỏ khi ở xa; địa hình, đường, cây và đồ vật được gộp hoặc dùng instancing.
- Biển có chuyển động mặt nước, phản sáng và bọt sóng; bãi cát có vùng ướt, dù và ghế nghỉ. Quán có mái che, bàn ghế, bảng tên; tàu cá có cabin, cột và cờ chuyển động theo sóng.
- Cảnh cầu Bình Tân có cửa nước, trụ và lan can; đoạn Cù Hin có độ cao và đường uốn lượn. Đây là các hình học minh họa.
- Mô phỏng xe ở bước cố định 1/120 giây, nội suy vị trí khi dựng hình, camera và vô-lăng được làm mềm theo thời gian. Đèn hậu sáng khi phanh.
- Menu tạm dừng có chất lượng Cao / Cân bằng / Nhẹ. Cân bằng tự giảm độ phân giải khi tốc độ khung hình thấp; Nhẹ tắt bóng đổ. Không dùng GPU vật lý trong kiểm tra cloud, nên không cam kết FPS trên mọi thiết bị.

## Mức độ chính xác của bản đồ

`data/coastline.geojson` là dữ liệu **bờ biển địa lý thật** trích từ [Natural Earth 1:10m coastline](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_coastline.geojson), public domain, tải ngày 2026-10-07. Tỷ lệ 1:10m nghĩa là **1:10 triệu**, không phải độ chính xác 10 mét. Dữ liệu đã được giản lược; phù hợp bản đồ tổng quan, không phù hợp chỉ đường hoặc dựng công trình đúng kích thước.

`route.js` chứa **tuyến tham chiếu được biên soạn thủ công**, không phải đường trung tâm lấy từ OSM. Khoảng 41 km là tổng đoạn thẳng nối các điểm này, không phải chiều dài tuyến giao thông đã xác minh. Truy vấn OSRM/Overpass bị chính sách mạng của cloud chặn (403); chưa lấy được hình học đường, cao độ DEM, ảnh vệ tinh hoặc mặt tiền công trình.

Cảnh 3D nén chiều dài tuyến thành khoảng 6.4 km và nén ngang theo tỷ lệ khác để tập trung cảnh trong vùng chơi. Bờ biển trong 3D, nhà, cầu, quán, tàu và địa hình đều dựng cách điệu; không phải digital twin hoặc đồ họa ảnh chụp. Bản đồ lớn dùng bờ biển Natural Earth độc lập, luôn ghi rõ tuyến tham chiếu, và cung cấp liên kết đối chiếu OpenStreetMap.

Để dựng chính xác hơn cần thay tuyến thủ công bằng dữ liệu đường OSM có nguồn và giấy phép ODbL, bổ sung DEM cùng tư liệu công trình có quyền sử dụng; sau đó chuyển từ hành lang nén một chiều sang từng đoạn đường 3D theo đường tâm thực.

## Kiểm tra

Trong môi trường cloud đã có Python Playwright và Chromium:

```sh
python3 tests/smoke.py
```

Chạy khi máy chủ HTTP ở trên đang hoạt động. Bài kiểm tra có thể thất bại khi dựng cảnh, điều khiển, phanh/lùi, camera, ngày/đêm, tạm dừng, chuyển chất lượng, zoom/kéo bản đồ hoặc chuyển chặng hỏng. Có kiểm tra desktop và điện thoại, hướng A/D chiếu qua camera, tốc độ trên phố, xe giao thông, lỗi JavaScript và lỗi shader; ảnh kiểm tra lưu ngoài repository tại `/tmp/game05-artifacts`.

Chromium trong cloud có thể không tin CA của proxy HTTPS. Bài kiểm tra chuyển riêng các yêu cầu jsDelivr qua Python HTTPS dùng proxy hiện có và `SSL_CERT_FILE` của môi trường, **giữ nguyên xác minh TLS**. Trình duyệt của người dùng tải CDN bình thường; ứng dụng không chứa proxy hay cơ chế bỏ qua chứng chỉ.

Các kiểm tra hiện dùng Chromium với WebGL phần mềm; chưa kiểm tra Safari, GPU thật hoặc chạy trên thiết bị di động vật lý.
