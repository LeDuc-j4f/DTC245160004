// js/departments.js
(async () => {
    if (!API.requireAuth()) return;
    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    const tbody = document.querySelector('#deptTable tbody');
    const modal = document.getElementById('deptModal');
    const form  = document.getElementById('deptForm');
    const modalTitle = document.getElementById('deptModalTitle');
    const idInput = document.getElementById('deptIdInput');
    const nameInput = document.getElementById('deptNameInput');
    const descInput = document.getElementById('deptDescInput');
    const errEl = document.getElementById('deptFormError');
    const user  = API.getUser();

    // Ensure modal starts hidden immediately
    function closeModal() {
        modal.classList.remove('open');
        modal.style.setProperty('display', 'none', 'important');
        modal.hidden = true;
        modal.setAttribute('aria-hidden', 'true');
        if (errEl) errEl.hidden = true;
        form.reset();
    }

    function openModal(isEdit = false, dept = null) {
        form.reset();
        if (errEl) errEl.hidden = true;
        if (isEdit && dept) {
            modalTitle.textContent = 'Sửa phòng ban: ' + dept.name;
            idInput.value = dept.id;
            nameInput.value = dept.name;
            descInput.value = dept.description || '';
        } else {
            modalTitle.textContent = 'Thêm phòng ban';
            idInput.value = '';
        }
        modal.style.setProperty('display', 'flex', 'important');
        modal.hidden = false;
        modal.removeAttribute('aria-hidden');
        modal.classList.add('open');
        nameInput.focus();
    }

    // Call closeModal immediately
    closeModal();

    // Modal event listeners
    const btnCancel = document.getElementById('btnCancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    const btnClose = document.getElementById('btnCloseDeptModal');
    if (btnClose) {
        btnClose.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeModal();
        });
    }

    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    const btnNewDept = document.getElementById('btnNewDept');
    if (user && user.role === 'employee' && btnNewDept) {
        btnNewDept.style.display = 'none';
    } else if (btnNewDept) {
        btnNewDept.addEventListener('click', () => {
            if (!user || user.role === 'employee') return alert('Bạn không có quyền thực hiện thao tác này');
            openModal(false);
        });
    }

    async function load() {
        try {
            const r = await API.get('/departments');
            tbody.innerHTML = '';
            for (const d of r.data) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td><strong>${API.escapeHtml(d.name)}</strong></td><td>${API.escapeHtml(d.description || '-')}</td><td>${parseInt(d.employee_count, 10) || 0}</td><td></td>`;
                const actions = tr.lastElementChild;
                actions.className = 'actions-cell';

                if (user && (user.role === 'admin' || user.role === 'hr')) {
                    // Nút Sửa
                    const btnEdit = document.createElement('button');
                    btnEdit.className = 'btn btn-sm btn-secondary';
                    btnEdit.textContent = 'Sửa';
                    btnEdit.onclick = () => openModal(true, d);
                    actions.appendChild(btnEdit);

                    // Nút Xoá
                    const btnDel = document.createElement('button');
                    btnDel.className = 'btn btn-sm btn-danger';
                    btnDel.textContent = 'Xoá';
                    btnDel.onclick = async () => {
                        if (!confirm(`Bạn có chắc muốn xoá phòng ban "${d.name}"?`)) return;
                        try {
                            await API.del('/departments/' + d.id);
                            load();
                        } catch (err) {
                            alert(err.message || 'Xoá thất bại');
                        }
                    };
                    actions.appendChild(btnDel);
                }
                tbody.appendChild(tr);
            }
            if (r.data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center;padding:16px;">Chưa có phòng ban nào.</td></tr>';
            }
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="4" class="error" style="text-align:center;padding:16px;">Không thể tải danh sách phòng ban: ${err.message}</td></tr>`;
        }
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const id = idInput.value;
        const body = {
            name: fd.get('name').trim(),
            description: fd.get('description')?.trim() || null,
        };
        errEl.hidden = true;
        try {
            if (id) {
                await API.put('/departments/' + id, body);
            } else {
                await API.post('/departments', body);
            }
            closeModal();
            load();
        } catch (err) {
            errEl.textContent = err.message || 'Có lỗi xảy ra';
            errEl.hidden = false;
        }
    });

    closeModal();
    await load();
})();
