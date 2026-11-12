# Build stage
FROM node:22-alpine AS build

WORKDIR /app

# Install all dependencies (including devDependencies for building)
COPY package*.json ./
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the frontend and backend (tsc -b && vite build)
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend, frontend assets, and required files from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/index.js ./server/index.js
# Optionally, if you have other files in server like static assets, you'd copy them too

# Ensure the server directory exists for data.json to be created
RUN mkdir -p /app/server

# Environment variables
ENV NODE_ENV=production
ENV PORT=8787
ENV API_HOST=0.0.0.0

# Expose the application port
EXPOSE 8787

# Run the compiled Node app
CMD ["node", "server/index.js"]
