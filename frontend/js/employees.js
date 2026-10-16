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

    async function loadDepts() {
        const r = await API.get('/departments');
        deptFilt.innerHTML = '<option value="">-- Phòng ban --</option>';
        empDept.innerHTML  = '<option value="">--</option>';
        for (const d of r.data) {
            const o1 = new Option(d.name, d.id);
            const o2 = new Option(d.name, d.id);
            deptFilt.add(o1);
            empDept.add(o2);
        }
    }

    async function load() {
        const params = new URLSearchParams();
        if (search.value) params.set('search', search.value);
        if (deptFilt.value) params.set('department_id', deptFilt.value);
        if (status.value)   params.set('status', status.value);
        const r = await API.get('/employees?' + params.toString());
        tbody.innerHTML = '';
        for (const e of r.data) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${e.employee_code}</td>
                <td>${e.full_name}</td>
                <td>${e.department_name || '-'}</td>
                <td>${e.position || '-'}</td>
                <td><span class="badge badge-${e.status}">${e.status}</span></td>
                <td>${e.has_face ? '✅' : '❌'}</td>
                <td></td>`;
            const actions = tr.lastElementChild;
            if (e.status === 'active') {
                const btnTerm = document.createElement('button');
                btnTerm.className = 'btn btn-danger';
                btnTerm.textContent = 'Nghỉ việc';
                btnTerm.onclick = async () => {
                    if (!confirm(`Cho nhân viên ${e.full_name} nghỉ việc?`)) return;
                    try { await API.del('/employees/' + e.id); load(); }
                    catch (err) { alert(err.message); }
                };
                actions.appendChild(btnTerm);
            }
            tbody.appendChild(tr);
        }
    }

    document.getElementById('btnReload').addEventListener('click', load);
    search.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
    deptFilt.addEventListener('change', load);
    status.addEventListener('change', load);

    document.getElementById('btnNewEmp').addEventListener('click', () => {
        form.reset();
        modalTitle.textContent = 'Thêm nhân viên';
        document.getElementById('empFormError').hidden = true;
        modal.hidden = false;
    });
    document.getElementById('btnCancel').addEventListener('click', () => { modal.hidden = true; });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const errEl = document.getElementById('empFormError');
        errEl.hidden = true;
        try {
            await API.post('/employees', fd);
            modal.hidden = true;
            load();
        } catch (err) {
            errEl.textContent = err.message;
            errEl.hidden = false;
        }
    });

    await loadDepts();
    await load();
})();
