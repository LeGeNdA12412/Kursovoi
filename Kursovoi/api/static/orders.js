/**
 * 📦 VioBlack Market — Логика страницы заказов
 */

// === 📦 ЗАГРУЗКА ЗАКАЗОВ ===

async function loadOrders() {
    const container = document.getElementById('orders-list');
    try {
        const orders = await api('/orders');
        renderOrders(orders);
    } catch (err) {
        console.error('❌ Ошибка загрузки заказов:', err);
        if (container) container.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">⚠️</div><h3>Ошибка загрузки</h3><p style="color:var(--error)">${getErrorMessage(err)}</p><button class="btn-secondary" onclick="loadOrders()">🔄 Повторить</button></div>`;
    }
}

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

/**
 * 🔥 ОТРИСОВКА ЗАКАЗОВ
 */
function renderOrders(orders) {
    const container = document.getElementById('orders-list');
    if (!container) return;
    
    if (!orders?.length) {
        container.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon">📦</div><h3>Заказов пока нет</h3><p>Оформите свой первый заказ в магазине</p><button class="btn-primary" onclick="window.location.href='/index.html'" style="margin-top:16px">🛍️ В магазин</button></div>`;
        updateOrdersCount(0);
        return;
    }

    updateOrdersCount(orders.length);

    container.innerHTML = orders.map((order, idx) => {
        const statusColors = {
            'pending': '#f59e0b',
            'processing': '#3b82f6',
            'shipped': '#8b5cf6',
            'delivered': '#10b981',
            'cancelled': '#ef4444'
        };
        const statusNames = {
            'pending': 'В обработке',
            'processing': 'Обрабатывается',
            'shipped': 'Отправлен',
            'delivered': 'Доставлен',
            'cancelled': 'Отменён'
        };
        const statusColor = statusColors[order.status] || '#6b7280';
        const statusName = statusNames[order.status] || order.status;
        const totalItems = order.items.reduce((s, i) => s + i.quantity, 0);

        return `
            <div class="cart-item" style="animation-delay: ${idx * 0.05}s; cursor: pointer;" onclick="showOrderModal(${order.id})">
                <div class="cart-item-image" style="background: linear-gradient(135deg, ${statusColor}, ${statusColor}cc)">
                    <div style="color:white;font-size:32px;">📦</div>
                </div>
                <div class="cart-item-info" style="flex:1;">
                    <div class="cart-item-name">Заказ #${order.id}</div>
                    <div class="cart-item-category">${totalItems} ${pluralize(totalItems, 'товар', 'товара', 'товаров')}</div>
                    <div style="font-size:12px;color:${statusColor};font-weight:600;margin-top:4px;">● ${statusName}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${order.city || 'Уфа'}, ${order.shipping_address}</div>
                </div>
                <div class="cart-item-actions" style="flex-direction:column;align-items:flex-end;gap:8px;">
                    <div style="font-size:18px;font-weight:700;color:var(--primary);">${Math.round(order.total_amount)} ₽</div>
                    <button class="btn-secondary" style="font-size:12px;padding:6px 12px;" onclick="event.stopPropagation(); showOrderModal(${order.id})">👁️ Подробнее</button>
                </div>
            </div>`;
    }).join('');
}

function updateOrdersCount(count) {
    const c = document.getElementById('orders-count');
    if (c) c.textContent = `${count} ${pluralize(count, 'заказ', 'заказа', 'заказов')}`;
}

// === 👁️ МОДАЛЬНОЕ ОКНО ПРОСМОТРА ЗАКАЗА ===

function showOrderModal(orderId) {
    api('/orders').then(orders => {
        const order = orders.find(o => o.id === orderId);
        if (!order) return showNotification('❌ Заказ не найден', 'error');
        
        const user = getUser();
        const isAdmin = user && user.role === 'ADMIN';
        
        const modal = document.getElementById('order-modal');
        const body = document.getElementById('modal-body');
        
        const statusColors = {
            'pending': '#f59e0b',
            'processing': '#3b82f6',
            'shipped': '#8b5cf6',
            'delivered': '#10b981',
            'cancelled': '#ef4444'
        };
        const statusNames = {
            'pending': 'В обработке',
            'processing': 'Обрабатывается',
            'shipped': 'Отправлен',
            'delivered': 'Доставлен',
            'cancelled': 'Отменён'
        };
        
        let subtotal = order.items.reduce((s, i) => s + i.subtotal, 0);
        
        // Панель администратора для смены статуса
        let adminPanel = '';
        if (isAdmin) {
            const currentStatus = order.status;
            adminPanel = `
                <div style="background:rgba(124,58,237,0.1);padding:16px;border-radius:12px;margin-bottom:24px;border:1px solid var(--primary);">
                    <h3 style="margin-bottom:12px;font-size:14px;color:var(--primary);">⚙️ Управление заказом (Админ)</h3>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn-secondary" style="font-size:12px;padding:8px 12px;" onclick="updateOrderStatus(${order.id}, 'pending')" ${currentStatus === 'pending' ? 'disabled style="opacity:0.5"' : ''}>⏳ В обработку</button>
                        <button class="btn-secondary" style="font-size:12px;padding:8px 12px;" onclick="updateOrderStatus(${order.id}, 'processing')" ${currentStatus === 'processing' ? 'disabled style="opacity:0.5"' : ''}>🔄 Обрабатывается</button>
                        <button class="btn-secondary" style="font-size:12px;padding:8px 12px;" onclick="updateOrderStatus(${order.id}, 'shipped')" ${currentStatus === 'shipped' ? 'disabled style="opacity:0.5"' : ''}>📤 Отправлен</button>
                        <button class="btn-secondary" style="font-size:12px;padding:8px 12px;" onclick="updateOrderStatus(${order.id}, 'delivered')" ${currentStatus === 'delivered' ? 'disabled style="opacity:0.5"' : ''}>✅ Доставлен</button>
                        <button class="btn-secondary" style="font-size:12px;padding:8px 12px;background:var(--error);color:white;" onclick="updateOrderStatus(${order.id}, 'cancelled')" ${currentStatus === 'cancelled' ? 'disabled style="opacity:0.5"' : ''}>❌ Отменён</button>
                    </div>
                </div>
            `;
        }
        
        body.innerHTML = `
            ${adminPanel}
            <div style="text-align:center;margin-bottom:24px;">
                <div style="font-size:48px;margin-bottom:8px;">📦</div>
                <h2 style="margin-bottom:4px;">Заказ #${order.id}</h2>
                <div style="color:${statusColors[order.status] || '#6b7280'};font-weight:600;">${statusNames[order.status] || order.status}</div>
            </div>
            
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:24px;">
                <div style="background:rgba(124,58,237,0.05);padding:12px;border-radius:8px;">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">🏙️ Город</div>
                    <div style="font-weight:600;">${order.city || 'Уфа'}</div>
                </div>
                <div style="background:rgba(124,58,237,0.05);padding:12px;border-radius:8px;">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">📍 Адрес</div>
                    <div style="font-weight:600;">${order.shipping_address}</div>
                </div>
                <div style="background:rgba(124,58,237,0.05);padding:12px;border-radius:8px;">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">💰 Сумма</div>
                    <div style="font-weight:600;color:var(--primary);">${Math.round(order.total_amount)} ₽</div>
                </div>
                <div style="background:rgba(124,58,237,0.05);padding:12px;border-radius:8px;">
                    <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">🔑 QR-код</div>
                    <div style="font-family:monospace;font-size:12px;">${order.qr_code || 'N/A'}</div>
                </div>
            </div>
            
            ${order.qr_code ? `
            <div style="text-align:center;margin:20px 0;">
                <div style="display:inline-block;background:white;padding:16px;border-radius:12px;">
                    <img src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${order.qr_code}" alt="QR Code" style="width:150px;height:150px;">
                </div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:8px;">Покажите этот код для получения заказа</div>
            </div>
            ` : ''}
            
            <div style="border-top:1px solid var(--border);padding-top:16px;margin-bottom:16px;">
                <h3 style="margin-bottom:12px;font-size:16px;">📦 Товары в заказе</h3>
                ${order.items.map(item => `
                    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
                        <div>
                            <div style="font-weight:600;">${item.product_name}</div>
                            <div style="font-size:12px;color:var(--text-muted);">${item.quantity} шт. × ${Math.round(item.price_at_order)} ₽</div>
                        </div>
                        <div style="font-weight:600;">${Math.round(item.subtotal)} ₽</div>
                    </div>
                `).join('')}
            </div>
            
            <div style="border-top:2px dashed var(--border);padding-top:16px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                    <span>Подытог:</span>
                    <span>${Math.round(subtotal)} ₽</span>
                </div>
                ${order.discount_applied > 0 ? `
                <div style="display:flex;justify-content:space-between;margin-bottom:8px;color:var(--success);">
                    <span>Скидка:</span>
                    <span>−${Math.round(order.discount_applied)} ₽</span>
                </div>
                ` : ''}
                <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:900;color:var(--primary);margin-top:12px;padding-top:12px;border-top:2px solid var(--border);">
                    <span>Итого:</span>
                    <span>${Math.round(order.total_amount)} ₽</span>
                </div>
            </div>
            
            <div style="display:flex;gap:12px;margin-top:24px;">
                <button class="btn-primary" style="flex:1;" onclick="window.location.href='/receipt.html?order_id=${order.id}'">📋 Чек</button>
                <button class="btn-secondary" style="flex:1;" onclick="closeOrderModal()">Закрыть</button>
            </div>
        `;
        
        modal.classList.remove('hidden');
    }).catch(err => {
        console.error('❌ Load order:', err);
        showNotification('❌ Не удалось загрузить заказ', 'error');
    });
}

// === ⚙️ ОБНОВЛЕНИЕ СТАТУСА ЗАКАЗА (АДМИН) ===
async function updateOrderStatus(orderId, newStatus) {
    const formData = new FormData();
    formData.append('status', newStatus);
    
    try {
        const token = localStorage.getItem('vb_token');
        const response = await fetch(`/api/orders/${orderId}/status`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Ошибка обновления');
        }
        
        showNotification(`✅ Статус заказа #${orderId} изменён на "${newStatus}"`, 'success');
        
        // Закрываем модальное окно и перезагружаем список
        closeOrderModal();
        await loadOrders();
        
    } catch (err) {
        console.error('❌ Update status:', err);
        showNotification('❌ Не удалось изменить статус: ' + err.message, 'error');
    }
}

function closeOrderModal(event) {
    if (event && event.target !== event.currentTarget) return;
    document.getElementById('order-modal')?.classList.add('hidden');
}

function pluralize(n, a, b, c) { 
    n = Math.abs(n) % 100; 
    return n >= 5 && n <= 20 ? c : n % 10 === 1 ? a : n % 10 >= 2 && n % 10 <= 4 ? b : c; 
}

function showNotification(msg, type = 'success') {
    let el = document.getElementById('cart-notification');
    if (!el) {
        el = document.createElement('div'); 
        el.id = 'cart-notification'; 
        el.className = `cart-notification ${type}`;
        el.style.cssText = 'position:fixed;bottom:24px;right:24px;padding:14px 20px;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);display:flex;align-items:center;gap:12px;z-index:1000;max-width:340px;animation:slideIn 0.3s ease;';
        document.body.appendChild(el);
    }
    el.innerHTML = `<span style="font-size:18px">${type === 'success' ? '✅' : '❌'}</span><span>${msg}</span>`;
    el.style.borderLeft = `4px solid ${type === 'success' ? 'var(--success)' : 'var(--error)'}`;
    setTimeout(() => el.style.display = 'none', type === 'success' ? 4000 : 6000);
}

// === 🚀 ИНИЦИАЛИЗАЦИЯ ===
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🟢 Страница заказов инициализирована');
    const user = getUser();
    if (!user) { window.location.href = '/login.html'; return; }
    
    document.getElementById('current-username').textContent = user.username;
    document.getElementById('current-role').textContent = {ADMIN:'Админ', MANAGER:'Менеджер', USER:'Покупатель'}[user.role] || 'Покупатель';
    document.getElementById('user-avatar').textContent = user.username[0]?.toUpperCase() || '👤';
    
    if (user.role === 'ADMIN') document.getElementById('admin-nav')?.classList.remove('hidden');
    if (['MANAGER','ADMIN'].includes(user.role)) document.getElementById('manager-nav')?.classList.remove('hidden');
    document.getElementById('logout-btn')?.addEventListener('click', () => { localStorage.removeItem('vb_token'); window.location.href = '/login.html'; });
    
    await loadOrders();
    console.log('✅ Заказы загружены');
});
