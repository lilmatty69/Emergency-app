FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py BUILD_STAMP ./

CMD ["/bin/sh", "-c", "exec uvicorn server:app --host 0.0.0.0 --port ${PORT:-8000}"]
