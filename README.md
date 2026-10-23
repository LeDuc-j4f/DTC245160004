# HRM — Hệ thống Quản lý Nhân sự

> Đề tài thực hành môn **Triển khai và Quản trị Hệ thống Phần mềm** — Đề 10.

Hệ thống quản lý nhân viên, phòng ban và chấm công tự động bằng khuôn mặt. Tích hợp đầy đủ:

- ✅ Ứng dụng web (Frontend + Backend API + AI worker)
- ✅ PostgreSQL 16 + pgvector + pgAdmin
- ✅ Nginx reverse proxy với HTTPS tự ký + security headers
- ✅ Prometheus + Grafana (container, web, DB)
- ✅ Loki + Promtail + LogQL (log tập trung)
- ✅ Hardening: non-root container, network isolation, mật khẩu mạnh, rate limit

## 🏗️ Kiến trúc

```
                    ┌──────────────────────────┐
                    │       Nginx (:80/:443)   │  Reverse proxy + TLS self-signed
                    │  6 security headers      │
                    └──────────┬───────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
  ┌────────────┐         ┌────────────┐         ┌────────────┐
  │  Frontend  │         │  Backend   │ ◄─────► │ AI Worker  │
  │  (Nginx)   │         │  Node.js   │         │ Python     │
  │  :8080     │         │  :3000     │         │ :8000      │
  └────────────┘         └─────┬──────┘         └────────────┘
                              │ pgvector
                              ▼
                     ┌──────────────────┐
                     │  PostgreSQL 16   │
                     │  + pgvector      │
                     │  :5432           │
                     └──────────────────┘
                     ┌──────────────────┐
                     │     pgAdmin      │
                     │     :5050        │
                     └──────────────────┘
```

3 network bridge:
- `hrm_backend`  — backend ↔ db, backend ↔ ai, ai ↔ db
- `hrm_frontend` — nginx ↔ backend, nginx ↔ frontend, nginx ↔ pgadmin
- `hrm_monitor`  — prometheus, grafana, loki, promtail, exporters

## 🚀 Cài đặt nhanh

### Yêu cầu
- Docker Desktop / Docker Engine 24+
- Docker Compose v2
- 4 GB RAM trống (cho AI models)
- 5 GB ổ cứng

### Bước 1 — Clone & chuẩn bị môi trường
```bash
git clone <repo-cua-ban> HRM
cd HRM
cp .env.example .env
# (tuỳ chọn) sửa password trong .env
bash scripts/gen-certs.sh
```

### Bước 2 — Khởi động stack chính
```bash
docker compose up -d --build
```
Stack chính gồm: `db`, `pgadmin`, `ai-worker`, `backend`, `frontend`, `proxy`.

Đợi ~3 phút để build image `ai-worker` (cài InsightFace + tải model buffalo_l ~300MB) lần đầu.

### Bước 3 — Khởi động monitoring + logging
```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

### Bước 4 — Truy cập
| URL | Mô tả |
|---|---|
| **https://localhost** | Reverse proxy chính (HTTPS self-signed, đầy đủ security headers) |
| http://localhost:8080 | Frontend trực tiếp (HTTP) |
| https://localhost/pgadmin/ | Quản trị CSDL pgAdmin 4 (qua reverse proxy) |
| http://localhost:9090 | Prometheus Dashboard |
| http://localhost:3001 | Grafana Monitoring Dashboard |
| http://localhost:3100 | Loki Log Aggregator (API) |

### Danh sách tài khoản hệ thống

| Phân hệ / Vai trò | Username | Password | Quyền hạn / Mục đích |
|---|---|---|---|
| **HRM - Quản trị viên** | `admin` | `Admin@HRM2024!` | Toàn quyền hệ thống, quản lý nhân viên, phòng ban, ca làm việc, xem thống kê |
| **HRM - Nhân sự (HR)** | `hr01` | `Hr@HRM2024!` | Quản lý hồ sơ nhân viên, phòng ban, phân ca làm việc, điểm danh |
| **HRM - Nhân viên** | `nv001` | `Nv@HRM2024!` | Xem thông tin cá nhân và lịch sử chấm công của chính mình |
| **HRM - Máy Chấm Công (Kiosk)** | `chamcong` *(hoặc `kiosk`)* | `Chamcong@2024!` *(hoặc `Kiosk@2024!`)* | **Chuyên dụng cho máy chấm công đặt tại cửa ra vào**. Tự động vào trang chấm công, chặn toàn bộ trang khác |
| **pgAdmin 4** | `admin@hrm.local` | `ChangeMe_PgAdmin_2024!_aB3s` | Quản trị cơ sở dữ liệu PostgreSQL |
| **Grafana** | `admin` | `ChangeMe_Grafana_2024!_gR5t` | Xem dashboard giám sát hệ thống & truy vấn LogQL |

> **Bắt buộc đổi mật khẩu trước khi triển khai môi trường sản xuất thực tế.**

## ✨ Các tính năng nổi bật của hệ thống

1. **Quản lý Nhân sự & Phòng ban**: Thêm mới, chỉnh sửa, xóa mềm (soft delete), lọc theo trạng thái và phòng ban.
2. **Quản lý Ca làm việc (Shifts)**:
   - Hỗ trợ ca chuẩn: Ca hành chính (08:30 - 17:30), Ca sáng (08:00 - 12:00), Ca chiều (13:00 - 17:00), Ca đêm (22:00 - 06:00).
   - Hỗ trợ thêm ca tùy chỉnh và phân ca hàng loạt cho nhiều nhân viên cùng lúc.
3. **Quản lý Nghỉ phép (Leave Management)**:
   - Đăng ký nghỉ phép theo khoảng thời gian (`Từ ngày` - `Đến ngày`).
   - Tự động chuyển nhân viên sang trạng thái nghỉ phép.
   - **Tự động kích hoạt lại**: Hệ thống chạy background job và cron hàng ngày để tự động đưa nhân viên trở lại trạng thái "Đang làm việc" ngay khi hết hạn nghỉ phép.
4. **Chế độ Kiosk Cửa ra vào (Dedicated Kiosk)**:
   - Thiết kế chuyên biệt cho máy tính bảng / màn hình cảm ứng gắn ở cửa ra vào công ty.
   - Khóa thanh điều hướng, chỉ hiển thị giao diện chấm công và lịch sử quẹt thẻ gần đây.
   - Tự động chặn truy cập vào mọi đường dẫn quản lý nhạy cảm.
5. **Dashboard Thống kê Thời gian thực**:
   - Thống kê tỷ lệ Đúng giờ, Đi muộn, Về sớm, Vắng mặt.
   - Nhấp vào từng thẻ số liệu để hiển thị ngay danh sách nhân viên tương ứng.
   - Đồng bộ thời gian thực và bộ lọc đa tiêu chí (ngày tháng, phòng ban, tìm kiếm).

## 🧠 Chấm công tự động bằng khuôn mặt

Hệ thống dùng:
- **YOLOv8-face** (ultralytics) — phát hiện khuôn mặt nhanh, real-time
- **InsightFace ArcFace (buffalo_l)** — embedding 512 chiều
- **pgvector** (PostgreSQL) — tìm kiếm cosine distance cực nhanh

### Ngưỡng nhận diện
Mặc định: `FACE_MATCH_THRESHOLD=0.45` (cosine distance). Có thể chỉnh trong `.env`.

### Quy trình
1. **Vào ca**: gửi ảnh webcam lên `POST /api/attendance/face-check`
   - AI worker trích embedding → backend query nearest employee theo `<=>` (cosine)
   - Nếu khớp (distance ≤ 0.45): ghi `attendance.check_in`
   - Status: `on_time` nếu ≤ 08:35, ngược lại `late`
2. **Tan ca**: lần khớp thứ 2 trong ngày → ghi `attendance.check_out`
   - Status: `on_time` nếu ≥ 17:25, ngược lại `early_leave`
3. **Vắng**: cron lúc 23:00 tự ghi `absent` cho nhân viên không check-in.

### Đăng ký khuôn mặt cho nhân viên mẫu

Đặt ảnh chụp thẳng vào `samples/<employee_code>.jpg` (ví dụ `samples/NV001.jpg`), rồi:
```bash
pip install requests
python scripts/seed_faces.py --api http://localhost/api --user admin --pwd 'Admin@HRM2024!'
```
Script sẽ POST ảnh lên backend để AI worker sinh embedding.

## 📊 Giám sát & Logging

### Prometheus targets
Truy cập http://localhost:9090/targets, kỳ vọng ≥ 4 target UP:
- `prometheus`, `node-exporter`, `cadvisor`, `postgres-exporter`, `hrm-backend`

### Grafana dashboard
Truy cập http://localhost:3001 → Dashboards → HRM → "HRM - System Overview" với 6 panel:
1. Container CPU Usage
2. Container Memory Usage
3. PostgreSQL Connections
4. Database Size
5. Recent backend errors (Loki)
6. Disk usage %

### LogQL queries mẫu (Loki @ http://localhost:3100)

Mở **Grafana → Explore → datasource Loki**, chạy:

1. **Lỗi trong backend**
   ```logql
   {job="hrm-backend"} |= "error"
   ```

2. **Số lượng request theo HTTP status trong 1 giờ qua**
   ```logql
   sum by (status) (count_over_time({job="hrm-proxy"}[1h]))
   ```

3. **Các lần chấm công có độ tin cậy thấp (distance > 0.5)**
   ```logql
   {job="hrm-backend"} |~ "face_check"
   ```
   Hoặc nếu bật JSON log:
   ```logql
   {job="hrm-backend"} | json | distance > 0.5
   ```

## 🔐 Hardening đã áp dụng

| # | Biện pháp | Vị trí |
|---|---|---|
| 1 | Non-root container | `Dockerfile` của mỗi service dùng `USER 1000:1000` / `USER 101:101` |
| 2 | Network isolation | 3 bridge networks: `hrm_frontend`, `hrm_backend`, `hrm_monitor` |
| 3 | Mật khẩu mạnh (bcrypt cost 12) | `db/init.sql` + `backend/src/controllers/auth.controller.js` |
| 4 | Security headers Nginx | `nginx/nginx-proxy.conf` (6+ headers) |
| 5 | Rate limiting | Nginx 10 r/s + Express global 2000/15min + login 50/5min |
| 6 | HTTPS self-signed | `scripts/gen-certs.sh` |
| 7 | SQL injection prevention | 100% parameterized queries (pg) |
| 8 | XSS prevention | Helmet + escape output |
| 9 | File upload validation | multer filter: jpg/png/webp, max 5MB |
| 10 | `no-new-privileges` security_opt | tất cả container trong compose |
| 11 | Resource limits | `deploy.resources.limits` mỗi service |
| 12 | `trust proxy` cho X-Forwarded-For | `server.js` |
| 13 | JWT signing + secret từ env | `middleware/auth.middleware.js` |
| 14 | Log redaction (password/JWT) | `config/logger.js` |
| 15 | CORS whitelist | `server.js` (không `origin: true`) |

## 🗂️ Cấu trúc thư mục

```
HRM/
├── README.md
├── docker-compose.yml
├── docker-compose.monitoring.yml
├── .env.example
├── db/init.sql
├── backend/                # Node.js Express
├── ai-worker/              # Python FastAPI + InsightFace
├── frontend/               # HTML/CSS/JS thuần
├── nginx/                  # Reverse proxy + TLS
├── monitoring/             # Prometheus + Grafana + Loki + Promtail
└── scripts/                # gen-certs, backup, seed_faces
```

## 📋 Kế hoạch 3 commit (yêu cầu của đề bài)

| # | Tên Commit (đơn giản, dễ hiểu) | Nội dung tương ứng trong đề bài |
|---|---|---|
| **1** | `Commit 1: Khoi tao ung dung HRM, co so du lieu PostgreSQL va Nginx Reverse Proxy HTTPS` | Toàn bộ mã nguồn ứng dụng, CSDL PostgreSQL + pgAdmin, Nginx reverse proxy HTTPS. |
| **2** | `Commit 2: Tich hop he thong giam sat Prometheus va Grafana` | Cấu hình Prometheus, exporters thu thập metrics, dashboard Grafana giám sát container và CSDL. |
| **3** | `Commit 3: Tich hop ghi log tap trung Loki, Promtail va bao mat he thong` | Cấu hình Loki, Promtail scrape log, các truy vấn LogQL mẫu và hardening bảo mật hệ thống. |

## 🛠️ Vận hành

### Xem log
```bash
docker compose logs -f backend
docker compose logs -f ai-worker
```

### Backup database
```bash
bash scripts/backup_db.sh
```

### Tắt hệ thống
```bash
docker compose down
```

## 📄 Tài liệu báo cáo & Triển khai

- **Báo cáo tổng hợp môn học (≥ 10 trang)**: Lưu tại `TrienKhai/BaoCao.md`
- **Hướng dẫn chi tiết triển khai trên máy ảo Ubuntu Server**: Lưu tại `TrienKhai/Huong_Dan_Trien_Khai_Ubuntu_Server.md`

## 📜 License

Dự án phục vụ mục đích học tập — Đề tài thực hành môn Triển khai và Quản trị Hệ thống Phần mềm.
