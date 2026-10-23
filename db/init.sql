-- ============================================================================
-- HRM - Initial database schema
-- Extensions: pgvector (for ArcFace face embeddings)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Enums
-- ============================================================================
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'hr', 'employee', 'kiosk');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE employee_status AS ENUM ('active', 'terminated', 'on_leave');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE attendance_status AS ENUM ('on_time', 'late', 'early_leave', 'absent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE attendance_method AS ENUM ('face', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- users
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(64)  NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role    NOT NULL DEFAULT 'employee',
    employee_id     INTEGER,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_employee_id ON users(employee_id);

-- ============================================================================
-- departments
-- ============================================================================
CREATE TABLE IF NOT EXISTS departments (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- shifts (ca làm việc)
-- ============================================================================
CREATE TABLE IF NOT EXISTS shifts (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(128) NOT NULL UNIQUE,
    work_start  VARCHAR(8)   NOT NULL,
    work_end    VARCHAR(8)   NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- employees
-- ============================================================================
CREATE TABLE IF NOT EXISTS employees (
    id                SERIAL PRIMARY KEY,
    employee_code     VARCHAR(32)  NOT NULL UNIQUE,
    full_name         VARCHAR(128) NOT NULL,
    email             VARCHAR(128) UNIQUE,
    phone             VARCHAR(20),
    department_id     INTEGER REFERENCES departments(id) ON DELETE SET NULL,
    position          VARCHAR(64),
    hire_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    status            employee_status NOT NULL DEFAULT 'active',
    leave_start       DATE,
    leave_end         DATE,
    work_start        VARCHAR(8) NOT NULL DEFAULT '08:30',
    work_end          VARCHAR(8) NOT NULL DEFAULT '17:30',
    shift_name        VARCHAR(64) NOT NULL DEFAULT 'Ca ngày (08:30 - 17:30)',
    face_embedding    VECTOR(512),
    face_image_path   VARCHAR(255),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employees_dept ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_face_embedding
    ON employees USING ivfflat (face_embedding vector_cosine_ops)
    WITH (lists = 100);

ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_employee;
ALTER TABLE users ADD CONSTRAINT fk_users_employee
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL;

-- ============================================================================
-- attendance
-- ============================================================================
CREATE TABLE IF NOT EXISTS attendance (
    id                SERIAL PRIMARY KEY,
    employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    date              DATE    NOT NULL,
    check_in          TIMESTAMPTZ,
    check_out         TIMESTAMPTZ,
    status            attendance_status NOT NULL DEFAULT 'on_time',
    check_in_status   VARCHAR(32) DEFAULT 'on_time',
    check_out_status  VARCHAR(32),
    check_in_method   attendance_method,
    check_out_method  attendance_method,
    confidence_in     NUMERIC(5,4),
    confidence_out    NUMERIC(5,4),
    note              TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status ON attendance(status);

-- ============================================================================
-- audit_log
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action      VARCHAR(64) NOT NULL,
    entity      VARCHAR(64) NOT NULL,
    entity_id   INTEGER,
    payload     JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- ============================================================================
-- updated_at trigger
-- ============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_departments_updated_at ON departments;
CREATE TRIGGER trg_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Seed data
-- ============================================================================
INSERT INTO departments (name, description) VALUES
    ('Phòng Kỹ thuật',   'Phát triển phần mềm, DevOps, AI'),
    ('Phòng Nhân sự',    'HR, tuyển dụng, đào tạo'),
    ('Phòng Kinh doanh', 'Sales, marketing, CSKH'),
    ('Phòng Kế toán',    'Tài chính, kế toán, thuế')
ON CONFLICT (name) DO NOTHING;

INSERT INTO employees (employee_code, full_name, email, phone, department_id, position, hire_date, status) VALUES
    ('NV001', 'Nguyễn Văn An',  'an.nv@hrm.local',   '0901000001',
        (SELECT id FROM departments WHERE name='Phòng Kỹ thuật'),   'Backend Dev',   '2023-01-15', 'active'),
    ('NV002', 'Trần Thị Bình',  'binh.tt@hrm.local', '0901000002',
        (SELECT id FROM departments WHERE name='Phòng Nhân sự'),    'HR Specialist', '2023-03-20', 'active'),
    ('NV003', 'Lê Văn Cường',   'cuong.lv@hrm.local','0901000003',
        (SELECT id FROM departments WHERE name='Phòng Kinh doanh'), 'Sales Lead',    '2022-11-01', 'active'),
    ('NV004', 'Phạm Thị Dung',  'dung.pt@hrm.local', '0901000004',
        (SELECT id FROM departments WHERE name='Phòng Kế toán'),    'Accountant',    '2024-02-10', 'active'),
    ('NV005', 'Hoàng Văn Em',   'em.hv@hrm.local',   '0901000005',
        (SELECT id FROM departments WHERE name='Phòng Kỹ thuật'),   'Frontend Dev',  '2024-05-05', 'active')
ON CONFLICT (employee_code) DO NOTHING;

-- Default users
--   admin = Admin@HRM2024!
--   hr01  = Hr@HRM2024!
--   nv001 = Nv@HRM2024!
INSERT INTO users (username, password_hash, role, employee_id) VALUES
    ('admin', '$2a$12$WdetURtFxQrIT0QVA9Y86OTFKX.98hwYL7fRMPJu7FD8Uc25jFA9u', 'admin',    NULL),
    ('hr01',  '$2a$12$l6H7VMTZBid.emrBa3IWU.5kSlrqOFb58wcC1PMcxAKAABvqX9xCu', 'hr',
        (SELECT id FROM employees WHERE employee_code='NV002')),
    ('nv001', '$2a$12$v1v5644HG6c..AP8bqsVTuXa0fPD2jTogN721hyIVCXZ.C10Hrigy', 'employee',
        (SELECT id FROM employees WHERE employee_code='NV001')),
    ('chamcong', '$2a$10$h3Ify4dymKq6ZzII/n8/OevQi1K6v2Bad8yOsTwsA.1P0lbNiuv7K', 'kiosk', NULL),
    ('kiosk',    '$2a$10$MbhvcR4m8QKTOz0EVF4vsOGOKcMM15LsUTznU6JXi/Igmn31WzuW2', 'kiosk', NULL)
ON CONFLICT (username) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    role = EXCLUDED.role,
    employee_id = EXCLUDED.employee_id;
