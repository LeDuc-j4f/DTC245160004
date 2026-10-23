// js/auth.js - login page logic
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const username = fd.get('username');
    const password = fd.get('password');
    const errEl = document.getElementById('loginError');
    errEl.hidden = true;
    try {
        const res = await API.login(username, password);
        if (res && res.user && (res.user.role === 'employee' || res.user.role === 'kiosk')) {
            location.href = 'attendance.html';
        } else {
            location.href = 'dashboard.html';
        }
    } catch (err) {
        errEl.textContent = err.message || 'Đăng nhập thất bại';
        errEl.hidden = false;
    }
});
