// js/attendance.js - face-based attendance
(async () => {
    if (!API.requireAuth()) return;
    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

    const currentUser = API.getUser();
    if (currentUser && currentUser.role === 'kiosk') {
        const nav = document.querySelector('.topbar nav');
        if (nav) {
            nav.innerHTML = '<span style="color:#93c5fd;font-weight:600;display:flex;align-items:center;gap:6px;"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Máy chấm công Kiosk (Cửa ra vào)</span>';
        }
        const brandSm = document.querySelector('.topbar .brand-sm');
        if (brandSm) brandSm.textContent = 'HRM KIOSK';
        const pageH1 = document.querySelector('main h1');
        if (pageH1) {
            pageH1.innerHTML = 'Máy chấm công khuôn mặt <span style="font-size:0.55em;color:#0284c7;font-weight:600;padding:4px 10px;background:#e0f2fe;border-radius:12px;margin-left:8px;vertical-align:middle;display:inline-block;">Kiosk Cửa ra vào</span>';
        }
    }

    const video      = document.getElementById('video');
    const btnStart   = document.getElementById('btnStartCam');
    const btnStop    = document.getElementById('btnStopCam');
    const btnCapture = document.getElementById('btnCapture');
    const fileInput  = document.getElementById('fileInput');
    const resultBox  = document.getElementById('resultBox');
    const myAttBody  = document.querySelector('#myAttTable tbody');
    let stream = null;

    function showResult(kind, html) {
        resultBox.className = 'result-' + kind;
        resultBox.innerHTML = html;
    }

    const statusMap = {
        on_time: '<span class="badge badge-on-time">Đến đúng giờ</span>',
        late: '<span class="badge badge-late">Đi muộn</span>',
        early_leave: '<span class="badge badge-early-leave">Về sớm</span>',
        absent: '<span class="badge badge-absent">Vắng mặt</span>'
    };

    async function submitImage(blob, filename = 'capture.jpg') {
        const fd = new FormData();
        fd.append('file', blob, filename);
        resultBox.className = 'result-empty';
        resultBox.textContent = 'Đang xử lý nhận diện khuôn mặt...';
        btnCapture.disabled = true;
        try {
            const r = await API.post('/attendance/face-check', fd);
            const d = r.data;
            if (d.matched === false) {
                showResult('warn',
                    `<h3>Không nhận diện được</h3>
                     <p>Không có nhân viên nào trong hệ thống khớp với khuôn mặt này.</p>
                     <p class="result-meta">Độ sai lệch: ${d.distance} (ngưỡng: ${d.threshold})</p>`);
                return;
            }
            const stBadge = (d.attendance && statusMap[d.attendance.status]) || `<span class="badge">${(d.attendance && d.attendance.status) || ''}</span>`;

            if (d.action === 'check_in') {
                showResult('ok',
                    `<h3>Điểm danh vào thành công</h3>
                     <p><b>${API.escapeHtml(d.employee.full_name)}</b> (${API.escapeHtml(d.employee.employee_code)})</p>
                     <p>Trạng thái: ${stBadge}</p>
                     <p class="result-meta">Độ tin cậy: ${(d.confidence * 100).toFixed(1)}%</p>`);
            } else if (d.action === 'check_out') {
                showResult('ok',
                    `<h3>Điểm danh ra thành công</h3>
                     <p><b>${API.escapeHtml(d.employee.full_name)}</b> (${API.escapeHtml(d.employee.employee_code)})</p>
                     <p>Trạng thái: ${stBadge}</p>
                     <p class="result-meta">Độ tin cậy: ${(d.confidence * 100).toFixed(1)}%</p>`);
            } else {
                let msg = d.message || 'Đã hoàn thành điểm danh vào và ra cho ngày hôm nay.';
                if (msg.toLowerCase().includes('already checked')) {
                    msg = 'Nhân viên đã hoàn thành điểm danh vào và ra cho ngày hôm nay.';
                }
                showResult('warn', `<h3>Thông báo</h3><p>${msg}</p>`);
            }
            loadMyHistory();
        } catch (err) {
            let errMsg = (err.data && (err.data.message || err.data.error)) || err.message || 'Không rõ lỗi';
            if (err.data && (err.data.error === 'NO_FACE' || err.data.message === 'No face detected in image')) {
                errMsg = 'Không tìm thấy khuôn mặt trong ảnh. Vui lòng đưa khuôn mặt vào giữa khung hình rõ ràng.';
            } else if (err.data && err.data.error === 'NO_ENROLLED_EMPLOYEE') {
                errMsg = 'Chưa có nhân viên nào đăng ký khuôn mặt trong hệ thống.';
            } else if (err.data && (err.data.error === 'AI service unavailable' || err.data.error === 'Dịch vụ AI nhận diện không khả dụng')) {
                errMsg = 'Dịch vụ AI nhận diện khuôn mặt hiện chưa sẵn sàng.';
            }
            showResult('err', `<h3>Lỗi chấm công</h3><p>${errMsg}</p>`);
        } finally {
            if (stream) btnCapture.disabled = false;
        }
    }

    btnStart.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            video.srcObject = stream;
            btnCapture.disabled = false;
            btnStart.disabled = true;
            btnStop.disabled = false;
        } catch (e) {
            alert('Không mở được camera: ' + e.message);
        }
    });

    btnStop.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
            video.srcObject = null;
        }
        btnCapture.disabled = true;
        btnStart.disabled = false;
        btnStop.disabled = true;
    });

    btnCapture.addEventListener('click', () => {
        if (!stream) return;
        const canvas = document.createElement('canvas');
        canvas.width  = video.videoWidth  || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => submitImage(blob, 'capture.jpg'), 'image/jpeg', 0.85);
    });

    fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if (f) submitImage(f, f.name);
    });

    async function loadMyHistory() {
        const user = API.getUser();
        const canViewCompanyHistory = user && (user.role === 'admin' || user.role === 'hr' || user.role === 'kiosk');
        const titleEl = document.getElementById('attHistoryTitle');
        if (titleEl) {
            titleEl.textContent = 'Lịch sử chấm công gần đây';
        }

        try {
            const endpoint = canViewCompanyHistory ? '/attendance?limit=30' : '/attendance/me';
            const r = await API.get(endpoint);
            myAttBody.innerHTML = '';
            const rows = r.data || [];

            if (rows.length === 0) {
                myAttBody.innerHTML = '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px;">Chưa có dữ liệu chấm công.</td></tr>';
                return;
            }

            for (const row of rows) {
                const tr = document.createElement('tr');
                const dateStr = row.date ? (row.date.slice ? row.date.slice(0, 10) : new Date(row.date).toLocaleDateString('vi-VN')) : '-';
                const ci = row.check_in  ? new Date(row.check_in).toLocaleTimeString('vi-VN')  : '-';
                const co = row.check_out ? new Date(row.check_out).toLocaleTimeString('vi-VN') : '-';
                const conf = row.confidence_in || row.confidence_out || null;
                const empInfo = row.full_name
                    ? `<strong>${API.escapeHtml(row.employee_code)}</strong> - ${API.escapeHtml(row.full_name)}`
                    : (row.employee_code ? `<strong>${API.escapeHtml(row.employee_code)}</strong>` : 'Tôi');

                let badgesHtml = '';
                const inStatus = row.check_in_status || (row.status === 'late' ? 'late' : (row.status === 'absent' ? 'absent' : 'on_time'));
                const outStatus = row.check_out_status || (row.status === 'early_leave' ? 'early_leave' : (row.check_out ? 'on_time' : null));

                if (row.status === 'absent') {
                    badgesHtml = '<span class="badge badge-absent">Vắng mặt</span>';
                } else if (inStatus === 'on_time' && outStatus === 'early_leave') {
                    badgesHtml = '<span class="badge badge-on-time">Đến đúng giờ</span> <span class="badge badge-early-leave">Về sớm</span>';
                } else if (inStatus === 'late' && outStatus === 'early_leave') {
                    badgesHtml = '<span class="badge badge-late">Đi muộn</span> <span class="badge badge-early-leave">Về sớm</span>';
                } else if (inStatus === 'late') {
                    badgesHtml = '<span class="badge badge-late">Đi muộn</span>';
                } else if (inStatus === 'on_time') {
                    badgesHtml = '<span class="badge badge-on-time">Đúng giờ</span>';
                } else {
                    badgesHtml = `<span class="badge">${row.status}</span>`;
                }

                tr.innerHTML = `
                    <td>${dateStr}</td>
                    <td>${empInfo}</td>
                    <td>${ci}</td>
                    <td>${co}</td>
                    <td>${badgesHtml}</td>
                    <td>${conf ? (parseFloat(conf) * 100).toFixed(1) + '%' : '-'}</td>
                `;
                myAttBody.appendChild(tr);
            }
        } catch (err) {
            myAttBody.innerHTML = `<tr><td colspan="6" class="error" style="text-align:center;padding:16px;">Lỗi tải lịch sử chấm công: ${err.message}</td></tr>`;
        }
    }

    const btnReloadAtt = document.getElementById('btnReloadAtt');
    if (btnReloadAtt) btnReloadAtt.addEventListener('click', loadMyHistory);

    await loadMyHistory();
})();
