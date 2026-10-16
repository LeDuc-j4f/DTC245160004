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
    const user  = API.getUser();

    async function load() {
        const r = await API.get('/departments');
        tbody.innerHTML = '';
        for (const d of r.data) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${d.name}</td><td>${d.description || '-'}</td><td>${d.employee_count}</td><td></td>`;
            const actions = tr.lastElementChild;
            if (user && (user.role === 'admin' || user.role === 'hr')) {
                const del = document.createElement('button');
                del.className = 'btn btn-danger';
                del.textContent = 'Xoá';
                del.onclick = async () => {
                    if (!confirm(`Xoá phòng ban "${d.name}"?`)) return;
                    try { await API.del('/departments/' + d.id); load(); }
                    catch (err) { alert(err.message); }
                };
                actions.appendChild(del);
            }
            tbody.appendChild(tr);
        }
    }

    document.getElementById('btnNewDept').addEventListener('click', () => {
        if (!user || user.role === 'employee') return alert('Bạn không có quyền');
        form.reset();
        document.getElementById('deptFormError').hidden = true;
        modal.hidden = false;
    });
    document.getElementById('btnCancel').addEventListener('click', () => { modal.hidden = true; });
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const body = { name: fd.get('name'), description: fd.get('description') || null };
        const errEl = document.getElementById('deptFormError');
        errEl.hidden = true;
        try { await API.post('/departments', body); modal.hidden = true; load(); }
        catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
    });

    await load();
})();
