# === PyMySQL patch — ПЕРВЫЙ импорт! ===
import pymysql
pymysql.install_as_MySQLdb()

from sqlalchemy import create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

DB_USER = os.getenv("DB_USER", "vio_user")
DB_PASSWORD = os.getenv("DB_PASSWORD", "vio_pass123")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "3306")
DB_NAME = os.getenv("DB_NAME", "vioblack_market")
USE_MYSQL = os.getenv("USE_MYSQL", "true").lower() == "true"

MYSQL_URL = f"mysql+pymysql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}?charset=utf8mb4"
SQLITE_URL = "sqlite:///./market.db"

if USE_MYSQL:
    try:
        engine = create_engine(
            MYSQL_URL,
            pool_pre_ping=True,
            pool_recycle=3600,
            echo=False,
            connect_args={"init_command": "SET sql_mode='STRICT_TRANS_TABLES'"}
        )
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"✅ MySQL подключён: {DB_NAME}@{DB_HOST}:{DB_PORT}")
    except Exception as e:
        print(f"⚠️ MySQL ошибка: {e} | 🔄 Переход на SQLite")
        engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False}, echo=False)
else:
    engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False}, echo=False)
    print(f"📁 Используем SQLite")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

__all__ = ["engine", "SessionLocal", "Base", "get_db"]