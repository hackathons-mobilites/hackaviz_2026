# API et collecteur AtouVent. Publiée dans GitHub Packages : ghcr.io/bricebokatola/atouvent-api
FROM python:3.12-slim
LABEL org.opencontainers.image.source="https://github.com/BriceBOKATOLA/atouvent" \
      org.opencontainers.image.description="AtouVent : API et collecteur de données (mobilités et climat, Île-de-France)" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
# Ne pas tourner en root
RUN useradd --system --uid 10001 atouvent
USER atouvent
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--no-server-header"]
