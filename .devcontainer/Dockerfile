FROM debian:trixie-slim

RUN useradd -m -s /bin/bash -u 1001 devuser

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    ca-certificates \
    sudo \
    unzip \
    fontconfig \
    coreutils \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

RUN curl -fsSL "https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local/bin uv-x86_64-unknown-linux-gnu/uv

USER devuser
WORKDIR /home/devuser

RUN uv python install 3.14
RUN uv venv --python 3.14 /home/devuser/.venv
ENV PATH="/home/devuser/.venv/bin:$PATH"

# Playwright + Chromium for the Drive scrape path (POST /api/patreon/ingest-drive-link).
# Pre-baked into the image so the postStartCommand doesn't have to download
# ~180 MB on every container restart. The matching `playwright==1.59.0` pin is
# in backend/requirements.txt, kept in lockstep.
#
# `uv pip install --python <venv>/bin/python` (not `<venv>/bin/pip install`)
# because uv 0.4+ stopped seeding pip into the venv by default. Same pattern
# the postStartCommand uses for installing requirements.txt.
RUN uv pip install --python /home/devuser/.venv/bin/python --no-cache-dir playwright==1.59.0 \
    && /home/devuser/.venv/bin/playwright install --with-deps chromium

RUN curl https://get.volta.sh | bash
ENV VOLTA_HOME="/home/devuser/.volta"
ENV PATH="$VOLTA_HOME/bin:$PATH"

# patreon-dl is installed at devcontainer-start time via .devcontainer/devcontainer.json
# (postStartCommand) so the version stays pinned alongside the production image.

RUN curl -s https://ohmyposh.dev/install.sh | bash -s

RUN mkdir -p ~/.local/share/fonts && \
    cd ~/.local/share/fonts && \
    curl -fLO https://github.com/ryanoasis/nerd-fonts/releases/latest/download/FiraCode.zip && \
    unzip -q FiraCode.zip && \
    rm FiraCode.zip && \
    fc-cache -fv

# Stub out dbus-send so oh-my-posh doesn't spam the terminal
RUN mkdir -p ~/.local/bin && \
    printf '#!/bin/sh\n' > ~/.local/bin/dbus-send && \
    chmod +x ~/.local/bin/dbus-send

RUN mkdir -p ~/.config/ohmyposh && \
    curl -fsSL https://raw.githubusercontent.com/unseensnick/oh-my-posh/main/themes/gothic-plague-2025.omp.json \
    -o ~/.config/ohmyposh/gothic-plague-2025.omp.json && \
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && \
    echo 'eval "$(oh-my-posh init bash --config ~/.config/ohmyposh/gothic-plague-2025.omp.json)"' >> ~/.bashrc

WORKDIR /workspace