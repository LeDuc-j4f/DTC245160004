// js/shifts.js - Quản lý ca làm việc của nhân viên
(async () => {
    if (!API.requireAuth()) return;

    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
        if (me.data.role === 'employee') {
            alert('Bạn không có quyền truy cập trang quản lý ca làm việc.');
            location.href = 'attendance.html';
            return;
        }
    } catch (e) {
        console.error('Failed to get user profile', e);
    }

    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    // DOM Elements - Table & Filter
    const tbody             = document.querySelector('#shiftTable tbody');
    const searchInput       = document.getElementById('searchInput');
    const deptFilter        = document.getElementById('deptFilter');
    const shiftFilter       = document.getElementById('shiftFilter');
    const statusFilter      = document.getElementById('statusFilter');
    const btnReload         = document.getElementById('btnReload');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');

    // Stats
    const statTotal         = document.getElementById('statTotal');
    const statDay           = document.getElementById('statDay');
    const statMorning       = document.getElementById('statMorning');
    const statAfternoon     = document.getElementById('statAfternoon');
    const statNight         = document.getElementById('statNight');

    // Bulk bar
    const bulkBar           = document.getElementById('bulkBar');
    const selectedCountBadge= document.getElementById('selectedCountBadge');
    const btnBulkShiftModal = document.getElementById('btnBulkShiftModal');
    const bulkBtnCount      = document.getElementById('bulkBtnCount');
    const btnBulkAction     = document.getElementById('btnBulkAction');
    const btnClearSelection = document.getElementById('btnClearSelection');

    // Modal - Đổi ca
    const shiftModal        = document.getElementById('shiftModal');
    const shiftForm         = document.getElementById('shiftForm');
    const shiftModalTitle   = document.getElementById('shiftModalTitle');
    const targetSummary     = document.getElementById('targetSummary');
    const presetSelect      = document.getElementById('shiftPresetSelect');
    const startTimeInput    = document.getElementById('shiftStartTime');
    const endTimeInput      = document.getElementById('shiftEndTime');
    const shiftModalError   = document.getElementById('shiftModalError');
    const btnCloseShiftModal= document.getElementById('btnCloseShiftModal');
    const btnCancelShiftModal= document.getElementById('btnCancelShiftModal');
    const btnSaveShift      = document.getElementById('btnSaveShift');
    const btnQuickCreateShift = document.getElementById('btnQuickCreateShift');

    // Inline create shift box inside shiftModal
    const inlineCreateShiftBox  = document.getElementById('inlineCreateShiftBox');
    const inlineShiftName       = document.getElementById('inlineShiftName');
    const inlineShiftStart      = document.getElementById('inlineShiftStart');
    const inlineShiftEnd        = document.getElementById('inlineShiftEnd');
    const inlineShiftError      = document.getElementById('inlineShiftError');
    const btnCancelInlineShift  = document.getElementById('btnCancelInlineShift');
    const btnSaveInlineShift    = document.getElementById('btnSaveInlineShift');

    // Modal - Thêm ca mới (độc lập)
    const btnOpenCreateShift = document.getElementById('btnOpenCreateShift');
    const createShiftModal   = document.getElementById('createShiftModal');
    const createShiftForm    = document.getElementById('createShiftForm');
    const newShiftName       = document.getElementById('newShiftName');
    const newShiftStart      = document.getElementById('newShiftStart');
    const newShiftEnd        = document.getElementById('newShiftEnd');
    const createShiftError   = document.getElementById('createShiftError');
    const btnCloseCreateShiftModal = document.getElementById('btnCloseCreateShiftModal');
    const btnCancelCreateShift = document.getElementById('btnCancelCreateShift');
    const btnSaveNewShift    = document.getElementById('btnSaveNewShift');

    // Dynamic shift presets map
    let shiftPresets = {
        'Ca ngày (08:30 - 17:30)': { start: '08:30', end: '17:30' },
        'Ca sáng (06:00 - 14:00)': { start: '06:00', end: '14:00' },
        'Ca chiều (14:00 - 22:00)': { start: '14:00', end: '22:00' },
        'Ca đêm (20:00 - 05:00)': { start: '20:00', end: '05:00' },
    };

    // State
    let allEmployees = [];
    let allDepartments = [];
    let allShifts = [];
    let selectedEmpIds = new Set();
    let currentMode = 'bulk'; // 'single' or 'bulk'
    let singleTargetEmp = null;

    // Helper: format shift badge (no emojis)
    function getShiftBadge(shiftName) {
        if (!shiftName) return '<span class="badge badge-shift-custom">Chưa gán</span>';
        const s = shiftName.toLowerCase();
        let cls = 'badge-shift';
        if (s.includes('đêm')) cls = 'badge-shift-night';
        else if (s.includes('sáng')) cls = 'badge-shift-morning';
        else if (s.includes('chiều')) cls = 'badge-shift-afternoon';
        else if (s.includes('ngày')) cls = 'badge-shift-day';
        return `<span class="badge ${cls}">${escapeHtml(shiftName)}</span>`;
    }

    function getStatusBadge(status) {
        if (status === 'active') return '<span class="badge badge-active">Đang làm việc</span>';
        if (status === 'terminated') return '<span class="badge badge-terminated">Đã nghỉ việc</span>';
        if (status === 'on_leave') return '<span class="badge badge-late">Nghỉ phép</span>';
        return `<span class="badge">${escapeHtml(status || 'N/A')}</span>`;
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // Load available shifts from API
    async function loadShifts() {
        try {
            const r = await API.get('/shifts');
            allShifts = r.data || [];
            shiftPresets = {};
            for (const s of allShifts) {
                shiftPresets[s.name] = { start: s.work_start, end: s.work_end };
            }
        } catch (err) {
            console.warn('Fallback to local presets', err);
        }

        // Populate presetSelect in modal
        presetSelect.innerHTML = Object.keys(shiftPresets).map(name => {
            return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
        }).join('') + '<option value="__inline_create__">+ Tự tạo ca mới...</option>';

        // Populate shiftFilter
        shiftFilter.innerHTML = '<option value="">-- Tất cả ca làm việc --</option>' +
            Object.keys(shiftPresets).map(name => {
                return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
            }).join('');
    }

    // Modal Đổi ca functions
    function closeShiftModal() {
        toggleInlineCreateShift(false);
        shiftModal.classList.remove('open');
        shiftModal.hidden = true;
        shiftModal.setAttribute('aria-hidden', 'true');
        shiftModalError.hidden = true;
        shiftModalError.textContent = '';
        shiftForm.reset();
        currentMode = 'bulk';
        singleTargetEmp = null;
    }

    function applyPresetTimes(presetName) {
        if (shiftPresets[presetName]) {
            startTimeInput.value = shiftPresets[presetName].start;
            endTimeInput.value   = shiftPresets[presetName].end;
        } else {
            startTimeInput.value = '08:30';
            endTimeInput.value   = '17:30';
        }
    }

    function openSingleModal(emp) {
        currentMode = 'single';
        singleTargetEmp = emp;
        shiftModalTitle.textContent = `Đổi ca làm: ${emp.full_name} (${emp.employee_code})`;
        targetSummary.innerHTML = `Đang cập nhật ca cho: <strong>${escapeHtml(emp.full_name)}</strong> (Mã: <code>${escapeHtml(emp.employee_code)}</code>) - Phòng: <em>${escapeHtml(emp.department_name || 'N/A')}</em>`;
        shiftModalError.hidden = true;
        toggleInlineCreateShift(false);

        let matched = emp.shift_name;
        if (!shiftPresets[matched]) {
            const sStart = (emp.work_start || '08:30').slice(0, 5);
            const sEnd   = (emp.work_end || '17:30').slice(0, 5);
            matched = Object.keys(shiftPresets).find(k => 
                shiftPresets[k].start === sStart && shiftPresets[k].end === sEnd
            ) || Object.keys(shiftPresets)[0] || 'Ca ngày (08:30 - 17:30)';
        }

        presetSelect.value = matched;
        applyPresetTimes(matched);

        shiftModal.hidden = false;
        shiftModal.removeAttribute('aria-hidden');
        shiftModal.classList.add('open');
    }

    function openBulkModal() {
        if (selectedEmpIds.size === 0) {
            alert('Vui lòng chọn ít nhất một nhân viên để đổi ca làm việc.');
            return;
        }
        currentMode = 'bulk';
        singleTargetEmp = null;
        shiftModalTitle.textContent = `Đổi ca hàng loạt cho ${selectedEmpIds.size} nhân viên`;
        toggleInlineCreateShift(false);
        
        const selectedNames = allEmployees
            .filter(e => selectedEmpIds.has(e.id))
            .map(e => `${escapeHtml(e.full_name)} (${escapeHtml(e.employee_code)})`)
            .slice(0, 5);
        const moreCount = selectedEmpIds.size - selectedNames.length;
        const namesStr = selectedNames.join(', ') + (moreCount > 0 ? ` và ${moreCount} nhân viên khác...` : '');

        targetSummary.innerHTML = `Áp dụng cho <strong>${selectedEmpIds.size} nhân viên đã chọn</strong>:<br><span class="muted" style="font-size: 0.9em;">${namesStr}</span>`;
        shiftModalError.hidden = true;

        const defaultShift = Object.keys(shiftPresets)[0] || 'Ca ngày (08:30 - 17:30)';
        presetSelect.value = defaultShift;
        applyPresetTimes(defaultShift);

        shiftModal.hidden = false;
        shiftModal.removeAttribute('aria-hidden');
        shiftModal.classList.add('open');
    }

    // Modal Thêm ca mới (độc lập) functions
    function openCreateShiftModal() {
        createShiftForm.reset();
        createShiftError.hidden = true;
        createShiftModal.hidden = false;
        createShiftModal.removeAttribute('aria-hidden');
        createShiftModal.classList.add('open');
        newShiftName.focus();
    }

    function closeCreateShiftModal() {
        createShiftModal.classList.remove('open');
        createShiftModal.hidden = true;
        createShiftModal.setAttribute('aria-hidden', 'true');
        createShiftError.hidden = true;
        createShiftForm.reset();
    }

    // Inline create shift bên trong shiftModal
    function toggleInlineCreateShift(show) {
        if (!inlineCreateShiftBox) return;
        if (typeof show === 'boolean') {
            inlineCreateShiftBox.style.display = show ? 'block' : 'none';
        } else {
            inlineCreateShiftBox.style.display = (inlineCreateShiftBox.style.display === 'block') ? 'none' : 'block';
        }
        if (inlineCreateShiftBox.style.display === 'block') {
            inlineShiftName.value = '';
            inlineShiftStart.value = '09:00';
            inlineShiftEnd.value = '18:00';
            inlineShiftError.hidden = true;
            inlineShiftName.focus();
        }
    }

    if (btnQuickCreateShift) {
        btnQuickCreateShift.addEventListener('click', (e) => {
            e.preventDefault();
            toggleInlineCreateShift();
        });
    }

    if (btnCancelInlineShift) {
        btnCancelInlineShift.addEventListener('click', (e) => {
            e.preventDefault();
            toggleInlineCreateShift(false);
        });
    }

    if (btnSaveInlineShift) {
        btnSaveInlineShift.addEventListener('click', async (e) => {
            e.preventDefault();
            inlineShiftError.hidden = true;
            const name = inlineShiftName.value.trim();
            const work_start = inlineShiftStart.value;
            const work_end = inlineShiftEnd.value;

            if (!name) {
                inlineShiftError.textContent = 'Vui lòng nhập tên ca làm việc.';
                inlineShiftError.hidden = false;
                inlineShiftName.focus();
                return;
            }
            if (!work_start || !work_end) {
                inlineShiftError.textContent = 'Vui lòng chọn giờ vào ca và giờ tan ca.';
                inlineShiftError.hidden = false;
                return;
            }

            btnSaveInlineShift.disabled = true;
            btnSaveInlineShift.textContent = 'Đang lưu...';

            try {
                const res = await API.post('/shifts', { name, work_start, work_end });
                const created = res.data;
                await loadShifts();
                toggleInlineCreateShift(false);

                // Tự động chọn ca mới tạo trong dropdown
                presetSelect.value = created.name;
                applyPresetTimes(created.name);
            } catch (err) {
                console.error('Lỗi tạo ca làm', err);
                inlineShiftError.textContent = err.message || 'Lỗi khi lưu ca làm việc';
                inlineShiftError.hidden = false;
            } finally {
                btnSaveInlineShift.disabled = false;
                btnSaveInlineShift.textContent = 'Lưu vào danh sách & Chọn ca này';
            }
        });
    }

    // Modal Event Listeners - Đổi ca
    btnCloseShiftModal.addEventListener('click', closeShiftModal);
    btnCancelShiftModal.addEventListener('click', closeShiftModal);
    shiftModal.addEventListener('click', (e) => {
        if (e.target === shiftModal) closeShiftModal();
    });

    // Modal Event Listeners - Thêm ca mới (nút topbar)
    btnOpenCreateShift.addEventListener('click', openCreateShiftModal);
    btnCloseCreateShiftModal.addEventListener('click', closeCreateShiftModal);
    btnCancelCreateShift.addEventListener('click', closeCreateShiftModal);
    createShiftModal.addEventListener('click', (e) => {
        if (e.target === createShiftModal) closeCreateShiftModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (createShiftModal.classList.contains('open')) closeCreateShiftModal();
            else if (shiftModal.classList.contains('open')) closeShiftModal();
        }
    });

    presetSelect.addEventListener('change', () => {
        if (presetSelect.value === '__inline_create__') {
            toggleInlineCreateShift(true);
            const firstPreset = Object.keys(shiftPresets)[0];
            if (firstPreset) presetSelect.value = firstPreset;
        } else {
            toggleInlineCreateShift(false);
            applyPresetTimes(presetSelect.value);
        }
    });

    // Submit Thêm ca mới
    createShiftForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        createShiftError.hidden = true;
        btnSaveNewShift.disabled = true;
        btnSaveNewShift.textContent = 'Đang lưu...';

        const name = newShiftName.value.trim();
        const work_start = newShiftStart.value;
        const work_end = newShiftEnd.value;

        try {
            const res = await API.post('/shifts', { name, work_start, work_end });
            const created = res.data;
            await loadShifts();
            closeCreateShiftModal();

            // Nếu đang mở modal đổi ca, tự động chọn ca vừa tạo
            if (shiftModal.classList.contains('open')) {
                presetSelect.value = created.name;
                applyPresetTimes(created.name);
            }
            alert(`Đã thêm ca làm việc "${created.name}" thành công!`);
        } catch (err) {
            console.error('Tạo ca thất bại', err);
            createShiftError.textContent = err.message || 'Lỗi khi tạo ca làm việc';
            createShiftError.hidden = false;
        } finally {
            btnSaveNewShift.disabled = false;
            btnSaveNewShift.textContent = 'Lưu vào danh sách ca';
        }
    });

    // Submit Đổi ca
    shiftForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        shiftModalError.hidden = true;
        btnSaveShift.disabled = true;
        btnSaveShift.textContent = 'Đang lưu...';

        const shift_name = presetSelect.value;
        const work_start = startTimeInput.value;
        const work_end   = endTimeInput.value;

        try {
            if (currentMode === 'single' && singleTargetEmp) {
                await API.put(`/employees/${singleTargetEmp.id}`, {
                    ...singleTargetEmp,
                    shift_name,
                    work_start,
                    work_end,
                });
            } else if (currentMode === 'bulk') {
                const employee_ids = Array.from(selectedEmpIds);
                await API.post('/employees/bulk-shift', {
                    employee_ids,
                    shift_name,
                    work_start,
                    work_end,
                });
                selectedEmpIds.clear();
                updateBulkBar();
            }

            closeShiftModal();
            await loadEmployees();
        } catch (err) {
            console.error('Save shift error', err);
            shiftModalError.textContent = err.message || 'Lỗi khi lưu ca làm việc';
            shiftModalError.hidden = false;
        } finally {
            btnSaveShift.disabled = false;
            btnSaveShift.textContent = 'Lưu ca làm';
        }
    });

    // Checkbox selection management
    function updateBulkBar() {
        const count = selectedEmpIds.size;
        selectedCountBadge.textContent = count;
        bulkBtnCount.textContent = count;

        if (count > 0) {
            bulkBar.style.display = 'flex';
            btnBulkShiftModal.disabled = false;
        } else {
            bulkBar.style.display = 'none';
            btnBulkShiftModal.disabled = true;
        }

        const visibleCheckboxes = tbody.querySelectorAll('.emp-check');
        if (visibleCheckboxes.length > 0) {
            const allChecked = Array.from(visibleCheckboxes).every(cb => cb.checked);
            const someChecked = Array.from(visibleCheckboxes).some(cb => cb.checked);
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = !allChecked && someChecked;
        } else {
            selectAllCheckbox.checked = false;
            selectAllCheckbox.indeterminate = false;
        }
    }

    selectAllCheckbox.addEventListener('change', () => {
        const checked = selectAllCheckbox.checked;
        const visibleCheckboxes = tbody.querySelectorAll('.emp-check');
        visibleCheckboxes.forEach(cb => {
            cb.checked = checked;
            const empId = parseInt(cb.dataset.id, 10);
            if (checked) {
                selectedEmpIds.add(empId);
            } else {
                selectedEmpIds.delete(empId);
            }
        });
        updateBulkBar();
    });

    btnBulkAction.addEventListener('click', openBulkModal);
    btnBulkShiftModal.addEventListener('click', openBulkModal);
    btnClearSelection.addEventListener('click', () => {
        selectedEmpIds.clear();
        tbody.querySelectorAll('.emp-check').forEach(cb => cb.checked = false);
        updateBulkBar();
    });

    // Load departments
    async function loadDepartments() {
        try {
            const r = await API.get('/departments');
            allDepartments = r.data || [];
            deptFilter.innerHTML = '<option value="">-- Tất cả phòng ban --</option>' +
                allDepartments.map(d => `<option value="${d.id}">${escapeHtml(d.name)}</option>`).join('');
        } catch (err) {
            console.error('Failed to load departments', err);
        }
    }

    // Load employees and calculate stats
    async function loadEmployees() {
        tbody.innerHTML = '<tr><td colspan="8" class="muted text-center" style="padding: 24px;">Đang tải danh sách nhân viên...</td></tr>';
        try {
            const params = new URLSearchParams();
            if (deptFilter.value) params.set('department_id', deptFilter.value);
            if (statusFilter.value) params.set('status', statusFilter.value);
            if (searchInput.value.trim()) params.set('search', searchInput.value.trim());

            const url = `/employees` + (params.toString() ? `?${params.toString()}` : '');
            const r = await API.get(url);
            allEmployees = r.data || [];

            // Lọc ca làm
            const shiftVal = shiftFilter.value;
            let displayList = allEmployees;
            if (shiftVal) {
                displayList = allEmployees.filter(e => (e.shift_name || '').toLowerCase().includes(shiftVal.toLowerCase()));
            }

            // Cập nhật thống kê
            let countDay = 0, countMorning = 0, countAfternoon = 0, countNight = 0;
            allEmployees.forEach(e => {
                const s = (e.shift_name || '').toLowerCase();
                if (s.includes('đêm')) countNight++;
                else if (s.includes('sáng')) countMorning++;
                else if (s.includes('chiều')) countAfternoon++;
                else countDay++;
            });

            statTotal.textContent     = allEmployees.length;
            statDay.textContent       = countDay;
            statMorning.textContent   = countMorning;
            statAfternoon.textContent = countAfternoon;
            statNight.textContent     = countNight;

            if (displayList.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="muted text-center" style="padding: 30px;">Không tìm thấy nhân viên nào phù hợp với điều kiện lọc.</td></tr>';
                updateBulkBar();
                return;
            }

            tbody.innerHTML = displayList.map(emp => {
                const isChecked = selectedEmpIds.has(emp.id);
                return `
                    <tr data-id="${emp.id}">
                        <td style="text-align: center;">
                            <input type="checkbox" class="emp-check" data-id="${emp.id}" ${isChecked ? 'checked' : ''}>
                        </td>
                        <td><code>${escapeHtml(emp.employee_code)}</code></td>
                        <td><strong>${escapeHtml(emp.full_name)}</strong></td>
                        <td>${escapeHtml(emp.department_name || '-')}</td>
                        <td>${escapeHtml(emp.position || '-')}</td>
                        <td>${getShiftBadge(emp.shift_name)}</td>
                        <td>${getStatusBadge(emp.status)}</td>
                        <td style="text-align: right;">
                            <button type="button" class="btn btn-sm btn-secondary btn-edit-shift" data-id="${emp.id}">Đổi ca</button>
                        </td>
                    </tr>
                `;
            }).join('');

            // Gán sự kiện cho từng dòng
            tbody.querySelectorAll('.emp-check').forEach(cb => {
                cb.addEventListener('change', () => {
                    const id = parseInt(cb.dataset.id, 10);
                    if (cb.checked) {
                        selectedEmpIds.add(id);
                    } else {
                        selectedEmpIds.delete(id);
                    }
                    updateBulkBar();
                });
            });

            tbody.querySelectorAll('.btn-edit-shift').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = parseInt(btn.dataset.id, 10);
                    const emp = allEmployees.find(e => e.id === id);
                    if (emp) openSingleModal(emp);
                });
            });

            updateBulkBar();
        } catch (err) {
            console.error('Load employees error', err);
            tbody.innerHTML = `<tr><td colspan="8" class="error text-center" style="padding: 20px;">Lỗi tải dữ liệu: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    // Filter event listeners
    [deptFilter, shiftFilter, statusFilter].forEach(el => {
        el.addEventListener('change', loadEmployees);
    });

    let searchTimeout = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(loadEmployees, 300);
    });

    btnReload.addEventListener('click', loadEmployees);

    // Initial load
    await loadShifts();
    await loadDepartments();
    await loadEmployees();
})();
