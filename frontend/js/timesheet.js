// js/timesheet.js - Monthly Timesheet Dashboard per Employee
(async () => {
    if (!API.requireAuth()) return;
    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    // DOM Elements
    const filterMonth        = document.getElementById('filterMonth');
    const filterDept         = document.getElementById('filterDept');
    const filterSearch       = document.getElementById('filterSearch');
    const btnReload          = document.getElementById('btnReload');
    const btnPrintTimesheet  = document.getElementById('btnPrintTimesheet');
    const timesheetBody      = document.getElementById('timesheetBody');
    const timesheetSubtitle  = document.getElementById('timesheetSubtitle');



    // Modal Elements
    const detailModal        = document.getElementById('detailModal');
    const btnCloseDetailModal = document.getElementById('btnCloseDetailModal');
    const btnCloseDetailModalBottom = document.getElementById('btnCloseDetailModalBottom');
    const btnPrintEmpDetail  = document.getElementById('btnPrintEmpDetail');
    const modalEmpTitle      = document.getElementById('modalEmpTitle');
    const modalEmpSubtitle   = document.getElementById('modalEmpSubtitle');
    const mBannerCode        = document.getElementById('mBannerCode');
    const mBannerName        = document.getElementById('mBannerName');
    const mBannerDept        = document.getElementById('mBannerDept');
    const mBannerShift       = document.getElementById('mBannerShift');
    const mStatWork          = document.getElementById('mStatWork');
    const mStatLeave         = document.getElementById('mStatLeave');
    const mStatLate          = document.getElementById('mStatLate');
    const mStatEarly         = document.getElementById('mStatEarly');
    const mStatAbsent        = document.getElementById('mStatAbsent');
    const dailyBody          = document.getElementById('dailyBody');

    // Parse URL params
    const urlParams = new URLSearchParams(window.location.search);
    const paramMonth = urlParams.get('month');
    const paramEmpId = urlParams.get('employee_id');

    // Initialize month picker
    const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
    const curYearMonth = localNow.toISOString().slice(0, 7);
    filterMonth.value = paramMonth && /^\d{4}-\d{2}$/.test(paramMonth) ? paramMonth : curYearMonth;

    let cachedEmployees = [];

    // Load Department options
    async function loadDepartments() {
        try {
            const r = await API.get('/departments');
            const depts = r.data || [];
            depts.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = d.name;
                filterDept.appendChild(opt);
            });
        } catch (err) {
            console.error('Failed to load departments:', err);
        }
    }

    // Render Employee Table Rows
    function renderTable(emps) {
        if (!emps || emps.length === 0) {
            timesheetBody.innerHTML = '<tr><td colspan="11" class="muted" style="text-align:center;padding:28px;">Không tìm thấy nhân viên nào phù hợp với bộ lọc.</td></tr>';
            return;
        }

        timesheetBody.innerHTML = '';
        emps.forEach((e, idx) => {
            const tr = document.createElement('tr');
            const totalWorkStandard = e.total_working_days || 22;

            tr.innerHTML = `
                <td style="text-align:center;color:#6b7280;font-weight:500;">${idx + 1}</td>
                <td><strong>${API.escapeHtml(e.employee_code)}</strong></td>
                <td>
                    <div style="font-weight:600;color:#111827;">${API.escapeHtml(e.full_name)}</div>
                    ${e.status === 'on_leave' ? '<span class="badge badge-leave" style="font-size:0.75em;">Nghỉ phép</span>' : ''}
                </td>
                <td>${API.escapeHtml(e.department_name || '-')}</td>
                <td><span class="badge badge-shift" style="font-size:0.8em;">${API.escapeHtml(e.shift_name || 'Ca chuẩn')}</span></td>
                <td style="text-align:center;">
                    <span class="badge badge-on-time" style="font-weight:600;">
                        ${e.work_days} ngày
                    </span>
                </td>
                <td style="text-align:center;">
                    ${e.leave_days > 0 ? `<span class="badge badge-leave" style="font-weight:600;">${e.leave_days} ngày</span>` : '<span class="muted">0</span>'}
                </td>
                <td style="text-align:center;">
                    ${e.absent_days > 0 ? `<span class="badge badge-absent" style="font-weight:600;">${e.absent_days} ngày</span>` : '<span class="muted">0</span>'}
                </td>
                <td style="text-align:center;">
                    ${e.late_days > 0 ? `<span class="badge badge-late" style="font-weight:600;">${e.late_days} lần</span>` : '<span class="muted">0</span>'}
                </td>
                <td style="text-align:center;">
                    ${e.early_leave_days > 0 ? `<span class="badge badge-early-leave" style="font-weight:600;">${e.early_leave_days} lần</span>` : '<span class="muted">0</span>'}
                </td>
                <td style="text-align:center;font-weight:600;color:#374151;">
                    ${e.work_days}/${totalWorkStandard}
                </td>
            `;
            timesheetBody.appendChild(tr);
        });
    }

    // Filter in memory by search text
    function applySearch() {
        const query = (filterSearch.value || '').trim().toLowerCase();
        if (!query) {
            renderTable(cachedEmployees);
            return;
        }
        const filtered = cachedEmployees.filter(e => {
            const name = (e.full_name || '').toLowerCase();
            const code = (e.employee_code || '').toLowerCase();
            const dept = (e.department_name || '').toLowerCase();
            return name.includes(query) || code.includes(query) || dept.includes(query);
        });
        renderTable(filtered);
    }

    // Load Timesheet data from API
    async function loadTimesheet() {
        const ym = filterMonth.value || curYearMonth;
        const deptId = filterDept.value;
        let url = `/attendance/monthly-stats?month=${ym}`;
        if (deptId) url += `&department_id=${deptId}`;

        timesheetBody.innerHTML = '<tr><td colspan="12" class="muted" style="text-align:center;padding:28px;">Đang tải dữ liệu chấm công tháng ' + ym + '...</td></tr>';

        try {
            const r = await API.get(url);
            const d = r.data;
            const ymDisplay = d.month_display || ym;
            timesheetSubtitle.textContent = `Thống kê chi tiết số ngày đi làm, nghỉ phép, vắng mặt, đi muộn, về sớm của từng nhân viên trong tháng ${ymDisplay}`;

            cachedEmployees = d.employees || [];
            applySearch();

            // If paramEmpId was specified in URL, open their detail modal automatically
            if (paramEmpId) {
                openDetailModal(paramEmpId);
            }
        } catch (err) {
            timesheetBody.innerHTML = `<tr><td colspan="11" class="error" style="text-align:center;padding:24px;">Lỗi tải bảng chấm công: ${err.message}</td></tr>`;
        }
    }

    // Open Employee Monthly Detail Modal
    async function openDetailModal(empId) {
        const ym = filterMonth.value || curYearMonth;
        detailModal.style.display = 'flex';
        dailyBody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px;">Đang tải chi tiết ngày công...</td></tr>';

        try {
            const r = await API.get(`/attendance/monthly-stats?month=${ym}&employee_id=${empId}`);
            const data = r.data;
            const s = data.summary;
            const records = data.daily || [];

            modalEmpTitle.textContent = `Bảng chấm công chi tiết - Tháng ${s.month_display || ym}`;
            modalEmpSubtitle.textContent = `Nhân viên: ${s.full_name} (${s.employee_code})`;

            mBannerCode.textContent  = s.employee_code;
            mBannerName.textContent  = s.full_name;
            mBannerDept.textContent  = s.department_name || '-';
            mBannerShift.textContent = s.shift_name || `${s.work_start} - ${s.work_end}`;

            mStatWork.textContent   = s.work_days + ' ngày';
            mStatLeave.textContent  = s.leave_days + ' ngày';
            mStatLate.textContent   = s.late_days + ' lần';
            mStatEarly.textContent  = s.early_leave_days + ' lần';
            mStatAbsent.textContent = s.absent_days + ' ngày';

            if (records.length === 0) {
                dailyBody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:20px;">Không có ngày nào trong tháng này.</td></tr>';
                return;
            }

            dailyBody.innerHTML = '';
            for (const row of records) {
                const tr = document.createElement('tr');
                const rawDate = row.date ? row.date.slice(0, 10) : '';
                const parts = rawDate.split('-');
                const formattedDate = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : rawDate;

                const ci = row.check_in ? new Date(row.check_in).toLocaleTimeString('vi-VN') : '-';
                const co = row.check_out ? new Date(row.check_out).toLocaleTimeString('vi-VN') : '-';

                let statusBadge = '';
                const st = row.day_status;

                if (st === 'on_time') {
                    statusBadge = '<span class="badge badge-on-time">Đúng giờ</span>';
                } else if (st === 'late') {
                    statusBadge = '<span class="badge badge-late">Đi muộn</span>';
                } else if (st === 'early_leave') {
                    statusBadge = '<span class="badge badge-early-leave">Về sớm</span>';
                } else if (st === 'late_and_early') {
                    statusBadge = '<span class="badge badge-late">Đi muộn</span> <span class="badge badge-early-leave">Về sớm</span>';
                } else if (st === 'on_leave') {
                    statusBadge = '<span class="badge badge-leave">Nghỉ phép</span>';
                } else if (st === 'absent') {
                    statusBadge = '<span class="badge badge-absent">Vắng mặt</span>';
                } else if (st === 'weekend') {
                    statusBadge = '<span class="badge badge-weekend">Cuối tuần</span>';
                    tr.style.background = '#fcfcfc';
                } else if (st === 'not_hired') {
                    statusBadge = '<span class="badge badge-not-hired">Chưa vào làm</span>';
                    tr.style.opacity = '0.7';
                } else if (st === 'today_unrecorded') {
                    statusBadge = '<span class="badge" style="background:#fef9c3;color:#854d0e;">Chưa điểm danh</span>';
                } else {
                    statusBadge = '<span class="muted">-</span>';
                    tr.style.opacity = '0.7';
                }

                tr.innerHTML = `
                    <td style="font-weight:600;">${formattedDate}</td>
                    <td class="muted">${API.escapeHtml(row.day_name || '')}</td>
                    <td>${ci}</td>
                    <td>${co}</td>
                    <td>${statusBadge}</td>
                    <td class="muted">${row.note ? API.escapeHtml(row.note) : '-'}</td>
                `;
                dailyBody.appendChild(tr);
            }
        } catch (err) {
            dailyBody.innerHTML = `<tr><td colspan="6" class="error" style="text-align:center;padding:20px;">Lỗi tải chi tiết: ${err.message}</td></tr>`;
        }
    }

    function closeDetailModal() {
        detailModal.style.display = 'none';
    }

    // Event listeners
    filterMonth.addEventListener('change', () => loadTimesheet());
    filterDept.addEventListener('change', () => loadTimesheet());
    filterSearch.addEventListener('input', applySearch);
    btnReload.addEventListener('click', () => loadTimesheet());
    btnPrintTimesheet.addEventListener('click', () => window.print());
    btnPrintEmpDetail.addEventListener('click', () => window.print());

    btnCloseDetailModal.addEventListener('click', closeDetailModal);
    btnCloseDetailModalBottom.addEventListener('click', closeDetailModal);
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) closeDetailModal();
    });

    // Start
    await loadDepartments();
    await loadTimesheet();
})();
