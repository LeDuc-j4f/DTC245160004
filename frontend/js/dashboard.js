// js/dashboard.js - Quản lý tổng quan & thống kê chấm công
(async () => {
    if (!API.requireAuth()) return;

    const user = API.getUser();
    if (user && user.role === 'employee') {
        location.href = 'attendance.html';
        return;
    }

    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    // DOM Elements - Bộ lọc
    const deptSelect       = document.getElementById('dashDeptSelect');
    const fromInput        = document.getElementById('dashFromDate');
    const toInput          = document.getElementById('dashToDate');
    const statusSelect     = document.getElementById('dashStatusSelect');
    const searchInput      = document.getElementById('dashSearchInput');
    const btnApplyFilter   = document.getElementById('btnApplyFilter');
    const btnResetFilter   = document.getElementById('btnResetFilter');

    // DOM Elements - Thẻ thống kê
    const statCards        = document.querySelectorAll('.stat-clickable');
    const cardActive       = document.getElementById('cardStatActive');
    const cardOnTime       = document.getElementById('cardStatOnTime');
    const cardLate         = document.getElementById('cardStatLate');
    const cardEarlyLeave   = document.getElementById('cardStatEarlyLeave');
    const cardAbsent       = document.getElementById('cardStatAbsent');

    const statActiveVal    = document.getElementById('statActive');
    const statOnTimeVal    = document.getElementById('statOnTime');
    const statLateVal      = document.getElementById('statLate');
    const statEarlyLeaveVal= document.getElementById('statEarlyLeave');
    const statAbsentVal    = document.getElementById('statAbsent');

    // DOM Elements - Bảng chi tiết
    const recentTableTitle = document.getElementById('recentTableTitle');
    const selectedDateSub  = document.getElementById('selectedDateSub');
    const recentTableCount = document.getElementById('recentTableCount');
    const recBody          = document.querySelector('#recentTable tbody');

    // Current active status filter
    let activeStatus = '';

    function formatDateDisplay(dStr) {
        if (!dStr) return '-';
        const parts = dStr.slice(0, 10).split('-');
        if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
        return new Date(dStr).toLocaleDateString('vi-VN');
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Load danh sách phòng ban cho bộ lọc
    async function loadDepts() {
        try {
            const r = await API.get('/departments');
            if (deptSelect && r.data) {
                deptSelect.innerHTML = '<option value="">-- Tất cả phòng ban --</option>';
                for (const d of r.data) {
                    deptSelect.add(new Option(d.name, d.id));
                }
            }
        } catch (e) {
            console.error('Failed to load departments', e);
        }
    }

    // Đồng bộ thẻ thống kê active với status đang chọn
    function syncCardActiveState(status) {
        activeStatus = status || '';
        statCards.forEach(card => {
            const cardStatus = card.dataset.status || '';
            if (activeStatus === cardStatus) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });
    }

    // Gán sự kiện click vào từng thẻ thống kê
    statCards.forEach(card => {
        card.addEventListener('click', () => {
            const clickedStatus = card.dataset.status || '';
            // Nếu bấm vào thẻ đang chọn (khác thẻ all), bấm lần nữa để bỏ lọc
            if (activeStatus === clickedStatus && clickedStatus !== '') {
                statusSelect.value = '';
                syncCardActiveState('');
            } else {
                statusSelect.value = clickedStatus;
                syncCardActiveState(clickedStatus);
            }
            loadDashboard();
        });
    });

    // Khi người dùng đổi status trên dropdown bộ lọc, đồng bộ lại thẻ active
    statusSelect.addEventListener('change', () => {
        syncCardActiveState(statusSelect.value);
        loadDashboard();
    });

    deptSelect.addEventListener('change', () => loadDashboard());

    // Nút chọn nhanh thời gian
    function setPresetDates(daysAgo) {
        const nowObj = new Date();
        const toStr = nowObj.toISOString().slice(0, 10);
        let fromStr = toStr;
        if (daysAgo === 'month') {
            const firstDay = new Date(nowObj.getFullYear(), nowObj.getMonth(), 1);
            fromStr = firstDay.toISOString().slice(0, 10);
        } else if (daysAgo > 0) {
            const past = new Date(nowObj.getTime() - daysAgo * 86400000);
            fromStr = past.toISOString().slice(0, 10);
        }
        fromInput.value = fromStr;
        toInput.value   = toStr;
        loadDashboard();
    }

    document.getElementById('btnPresetToday')?.addEventListener('click', () => setPresetDates(0));
    document.getElementById('btnPreset7Days')?.addEventListener('click', () => setPresetDates(6));
    document.getElementById('btnPresetMonth')?.addEventListener('click', () => setPresetDates('month'));

    btnApplyFilter?.addEventListener('click', () => loadDashboard());

    btnResetFilter?.addEventListener('click', () => {
        const today = new Date().toISOString().slice(0, 10);
        fromInput.value = today;
        toInput.value = today;
        deptSelect.value = '';
        statusSelect.value = '';
        searchInput.value = '';
        syncCardActiveState('');
        loadDashboard();
    });

    searchInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadDashboard();
    });

    // Tải và hiển thị dữ liệu Dashboard
    async function loadDashboard() {
        const params = new URLSearchParams();
        if (fromInput.value) params.set('from', fromInput.value);
        if (toInput.value) params.set('to', toInput.value);
        if (deptSelect && deptSelect.value) params.set('department_id', deptSelect.value);
        if (statusSelect && statusSelect.value) params.set('status', statusSelect.value);
        if (searchInput && searchInput.value.trim()) params.set('search', searchInput.value.trim());

        try {
            const r = await API.get('/dashboard/overview?' + params.toString());
            const d = r.data;

            // Đồng bộ ngày tháng hiển thị
            const fromFmt = formatDateDisplay(d.filter.from);
            const toFmt   = formatDateDisplay(d.filter.to);
            const rangeText = (d.filter.from === d.filter.to) ? fromFmt : `${fromFmt} - ${toFmt}`;

            document.getElementById('todayLabel').textContent = `Thời gian thống kê: ${rangeText} (Hôm nay: ${formatDateDisplay(d.today)})`;

            // Tên trạng thái đang lọc
            let statusName = 'Tất cả trạng thái';
            if (d.filter.status === 'on_time') statusName = 'Đúng giờ';
            else if (d.filter.status === 'late') statusName = 'Đi muộn';
            else if (d.filter.status === 'early_leave') statusName = 'Về sớm';
            else if (d.filter.status === 'absent') statusName = 'Vắng mặt';

            recentTableTitle.textContent = `Chi tiết hoạt động chấm công: ${statusName}`;
            if (selectedDateSub) {
                selectedDateSub.textContent = `Đồng bộ dữ liệu chấm công từ ${fromFmt} đến ${toFmt}`;
            }

            // Cập nhật giá trị thẻ thống kê (đồng bộ theo đúng khoảng thời gian lọc)
            statActiveVal.textContent     = d.employees.active_employees;
            statOnTimeVal.textContent     = d.today_stats.on_time;
            statLateVal.textContent       = d.today_stats.late;
            statEarlyLeaveVal.textContent = d.today_stats.early_leave;
            statAbsentVal.textContent     = d.today_stats.absent;

            // Đồng bộ trạng thái active của các thẻ
            syncCardActiveState(d.filter.status);

            // Bảng danh sách chi tiết bên dưới
            recBody.innerHTML = '';
            const actList = d.recent || [];
            recentTableCount.textContent = `${actList.length} bản ghi`;

            if (actList.length === 0) {
                recBody.innerHTML = `<tr><td colspan="9" class="muted text-center" style="padding:28px;">Không có dữ liệu chấm công nào phù hợp (${statusName}) trong khoảng thời gian ${rangeText}.</td></tr>`;
            } else {
                for (const act of actList) {
                    const tr = document.createElement('tr');
                    const dateStr = formatDateDisplay(act.date);
                    const ci = act.check_in  ? new Date(act.check_in).toLocaleTimeString('vi-VN')  : '-';
                    const co = act.check_out ? new Date(act.check_out).toLocaleTimeString('vi-VN') : '-';

                    const conf = act.confidence_in || act.confidence_out;
                    const confStr = conf ? `${(parseFloat(conf) * 100).toFixed(1)}%` : (act.check_in ? (act.check_in_method || 'manual') : '-');

                    let badgesHtml = '';
                    const inStatus = act.check_in_status || (act.status === 'late' ? 'late' : (act.status === 'absent' ? 'absent' : 'on_time'));
                    const outStatus = act.check_out_status || (act.status === 'early_leave' ? 'early_leave' : (act.check_out ? 'on_time' : null));

                    if (act.status === 'absent' || inStatus === 'absent') {
                        let isUpcoming = false;
                        if (act.work_start) {
                            const now = new Date();
                            const curMins = now.getHours() * 60 + now.getMinutes();
                            const parts = act.work_start.toString().slice(0, 5).split(':').map(Number);
                            const startMins = (parts[0] || 0) * 60 + (parts[1] || 0);
                            if (startMins > curMins && d.filter.from === d.today && d.filter.to === d.today) {
                                isUpcoming = true;
                            }
                        }
                        if (isUpcoming) {
                            badgesHtml = '<span class="badge" style="background:#e0f2fe;color:#0369a1;font-weight:600;">Chưa vào ca</span>';
                        } else {
                            badgesHtml = '<span class="badge badge-absent">Vắng mặt</span>';
                        }
                    } else if (inStatus === 'on_time' && outStatus === 'early_leave') {
                        badgesHtml = '<span class="badge badge-on-time">Đến đúng giờ</span> <span class="badge badge-early-leave">Về sớm</span>';
                    } else if (inStatus === 'late' && outStatus === 'early_leave') {
                        badgesHtml = '<span class="badge badge-late">Đi muộn</span> <span class="badge badge-early-leave">Về sớm</span>';
                    } else if (inStatus === 'late') {
                        badgesHtml = '<span class="badge badge-late">Đi muộn</span>';
                    } else if (inStatus === 'on_time') {
                        badgesHtml = '<span class="badge badge-on-time">Đúng giờ</span>';
                    } else {
                        badgesHtml = `<span class="badge">${escapeHtml(act.status)}</span>`;
                    }

                    tr.innerHTML = `
                        <td><strong>${escapeHtml(dateStr)}</strong></td>
                        <td><code>${escapeHtml(act.employee_code)}</code></td>
                        <td><strong>${escapeHtml(act.full_name)}</strong></td>
                        <td>${escapeHtml(act.department_name || '-')}</td>
                        <td><span class="badge badge-shift">${escapeHtml(act.shift_name || 'Ca chuẩn')}</span></td>
                        <td><span style="font-family: monospace; font-weight: 600; color: #047857;">${ci}</span></td>
                        <td><span style="font-family: monospace; font-weight: 600; color: #b91c1c;">${co}</span></td>
                        <td>${badgesHtml}</td>
                        <td><small class="muted">${escapeHtml(confStr)}</small></td>
                    `;
                    recBody.appendChild(tr);
                }
            }
        } catch (err) {
            console.error('Lỗi tải dashboard', err);
        }
    }

    // Khởi tạo ngày mặc định: Hôm nay
    const todayDefault = new Date().toISOString().slice(0, 10);
    if (fromInput) fromInput.value = todayDefault;
    if (toInput)   toInput.value   = todayDefault;

    await loadDepts();
    await loadDashboard();
})();
