// js/attendance.js - face-based attendance
(async () => {
    if (!API.requireAuth()) return;
    try {
        const me = await API.me();
        document.getElementById('meName').textContent = me.data.full_name || me.data.username;
    } catch {}
    document.getElementById('btnLogout').addEventListener('click', () => API.logout());

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

    async function submitImage(blob, filename = 'capture.jpg') {
        const fd = new FormData();
        fd.append('file', blob, filename);
        resultBox.className = 'result-empty';
        resultBox.textContent = 'Đang xử lý...';
        try {
            const r = await API.post('/attendance/face-check', fd);
            const d = r.data;
            if (d.matched === false) {
                showResult('warn',
                    `<h3>Không nhận diện được</h3>
                     <p>Không có nhân viên nào trong hệ thống khớp với khuôn mặt này.</p>
                     <p class="result-meta">Distance: ${d.distance} (threshold: ${d.threshold})</p>`);
                return;
            }
            if (d.action === 'check_in') {
                showResult('ok',
                    `<h3>✅ Check-in thành công</h3>
                     <p><b>${d.employee.full_name}</b> (${d.employee.employee_code})</p>
                     <p>Trạng thái: <span class="badge badge-${d.attendance.status}">${d.attendance.status}</span></p>
                     <p class="result-meta">Độ tin cậy: ${(d.confidence * 100).toFixed(1)}%</p>`);
            } else if (d.action === 'check_out') {
                showResult('ok',
                    `<h3>👋 Check-out thành công</h3>
                     <p><b>${d.employee.full_name}</b> (${d.employee.employee_code})</p>
                     <p>Trạng thái: <span class="badge badge-${d.attendance.status}">${d.attendance.status}</span></p>
                     <p class="result-meta">Độ tin cậy: ${(d.confidence * 100).toFixed(1)}%</p>`);
            } else {
                showResult('warn', `<p>${d.message || 'Đã chấm công xong cho hôm nay.'}</p>`);
            }
            loadMyHistory();
        } catch (err) {
            if (err.data && err.data.error === 'NO_FACE') {
                showResult('err', '<h3>Không thấy khuôn mặt</h3><p>Vui lòng đưa mặt vào khung hình rõ hơn.</p>');
            } else {
                showResult('err', '<h3>Lỗi</h3><p>' + (err.message || 'Không rõ') + '</p>');
            }
        }
    }

    btnStart.addEventListener('click', async () => {
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
            video.srcObject = stream;
            btnCapture.disabled = false;
        } catch (err) {
            alert('Không mở được camera: ' + err.message);
        }
    });

    btnStop.addEventListener('click', () => {
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
            video.srcObject = null;
            btnCapture.disabled = true;
        }
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
        try {
            const r = await API.get('/attendance/me');
            myAttBody.innerHTML = '';
            for (const row of r.data) {
                const tr = document.createElement('tr');
                const ci = row.check_in  ? new Date(row.check_in).toLocaleTimeString('vi-VN')  : '-';
                const co = row.check_out ? new Date(row.check_out).toLocaleTimeString('vi-VN') : '-';
                const conf = row.confidence_in || row.confidence_out || null;
                tr.innerHTML = `<td>${row.date}</td><td>${ci}</td><td>${co}</td>
                    <td><span class="badge badge-${row.status}">${row.status}</span></td>
                    <td>${conf ? (parseFloat(conf) * 100).toFixed(1) + '%' : '-'}</td>`;
                myAttBody.appendChild(tr);
            }
            if (r.data.length === 0) {
                myAttBody.innerHTML = '<tr><td colspan="5" class="muted">Chưa có dữ liệu chấm công.</td></tr>';
            }
        } catch (err) {
            // employee without linked profile -> 403
        }
    }
    await loadMyHistory();
})();
