from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean, DateTime
from sqlalchemy.orm import relationship
from database import Base
from datetime import datetime
import secrets

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    role = Column(String(20), default="USER")  # USER, MANAGER, ADMIN
    
    cart = relationship("Cart", back_populates="user", uselist=False, cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="user", cascade="all, delete-orphan")
    favorites = relationship("Favorite", back_populates="user", cascade="all, delete-orphan")

class Product(Base):
    __tablename__ = "products"
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), index=True, nullable=False)
    price = Column(Float, nullable=False)
    description = Column(String(500))
    category = Column(String(50))
    sales = Column(Integer, default=0)
    stock = Column(Integer, default=100)
    image_url = Column(String(255), default="")  # Основное фото (для совместимости)
    is_active = Column(Boolean, default=True)
    favorited_by = relationship("Favorite", back_populates="product", cascade="all, delete-orphan")
    
    # 🎁 ПОЛЯ ДЛЯ СИСТЕМЫ СКИДОК
    discount_percent = Column(Integer, default=0)  # 0-100%
    discount_until = Column(DateTime, nullable=True)  # Дата окончания акции
    bulk_discount_threshold = Column(Integer, default=5)  # От какого количества скидка
    bulk_discount_percent = Column(Integer, default=5)   # % скидки за опт
    
    cart_items = relationship("CartItem", back_populates="product", cascade="all, delete-orphan")
    order_items = relationship("OrderItem", back_populates="product", cascade="all, delete-orphan")
    photos = relationship("ProductPhoto", back_populates="product", cascade="all, delete-orphan")

class Cart(Base):
    __tablename__ = "carts"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    user = relationship("User", back_populates="cart")
    items = relationship("CartItem", back_populates="cart", cascade="all, delete-orphan")

class CartItem(Base):
    __tablename__ = "cart_items"
    id = Column(Integer, primary_key=True, index=True)
    cart_id = Column(Integer, ForeignKey("carts.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, default=1)
    cart = relationship("Cart", back_populates="items")
    product = relationship("Product", back_populates="cart_items")

class Order(Base):
    __tablename__ = "orders"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="pending")
    total_amount = Column(Float, default=0)
    discount_applied = Column(Float, default=0)  # Сумма скидки в ₽
    promo_code_used = Column(String(50), nullable=True)  # Использованный промокод
    shipping_address = Column(String(255))
    city = Column(String(100), default="Уфа")  # Город доставки
    qr_code = Column(String(64), unique=True, nullable=True)  # QR-код для получения заказа
    user = relationship("User", back_populates="orders")
    items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")
    
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.qr_code:
            self.qr_code = secrets.token_hex(16)  # Генерируем уникальный QR-код

class OrderItem(Base):
    __tablename__ = "order_items"
    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, default=1)
    price_at_order = Column(Float, nullable=False)  # Цена на момент заказа
    discount_percent = Column(Integer, default=0)   # Применённая скидка %
    subtotal = Column(Float, nullable=False)        # Итого со скидкой
    order = relationship("Order", back_populates="items")
    product = relationship("Product", back_populates="order_items")

class Favorite(Base):
    __tablename__ = "favorites"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.now)
    
    # Связи
    user = relationship("User", back_populates="favorites")
    product = relationship("Product", back_populates="favorited_by")
    
    # Уникальная пара: пользователь + товар
    __table_args__ = (
        # Один товар может быть в избранном у пользователя только один раз
        {'sqlite_autoincrement': True},
    )

# 📸 Таблица для нескольких фотографий товара
class ProductPhoto(Base):
    __tablename__ = "product_photos"
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    image_url = Column(String(255), nullable=False)
    is_primary = Column(Boolean, default=False)  # Основное фото
    sort_order = Column(Integer, default=0)  # Порядок сортировки
    
    product = relationship("Product", back_populates="photos")

# 🎫 Таблица промокодов
class PromoCode(Base):
    __tablename__ = "promo_codes"
    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, index=True, nullable=False)  # SALE10
    discount_percent = Column(Integer, nullable=False)  # 10 = 10%
    min_order_amount = Column(Float, default=0)  # Мин. сумма заказа для применения
    max_uses = Column(Integer, nullable=True)  # Макс. использований (None = безлим)
    used_count = Column(Integer, default=0)  # Сколько раз использован
    valid_until = Column(DateTime, nullable=True)  # Дата окончания
    is_active = Column(Boolean, default=True)