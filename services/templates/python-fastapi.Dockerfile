# FastAPI (detected via "fastapi" in requirements.txt/pyproject.toml)
FROM python:3.12-slim

WORKDIR /app

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN pip install --no-cache-dir uvicorn

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Try the common module locations for the FastAPI `app` instance in order.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port 8000 || uvicorn app.main:app --host 0.0.0.0 --port 8000 || uvicorn src.main:app --host 0.0.0.0 --port 8000"]
