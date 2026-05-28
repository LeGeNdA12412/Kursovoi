/**
 * 🛒 VioBlack Market — Логика страницы корзины (ИСПРАВЛЕННАЯ ВЕРСИЯ)
 * 🔹 Убран бесконечный цикл запросов
 * 🔹 Кнопка "+" гарантированно блокируется при лимите
 * 🔹 Убраны дубликаты инициализации
 */

// === 🔍 БЫСТРЫЕ ТОВАРЫ ===
let allQuickProducts = [];

async function loadQuickProducts() {
    const container = document.getElementById('quick-products');
    try {
        const products = await api('/products');
        allQuickProducts = products;
        renderQuickProducts(products);
    } catch (err) {
        console.error('❌ Load quick products:', err);
        if (container) container.innerHTML = '<div class="no-products">⚠️ Не удалось загрузить товары</div>';
    }
}

function renderQuickProducts(products) {
    const container = document.getElementById('quick-products');
    if (!container) return;
    if (!products?.length) { container.innerHTML = '<div class="no-products">🔍 Товары не найдены</div>'; return; }

    container.innerHTML = products.slice(0, 8).map(p => {
        const color = { 'Электроника': '#7c3aed', 'Одежда': '#00c853', 'Дом': '#ff6b35' }[p.category] || '#6b7280';
        const stock = Number(p.stock) || 0;
        const isOut = stock <= 0;
        return `
            <div class="quick-product-card">
                <div class="quick-product-image" style="background:linear-gradient(135deg, ${color}, ${color}cc)">
                    ${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" onerror="this.style.display='none'">` : `<div style="color:var(--text-muted);font-size:24px;">📦</div>`}
                    ${isOut ? '<div style="position:absolute;top:8px;right:8px;background:var(--error);color:white;padding:4px 8px;border-radius:6px;font-size:10px;font-weight:700;z-index:2">НЕТ</div>' : ''}
                </div>
                <div class="quick-product-name" title="${p.name}">${p.name}</div>
                <div class="quick-product-category">${p.category}</div>
                <div class="quick-product-price">${Math.round(p.price)} ₽</div>
                <button class="quick-add-btn" onclick="quickAddToCart(${p.id}, this)" ${isOut ? 'disabled' : ''}>
                    ${isOut ? '⛔ Нет в наличии' : '➕ В корзину'}
                </button>
            </div>`;
    }).join('');
}

function filterQuickProducts() {
    const search = (document.getElementById('quick-search')?.value || '').toLowerCase();
    const category = document.getElementById('quick-category')?.value || 'all';
    const filtered = allQuickProducts.filter(p => 
        (!search || p.name.toLowerCase().includes(search) || p.description?.toLowerCase().includes(search)) &&
        (category === 'all' || p.category === category)
    );
    renderQuickProducts(filtered);
}

async function quickAddToCart(productId, btn) {
    if (btn.disabled) return;
    btn.disabled = true; btn.innerHTML = '⏳';
    try {
        await api('/cart', { method: 'POST', body: JSON.stringify({ product_id: productId, quantity: 1 }) });
        showNotification('✅ Товар добавлен в корзину', 'success');
        await loadCart();
    } catch (err) { showNotification('❌ ' + getErrorMessage(err), 'error'); }
    finally { btn.disabled = false; btn.innerHTML = '➕ В корзину'; }
}

// === 🛒 КОРЗИНА ===

function getErrorMessage(err) {
    if (!err) return 'Неизвестная ошибка';
    if (typeof err.detail === 'string') return formatServerError(err.detail);
    if (Array.isArray(err.detail)) return err.detail.map(e => `${e.loc?.[1] || 'Поле'}: ${e.msg || 'ошибка'}`).join('; ');
    return err.message || 'Произошла ошибка.';
}

function formatServerError(msg) {
    const m = { 'Корзина пуста':'🛒 Корзина пуста', 'Товар не найден':'❌ Товар недоступен', 'Недостаточно товара':'⚠️ Недостаточно на складе' };
    for (const [k, v] of Object.entries(m)) if (msg.includes(k)) return v;
    return msg;
}

async function loadCart() {
    const container = document.getElementById('cart-items');
    try {
        const cart = await api('/cart');
        renderCart(cart);
    } catch (err) {
        console.error('❌ Ошибка загрузки корзины:', err);
        if (container) container.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">⚠️</div><h3>Ошибка загрузки</h3><p style="color:var(--error)">${getErrorMessage(err)}</p><button class="btn-secondary" onclick="loadCart()">🔄 Повторить</button></div>`;
    }
}

/**
 * 🔥 БЕЗОПАСНАЯ ОТРИСОВКА КОРЗИНЫ (без циклов)
 */
function renderCart(cart) {
    const container = document.getElementById('cart-items');
    if (!container) return;
    if (!cart?.items?.length) {
        container.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">🛒</div><h3>Корзина пуста</h3><p>Добавьте товары из каталога</p><button class="btn-primary" onclick="window.location.href='/index.html'" style="margin-top:16px">🛍️ В магазин</button></div>`;
        updateCartSummary(0, 0);
        return;
    }

    const totalItems = cart.items.reduce((s, i) => s + i.quantity, 0);
    updateCartSummary(totalItems, cart.total);

    container.innerHTML = cart.items.map((item, idx) => {
        // 🔥 СТРОГОЕ преобразование в числа
        const stock = Number(item.product_stock) || 0;
        const qty = Number(item.quantity) || 0;
        const isMax = stock > 0 && qty >= stock;
        const isOut = stock <= 0;

        return `
            <div class="cart-item" data-item-id="${item.id}" data-stock="${stock}" style="animation-delay: ${idx * 0.05}s">
                <div class="cart-item-image">
                    ${item.product_image ? `<img src="${item.product_image}" alt="${item.product_name}" onerror="this.style.display='none'">` : `<div style="color:var(--text-muted);font-size:24px">📦</div>`}
                </div>
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.product_name}</div>
                    <div class="cart-item-category">${item.product_category || 'Без категории'}</div>
                    <div class="cart-item-price">${Math.round(item.product_price)} ₽</div>
                    ${stock > 0 ? `<div style="font-size:11px;color:var(--text-muted)">Остаток: ${stock} шт.</div>` : ''}
                </div>
                <div class="cart-item-actions">
                    <div class="quantity-control">
                        <button class="quantity-btn" onclick="updateQuantity(${item.id}, -1)" ${qty <= 1 ? 'disabled' : ''}>−</button>
                        <span class="quantity-value">${qty}</span>
                        <button class="quantity-btn" onclick="updateQuantity(${item.id}, 1)" ${(isMax || isOut) ? 'disabled' : ''}>+</button>
                    </div>
                    <button class="remove-btn" onclick="removeFromCart(${item.id})">🗑️ Удалить</button>
                </div>
            </div>`;
    }).join('');
}

function updateCartSummary(totalItems, totalAmount) {
    const c = document.getElementById('cart-count');
    const s = document.getElementById('summary-items');
    const t = document.getElementById('summary-total');
    const btn = document.getElementById('checkout-btn');
    if (c) c.textContent = `${totalItems} ${pluralize(totalItems, 'товар', 'товара', 'товаров')}`;
    if (s) s.textContent = totalItems;
    if (t) t.textContent = `${Math.round(totalAmount)} ₽`;
    if (btn) btn.disabled = totalItems === 0;
}

/**
 * 🔥 БЕЗОПАСНОЕ ОБНОВЛЕНИЕ КОЛИЧЕСТВА (БЕЗ ЦИКЛОВ)
 */
async function updateQuantity(itemId, delta) {
    const itemEl = document.querySelector(`[data-item-id="${itemId}"]`);
    const qtyEl = itemEl?.querySelector('.quantity-value');
    if (!qtyEl) return;

    const currentQty = Number(qtyEl.textContent) || 0;
    const stock = Number(itemEl.dataset.stock) || 0;
    const newQty = currentQty + delta;

    if (newQty < 1) return showNotification('⚠️ Мин. 1 шт.', 'error');
    if (stock > 0 && newQty > stock) return showNotification(`⚠️ Лимит: ${stock} шт.`, 'error');

    // Блокируем кнопки на время запроса
    itemEl.querySelectorAll('.quantity-btn').forEach(b => b.disabled = true);
    animateNumber(qtyEl, currentQty, newQty, 150);

    try {
        const fd = new FormData(); fd.append('quantity', newQty);
        await api(`/cart/${itemId}`, { method: 'PUT', body: fd });
        // ✅ Обновляем ТОЛЬКО при успехе
        await loadCart();
    } catch (err) {
        showNotification('❌ ' + getErrorMessage(err), 'error');
        qtyEl.textContent = currentQty; // Возвращаем старое значение
        // Разблокируем кнопки и восстанавливаем состояния
        const btns = itemEl.querySelectorAll('.quantity-btn');
        btns[0].disabled = currentQty <= 1;
        btns[1].disabled = (stock > 0 && currentQty >= stock);
    }
}

async function removeFromCart(itemId) {
    if (!confirm('🗑️ Удалить товар?')) return;
    try {
        await api(`/cart/${itemId}`, { method: 'DELETE' });
        showNotification('🗑️ Удалено', 'success');
        await loadCart();
    } catch (err) { showNotification('❌ ' + getErrorMessage(err), 'error'); }
}

function toggleCheckout() {
    const f = document.getElementById('checkout-form');
    const b = document.getElementById('checkout-btn');
    if (!f || !b) return;
    f.classList.toggle('active');
    b.style.display = f.classList.contains('active') ? 'none' : 'block';
    if (f.classList.contains('active')) setTimeout(() => document.getElementById('shipping-address')?.focus(), 100);
    else document.getElementById('shipping-address').value = '';
}

async function handleCheckout(e) {
    e.preventDefault();
    const city = document.getElementById('shipping-city')?.value?.trim() || 'Уфа';
    const addr = document.getElementById('shipping-address')?.value?.trim();
    if (!addr) return showNotification('⚠️ Укажите адрес', 'error');
    if (addr.length < 10) return showNotification('⚠️ Мин. 10 символов', 'error');

    const btn = document.getElementById('confirm-order-btn');
    btn.disabled = true; btn.textContent = '⏳ Оформляем...';
    try {
        const order = await api('/orders', { method: 'POST', body: JSON.stringify({ shipping_address: addr, city: city }) });
        showNotification(`🎉 Заказ #${order.id} оформлен!`, 'success');
        // Сохраняем данные заказа для отображения в чеке
        localStorage.setItem('last_order', JSON.stringify(order));
        document.querySelectorAll('button').forEach(b => b.disabled = true);
        // Перенаправляем на страницу чека
        setTimeout(() => window.location.href = '/receipt.html?order_id=' + order.id, 1000);
    } catch (err) {
        showNotification('❌ Ошибка: ' + getErrorMessage(err), 'error');
        btn.disabled = false; btn.textContent = '✅ Подтвердить заказ';
    }
}

function animateNumber(el, from, to, dur = 200) {
    if (!el || from === to) return;
    const start = performance.now();
    el.innerHTML = `<span class="num-old">${from}</span><span class="num-new">${to}</span>`;
    (function step(ts) {
        const p = Math.min((ts - start) / dur, 1);
        const cur = Math.round(from + (to - from) * (1 - (1 - p) * (1 - p)));
        const ns = el.querySelector('.num-new');
        if (ns) ns.textContent = cur;
        if (p < 1) requestAnimationFrame(step); else { el.textContent = to; }
    })(start);
}

function pluralize(n, a, b, c) { n = Math.abs(n) % 100; return n >= 5 && n <= 20 ? c : n % 10 === 1 ? a : n % 10 >= 2 && n % 10 <= 4 ? b : c; }

function showNotification(msg, type = 'success') {
    let el = document.getElementById('cart-notification');
    if (!el) {
        el = document.createElement('div'); el.id = 'cart-notification'; el.className = `cart-notification ${type}`;
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 20px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);display:flex;align-items:center;gap:12px;z-index:1000;max-width:340px;animation:slideIn 0.3s ease;';
        document.body.appendChild(el);
    }
    el.innerHTML = `<span style="font-size:18px">${type === 'success' ? '✅' : '❌'}</span><span>${msg}</span>`;
    el.style.borderLeft = `4px solid ${type === 'success' ? 'var(--success)' : 'var(--error)'}`;
    setTimeout(() => el.style.display = 'none', type === 'success' ? 4000 : 6000);
}

// === 🚀 ИНИЦИАЛИЗАЦИЯ (ОДИН БЛОК) ===
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🟢 Корзина инициализирована');
    const user = getUser();
    if (!user) { window.location.href = '/login.html'; return; }
    
    document.getElementById('current-username').textContent = user.username;
    document.getElementById('current-role').textContent = {ADMIN:'Админ', MANAGER:'Менеджер', USER:'Покупатель'}[user.role] || 'Покупатель';
    document.getElementById('user-avatar').textContent = user.username[0]?.toUpperCase() || '👤';
    
    if (user.role === 'ADMIN') document.getElementById('admin-nav')?.classList.remove('hidden');
    if (['MANAGER','ADMIN'].includes(user.role)) document.getElementById('manager-nav')?.classList.remove('hidden');
    document.getElementById('logout-btn')?.addEventListener('click', () => { localStorage.removeItem('vb_token'); window.location.href = '/login.html'; });
    
    await Promise.all([loadCart(), loadQuickProducts()]);
    console.log('✅ Корзина готова');
});