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
| **https://localhost** | Reverse proxy (HTTPS self-signed) |
| http://localhost:8080 | Frontend (HTTP) |
| https://localhost/pgadmin/ | pgAdmin (qua proxy) |
| http://localhost:9090 | Prometheus |
| http://localhost:3001 | Grafana |
| http://localhost:3100 | Loki (API) |

### Tài khoản mặc định

| Service | Username | Password |
|---|---|---|
| HRM | `admin` | `Admin@HRM2024!` |
| HRM | `hr01` | `Hr@HRM2024!` |
| HRM | `nv001` | `Nv@HRM2024!` |
| pgAdmin | `admin@hrm.local` | `ChangeMe_PgAdmin_2024!_aB3s` |
| Grafana | `admin` | `ChangeMe_Grafana_2024!_gR5t` |

> **Bắt buộc đổi mật khẩu trước khi triển khai thật.**

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

| # | Commit message | Nội dung |
|---|---|---|
| 1 | `feat: initial HRM stack + Nginx reverse proxy` | Toàn bộ source + docker-compose + Nginx HTTPS. |
| 2 | `feat: monitoring (Prometheus + Grafana) + hardening` | `docker-compose.monitoring.yml`, exporters, security headers, non-root. |
| 3 | `feat: central logging (Loki + Promtail) + LogQL` | Loki config, Promtail scrape, 3 query LogQL mẫu. |

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

## 📄 Báo cáo

Xem file `BaoCao.md` để có báo cáo tổng hợp ≥ 10 trang theo yêu cầu môn học.

## 📜 License

Dự án phục vụ mục đích học tập — Đề tài thực hành môn Triển khai và Quản trị Hệ thống Phần mềm.
