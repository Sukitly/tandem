FROM node:24.19.0-slim

ARG APT_MIRROR=""

# Install system dependencies, git, and search tools (optionally switch apt mirror via build-arg)
RUN if [ -n "${APT_MIRROR}" ]; then \
      (sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list.d/debian.sources 2>/dev/null || sed -i "s|deb.debian.org|${APT_MIRROR}|g" /etc/apt/sources.list 2>/dev/null || true); \
    fi \
  && apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    wget \
    ca-certificates \
    openssh-client \
    procps \
    jq \
    unzip \
    ripgrep \
    fd-find \
    python3 \
    build-essential \
  && ln -s /usr/bin/fdfind /usr/local/bin/fd \
  && rm -rf /var/lib/apt/lists/*

# Install cloudflared for Tandem public access integration
RUN ARCH=$(dpkg --print-architecture) \
  && curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}" -o /usr/local/bin/cloudflared \
  && chmod +x /usr/local/bin/cloudflared

# Install Bun package manager
ENV BUN_INSTALL="/root/.bun"
ENV PATH="${BUN_INSTALL}/bin:${PATH}"
RUN curl -fsSL https://bun.sh/install | bash

# Install uv modern Python package manager & enable corepack for pnpm/yarn
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh \
  && corepack enable

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock* ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/client/package.json ./packages/client/
COPY packages/contracts/package.json ./packages/contracts/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy project source code
COPY . .

# Build frontend and package bundles
RUN bun run build

# Configure SSH client defaults (auto-accept new host keys for non-interactive agent execution)
RUN mkdir -p /etc/ssh/ssh_config.d /data /workspace /root/.ssh \
  && chmod 700 /root/.ssh \
  && echo "Host *\n  StrictHostKeyChecking accept-new\n  ServerAliveInterval 60\n" > /etc/ssh/ssh_config.d/tandem.conf

# Create mount points for persistent state and project workspaces
RUN mkdir -p /data /workspace

ENV TANDEM_HOME=/data
ENV TANDEM_HOST=0.0.0.0
ENV PORT=4820

EXPOSE 4820

VOLUME ["/data", "/workspace"]

CMD ["node", "apps/server/src/main.ts", "--no-open", "--host", "0.0.0.0", "--port", "4820"]
