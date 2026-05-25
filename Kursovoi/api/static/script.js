/**
 * 🛍️ VioBlack Market — Полный функционал
 * Поиск, фильтры, сортировка, избранное, авторизация
 */

// === КОНФИГУРАЦИЯ ===
const API_BASE = 'http://127.0.0.1:8000/api';
// FAV_KEY больше не нужен — избранное хранится на сервере

// === УТИЛИТЫ ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getToken() { return localStorage.getItem('vb_token'); }

function getUser() {
    const token = getToken();
    if (!token) return null;
    const parts = token.split(':');
    return parts.length >= 2 ? { username: parts[0], role: parts[1] } : null;
}

function logout() {
    localStorage.removeItem('vb_token');
    window.location.href = '/login.html';
}

// 🔥 API с обработкой ошибок
async function api(url, options = {}) {
    const token = getToken();
    const headers = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (!(options.body instanceof FormData)) headers['content-type'] = 'application/json';

    try {
        const res = await fetch(`${API_BASE}${url}`, { ...options, headers });
        const text = await res.text();
        if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
            throw new Error('Сервер вернул ошибку. Попробуйте позже.');
        }
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) throw new Error(data.detail || data.message || `Ошибка: ${res.status}`);
        return data;
    } catch (err) {
        if (err instanceof SyntaxError && err.message.includes('JSON')) {
            throw new Error('Некорректный ответ сервера');
        }
        throw err;
    }
}

// === ❤️ ИЗБРАННОЕ — СИНХРОНИЗАЦИЯ С СЕРВЕРОМ ===
// Глобальный кеш избранного (чтобы не запрашивать каждый раз)
let favoriteIds = [];

// Загружаем избранное с сервера (список ID)
async function loadFavorites() {
    try {
        favoriteIds = await api('/favorites'); // Теперь приходит [1, 5, 12]
        return favoriteIds;
    } catch (err) {
        console.error('❌ Load favorites:', err);
        favoriteIds = [];
        return [];
    }
}

// Добавляем/удаляем товар из избранного
async function toggleFavorite(productId) {
    const isFav = favoriteIds.includes(productId);
    
    try {
        if (isFav) {
            await api(`/favorites/${productId}`, { method: 'DELETE' });
            favoriteIds = favoriteIds.filter(id => id !== productId);
            showNotification('🤍 Удалено из избранного', 'success');
        } else {
            await api('/favorites', { 
                method: 'POST', 
                body: JSON.stringify({ product_id: productId }) 
            });
            favoriteIds.push(productId);
            showNotification('❤️ Добавлено в избранное', 'success');
        }
        // Обновляем иконки локально (быстро)
        updateFavoriteIconsLocal();
        // Если открыта вкладка избранного — перерисовываем
        if (!$('#view-FAVORITES')?.classList.contains('hidden')) {
            renderFavoritesGridLocal();
        }
    } catch (err) {
        showNotification('❌ ' + getErrorMessage(err), 'error');
    }
}

// Обновляем иконки ♥/♡ (локально, без запроса к серверу)
function updateFavoriteIconsLocal() {
    $$('.product-favorite').forEach(btn => {
        const pid = parseInt(btn.dataset.pid);
        if (pid) {
            if (favoriteIds.includes(pid)) {
                btn.textContent = '♥';
                btn.classList.add('active');
            } else {
                btn.textContent = '♡';
                btn.classList.remove('active');
            }
        }
    });
}

// Проверяем, есть ли товар в избранном (локально)
function isFavorite(productId) { return favoriteIds.includes(productId); }

// === 🎨 ТОВАРЫ ===
let allProducts = [];

async function loadProducts() {
    try {
        // Сначала загружаем избранное, потом товары
        await loadFavorites();
        allProducts = await api('/products');
        applyFiltersAndSort();
        updateFavoriteIconsLocal();
    } catch (err) {
        console.error('❌ Load products:', err);
        const grid = $('#product-grid');
        if (grid) grid.innerHTML = '<p style="color:var(--error);grid-column:1/-1;text-align:center">Ошибка загрузки</p>';
    }
}

function getFilterValues() {
    return {
        search: $('#search-input')?.value?.toLowerCase().trim() || '',
        category: $('#category-filter')?.value || 'all',
        sort: $('#sort-filter')?.value || 'default'
    };
}

function applyFiltersAndSort() {
    const { search, category, sort } = getFilterValues();
    let filtered = allProducts.filter(p => {
        const matchSearch = !search || p.name.toLowerCase().includes(search) || p.description?.toLowerCase().includes(search);
        const matchCat = category === 'all' || p.category === category;
        return matchSearch && matchCat && p.is_active !== false;
    });
    switch (sort) {
        case 'cheap': filtered.sort((a, b) => a.price - b.price); break;
        case 'expensive': filtered.sort((a, b) => b.price - a.price); break;
        case 'name': filtered.sort((a, b) => a.name.localeCompare(b.name, 'ru')); break;
    }
    renderProductGrid(filtered);
    $('#products-count').textContent = filtered.length;
}

function renderProductGrid(products) {
    const grid = $('#product-grid');
    if (!grid) return;
    if (!products?.length) { grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text-muted)">Товары не найдены</p>'; return; }
    
    grid.innerHTML = products.map(p => {
        const discount = p.is_discount_active && p.discount_percent > 0 ? p.discount_percent : 0;
        const displayPrice = p.final_price || p.price;
        const oldPrice = discount > 0 ? Math.round(p.price) : null;
        const badge = p.sales > 40 ? '<div class="product-badge bestseller">🔥 ХИТ</div>' : (discount > 0 ? `<div class="product-badge sale">−${discount}%</div>` : '');
        const favActive = isFavorite(p.id) ? 'active' : '';
        let productImage;
        if (p.image_url?.startsWith('/uploads/')) {
            productImage = `<img src="${p.image_url}" alt="${p.name}" class="product-image" loading="lazy" onerror="this.style.display='none';this.parentElement.style.background='linear-gradient(135deg,#2a2a4a,#3a3a6a)'">`;
        } else {
            const colors = { 'Электроника': '#7c3aed', 'Одежда': '#00c853', 'Дом': '#ff6b35' };
            const color = colors[p.category] || '#6b7280';
            productImage = `<div class="product-image" style="background:linear-gradient(135deg,${color},${color}cc);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:18px;text-align:center;padding:20px">${p.name.length>20?p.name.substring(0,20)+'…':p.name}</div>`;
        }
        return `
            <div class="product-card">
                <div class="product-image-container">
                    ${badge}
                    <div class="product-favorite ${favActive}" data-pid="${p.id}" onclick="toggleFavorite(${p.id})">${isFavorite(p.id)?'♥':'♡'}</div>
                    ${productImage}
                </div>
                <div class="product-info">
                    <div class="product-price-block">
                        <span class="product-price ${discount>0?'with-discount':''}">${Math.round(displayPrice)}</span><span class="product-price-currency">₽</span>
                        ${oldPrice ? `<span class="product-old-price">${oldPrice} ₽</span>` : ''}
                        ${discount>0 ? `<span class="product-discount">−${discount}%</span>` : ''}
                    </div>
                    <div class="product-rating"><span style="color:#fbbf24">★</span> <span style="color:#ccc">${(3.5+Math.random()*1.5).toFixed(1)}</span><span style="color:#555;font-size:12px">(${Math.floor(Math.random()*200)+10})</span></div>
                    <h3 class="product-name">${p.name}</h3>
                    <div class="product-category">${p.category}</div>
                    <div class="product-actions">
                        <button class="btn-add-cart" onclick="addToCart(${p.id})">В корзину</button>
                        <button class="btn-buy" onclick="buyProduct(${p.id})">Купить</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

// === ❤️ ИЗБРАННОЕ ГРИД — УДАЛЯЕМ (теперь используем renderFavoritesGridLocal) ===

// === 🌐 ГЛОБАЛЬНЫЕ ФУНКЦИИ ===
window.buyProduct = async (id) => {
    try { await api(`/products/${id}/buy`, { method: 'POST' }); showNotification('✅ Куплено!', 'success'); loadProducts(); if (getUser()?.role!=='USER') updateStats(); }
    catch (err) { showNotification('❌ ' + getErrorMessage(err), 'error'); }
};
window.addToCart = async (id) => {
    try { await api('/cart', { method: 'POST', body: JSON.stringify({ product_id: id, quantity: 1 }) }); showNotification('✅ В корзине!', 'success'); }
    catch (err) { showNotification('❌ ' + getErrorMessage(err), 'error'); }
};
window.toggleFavorite = toggleFavorite;
window.switchView = (view) => {
    $$('.nav-link').forEach(b => b.classList.remove('active'));
    $$('.view').forEach(v => v.classList.add('hidden'));
    $(`.nav-link[data-view="${view}"]`)?.classList.add('active');
    $(`#view-${view}`)?.classList.remove('hidden');
    if (view === 'FAVORITES') renderFavoritesGridLocal();
    if (['ADMIN','MANAGER'].includes(view)) updateStats();
};

function showNotification(msg, type = 'success') {
    let el = document.getElementById('app-notification');
    if (!el) {
        el = document.createElement('div'); el.id = 'app-notification';
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 20px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);z-index:1000;display:flex;align-items:center;gap:12px;max-width:340px;animation:slideIn 0.3s ease;';
        document.body.appendChild(el);
    }
    el.innerHTML = `<span style="font-size:18px">${type==='success'?'✅':'❌'}</span><span>${msg}</span>`;
    el.style.borderLeft = `4px solid ${type==='success'?'var(--success)':'var(--error)'}`;
    el.style.display = 'flex';
    setTimeout(() => { el.style.animation='slideOut 0.3s ease forwards'; setTimeout(()=>el.style.display='none',300); }, type==='success'?3000:5000);
}

function getErrorMessage(err) {
    if (!err) return 'Неизвестная ошибка';
    if (typeof err.detail === 'string') return formatServerError(err.detail);
    if (Array.isArray(err.detail)) return err.detail.map(e => `${e.loc?.[1]||'Поле'}: ${e.msg||'ошибка'}`).join('; ');
    return err.message || 'Произошла ошибка';
}
function formatServerError(msg) {
    const m = { 'Корзина пуста':'🛒 Корзина пуста', 'Товар не найден':'❌ Товар недоступен', 'Недостаточно товара':'⚠️ Недостаточно на складе', 'Требуется авторизация':'🔐 Войдите в аккаунт', 'Пользователь существует':'👤 Такой пользователь уже есть' };
    for (const [k,v] of Object.entries(m)) if (msg.includes(k)) return v;
    return msg;
}

// === 📊 СТАТИСТИКА ===
async function updateStats() {
    try {
        const user = getUser();
        if (!user || !['ADMIN','MANAGER'].includes(user.role)) return;
        const products = await api('/products').catch(()=>[]);
        const orders = await api('/orders').catch(()=>[]);
        const totalRevenue = orders.reduce((s,o)=>s+(o.total_amount||0),0);
        const totalSold = orders.reduce((s,o)=>s+o.items?.reduce((x,i)=>x+(i.quantity||0),0)||0,0);
        const netRevenue = orders.reduce((s,o)=>s+o.items?.reduce((x,i)=>x+(i.price_at_order||0)*(i.quantity||0),0)||0,0);
        const activeCount = products.filter(p=>p.is_active!==false).length;
        const convRate = Math.min(Math.round((new Set(orders.map(o=>o.user_id)).size/10)*100),100);
        if (user.role==='ADMIN') { safeSetText('admin-revenue', `${Math.round(totalRevenue)} ₽`); safeSetText('admin-sold', totalSold); }
        if (['ADMIN','MANAGER'].includes(user.role)) { safeSetText('manager-revenue', `${Math.round(netRevenue)} ₽`); safeSetText('manager-sold', totalSold); safeSetText('manager-conversion', `${convRate}%`); safeSetText('manager-products', activeCount); }
    } catch (err) { console.error('Stats error:', err); }
}
function safeSetText(id, text) { const el = $(`#${id}`); if (el) el.textContent = text; }

// === ⚙️ АДМИН ===
function initAdmin() {
    console.log('🔧 Admin initialized');
    $('#p-image')?.addEventListener('change', function() { $('#file-name').textContent = this.files?.[0]?.name || 'Файл не выбран'; });
    $('#add-product-btn')?.addEventListener('click', async () => {
        const name = $('#p-name')?.value?.trim(), cat = $('#p-cat')?.value, price = parseFloat($('#p-price')?.value), stock = parseInt($('#p-stock')?.value) || 100, desc = $('#p-desc')?.value?.trim() || '', img = $('#p-image')?.files?.[0];
        if (!name || !price || !cat) return alert('⚠️ Заполните обязательные поля');
        try {
            const fd = new FormData(); fd.append('name',name); fd.append('category',cat); fd.append('price',price); fd.append('stock',stock); fd.append('description',desc); if (img) fd.append('image',img);
            const res = await fetch(`${API_BASE}/products`, { method:'POST', headers:{'authorization':`Bearer ${getToken()}`}, body:fd });
            const text = await res.text(); if (!res.ok) throw JSON.parse(text);
            alert('✅ Товар добавлен!'); ['p-name','p-desc','p-price','p-cat'].forEach(id=>{if($(`#${id}`))$(`#${id}`).value='';}); if($('#p-image')){$('#p-image').value='';$('#file-name').textContent='Файл не выбран';}
            loadProducts(); updateStats();
        } catch (err) { alert('❌ ' + getErrorMessage(err)); }
    });
}
function initManager() { console.log('📊 Manager initialized'); updateStats(); }

// === 🔐 АВТОРИЗАЦИЯ (ДЛЯ LOGIN.HTML) ===
function initLogin() {
    console.log('🔐 Login page initialized');
    if (getToken()) { window.location.href = '/index.html'; return; }
    
    const form = $('#login-form');
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    const errorDiv = $('#login-error');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errorDiv) errorDiv.style.display = 'none';
        const username = $('#username')?.value?.trim(), password = $('#password')?.value;
        if (!username || !password) { if (errorDiv) { errorDiv.textContent = '⚠️ Введите логин и пароль'; errorDiv.style.display = 'block'; } else alert('⚠️ Введите логин и пароль'); return; }
        if (btn) { btn.disabled = true; btn.textContent = 'Вход...'; }
        try {
            const res = await api('/login', { method:'POST', body:JSON.stringify({username,password}) });
            localStorage.setItem('vb_token', res.access_token);
            window.location.href = '/index.html';
        } catch (err) {
            if (errorDiv) { errorDiv.textContent = '❌ ' + getErrorMessage(err); errorDiv.style.display = 'block'; }
            else alert('❌ ' + getErrorMessage(err));
        } finally { if (btn) { btn.disabled = false; btn.textContent = 'Авторизовать Доступ'; } }
    });
}

// === 📝 РЕГИСТРАЦИЯ (ДЛЯ REGISTR.HTML) ===
function initRegister() {
    console.log('📝 Register page initialized');
    const form = $('#register-form');
    if (!form) return;
    const btn = form.querySelector('button[type="submit"]');
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = $('#username')?.value?.trim(), password = $('#password')?.value, confirm = $('#password-confirm')?.value;
        if (password !== confirm) { alert('❌ Пароли не совпадают!'); return; }
        if (!username || !password) { alert('❌ Заполните все поля!'); return; }
        if (btn) { btn.disabled = true; btn.textContent = 'Регистрация...'; }
        try {
            await api('/register', { method:'POST', body:JSON.stringify({username,password,role:'USER'}) });
            alert('✅ Регистрация успешна! Войдите.');
            window.location.href = '/login.html';
        } catch (err) { alert('❌ ' + getErrorMessage(err)); }
        finally { if (btn) { btn.disabled = false; btn.textContent = 'Зарегистрироваться'; } }
    });
}

// === 🚀 ИНИЦИАЛИЗАЦИЯ ПО СТРАНИЦАМ ===
document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.dataset.page;
    console.log(`📄 Page: ${page}`);
    
    if (page === 'login') { initLogin(); return; }
    if (page === 'register') { initRegister(); return; }
    if (page !== 'main') return;
    
    // === INDEX.HTML ===
    const user = getUser();
    if (!user) { window.location.href = '/login.html'; return; }
    
    // Профиль
    $('#current-username').textContent = user.username;
    $('#current-role').textContent = {ADMIN:'Админ', MANAGER:'Менеджер', USER:'Покупатель'}[user.role] || 'Покупатель';
    $('#user-avatar').textContent = user.username[0]?.toUpperCase() || '👤';
    
    // Меню по ролям
    if (user.role==='ADMIN') $('#admin-nav')?.classList.remove('hidden');
    if (['MANAGER','ADMIN'].includes(user.role)) $('#manager-nav')?.classList.remove('hidden');
    
    // Выход
    $('#logout-btn')?.addEventListener('click', () => { localStorage.removeItem('vb_token'); window.location.href='/login.html'; });
    
    // Переключение вкладок
    $$('.nav-link[data-view]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = btn.dataset.view;
            $$('.nav-link').forEach(b => b.classList.remove('active'));
            $$('.view').forEach(v => v.classList.add('hidden'));
            btn.classList.add('active');
            $(`#view-${view}`)?.classList.remove('hidden');
            if (view === 'FAVORITES') renderFavoritesGridLocal();
            if (['ADMIN','MANAGER'].includes(view)) updateStats();
        });
    });
    
    // 🔎 Поиск и фильтры
    $('#search-input')?.addEventListener('input', applyFiltersAndSort);
    $('#category-filter')?.addEventListener('change', applyFiltersAndSort);
    $('#sort-filter')?.addEventListener('change', applyFiltersAndSort);
    $('#reset-filters')?.addEventListener('click', () => {
        if ($('#search-input')) $('#search-input').value = '';
        if ($('#category-filter')) $('#category-filter').value = 'all';
        if ($('#sort-filter')) $('#sort-filter').value = 'default';
        applyFiltersAndSort();
    });
    
    // 🔎 Поиск в избранном
    $('#fav-search-input')?.addEventListener('input', () => {
        const search = $('#fav-search-input')?.value?.toLowerCase().trim() || '';
        const filtered = allProducts.filter(p => favoriteIds.includes(p.id) && (!search || p.name.toLowerCase().includes(search)));
        $('#favorites-count').textContent = filtered.length;
        renderFavoritesGridLocal();
    });
    $('#clear-fav-search')?.addEventListener('click', () => { if ($('#fav-search-input')) $('#fav-search-input').value = ''; renderFavoritesGridLocal(); });
    
    // Загрузка
    await loadProducts();
    if (user.role==='ADMIN') initAdmin();
    if (['MANAGER','ADMIN'].includes(user.role)) initManager();
    
    console.log('✅ App initialized');
}); 

// === ❤️ ИЗБРАННОЕ — ИСПРАВЛЕННОЕ ===

// Глобальный кеш избранного (чтобы не запрашивать каждый раз)
let favoriteIds = [];

// Загружаем избранное с сервера (список ID)
async function loadFavorites() {
    try {
        favoriteIds = await api('/favorites'); // Теперь приходит [1, 5, 12]
        return favoriteIds;
    } catch (err) {
        console.error('❌ Load favorites:', err);
        favoriteIds = [];
        return [];
    }
}

// Добавляем/удаляем товар из избранного
async function toggleFavorite(productId) {
    const isFav = favoriteIds.includes(productId);
    
    try {
        if (isFav) {
            await api(`/favorites/${productId}`, { method: 'DELETE' });
            favoriteIds = favoriteIds.filter(id => id !== productId);
            showNotification('🤍 Удалено из избранного', 'success');
        } else {
            await api('/favorites', { 
                method: 'POST', 
                body: JSON.stringify({ product_id: productId }) 
            });
            favoriteIds.push(productId);
            showNotification('❤️ Добавлено в избранное', 'success');
        }
        // Обновляем иконки локально (быстро)
        updateFavoriteIconsLocal();
        // Если открыта вкладка избранного — перерисовываем
        if (!$('#view-FAVORITES')?.classList.contains('hidden')) {
            renderFavoritesGridLocal();
        }
    } catch (err) {
        showNotification('❌ ' + getErrorMessage(err), 'error');
    }
}

// Обновляем иконки ♥/♡ (локально, без запроса к серверу)
function updateFavoriteIconsLocal() {
    $$('.product-favorite').forEach(btn => {
        const pid = parseInt(btn.dataset.pid);
        if (pid) {
            if (favoriteIds.includes(pid)) {
                btn.textContent = '♥';
                btn.classList.add('active');
            } else {
                btn.textContent = '♡';
                btn.classList.remove('active');
            }
        }
    });
}

// === ❤️ ИЗБРАННОЕ — ОТРИСОВКА (локальная, без лишних запросов) ===
function renderFavoritesGridLocal() {
    const grid = $('#favorites-grid');
    if (!grid) return;
    
    // Фильтруем уже загруженные товары по списку избранного
    const favProducts = allProducts.filter(p => 
        favoriteIds.includes(p.id) && p.is_active !== false
    );
    
    $('#favorites-count').textContent = favProducts.length;
    
    if (!favProducts.length) {
        grid.innerHTML = `
            <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">
                <div style="font-size:48px;margin-bottom:16px">🤍</div>
                <p>В избранном пока нет товаров</p>
                <button class="btn-primary" onclick="switchView('SHOP')" style="margin-top:16px">🛍️ Перейти в магазин</button>
            </div>`;
        return;
    }
    
    grid.innerHTML = favProducts.map(p => {
        const discount = p.is_discount_active && p.discount_percent > 0 ? p.discount_percent : 0;
        const displayPrice = p.final_price || p.price;
        const badge = p.sales > 40 ? '<div class="product-badge bestseller">🔥 ХИТ</div>' : 
                     (discount > 0 ? `<div class="product-badge sale">−${discount}%</div>` : '');
        
        let productImage;
        if (p.image_url?.startsWith('/uploads/')) {
            productImage = `<img src="${p.image_url}" alt="${p.name}" class="product-image" loading="lazy">`;
        } else {
            const colors = { 'Электроника': '#7c3aed', 'Одежда': '#00c853', 'Дом': '#ff6b35' };
            const color = colors[p.category] || '#6b7280';
            productImage = `<div class="product-image" style="background:linear-gradient(135deg,${color},${color}cc);display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:18px;text-align:center;padding:20px">${p.name}</div>`;
        }
        
        return `
            <div class="product-card">
                <div class="product-image-container">
                    ${badge}
                    <div class="product-favorite active" data-pid="${p.id}" onclick="toggleFavorite(${p.id})">♥</div>
                    ${productImage}
                </div>
                <div class="product-info">
                    <div class="product-price-block">
                        <span class="product-price">${Math.round(displayPrice)}</span><span class="product-price-currency">₽</span>
                        ${discount>0 ? `<span class="product-discount">−${discount}%</span>` : ''}
                    </div>
                    <h3 class="product-name">${p.name}</h3>
                    <div class="product-category">${p.category}</div>
                    <div class="product-actions">
                        <button class="btn-add-cart" onclick="addToCart(${p.id})">В корзину</button>
                        <button class="btn-buy" onclick="buyProduct(${p.id})">Купить</button>
                    </div>
                </div>
            </div>`;
    }).join('');
}