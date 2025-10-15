# Use official Node.js LTS image as the base
FROM node:18-alpine

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY mongodb_dashboard_backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application code
COPY mongodb_dashboard_backend/ ./

# Expose port (adjust if your app listens on a different port)
EXPOSE 7001

# Command to run the app
#CMD ["node", "-r", "dotenv/config", "src/server.js"]
CMD ["node", "src/server.js"]
