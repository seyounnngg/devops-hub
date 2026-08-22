# Django (detected via manage.py)
FROM python:3.12-slim

WORKDIR /app

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
