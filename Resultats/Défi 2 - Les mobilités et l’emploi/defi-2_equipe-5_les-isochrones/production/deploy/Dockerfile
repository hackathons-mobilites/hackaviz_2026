# FastAPI app serving the dataviz: / (story), /explorer, /static
# Serving only needs FastAPI + uvicorn (versions from uv.lock); the isochrones/ pipeline is not shipped.
FROM python:3.12-slim

WORKDIR /srv

RUN pip install --no-cache-dir "fastapi==0.162.0" "uvicorn==0.54.0"

COPY app/ /srv/app/

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/')" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
