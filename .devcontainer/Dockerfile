FROM ubuntu:25.10

# Create non-privileged user
RUN useradd -m -s /bin/bash devuser

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    git \
    build-essential \
    ca-certificates \
    sudo \
    unzip \
    fontconfig \
    coreutils \
    dbus-x11 \
    && rm -rf /var/lib/apt/lists/*

# Give devuser sudo access
RUN echo "devuser ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Switch to devuser for installations
USER devuser
WORKDIR /home/devuser

# Install uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/home/devuser/.local/bin:$PATH"

# Install Python 3.14 via uv and create a persistent venv
RUN uv python install 3.14
RUN uv venv --python 3.14 /home/devuser/.venv

# Put venv on PATH so uvicorn/python/pip just work in every terminal
ENV PATH="/home/devuser/.venv/bin:$PATH"

# Install Volta (Node version manager)
RUN curl https://get.volta.sh | bash
ENV VOLTA_HOME="/home/devuser/.volta"
ENV PATH="$VOLTA_HOME/bin:$PATH"

# Install Oh My Posh
RUN curl -s https://ohmyposh.dev/install.sh | bash -s

# Install FiraCode Nerd Font
RUN mkdir -p ~/.local/share/fonts && \
    cd ~/.local/share/fonts && \
    curl -fLO https://github.com/ryanoasis/nerd-fonts/releases/latest/download/FiraCode.zip && \
    unzip -q FiraCode.zip && \
    rm FiraCode.zip && \
    fc-cache -fv

# Download and apply custom Oh My Posh theme
RUN mkdir -p ~/.config/ohmyposh && \
    curl -fsSL https://raw.githubusercontent.com/unseensnick/oh-my-posh/main/themes/gothic-plague-2025.omp.json \
    -o ~/.config/ohmyposh/gothic-plague-2025.omp.json && \
    echo 'eval "$(oh-my-posh init bash --config ~/.config/ohmyposh/gothic-plague-2025.omp.json)"' >> ~/.bashrc

WORKDIR /workspace