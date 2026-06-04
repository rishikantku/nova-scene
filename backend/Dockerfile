FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the API port
EXPOSE 8000

# Create a data directory for db.json if we want to mount a volume
RUN mkdir -p /app/data

# Run the backend
CMD ["npm", "start"]
