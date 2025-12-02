# Use official Node.js LTS image as the base
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY mongodb_dashboard_backend/package*.json ./

# Install dependencies (production only)
ENV NODE_OPTIONS="--max_old_space_size=256 --heapsnapshot-near-heap-limit=1"
# Avoid browserslist update prompts/noise in backend container
ENV BROWSERSLIST_DISABLE_CACHE=1
ENV NODE_ENV=production
RUN npm ci --only=production || npm install --production --no-audit --no-fund

# Copy the rest of the application code
COPY mongodb_dashboard_backend/ ./

# Expose port
EXPOSE 3001

# Command to run the app (production start; exits non-zero on failure)
CMD ["npm", "start"]
