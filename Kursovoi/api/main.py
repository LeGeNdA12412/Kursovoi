from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from passlib.context import CryptContext
from datetime import datetime, timedelta
import models, schemas, database
import os
from pathlib import Path
import uuid
import shutil

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = STATIC_DIR / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto", pbkdf2_sha256__default_rounds=29000)

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_role_discount(role: str) -> int:
    return {"ADMIN": 15, "MANAGER": 10, "USER": 0}.get(role, 0)

def is_discount_active(product: models.Product) -> bool:
    """Безопасно проверяет скидку, игнорируя часовые пояса и None"""
    if not product.discount_percent or product.discount_percent <= 0:
        return False
    if product.discount_until:
        until = product.discount_until.replace(tzinfo=None) if product.discount_until.tzinfo else product.discount_until
        if until < datetime.now():
            return False
    return True

def calculate_item_discount(product: models.Product, quantity: int, user_role: str) -> dict:
    discounts = []
    if is_discount_active(product):
        discounts.append(("Акция на товар", product.discount_percent))
    if quantity >= product.bulk_discount_threshold and product.bulk_discount_percent > 0:
        discounts.append(("Опт", product.bulk_discount_percent))
    role_discount = get_role_discount(user_role)
    if role_discount > 0:
        discounts.append((f"Скидка {user_role}", role_discount))
        
    total_discount = min(sum(d[1] for d in discounts), 50)
    final_price = round(product.price * (1 - total_discount / 100), 2)
    reason = " + ".join([d[0] for d in discounts]) if discounts else "Без скидки"
    
    return {"discount_percent": total_discount, "final_price": final_price, "reason": reason}

def validate_promo_code(db: Session, code: str, order_total: float) -> dict:
    promo = db.query(models.PromoCode).filter(
        models.PromoCode.code == code.upper(),
        models.PromoCode.is_active == True
    ).first()
    
    if not promo: return {"success": False, "message": "❌ Промокод не найден"}
    if promo.valid_until and promo.valid_until < datetime.now(): return {"success": False, "message": "⏰ Промокод истёк"}
    if promo.max_uses and promo.used_count >= promo.max_uses: return {"success": False, "message": "🎫 Промокод больше не действует"}
    if order_total < promo.min_order_amount: return {"success": False, "message": f"💰 Мин. сумма заказа: {promo.min_order_amount} ₽"}
    
    return {"success": True, "discount_percent": promo.discount_percent, "message": f"✅ {promo.code}: −{promo.discount_percent}%"}


def get_current_user_from_request(request: Request, db: Session) -> models.User:
    auth = request.headers.get("authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    token = auth[7:].strip()
    if ":" not in token:
        raise HTTPException(status_code=401, detail="Неверный формат токена")
    username, _ = token.split(":", 1)
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="Пользователь не найден")
    return user

def get_admin_user_from_request(request: Request, db: Session) -> models.User:
    user = get_current_user_from_request(request, db)
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Требуется роль ADMIN")
    return user

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

def save_upload_file(file: UploadFile) -> str:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Файл не выбран")
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат")
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = UPLOAD_DIR / filename
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return f"/uploads/{filename}"

@asynccontextmanager
async def lifespan(app: FastAPI):
    db = None
    try:
        models.Base.metadata.create_all(bind=database.engine)
        print("✅ Таблицы БД созданы")
        db = database.SessionLocal()
        
        if not db.query(models.PromoCode).first():
            print("🎁 Создаём тестовые промокоды...")
            db.add_all([
                models.PromoCode(code="WELCOME10", discount_percent=10, min_order_amount=500),
                models.PromoCode(code="SALE20", discount_percent=20, min_order_amount=2000, max_uses=100),
                models.PromoCode(code="VIP30", discount_percent=30, min_order_amount=5000, valid_until=datetime.now() + timedelta(days=30)),
            ])
            db.commit()
        
        if not db.query(models.User).first():
            print("🌱 Создаём тестовые данные...")
            admin = models.User(username="admin", password=hash_password("admin123"), role="ADMIN")
            db.add(admin)
            db.commit()
            db.refresh(admin)
            
            products = [
                models.Product(name='Нано-часы', price=199.0, description='Футуристические смарт-часы', category='Электроника', sales=12, stock=50, discount_percent=15, discount_until=datetime.now() + timedelta(days=7)),
                models.Product(name='Кибер-обувь', price=89.0, description='Неоновые кроссовки', category='Одежда', sales=45, stock=120, bulk_discount_threshold=3, bulk_discount_percent=10),
                models.Product(name='Голо-очки', price=299.0, description='AR-очки с ИИ', category='Электроника', sales=8, stock=30),
            ]
            db.add_all(products)
            db.add(models.Cart(user_id=admin.id))
            db.commit()
            print("✅ Тестовые данные готовы")
    except Exception as e:
        if db: db.rollback()
        print(f"❌ Ошибка старта: {e}")
    finally:
        if db: db.close()
    print("🚀 VioBlack Market API запущен!")
    yield
    print("🛑 Завершение работы...")

app = FastAPI(title="VioBlack Market", version="1.0", lifespan=lifespan)

# ✅ CORS
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

if STATIC_DIR.exists():
    @app.get("/")
    async def root(): return FileResponse(STATIC_DIR / "login.html")
    @app.get("/login.html")
    async def login_html(): return FileResponse(STATIC_DIR / "login.html")
    @app.get("/registr.html")
    async def reg_html(): return FileResponse(STATIC_DIR / "registr.html")
    @app.get("/index.html")
    async def main_html(): return FileResponse(STATIC_DIR / "index.html")
    @app.get("/cart.html")
    async def cart_html(): return FileResponse(STATIC_DIR / "cart.html")
    @app.get("/receipt.html")
    async def receipt_html(): return FileResponse(STATIC_DIR / "receipt.html")
    @app.get("/style.css")
    async def style_css(): return FileResponse(STATIC_DIR / "style.css")
    @app.get("/cart.css")
    async def cart_css(): return FileResponse(STATIC_DIR / "cart.css")
    @app.get("/script.js")
    async def main_js(): return FileResponse(STATIC_DIR / "script.js")
    @app.get("/cart.js")
    async def cart_js(): return FileResponse(STATIC_DIR / "cart.js")

#  API Endpoints 

@app.get("/api/products", response_model=List[schemas.ProductOut])
def get_products(db: Session = Depends(database.get_db)):
    products = db.query(models.Product).filter(models.Product.is_active == True).all()
    result = []
    
    for p in products:
        try:
            active = is_discount_active(p)
            discount = p.discount_percent or 0
            final_price = round(p.price * (1 - discount / 100), 2) if active else p.price
            
            # Получаем все фото товара
            photo_urls = [photo.image_url for photo in p.photos] if p.photos else []
            
            obj = schemas.ProductOut(
                id=p.id,
                name=p.name or "Товар",
                price=float(p.price),
                description=(p.description or "Описание отсутствует").strip(),
                category=(p.category or "Разное").strip(),
                sales=int(p.sales or 0),
                stock=int(p.stock or 0),
                image_url=p.image_url or "",
                is_active=bool(p.is_active) if p.is_active is not None else True,
                discount_percent=int(discount),
                discount_until=p.discount_until,
                bulk_discount_threshold=int(p.bulk_discount_threshold or 5),
                bulk_discount_percent=int(p.bulk_discount_percent or 5),
                final_price=float(final_price),
                is_discount_active=bool(active),
                photos=photo_urls
            )
            result.append(obj)
        except Exception as e:
            print(f"⚠️ Пропущен товар ID={p.id}: {e}")
            continue
            
    return result

@app.post("/api/products", response_model=schemas.ProductOut)
async def create_product(
    request: Request,
    db: Session = Depends(database.get_db),
    name: str = Form(...),
    price: float = Form(...),
    description: str = Form(...),
    category: str = Form(...),
    stock: int = Form(default=100, ge=0),
    discount_percent: int = Form(default=0, ge=0, le=100),
    discount_until: Optional[str] = Form(default=None),
    bulk_discount_threshold: int = Form(default=5, ge=1),
    bulk_discount_percent: int = Form(default=5, ge=0, le=50),
    image: Optional[UploadFile] = File(default=None),
    images: List[UploadFile] = File(default=[]),  # Дополнительные фото
):
    get_admin_user_from_request(request, db)
    
    discount_until_dt = None
    if discount_until:
        try: discount_until_dt = datetime.fromisoformat(discount_until.replace('Z', '+00:00'))
        except: pass
        
    data = {
        "name": name.strip(),
        "price": price,
        "description": description.strip() or "",
        "category": category.strip(),
        "stock": stock,  
        "sales": 0,
        "is_active": True,
        "image_url": save_upload_file(image) if image and image.filename else "",
        "discount_percent": discount_percent,
        "discount_until": discount_until_dt,
        "bulk_discount_threshold": bulk_discount_threshold,
        "bulk_discount_percent": bulk_discount_percent
    }
    
    db_product = models.Product(**data)
    db.add(db_product)
    db.commit()
    db.refresh(db_product)
    
    # Сохраняем дополнительные фото
    all_photos = []
    if image and image.filename:
        main_url = save_upload_file(image)
        all_photos.append(models.ProductPhoto(product_id=db_product.id, image_url=main_url, is_primary=True, sort_order=0))
    
    for idx, img in enumerate(images):
        if img and img.filename:
            img_url = save_upload_file(img)
            all_photos.append(models.ProductPhoto(product_id=db_product.id, image_url=img_url, is_primary=False, sort_order=idx+1))
    
    if all_photos:
        db.add_all(all_photos)
        db.commit()
    
    print(f"✅ Product created: {db_product.name}, stock={db_product.stock}")
    return db_product

@app.post("/api/register", response_model=schemas.UserOut, status_code=201)
def register_user(user: schemas.UserCreate, db: Session = Depends(database.get_db)):
    if db.query(models.User).filter(models.User.username == user.username).first():
        raise HTTPException(status_code=400, detail="Пользователь существует")
    db_user = models.User(username=user.username, password=hash_password(user.password), role="USER")
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    db.add(models.Cart(user_id=db_user.id))
    db.commit()
    return db_user

@app.post("/api/login", response_model=schemas.LoginResponse)
def login(user: schemas.LoginRequest, db: Session = Depends(database.get_db)):
    db_user = db.query(models.User).filter(models.User.username == user.username).first()
    if not db_user or not verify_password(user.password, db_user.password):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    return {"access_token": f"{db_user.username}:{db_user.role}", "token_type": "bearer", "user": schemas.UserOut.model_validate(db_user)}

@app.post("/api/promo/validate", response_model=schemas.PromoCodeResponse)
def validate_promo(data: schemas.PromoCodeApply, request: Request, db: Session = Depends(database.get_db)):
    get_current_user_from_request(request, db)
    result = validate_promo_code(db, data.code, data.order_total)
    if result["success"]:
        discount_amount = data.order_total * result["discount_percent"] / 100
        new_total = round(data.order_total - discount_amount, 2)
        return schemas.PromoCodeResponse(success=True, message=result["message"], discount_percent=result["discount_percent"], new_total=new_total)
    return schemas.PromoCodeResponse(success=False, message=result["message"])

@app.get("/api/promo", response_model=List[schemas.PromoCodeOut])
def list_promo_codes(request: Request, db: Session = Depends(database.get_db)):
    get_admin_user_from_request(request, db)
    return db.query(models.PromoCode).all()

@app.post("/api/promo", response_model=schemas.PromoCodeOut, status_code=201)
def create_promo_code(data: schemas.PromoCodeCreate, request: Request, db: Session = Depends(database.get_db)):
    get_admin_user_from_request(request, db)
    promo = models.PromoCode(**data.model_dump())
    db.add(promo)
    db.commit()
    db.refresh(promo)
    return promo

#  КОРЗИНА 

@app.get("/api/cart", response_model=schemas.CartOut)
async def get_cart(request: Request, db: Session = Depends(database.get_db)):
    current_user = get_current_user_from_request(request, db)
    cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    if not cart:
        cart = models.Cart(user_id=current_user.id)
        db.add(cart)
        db.commit()
        db.refresh(cart)
    
    items_out, subtotal = [], 0
    for item in cart.items:
        if not item.product or not item.product.is_active: continue
        disc = calculate_item_discount(item.product, item.quantity, current_user.role)
        sub = round(disc["final_price"] * item.quantity, 2)
        items_out.append({
            "id": item.id, "product_id": item.product_id, "quantity": item.quantity,"product_stock": item.product.stock,
            "product_name": item.product.name, "product_price": item.product.price,
            "product_category": item.product.category, "product_image": item.product.image_url,
            "discount_percent": disc["discount_percent"], "final_price": disc["final_price"], 
            "subtotal": sub, "discount_reason": disc["reason"]
        })
        subtotal += sub
    
    return {"id": cart.id, "user_id": cart.user_id, "items": items_out, "subtotal": subtotal, "discount_applied": 0, "promo_code": None, "total": subtotal}

@app.post("/api/cart", response_model=schemas.CartOut)
async def add_to_cart(item: schemas.CartItemBase, request: Request, db: Session = Depends(database.get_db)):
    current_user = get_current_user_from_request(request, db)
    
    product = db.query(models.Product).filter(
        models.Product.id == item.product_id, 
        models.Product.is_active == True
    ).first()
    
    if not product:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    # ПРОВЕРКА: сколько этого товара уже в корзине
    cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    existing_item = None
    if cart:
        existing_item = db.query(models.CartItem).filter(
            models.CartItem.cart_id == cart.id,
            models.CartItem.product_id == item.product_id
        ).first()
    
    current_in_cart = existing_item.quantity if existing_item else 0
    requested_qty = item.quantity
    total_wanted = current_in_cart + requested_qty
    
    # ПРОВЕРКА ОСТАТКОВ
    if product.stock < total_wanted:
        available = product.stock - current_in_cart
        raise HTTPException(
            status_code=400, 
            detail=f"Недостаточно товара на складе. Доступно: {available} шт. (в корзине уже: {current_in_cart})"
        )
    
    # Создаём корзину если нет
    if not cart:
        cart = models.Cart(user_id=current_user.id)
        db.add(cart)
        db.commit()
        db.refresh(cart)
    
    # Добавляем или обновляем элемент
    if existing_item:
        existing_item.quantity += requested_qty
    else:
        db.add(models.CartItem(
            cart_id=cart.id, 
            product_id=item.product_id, 
            quantity=requested_qty
        ))
    
    db.commit()
    return await get_cart(request, db)

@app.delete("/api/cart/{item_id}")
async def remove_from_cart(item_id: int, request: Request, db: Session = Depends(database.get_db)):
    current_user = get_current_user_from_request(request, db)
    cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    if not cart: raise HTTPException(status_code=404, detail="Корзина не найдена")
    cart_item = db.query(models.CartItem).filter(models.CartItem.id == item_id, models.CartItem.cart_id == cart.id).first()
    if not cart_item: raise HTTPException(status_code=404, detail="Товар не найден")
    db.delete(cart_item)
    db.commit()
    return {"status": "success"}

@app.put("/api/cart/{item_id}", response_model=schemas.CartOut)
async def update_cart_item(
    item_id: int, 
    request: Request, 
    quantity: int = Form(..., ge=1, le=100), 
    db: Session = Depends(database.get_db)
):
    current_user = get_current_user_from_request(request, db)
    
    cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    if not cart:
        raise HTTPException(status_code=404, detail="Корзина не найдена")
    
    cart_item = db.query(models.CartItem).filter(
        models.CartItem.id == item_id,
        models.CartItem.cart_id == cart.id
    ).first()
    
    if not cart_item:
        raise HTTPException(status_code=404, detail="Товар не найден в корзине")
    
    product = db.query(models.Product).filter(models.Product.id == cart_item.product_id).first()
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Товар больше не доступен")
    
    # 🔥 ПРОВЕРКА ОСТАТКОВ при обновлении количества
    if product.stock < quantity:
        raise HTTPException(
            status_code=400, 
            detail=f"Недостаточно товара на складе. Доступно: {product.stock} шт."
        )
    
    cart_item.quantity = quantity
    db.commit()
    return await get_cart(request, db)

# === ❤️ ИЗБРАННОЕ — ИСПРАВЛЕННЫЙ API ===

@app.get("/api/favorites", response_model=List[int])
async def get_favorites(request: Request, db: Session = Depends(database.get_db)):
    """Возвращает список ID товаров в избранном у текущего пользователя"""
    current_user = get_current_user_from_request(request, db)
    
    favs = db.query(models.Favorite.product_id).filter(
        models.Favorite.user_id == current_user.id
    ).all()
    
    # Возвращаем просто список ID: [1, 5, 12]
    return [f[0] for f in favs]

@app.post("/api/favorites", status_code=201)
async def add_to_favorites(
    request: Request, 
    data: schemas.FavoriteCreate, 
    db: Session = Depends(database.get_db)
):
    """Добавить товар в избранное"""
    current_user = get_current_user_from_request(request, db)
    
    product = db.get(models.Product, data.product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=404, detail="Товар не найден")
    
    existing = db.query(models.Favorite).filter(
        models.Favorite.user_id == current_user.id,
        models.Favorite.product_id == data.product_id
    ).first()
    
    if existing:
        return {"status": "already_exists"}
    
    new_fav = models.Favorite(user_id=current_user.id, product_id=data.product_id)
    db.add(new_fav)
    db.commit()
    
    return {"status": "added", "product_id": data.product_id}

@app.delete("/api/favorites/{product_id}", status_code=200)
async def remove_from_favorites(
    request: Request, 
    product_id: int, 
    db: Session = Depends(database.get_db)
):
    """Удалить товар из избранного"""
    current_user = get_current_user_from_request(request, db)
    
    fav = db.query(models.Favorite).filter(
        models.Favorite.user_id == current_user.id,
        models.Favorite.product_id == product_id
    ).first()
    
    if not fav:
        raise HTTPException(status_code=404, detail="Не найдено в избранном")
    
    db.delete(fav)
    db.commit()
    
    return {"status": "deleted", "product_id": product_id}

# === ЗАКАЗЫ ===

@app.post("/api/orders", response_model=schemas.OrderOut, status_code=201)
async def create_order(order_data: schemas.OrderCreate, request: Request, db: Session = Depends(database.get_db)):
    current_user = get_current_user_from_request(request, db)
    cart = db.query(models.Cart).filter(models.Cart.user_id == current_user.id).first()
    
    if not cart or not cart.items:
        raise HTTPException(status_code=400, detail="Корзина пуста")
    
    order_items_raw, subtotal = [], 0
    
    for ci in cart.items:
        p = ci.product
        if not p or not p.is_active or p.stock < ci.quantity:
            raise HTTPException(status_code=400, detail=f"Товар '{p.name if p else 'UNKNOWN'}' недоступен")
        
        disc = calculate_item_discount(p, ci.quantity, current_user.role)
        sub = round(disc["final_price"] * ci.quantity, 2)
        
        # 🎯 Формируем словарь вручную — это надёжнее than model_validate с объектами БД
        order_items_raw.append({
            "product_id": p.id,
            "product_name": p.name,
            "quantity": ci.quantity,
            "price_at_order": p.price,
            "discount_percent": disc["discount_percent"],
            "subtotal": sub
        })
        subtotal += sub
    
    # 🎫 Применяем промокод если указан
    promo_discount, promo_used = 0, None
    if order_data.promo_code:
        res = validate_promo_code(db, order_data.promo_code, subtotal)
        if res["success"]:
            promo_discount = round(subtotal * res["discount_percent"] / 100, 2)
            promo_used = order_data.promo_code.upper()
            promo = db.query(models.PromoCode).filter(models.PromoCode.code == promo_used).first()
            if promo:
                promo.used_count += 1
    
    total = round(subtotal - promo_discount, 2)
    
    # Создаём заказ
    new_order = models.Order(
        user_id=current_user.id,
        total_amount=total,
        discount_applied=promo_discount,
        promo_code_used=promo_used,
        shipping_address=order_data.shipping_address,
        city=order_data.city,
        status="pending"
    )
    db.add(new_order)
    db.commit()
    db.refresh(new_order)  # ← Получаем new_order.id
    
    # Создаём элементы заказа и списываем со склада
    for item_data in order_items_raw:
        db.add(models.OrderItem(
            order_id=new_order.id,
            product_id=item_data["product_id"],
            quantity=item_data["quantity"],
            price_at_order=item_data["price_at_order"],
            discount_percent=item_data["discount_percent"],
            subtotal=item_data["subtotal"]
        ))
        # Списываем товар
        p = db.get(models.Product, item_data["product_id"])
        if p:
            p.stock -= item_data["quantity"]
            p.sales += item_data["quantity"]
    
    # Очищаем корзину
    db.query(models.CartItem).filter(models.CartItem.cart_id == cart.id).delete()
    db.commit()
    
    # ✅ ВОЗВРАЩАЕМ ВРУЧНУЮ СОБРАННЫЙ ОТВЕТ (без model_validate с объектами БД)
    return {
        "id": new_order.id,
        "status": new_order.status,
        "total_amount": new_order.total_amount,
        "discount_applied": new_order.discount_applied,
        "promo_code_used": new_order.promo_code_used,
        "shipping_address": new_order.shipping_address,
        "city": new_order.city,
        "items": order_items_raw  # ← Список словарей, а не объектов БД!
    }



@app.get("/api/orders", response_model=List[schemas.OrderOut])
async def get_orders(request: Request, db: Session = Depends(database.get_db)):
    current_user = get_current_user_from_request(request, db)
    
    # Получаем заказы
    if current_user.role in ["ADMIN", "MANAGER"]:
        orders = db.query(models.Order).all()
    else:
        orders = db.query(models.Order).filter(models.Order.user_id == current_user.id).all()
    
    # 🎯 Вручную формируем ответ, чтобы добавить product_name из связанных товаров
    result = []
    for order in orders:
        items_data = []
        for item in order.items:
            # Получаем название товара из связи
            product_name = item.product.name if item.product else "Удалённый товар"
            items_data.append({
                "id": item.id,
                "product_id": item.product_id,
                "product_name": product_name,  # ← Добавляем вручную!
                "quantity": item.quantity,
                "price_at_order": item.price_at_order,
                "discount_percent": item.discount_percent,
                "subtotal": item.subtotal
            })
        
        result.append({
            "id": order.id,
            "status": order.status,
            "total_amount": order.total_amount,
            "discount_applied": order.discount_applied,
            "promo_code_used": order.promo_code_used,
            "shipping_address": order.shipping_address,
            "city": order.city,
            "items": items_data  # ← Список словарей, а не объектов БД
        })
    
    return result

@app.get("/api/health")
def health():
    return {"status": "ok", "api": "VioBlack Market v1.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)