// js/employees.js
(async () => {
    if (!API.requireAuth()) return;

    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    const tbody     = document.querySelector('#empTable tbody');
    const deptFilt  = document.getElementById('deptFilter');
    const empDept   = document.getElementById('empDeptSelect');
    const search    = document.getElementById('searchInput');
    const status    = document.getElementById('statusFilter');
    const modal     = document.getElementById('empModal');
    const form      = document.getElementById('empForm');
    const modalTitle= document.getElementById('empModalTitle');
    const errEl     = document.getElementById('empFormError');
    const user      = API.getUser();

    // Form inputs
    const idInput        = document.getElementById('empIdInput');
    const codeInput      = document.getElementById('empCodeInput');
    const nameInput      = document.getElementById('empNameInput');
    const emailInput     = document.getElementById('empEmailInput');
    const phoneInput     = document.getElementById('empPhoneInput');
    const positionInput  = document.getElementById('empPositionInput');
    const hireDateInput  = document.getElementById('empHireDateInput');
    const shiftSelect    = document.getElementById('empShiftSelect');
    const workStartInput = document.getElementById('empWorkStart');
    const workEndInput   = document.getElementById('empWorkEnd');
    const statusGroup    = document.getElementById('empStatusGroup');
    const statusSelect   = document.getElementById('empStatusSelect');
    const leaveDatesGroup= document.getElementById('empLeaveDatesGroup');
    const leaveStartInput= document.getElementById('empLeaveStartInput');
    const leaveEndInput  = document.getElementById('empLeaveEndInput');

    // Leave Modal elements
    const leaveModal     = document.getElementById('leaveModal');
    const leaveForm      = document.getElementById('leaveForm');
    const leaveEmpId     = document.getElementById('leaveEmpId');
    const leaveEmpName   = document.getElementById('leaveEmpName');
    const leaveStartDate = document.getElementById('leaveStartDate');
    const leaveEndDate   = document.getElementById('leaveEndDate');
    const btnCancelLeave = document.getElementById('btnCancelLeave');
    const btnCloseLeave  = document.getElementById('btnCloseLeaveModal');
    const leaveFormError = document.getElementById('leaveFormError');

    // Shift presets
    let SHIFT_TIMES = {
        'Ca ngày (08:30 - 17:30)': { start: '08:30', end: '17:30' },
        'Ca sáng (06:00 - 14:00)': { start: '06:00', end: '14:00' },
        'Ca chiều (14:00 - 22:00)': { start: '14:00', end: '22:00' },
        'Ca đêm (20:00 - 05:00)': { start: '20:00', end: '05:00' },
    };

    async function loadEmpShifts() {
        try {
            const r = await API.get('/shifts');
            if (r.data && r.data.length > 0) {
                SHIFT_TIMES = {};
                shiftSelect.innerHTML = '';
                for (const s of r.data) {
                    SHIFT_TIMES[s.name] = { start: s.work_start, end: s.work_end };
                    shiftSelect.add(new Option(s.name, s.name));
                }
            }
        } catch (e) {
            console.warn('Fallback to default shifts', e);
        }
    }

    function applyEmpShiftTimes(val) {
        if (SHIFT_TIMES[val]) {
            workStartInput.value = SHIFT_TIMES[val].start;
            workEndInput.value   = SHIFT_TIMES[val].end;
        } else {
            workStartInput.value = '08:30';
            workEndInput.value   = '17:30';
        }
    }

    shiftSelect.addEventListener('change', () => {
        applyEmpShiftTimes(shiftSelect.value);
    });

    if (statusSelect) {
        statusSelect.addEventListener('change', () => {
            if (leaveDatesGroup) {
                leaveDatesGroup.style.display = statusSelect.value === 'on_leave' ? 'block' : 'none';
            }
        });
    }

    // Ensure modal starts hidden immediately
    function closeModal() {
        modal.classList.remove('open');
        modal.style.setProperty('display', 'none', 'important');
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        if (errEl) errEl.hidden = true;
        form.reset();
    }

    function closeLeaveModal() {
        if (!leaveModal) return;
        leaveModal.classList.remove('open');
        leaveModal.style.setProperty('display', 'none', 'important');
        leaveModal.hidden = true;
        if (leaveFormError) leaveFormError.hidden = true;
        leaveForm.reset();
    }

    function openLeaveModal(emp) {
        leaveForm.reset();
        if (leaveFormError) leaveFormError.hidden = true;
        leaveEmpId.value = emp.id;
        leaveEmpName.textContent = `${emp.full_name} (${emp.employee_code}) - ${emp.department_name || 'Chưa phân phòng'}`;
        const today = new Date().toISOString().slice(0, 10);
        leaveStartDate.value = emp.leave_start ? emp.leave_start.slice(0, 10) : today;
        leaveEndDate.value   = emp.leave_end   ? emp.leave_end.slice(0, 10)   : today;
        leaveStartDate.min = today;
        leaveEndDate.min   = leaveStartDate.value;
        leaveModal.style.setProperty('display', 'flex', 'important');
        leaveModal.hidden = false;
        leaveModal.classList.add('open');
    }

    if (btnCancelLeave) btnCancelLeave.addEventListener('click', (e) => { e.preventDefault(); closeLeaveModal(); });
    if (btnCloseLeave)  btnCloseLeave.addEventListener('click', (e) => { e.preventDefault(); closeLeaveModal(); });
    if (leaveModal)     leaveModal.addEventListener('click', (e) => { if (e.target === leaveModal) closeLeaveModal(); });

    if (leaveStartDate) {
        leaveStartDate.addEventListener('change', () => {
            leaveEndDate.min = leaveStartDate.value;
            if (leaveEndDate.value < leaveStartDate.value) {
                leaveEndDate.value = leaveStartDate.value;
            }
        });
    }

    if (leaveForm) {
        leaveForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const empId = leaveEmpId.value;
            const start = leaveStartDate.value;
            const end   = leaveEndDate.value;
            if (!start || !end) return;
            if (end < start) {
                alert('Ngày kết thúc nghỉ phép không thể trước ngày bắt đầu!');
                return;
            }
            try {
                await API.put('/employees/' + empId, {
                    status: 'on_leave',
                    leave_start: start,
                    leave_end: end
                });
                closeLeaveModal();
                load();
            } catch (err) {
                if (leaveFormError) {
                    leaveFormError.textContent = err.message || 'Lỗi đăng ký nghỉ phép';
                    leaveFormError.hidden = false;
                } else {
                    alert(err.message || 'Lỗi đăng ký nghỉ phép');
                }
            }
        });
    }

    function openModal(isEdit = false, emp = null) {
        form.reset();
        if (errEl) errEl.hidden = true;

        if (isEdit && emp) {
            modalTitle.textContent = `Sửa thông tin: ${emp.full_name} (${emp.employee_code})`;
            idInput.value = emp.id;
            codeInput.value = emp.employee_code;
            codeInput.readOnly = true;
            nameInput.value = emp.full_name || '';
            emailInput.value = emp.email || '';
            phoneInput.value = emp.phone || '';
            empDept.value = emp.department_id || '';
            positionInput.value = emp.position || '';
            hireDateInput.value = emp.hire_date ? emp.hire_date.slice(0, 10) : '';
            let matched = emp.shift_name;
            if (!SHIFT_TIMES[matched]) {
                const sStart = (emp.work_start || '08:30').slice(0, 5);
                const sEnd   = (emp.work_end || '17:30').slice(0, 5);
                matched = Object.keys(SHIFT_TIMES).find(k => 
                    SHIFT_TIMES[k].start === sStart && SHIFT_TIMES[k].end === sEnd
                ) || 'Ca ngày (08:30 - 17:30)';
            }
            shiftSelect.value = matched;
            applyEmpShiftTimes(matched);
            statusSelect.value   = emp.status || 'active';
            statusGroup.style.display = 'block';
            if (leaveDatesGroup) {
                leaveDatesGroup.style.display = emp.status === 'on_leave' ? 'block' : 'none';
                leaveStartInput.value = emp.leave_start ? emp.leave_start.slice(0, 10) : '';
                leaveEndInput.value   = emp.leave_end   ? emp.leave_end.slice(0, 10)   : '';
            }
        } else {
            modalTitle.textContent = 'Thêm nhân viên';
            idInput.value = '';
            codeInput.readOnly = false;
            shiftSelect.value = 'Ca ngày (08:30 - 17:30)';
            applyEmpShiftTimes('Ca ngày (08:30 - 17:30)');
            statusGroup.style.display = 'none';
            if (leaveDatesGroup) leaveDatesGroup.style.display = 'none';
        }

        modal.style.setProperty('display', 'flex', 'important');
        modal.hidden = false;
        modal.removeAttribute('aria-hidden');
        modal.classList.add('open');
        if (!isEdit) codeInput.focus();
    }

    // Call closeModal immediately
    closeModal();

    // Modal listeners
    const btnCancel = document.getElementById('btnCancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    const btnClose = document.getElementById('btnCloseEmpModal');
    if (btnClose) {
        btnClose.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    const btnNewEmp = document.getElementById('btnNewEmp');
    if (user && user.role === 'employee' && btnNewEmp) {
        btnNewEmp.style.display = 'none';
    } else if (btnNewEmp) {
        btnNewEmp.addEventListener('click', () => {
            if (!user || user.role === 'employee') return alert('Bạn không có quyền thực hiện thao tác này');
            openModal(false);
        });
    }

    async function loadDepts() {
        try {
            const r = await API.get('/departments');
            deptFilt.innerHTML = '<option value="">-- Phòng ban --</option>';
            empDept.innerHTML  = '<option value="">--</option>';
            for (const d of r.data) {
                const o1 = new Option(d.name, d.id);
                const o2 = new Option(d.name, d.id);
                deptFilt.add(o1);
                empDept.add(o2);
            }
        } catch (err) {
            console.error('Failed to load departments', err);
        }
    }

    async function load() {
        try {
            const params = new URLSearchParams();
            if (search.value) params.set('search', search.value);
            if (deptFilt.value) params.set('department_id', deptFilt.value);
            if (status.value)   params.set('status', status.value);
            const r = await API.get('/employees?' + params.toString());
            tbody.innerHTML = '';
            for (const e of r.data) {
                const tr = document.createElement('tr');
                const shiftLabel = e.shift_name 
                    ? `<span class="badge" style="background:#ede9fe;color:#5b21b6;font-weight:600;">${e.shift_name}</span>`
                    : `<span class="badge" style="background:#ede9fe;color:#5b21b6;">${e.work_start || '08:30'} - ${e.work_end || '17:30'}</span>`;

                let statusBadge = '<span class="badge badge-active">Đang làm việc</span>';
                if (e.status === 'on_leave') {
                    let leaveInfo = 'Nghỉ phép';
                    if (e.leave_end) {
                        const d = new Date(e.leave_end);
                        const endFormatted = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
                        leaveInfo = `Nghỉ phép (đến ${endFormatted})`;
                    }
                    const tooltip = (e.leave_start && e.leave_end) ? `Nghỉ từ ${e.leave_start.slice(0, 10)} đến ${e.leave_end.slice(0, 10)}` : 'Đang nghỉ phép';
                    statusBadge = `<span class="badge badge-late" title="${tooltip}">${leaveInfo}</span>`;
                } else if (e.status === 'terminated') {
                    statusBadge = '<span class="badge badge-terminated">Đã nghỉ việc</span>';
                }

                const faceBadge = e.has_face
                    ? '<span class="badge badge-on-time">Đã có</span>'
                    : '<span class="badge badge-terminated">Chưa có</span>';

                tr.innerHTML = `
                    <td><strong>${API.escapeHtml(e.employee_code)}</strong></td>
                    <td>${API.escapeHtml(e.full_name)}</td>
                    <td>${API.escapeHtml(e.department_name || '-')}</td>
                    <td>${API.escapeHtml(e.position || '-')}</td>
                    <td>${shiftLabel}</td>
                    <td>${statusBadge}</td>
                    <td>${faceBadge}</td>
                    <td></td>`;

                const actions = tr.lastElementChild;
                actions.className = 'actions-cell';

                if (user && (user.role === 'admin' || user.role === 'hr')) {
                    // Nút Sửa
                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-secondary';
                    btnEdit.textContent = 'Sửa';
                    btnEdit.onclick = () => openModal(true, e);
                    actions.appendChild(btnEdit);

                    // Nút Nghỉ phép (nếu đang active) / Đi làm lại (nếu đang on_leave)
                    if (e.status === 'active') {
                        const btnLeave = document.createElement('button');
                        btnLeave.className = 'btn btn-sm';
                        btnLeave.style.background = '#fef3c7';
                        btnLeave.style.color = '#92400e';
                        btnLeave.style.borderColor = '#fde68a';
                        btnLeave.textContent = 'Nghỉ phép';
                        btnLeave.title = 'Chọn ngày và đăng ký nghỉ phép';
                        btnLeave.onclick = () => openLeaveModal(e);
                        actions.appendChild(btnLeave);
                    } else if (e.status === 'on_leave') {
                        const btnBack = document.createElement('button');
                        btnBack.className = 'btn btn-sm btn-primary';
                        btnBack.textContent = 'Đi làm lại';
                        btnBack.title = 'Kích hoạt nhân viên đi làm lại sớm hơn dự kiến';
                        btnBack.onclick = async () => {
                            if (!confirm(`Xác nhận cho nhân viên ${e.full_name} (${e.employee_code}) đi làm lại ngay hôm nay?`)) return;
                            try {
                                await API.put('/employees/' + e.id, {
                                    ...e,
                                    status: 'active',
                                    leave_start: null,
                                    leave_end: null
                                });
                                load();
                            } catch (err) {
                                alert(err.message || 'Thao tác thất bại');
                            }
                        };
                        actions.appendChild(btnBack);
                    }

                    // Nút Xoá hẳn
                    if (user.role === 'admin') {
                        const btnDel = document.createElement('button');
                        btnDel.className = 'btn btn-sm';
                        btnDel.style.borderColor = '#ef4444';
                        btnDel.style.color = '#ef4444';
                        btnDel.textContent = 'Xoá';
                        btnDel.onclick = async () => {
                            if (!confirm(`CẢNH BÁO: Bạn có chắc muốn xoá vĩnh viễn nhân viên ${e.full_name} (${e.employee_code})?`)) return;
                            try {
                                await API.del('/employees/' + e.id + '?hard=true');
                                load();
                            } catch (err) {
                                alert(err.message || 'Xoá thất bại');
                            }
                        };
                        actions.appendChild(btnDel);
                    }
                }
                tbody.appendChild(tr);
            }
            if (r.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:16px;">Không tìm thấy nhân viên nào.</td></tr>';
            }
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="8" class="error" style="text-align:center;padding:16px;">Không thể tải danh sách nhân viên: ${err.message}</td></tr>`;
        }
    }

    document.getElementById('btnReload').addEventListener('click', load);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
    deptFilt.addEventListener('change', load);
    status.addEventListener('change', load);

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const id = idInput.value;
        errEl.hidden = true;
        try {
            if (id) {
                await API.put('/employees/' + id, fd);
            } else {
                await API.post('/employees', fd);
            }
            closeModal();
            load();
        } catch (err) {
            errEl.textContent = err.message || 'Có lỗi xảy ra khi lưu nhân viên';
            errEl.hidden = false;
        }
    });

    closeModal();
    await loadDepts();
    await loadEmpShifts();
    await load();
})();
