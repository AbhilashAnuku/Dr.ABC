FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# uv = the fast, deterministic Python installer / lockfile tool.
# Pinned to a recent stable so layer caching is predictable.
RUN pip install --no-cache-dir uv==0.5.4

WORKDIR /app

# Copy only pyproject first so the deps layer stays cached when source changes.
COPY pyproject.toml ./
RUN uv pip install --system --no-cache .

COPY app ./app

EXPOSE 8001

# Single worker for V0 (most heavy work is per-request); scale via the
# orchestrator running multiple containers when imaging gets real.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
