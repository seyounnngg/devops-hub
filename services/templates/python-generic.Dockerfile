# Generic Python (requirements.txt/pyproject.toml present, but no recognized
# framework). Best-effort — tries common entrypoint filenames in order.
FROM python:3.12-slim

WORKDIR /app

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi

ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["sh", "-c", "python app.py || python main.py || python run.py || python server.py"]
