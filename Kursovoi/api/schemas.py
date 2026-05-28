from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from typing import List, Optional, Literal
from datetime import datetime

# === Продукты ===
class ProductBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    price: float = Field(..., gt=0, le=100000)
    description: str = Field(..., min_length=10, max_length=500)
    category: str = Field(..., min_length=2, max_length=50)
    
    @field_validator('name', 'description', 'category')
    @classmethod
    def strip_and_check(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Поле не может быть пустым')
        return v.strip()

class ProductCreate(ProductBase):
    image_url: Optional[str] = None
    discount_percent: Optional[int] = Field(default=0, ge=0, le=100)
    discount_until: Optional[datetime] = None
    bulk_discount_threshold: Optional[int] = Field(default=5, ge=1)
    bulk_discount_percent: Optional[int] = Field(default=5, ge=0, le=50)

class ProductOut(ProductBase):
    id: int
    sales: int
    stock: int
    image_url: Optional[str] = None
    is_active: bool = True
    # 🎁 Поля скидок
    discount_percent: int = 0
    discount_until: Optional[datetime] = None
    bulk_discount_threshold: int = 5
    bulk_discount_percent: int = 5
    # 🧮 Вычисляемые поля
    final_price: Optional[float] = None  # Цена с учётом активной скидки
    is_discount_active: bool = False
    # 📸 Дополнительные фото
    photos: List[str] = []  # Список URL фотографий
    model_config = ConfigDict(from_attributes=True)

# === Промокоды ===
class PromoCodeCreate(BaseModel):
    code: str = Field(..., min_length=3, max_length=20, pattern=r'^[A-Z0-9]+$')
    discount_percent: int = Field(..., ge=5, le=50)
    min_order_amount: Optional[float] = Field(default=0, ge=0)
    max_uses: Optional[int] = Field(default=None, ge=1)
    valid_until: Optional[datetime] = None

class PromoCodeOut(BaseModel):
    id: int
    code: str
    discount_percent: int
    min_order_amount: float
    max_uses: Optional[int]
    used_count: int
    valid_until: Optional[datetime]
    is_active: bool
    model_config = ConfigDict(from_attributes=True)

class PromoCodeApply(BaseModel):
    code: str
    order_total: float  # Для проверки min_order_amount

class PromoCodeResponse(BaseModel):
    success: bool
    message: str
    discount_percent: Optional[int] = None
    new_total: Optional[float] = None

# === Пользователи ===
class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50, pattern=r'^[a-zA-Z0-9_]+$')
    password: str = Field(..., min_length=6, max_length=128)

class UserCreate(UserBase):
    pass

class UserOut(BaseModel):
    id: int
    username: str
    role: str
    model_config = ConfigDict(from_attributes=True)

class LoginRequest(BaseModel):
    username: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut

# === Корзина ===
class CartItemBase(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1, le=100)

class CartItemOut(BaseModel):
    id: int
    product_id: int
    quantity: int
    product_name: str
    product_price: float
    product_category: Optional[str] = None
    product_image: Optional[str] = None
    product_stock: int = 0
    # 🎁 Скидки
    discount_percent: int = 0
    final_price: float  # Цена за единицу со скидкой
    subtotal: float     # quantity × final_price
    model_config = ConfigDict(from_attributes=True)
    discount_reason: Optional[str] = None

class CartOut(BaseModel):
    id: int
    user_id: int
    items: List[CartItemOut]
    subtotal: float      # Сумма без учёта промокода
    discount_applied: float = 0  # Скидка от промокода/роли в ₽
    promo_code: Optional[str] = None
    total: float         # Итоговая сумма
    model_config = ConfigDict(from_attributes=True)

# === Заказы ===
class OrderCreate(BaseModel):
    shipping_address: str = Field(..., min_length=10, max_length=255)
    city: str = Field(default="Уфа", min_length=2, max_length=100)  # Город доставки
    promo_code: Optional[str] = None  # Промокод для применения

class OrderItemOut(BaseModel):
    id: Optional[int] = None
    product_id: int
    product_name: str
    quantity: int
    price_at_order: float
    discount_percent: int
    subtotal: float
    model_config = ConfigDict(from_attributes=True)

class OrderOut(BaseModel):
    id: int
    status: str
    total_amount: float
    discount_applied: float
    promo_code_used: Optional[str]
    shipping_address: str
    city: str = "Уфа"
    items: List[OrderItemOut]
    model_config = ConfigDict(from_attributes=True)

class FavoriteCreate(BaseModel):
    product_id: int

class FavoriteOut(BaseModel):
    id: int
    user_id: int
    product_id: int
    created_at: Optional[datetime] = None
    # Вложенный товар для удобства
    product: Optional[ProductOut] = None
    model_config = ConfigDict(from_attributes=True)