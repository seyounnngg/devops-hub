# Flask (detected via "flask" in requirements.txt/pyproject.toml)
# Make sure app.run() uses host="0.0.0.0" — 127.0.0.1 is not reachable from
# outside the container.
FROM python:3.12-slim

WORKDIR /app

COPY . .

RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install --no-cache-dir .; fi
RUN pip install --no-cache-dir flask

ENV PYTHONUNBUFFERED=1

EXPOSE 5000

# Try common entrypoint filenames in order — student projects don't follow one convention.
CMD ["sh", "-c", "python app.py || python main.py || python run.py || python wsgi.py"]
