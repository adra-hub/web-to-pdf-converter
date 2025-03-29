#!/bin/bash

# Log the beginning of the script
echo "Starting Vercel build script for Chrome dependencies..."

# Check if running as root (for apt-get)
if [ "$(id -u)" != "0" ]; then
   echo "This script must be run as root" 
   echo "Current user: $(whoami)"
   echo "Will try to continue anyway..."
fi

# Print working directory and environment info
echo "Working directory: $(pwd)"
echo "Node version: $(node -v)"
echo "System info: $(uname -a)"

# Install Chrome dependencies
echo "Updating package lists..."
apt-get update || { echo "Failed to update package lists. Continuing..."; }

echo "Installing Chrome dependencies..."
apt-get install -y \
    libnss3 \
    libnss3-dev \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libx11-xcb1 || { echo "Failed to install dependencies. Continuing..."; }

# Check if libnss3.so exists
echo "Checking for libnss3.so..."
find / -name libnss3.so 2>/dev/null || echo "libnss3.so not found"

# Try to copy libnss3.so to a location in the PATH if found
if [ -f /usr/lib/x86_64-linux-gnu/libnss3.so ]; then
  echo "Found libnss3.so, copying to /tmp"
  cp /usr/lib/x86_64-linux-gnu/libnss3.so /tmp/
  
  # Create a lib directory in the function's directory
  mkdir -p ./.vercel/output/functions/_lib
  cp /usr/lib/x86_64-linux-gnu/libnss3.so ./.vercel/output/functions/_lib/ || echo "Failed to copy to .vercel output path"
  
  echo "libnss3.so copied to /tmp and to .vercel/output/functions/_lib/"
fi

# Log paths for debugging
echo "PATH: $PATH"
echo "LD_LIBRARY_PATH: $LD_LIBRARY_PATH"

# List installed packages related to Chrome
echo "Checking installed Chrome-related packages:"
dpkg -l | grep -i nss

# List contents of /tmp directory
echo "Contents of /tmp directory:"
ls -la /tmp

# Log success
echo "Vercel build script completed!"

# Continue with the normal build process
exit 0
