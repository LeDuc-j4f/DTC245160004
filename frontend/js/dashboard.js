// js/dashboard.js
(async () => {
    if (!API.requireAuth()) return;

    // topbar: user info + logout
    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    try {
        const r = await API.get('/dashboard/overview');
        const d = r.data;
        document.getElementById('todayLabel').textContent = 'Hôm nay: ' + d.today;
        document.getElementById('statActive').textContent  = d.employees.active_employees;
        document.getElementById('statOnTime').textContent  = d.today_stats.on_time;
        document.getElementById('statLate').textContent    = d.today_stats.late;
        document.getElementById('statAbsent').textContent  = d.today_stats.absent;

        const trendBody = document.querySelector('#trendTable tbody');
        trendBody.innerHTML = '';
        for (const row of d.trend_7_days) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.date}</td>
                <td><span class="badge badge-on-time">${row.on_time}</span></td>
                <td><span class="badge badge-late">${row.late}</span></td>
                <td><span class="badge badge-early-leave">${row.early_leave}</span></td>
                <td><span class="badge badge-absent">${row.absent}</span></td>`;
            trendBody.appendChild(tr);
        }

        const lateBody = document.querySelector('#topLateTable tbody');
        lateBody.innerHTML = '';
        if (d.top_late_this_month.length === 0) {
            lateBody.innerHTML = '<tr><td colspan="3" class="muted">Chưa có dữ liệu</td></tr>';
        }
        for (const row of d.top_late_this_month) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${row.employee_code}</td><td>${row.full_name}</td><td>${row.late_count}</td>`;
            lateBody.appendChild(tr);
        }

        const recBody = document.querySelector('#recentTable tbody');
        recBody.innerHTML = '';
        if (d.recent.length === 0) {
            recBody.innerHTML = '<tr><td colspan="4" class="muted">Chưa có hoạt động trong 1 giờ qua</td></tr>';
        }
        for (const r of d.recent) {
            const tr = document.createElement('tr');
            const t = r.check_out || r.check_in;
            const kind = r.check_out ? 'Check-out' : 'Check-in';
            tr.innerHTML = `<td>${new Date(t).toLocaleString('vi-VN')}</td>
                <td>${r.employee_code} - ${r.full_name}</td>
                <td>${kind}</td>
                <td><span class="badge badge-${r.status}">${r.status}</span></td>`;
            recBody.appendChild(tr);
        }
    } catch (err) {
        alert('Lỗi tải dashboard: ' + err.message);
    }
})();
