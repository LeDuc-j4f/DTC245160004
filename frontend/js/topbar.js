// topbar - topbar.js (used by all authenticated pages) -- inline import via DOMContentLoaded
(function () {
    // ensure meName is shown + logout button works on every page
    const nameEl  = document.getElementById('meName');
    const btnOut  = document.getElementById('btnLogout');
    if (btnOut) btnOut.addEventListener('click', () => API.logout());
    if (nameEl && API.getToken()) {
        API.me().then(r => { nameEl.textContent = (r.data && (r.data.full_name || r.data.username)) || 'User'; })
                .catch(() => {});
    }
})();
